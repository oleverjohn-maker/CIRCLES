import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, getDocs, arrayUnion, arrayRemove, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

/* ---------------- helpers ---------------- */
const $app = document.getElementById("app");
const pad = n => String(n).padStart(2, "0");
const ds = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const todayDate = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const T = () => ds(todayDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00") - new Date(a + "T00:00")) / 864e5);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uidShort = () => Math.random().toString(36).slice(2, 10);
const COLORS = ["#0E6B5A", "#2F6FB0", "#7A4BB5", "#B5541F", "#C2416B", "#3E7D2E", "#8A6A12", "#4F5B66"];
const tickSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CARE_WORDS = ["suicide", "kill myself", "end my life", "want to die", "self harm", "self-harm", "hurt myself", "cut myself", "no reason to live"];
const needsCare = t => CARE_WORDS.some(w => t.toLowerCase().includes(w));

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}
function avatar(p, size = "") {
  const name = (p && p.nickname) || "?";
  const color = (p && p.color) || COLORS[7];
  return `<span class="av ${size}" style="background:${esc(color)}" aria-hidden="true">${esc(name.trim().charAt(0).toUpperCase())}</span>`;
}
function ago(ts) {
  if (!ts) return "just now";
  const m = Math.round((Date.now() - ts) / 6e4);
  if (m < 1) return "just now"; if (m < 60) return m + " min ago";
  const h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
  const d = Math.round(h / 24); return d === 1 ? "yesterday" : d + " days ago";
}
const tsOf = v => (v && v.toMillis ? v.toMillis() : 0);

/* ---------------- habit maths ---------------- */
function streak(h) {
  const log = h.log || {}; let d = log[T()] ? todayDate() : addDays(todayDate(), -1), n = 0;
  while (log[ds(d)]) { n++; d = addDays(d, -1); } return n;
}
function cleanDays(h) { const last = (h.slips || []).slice().sort().pop(); return Math.max(0, daysBetween(last || h.start, T())); }
function weekStates(h) {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const k = ds(addDays(todayDate(), -i));
    out.push(h.type === "build" ? ((h.log || {})[k] ? "y" : "") : ((h.slips || []).includes(k) ? "s" : (k >= h.start ? "y" : "")));
  }
  return out;
}

/* ---------------- Bible reading plans ---------------- */
const PLANS = {
  john21: { name: "Gospel of John in 21 days", book: "JHN", label: "John", n: 21 },
  mark16: { name: "Gospel of Mark in 16 days", book: "MRK", label: "Mark", n: 16 },
  psalms30: { name: "Psalms 1 to 30 in 30 days", book: "PSA", label: "Psalm", n: 30 },
  proverbs31: { name: "Proverbs in 31 days", book: "PRO", label: "Proverbs", n: 31 },
};
function planToday(c) {
  const p = c && PLANS[c.planId]; if (!p || !c.planStart) return null;
  const d = daysBetween(c.planStart, T());
  if (d >= p.n) return { p, finished: true };
  const ch = Math.max(0, d) + 1;
  return { p, day: ch, ref: p.label + " " + ch, url: "https://www.bible.com/bible/1/" + p.book + "." + ch + ".KJV" };
}
const pairId = (a, b) => [a, b].sort().join("_");
const otherOf = pr => pr.members.find(m => m !== S.user.uid);

/* ---------------- leading a Circle ---------------- */
const LEAD_DAYS = 30; // days of streak or clean time needed before someone can ask to lead a Circle
function bestRun() {
  let best = null;
  S.habits.forEach(h => {
    const days = h.type === "build" ? streak(h) : cleanDays(h);
    if (!best || days > best.days) best = { name: h.name, type: h.type, days, private: !!h.private };
  });
  return best;
}

/* ---------------- suggestions ---------------- */
const AREAS = {
  faith: { label: "Faith", sub: "Bible reading, prayer", habits: [["Read the Bible", "build"], ["Pray for 10 minutes", "build"]] },
  health: { label: "Health", sub: "Gym, sleep, water", habits: [["Go to the gym", "build"], ["Sleep before 11 pm", "build"], ["Drink 8 glasses of water", "build"]] },
  mind: { label: "Mind", sub: "Reading, less phone time", habits: [["Read for 20 minutes", "build"], ["No phone in the first hour of the day", "build"]] },
  free: { label: "Break free", sub: "Private by default", habits: [["No pornography", "quit"], ["No smoking", "quit"], ["No alcohol", "quit"]] },
};

/* ---------------- state ---------------- */
const S = {
  user: null, account: null, profile: null, isAdmin: false,
  habits: [], circles: {}, profiles: {}, nudges: [], request: null,
  buddies: [], buddyIn: [], buddyOut: [], chat: [], chatSub: null,
  view: "loading", params: {}, ob: {}, confirming: null,
  subs: [], circleSubs: [],
};
const invite = (() => {
  const q = new URLSearchParams(location.search);
  const c = q.get("join"), k = q.get("code");
  if (c && k) { try { sessionStorage.setItem("circles-invite", JSON.stringify({ c, k })); } catch (e) {} history.replaceState(null, "", location.pathname); }
  try { return JSON.parse(sessionStorage.getItem("circles-invite")); } catch (e) { return null; }
})();
let pendingInvite = invite;
let pendingFriend = (() => {
  const q = new URLSearchParams(location.search), f = q.get("friend");
  if (f) { try { sessionStorage.setItem("circles-friend", f); } catch (e) {} history.replaceState(null, "", location.pathname); }
  try { return sessionStorage.getItem("circles-friend"); } catch (e) { return f; }
})();
function clearFriendInvite() { pendingFriend = null; try { sessionStorage.removeItem("circles-friend"); } catch (e) {} }

function go(view, params = {}) {
  if (view !== "buddy" && S.chatSub) { S.chatSub(); S.chatSub = null; S.chat = []; }
  S.view = view; S.params = params; S.confirming = null;
  if (view === "buddy") openChat(params.pid);
  render(); window.scrollTo(0, 0);
}

/* ---------------- data loading ---------------- */
async function loadProfiles(ids) {
  const need = [...new Set(ids)].filter(id => id && !S.profiles[id]);
  await Promise.all(need.map(async id => {
    try { const s = await getDoc(doc(db, "profiles", id)); S.profiles[id] = s.exists() ? s.data() : { nickname: "Member" }; }
    catch (e) { S.profiles[id] = { nickname: "Member" }; }
  }));
}
function stopSubs(list) { list.forEach(u => { try { u(); } catch (e) {} }); list.length = 0; }

async function startSession(user) {
  S.user = user;
  const [acc, prof, adm] = await Promise.all([
    getDoc(doc(db, "users", user.uid)),
    getDoc(doc(db, "profiles", user.uid)),
    getDoc(doc(db, "admins", user.uid)).catch(() => null),
  ]);
  S.account = acc.exists() ? acc.data() : null;
  S.profile = prof.exists() ? prof.data() : null;
  S.isAdmin = !!(adm && adm.exists());
  if (S.profile) S.profiles[user.uid] = S.profile;

  if (!S.account || !S.account.adult) return go("ob-age");
  if (!S.profile) return go("ob-name");
  watchMine();
  if (!S.account.onboarded) return go("ob-privacy");
  if (pendingInvite && !(S.account.circles || []).includes(pendingInvite.c)) return openPromise(pendingInvite.c, pendingInvite.k);
  if (pendingFriend) return openFriendInvite(pendingFriend);
  go("today");
}

function watchMine() {
  stopSubs(S.subs);
  const uid = S.user.uid;
  S.subs.push(onSnapshot(collection(db, "users", uid, "habits"), snap => {
    S.habits = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (["today", "me"].includes(S.view)) render();
  }));
  S.subs.push(onSnapshot(doc(db, "circleRequests", uid), snap => {
    S.request = snap.exists() ? snap.data() : null;
    if (S.view === "circles") render();
  }, () => {}));
  S.subs.push(onSnapshot(query(collection(db, "buddies"), where("members", "array-contains", uid)), async snap => {
    S.buddies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await loadProfiles(S.buddies.map(otherOf));
    if (["today", "friends", "buddy", "circle"].includes(S.view)) render();
  }, () => {}));
  S.subs.push(onSnapshot(query(collection(db, "buddyReqs"), where("to", "==", uid)), async snap => {
    S.buddyIn = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await loadProfiles(S.buddyIn.map(r => r.from));
    if (["today", "friends"].includes(S.view)) render();
  }, () => {}));
  S.subs.push(onSnapshot(query(collection(db, "buddyReqs"), where("from", "==", uid)), async snap => {
    S.buddyOut = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await loadProfiles(S.buddyOut.map(r => r.to));
    if (["friends", "circle"].includes(S.view)) render();
  }, () => {}));
  S.subs.push(onSnapshot(doc(db, "users", uid), snap => {
    S.account = snap.data() || S.account;
    watchCircles();
  }));
}

function watchCircles() {
  const ids = (S.account && S.account.circles) || [];
  const key = ids.join(",");
  if (watchCircles._key === key) return;
  watchCircles._key = key;
  stopSubs(S.circleSubs);
  S.nudges = [];
  ids.forEach(cid => {
    S.circles[cid] = S.circles[cid] || { id: cid, members: [], posts: [] };
    S.circleSubs.push(onSnapshot(doc(db, "circles", cid), s => { Object.assign(S.circles[cid], s.data() || {}, { id: cid }); renderIfCircle(cid); }, () => {}));
    S.circleSubs.push(onSnapshot(collection(db, "circles", cid, "members"), async s => {
      S.circles[cid].members = s.docs.map(d => ({ uid: d.id, ...d.data() }));
      await loadProfiles(S.circles[cid].members.map(m => m.uid));
      renderIfCircle(cid);
    }, () => {}));
    S.circleSubs.push(onSnapshot(query(collection(db, "circles", cid, "posts"), orderBy("createdAt", "desc"), limit(60)), async s => {
      S.circles[cid].posts = s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
      await loadProfiles(S.circles[cid].posts.map(p => p.uid));
      renderIfCircle(cid);
    }, () => {}));
    S.circleSubs.push(onSnapshot(query(collection(db, "circles", cid, "nudges"), where("to", "==", S.user.uid)), async s => {
      S.nudges = S.nudges.filter(n => n.cid !== cid).concat(s.docs.map(d => ({ id: d.id, cid, ...d.data({ serverTimestamps: "estimate" }) })));
      await loadProfiles(S.nudges.map(n => n.from));
      if (S.view === "today") render();
    }, () => {}));
  });
  if (["today", "circles"].includes(S.view)) render();
}
function renderIfCircle(cid) {
  if ((S.view === "circle" && S.params.cid === cid) || ["today", "circles"].includes(S.view)) render();
}

/* ---------------- writes ---------------- */
async function saveHabit(h) {
  const { id, ...rest } = h;
  await setDoc(doc(db, "users", S.user.uid, "habits", id), rest);
  scheduleSummary();
}
function summaryFor() {
  const shared = S.habits.filter(h => !h.private);
  return {
    date: T(),
    shared: shared.map(h => h.type === "build"
      ? { name: h.name, type: "build", done: !!(h.log || {})[T()], streak: streak(h) }
      : { name: h.name, type: "quit", clean: cleanDays(h) }),
  };
}
let sumTimer = null;
function scheduleSummary() {
  clearTimeout(sumTimer);
  sumTimer = setTimeout(async () => {
    const s = summaryFor();
    for (const cid of (S.account.circles || [])) {
      const me = (S.circles[cid]?.members || []).find(m => m.uid === S.user.uid);
      if (!me) continue;
      try { await updateDoc(doc(db, "circles", cid, "members", S.user.uid), { summary: s, active: serverTimestamp() }); } catch (e) {}
    }
    for (const b of S.buddies) {
      try { await updateDoc(doc(db, "buddies", b.id), { ["s_" + S.user.uid]: s }); } catch (e) {}
    }
  }, 800);
}
async function postCheckin(text) {
  const s = summaryFor();
  const builds = s.shared.filter(h => h.type === "build");
  const care = needsCare(text);
  for (const cid of (S.account.circles || [])) {
    try {
      const pid = S.user.uid + "_" + T();
      const body = { uid: S.user.uid, kind: "checkin", text, care, hidden: false, done: builds.filter(h => h.done).length, total: builds.length, date: T(), createdAt: serverTimestamp() };
      const exists = (S.circles[cid]?.posts || []).some(p => p.id === pid);
      if (exists) await updateDoc(doc(db, "circles", cid, "posts", pid), body);
      else await setDoc(doc(db, "circles", cid, "posts", pid), { ...body, cheers: {} });
      await updateDoc(doc(db, "circles", cid, "members", S.user.uid), { summary: s, lastCheckIn: T(), active: serverTimestamp() });
    } catch (e) { console.error(e); }
  }
  await updateDoc(doc(db, "users", S.user.uid), { lastCheckIn: T(), lastNote: text });
  return care;
}

/* ---------------- render ---------------- */
function nav() {
  const t = (v, label, icon) => `<button data-act="nav" data-v="${v}" class="${S.view === v || (v === "circles" && S.view === "circle") || (v === "friends" && S.view === "buddy") ? "on" : ""}">${icon}<span>${label}</span></button>`;
  const iToday = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>';
  const iCircles = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>';
  const iFriends = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="9" r="3.2"/><circle cx="16.5" cy="9" r="3.2"/><path d="M2.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6M12.5 15.2c1-.6 2.4-.8 4-.8 2.5 0 4.6 1.6 5.2 4.6"/></svg>';
  const badge = S.buddyIn.length + S.buddies.filter(unread).length;
  const iMe = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  const iAdmin = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/></svg>';
  return `<nav class="tabs" aria-label="Main"><div>${t("today", "Today", iToday)}${t("circles", "Circles", iCircles)}${t("friends", "Friends" + (badge ? " (" + badge + ")" : ""), iFriends)}${t("me", "Me", iMe)}${S.isAdmin ? t("admin", "Admin", iAdmin) : ""}</div></nav>`;
}
function steps(n, total = 5) { return `<div class="steps" aria-label="Step ${n} of ${total}">${Array.from({ length: total }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</div>`; }

const views = {
  loading: () => `<div class="splash"><div class="logo-mark" aria-hidden="true"></div><p>Loading Circles…</p></div>`,

  signin: () => `<div class="hero">
      <div class="logo-mark" aria-hidden="true"></div>
      <h1>Grow together, one day at a time.</h1>
      <p class="muted">Circles helps you build good habits and break free from the ones holding you back, with a small group of people who check in with you every day.</p>
      <div class="cards3">
        <div class="soft"><b>Track your habits</b>Tick off what you did today and watch your streak grow.</div>
        <div class="soft"><b>Join a Circle</b>A small group with one shared goal, who notice when you show up.</div>
        <div class="soft"><b>Stay anonymous</b>Others only see your nickname. Your real name stays private.</div>
      </div>
      ${pendingInvite ? `<div class="soft small">You have been invited to join a Circle. Sign in to continue.</div>` : ""}
      <button class="btn block" data-act="signin">Continue with Google</button>
      <p class="small muted">This is a test version of Circles for a small group of people. It is for people aged 18 and above.</p>
    </div>`,

  "ob-age": () => `<div class="stack-lg">${steps(1)}
      <div class="stack"><h1>How old are you?</h1><p class="muted">Circles is for people aged 18 and above.</p></div>
      <div class="field"><label for="dob">Your date of birth</label><input type="date" id="dob" max="${T()}"></div>
      <p class="err" id="ageErr" hidden></p>
      <button class="btn block" data-act="age">Continue</button></div>`,

  "too-young": () => `<div class="stack-lg" style="padding-top:8vh"><h1>Not yet, but we would love to have you later.</h1>
      <p class="muted">Circles is only for people aged 18 and above for now. We have not saved anything about you. Please come back when you turn 18.</p>
      <button class="btn ghost block" data-act="signout">Close</button></div>`,

  "ob-name": () => {
    const c = S.ob.color || COLORS[0], n = S.ob.nickname || "";
    return `<div class="stack-lg">${steps(2)}
      <div class="stack"><h1>Choose a nickname</h1><p class="muted">This is the only name other people in Circles will see. Your real name from Google stays private.</p></div>
      <div class="row">${avatar({ nickname: n || "?", color: c }, "lg")}<div><b>${esc(n || "Your nickname")}</b><p class="small muted">This is how others will see you</p></div></div>
      <div class="field"><label for="nick">Nickname</label><input type="text" id="nick" maxlength="24" value="${esc(n)}" placeholder="For example: Morning Runner" autocomplete="off"></div>
      <div class="field"><label>Colour</label><div class="swatches">${COLORS.map(x => `<button class="swatch ${x === c ? "on" : ""}" style="background:${x}" data-act="color" data-c="${x}" aria-label="Choose this colour"></button>`).join("")}</div></div>
      <p class="err" id="nickErr" hidden></p>
      <button class="btn block" data-act="saveName">Continue</button></div>`;
  },

  "ob-privacy": () => `<div class="stack-lg">${steps(3)}
      <div class="stack"><h1>What others can see</h1><p class="muted">Circles is a safe space. Here is exactly what is shared.</p></div>
      <div class="stack">
        <div class="card"><b>Only your nickname</b><p class="muted small">People in your Circles see your nickname and colour. Never your real name, email or photo.</p></div>
        <div class="card"><b>Only the habits you share</b><p class="muted small">Every habit has a privacy switch. Habits you keep private are seen by nobody else.</p></div>
        <div class="card"><b>Only what you choose to write</b><p class="muted small">Your daily check in and posts are seen only by members of your Circle.</p></div>
      </div>
      <button class="btn block" data-act="privacyOk">I understand</button></div>`,

  "ob-areas": () => {
    const sel = S.ob.areas || [];
    return `<div class="stack-lg">${steps(4)}
      <div class="stack"><h1>What do you want to work on?</h1><p class="muted">Pick one or more. You can change this any time.</p></div>
      <div class="choices">${Object.entries(AREAS).map(([k, a]) => `<button class="choice ${sel.includes(k) ? "on" : ""}" data-act="area" data-k="${k}" aria-pressed="${sel.includes(k)}"><b>${a.label}</b><small>${a.sub}</small></button>`).join("")}</div>
      <button class="btn block" data-act="areasNext" ${sel.length ? "" : "disabled"}>Continue</button>
      <button class="link" data-act="skipHabits">Skip for now</button></div>`;
  },

  "ob-habits": () => {
    const list = S.ob.suggest || [];
    return `<div class="stack-lg">${steps(5)}
      <div class="stack"><h1>Your first habits</h1><p class="muted">Untick anything you do not want. Habits you are quitting are private unless you choose to share them.</p></div>
      <div class="stack">${list.map((h, i) => `<div class="card stack">
          <label class="row" style="justify-content:space-between"><span><b>${esc(h.name)}</b><span class="tag ${h.type}">${h.type === "build" ? "Build" : "Quit"}</span></span>
          <input type="checkbox" data-act="sugOn" data-i="${i}" ${h.on ? "checked" : ""} aria-label="Keep ${esc(h.name)}" style="width:22px;height:22px"></label>
          ${h.on && h.type === "quit" ? `<div class="field"><label for="since${i}" class="small">When did you last do this? Your days clean count from here.</label><input type="date" id="since${i}" data-act="sugSince" data-i="${i}" value="${h.since || T()}" max="${T()}"></div>` : ""}
          ${h.on ? `<label class="row small"><input type="checkbox" data-act="sugShare" data-i="${i}" ${h.share ? "checked" : ""}> Let my Circle see this habit</label>` : ""}
        </div>`).join("")}
        <div class="card stack"><div class="field"><label for="customH">Add your own habit</label><input type="text" id="customH" maxlength="60" placeholder="For example: Call my parents"></div>
          <div class="row"><button class="btn small ghost" data-act="addCustom" data-t="build">Add as Build</button><button class="btn small ghost" data-act="addCustom" data-t="quit">Add as Quit</button></div></div>
      </div>
      <button class="btn block" data-act="saveHabits">Continue</button></div>`;
  },

  "ob-find": () => `<div class="stack-lg">
      <div class="stack"><h1>Find your people</h1><p class="muted">Circles are small groups with one goal. Ask your Circle leader for the Circle code, or open the invite link they sent you.</p></div>
      ${joinForm()}
      <button class="link" data-act="finishOb">Skip for now</button></div>`,

  promise: () => {
    const c = S.params.preview || {};
    return `<div class="stack-lg">
      <div class="stack"><p class="label">You are joining</p><h1>${esc(c.name || "a Circle")}</h1>${c.goal ? `<p class="muted">${esc(c.goal)}</p>` : ""}</div>
      <div class="card stack"><h2>The Circle promise</h2>
        <ol class="stack" style="margin:0;padding-left:20px">
          <li>I will be honest about my own struggles, and never judge anyone else's.</li>
          <li>I will not share sexual content or explicit images of any kind.</li>
          <li>I will not harass or threaten anyone, or share anyone's private details.</li>
          <li>I will not sell, promote or recruit.</li>
          <li>What is shared in this Circle stays in this Circle.</li>
        </ol></div>
      <p class="err" id="joinErr" hidden></p>
      <button class="btn block" data-act="promise">I promise</button>
      <button class="link" data-act="${S.account && S.account.onboarded ? "nav" : "finishOb"}" data-v="circles">Not now</button></div>`;
  },

  today: () => {
    const hs = S.habits, builds = hs.filter(h => h.type === "build"), done = builds.filter(h => (h.log || {})[T()]).length;
    const name = (S.profile && S.profile.nickname) || "friend";
    const checked = S.account && S.account.lastCheckIn === T();
    const nudges = S.nudges.filter(n => Date.now() - tsOf(n.createdAt) < 3 * 864e5).sort((a, b) => tsOf(b.createdAt) - tsOf(a.createdAt));
    const myCircles = (S.account.circles || []).map(id => S.circles[id]).filter(Boolean);
    return `<div class="stack-lg">
      <div class="stack"><p class="label">${todayDate().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1>Hello, ${esc(name)}</h1>
        <div class="row" style="flex-wrap:nowrap"><div class="bar" style="flex:1"><i style="width:${builds.length ? done / builds.length * 100 : 0}%"></i></div><b>${done} of ${builds.length}</b></div></div>
      ${nudges.length ? `<div class="inbox">${nudges.slice(0, 5).map(n => `<div class="note">${avatar(S.profiles[n.from], "sm")}<div><b>${esc((S.profiles[n.from] || {}).nickname || "Someone")}</b> ${n.kind === "cheer" ? "is cheering you on" : "sent you a gentle nudge"}<p class="small muted">${ago(tsOf(n.createdAt))}</p></div><button class="link" data-act="dismissNudge" data-cid="${esc(n.cid)}" data-id="${esc(n.id)}" aria-label="Dismiss">Dismiss</button></div>`).join("")}</div>` : ""}
      ${S.buddyIn.length || S.buddies.some(unread) ? `<div class="inbox">${S.buddyIn.map(r => `<div class="note">${avatar(S.profiles[r.from], "sm")}<div><b>${esc((S.profiles[r.from] || {}).nickname || "Someone")}</b> wants to be your buddy</div><button class="btn small" data-act="nav" data-v="friends">See</button></div>`).join("")}${S.buddies.filter(unread).map(b => `<div class="note">${avatar(S.profiles[otherOf(b)], "sm")}<div><b>${esc((S.profiles[otherOf(b)] || {}).nickname || "Your buddy")}</b> sent you a message</div><button class="btn small" data-act="openBuddy" data-pid="${esc(b.id)}">Open</button></div>`).join("")}</div>` : ""}
      <section class="stack"><h2>Today's habits</h2>${hs.length ? hs.map(habitCard).join("") : `<div class="empty">You have no habits yet.<button class="btn small" data-act="nav" data-v="me">Add a habit</button></div>`}</section>
      ${(S.account.circles || []).length ? `<section class="stack"><h2>Your check in</h2>
        <div class="card stack">${checked ? `<p class="small muted">You checked in today. You can update it.</p>` : `<p class="small muted">Write one line about your day. Your Circle will see it with your shared habits.</p>`}
          <textarea id="checkText" maxlength="500" placeholder="For example: Went to the gym and read two chapters.">${esc(checked ? S.account.lastNote || "" : "")}</textarea>
          <button class="btn" data-act="checkin">${checked ? "Update check in" : "Share my check in"}</button>
          <div id="careSlot"></div></div></section>` : ""}
      <section class="stack"><h2>Your Circles</h2>${myCircles.length ? myCircles.map(c => {
        const ms = c.members || [], ci = ms.filter(m => m.lastCheckIn === T()).length;
        const pt = planToday(c);
        return `<button class="card circle-card" data-act="openCircle" data-cid="${esc(c.id)}"><b>${esc(c.name || "Circle")}</b><span class="small muted">${ci} of ${ms.length} checked in today</span>${pt && pt.ref ? `<span class="small">Today's reading: <b>${esc(pt.ref)}</b></span>` : ""}</button>`;
      }).join("") : `<div class="empty">You have not joined a Circle yet.<button class="btn small" data-act="nav" data-v="circles">Find a Circle</button></div>`}</section>
    </div>${nav()}`;
  },

  circles: () => {
    const mine = (S.account.circles || []).map(id => S.circles[id]).filter(Boolean);
    return `<div class="stack-lg"><h1>Circles</h1>
      ${mine.length ? `<section class="stack">${mine.map(c => `<button class="card circle-card" data-act="openCircle" data-cid="${esc(c.id)}"><b>${esc(c.name || "Circle")}</b><span class="small muted">${esc(c.goal || "")}</span><span class="small muted">${(c.members || []).length} members</span></button>`).join("")}</section>` : ""}
      <section class="stack"><h2>Join a Circle</h2><p class="muted small">Ask your Circle leader for the Circle code, or open the invite link they sent you.</p>${joinForm()}</section>
      <section class="stack"><h2>Lead your own Circle</h2>${leadSection()}</section>
    </div>${nav()}`;
  },

  circle: () => {
    const c = S.circles[S.params.cid];
    if (!c) return `<div class="empty">This Circle could not be found.</div>${nav()}`;
    const me = S.user.uid, isLead = c.leaderUid === me || S.isAdmin;
    const ms = (c.members || []).slice().sort((a, b) => (b.lastCheckIn === T()) - (a.lastCheckIn === T()));
    const posts = (c.posts || []).filter(p => !p.hidden || isLead);
    const sel = S.params.member;
    const selM = sel && ms.find(m => m.uid === sel);
    return `<div class="stack-lg">
      <div class="stack"><button class="back" data-act="nav" data-v="circles">‹ Circles</button>
        <h1>${esc(c.name || "Circle")}</h1>${c.goal ? `<p class="muted">${esc(c.goal)}</p>` : ""}
        ${c.leaderUid ? `<p class="small muted">Led by <b>${esc((S.profiles[c.leaderUid] || {}).nickname || "the Circle leader")}</b></p>` : ""}</div>
      ${planSection(c, ms, isLead)}
      <section class="stack"><div class="row" style="justify-content:space-between"><h2>Members</h2><span class="small muted">${ms.filter(m => m.lastCheckIn === T()).length} of ${ms.length} checked in today</span></div>
        <div class="members">${ms.map(m => `<button class="member" data-act="pickMember" data-uid="${esc(m.uid)}">${avatar(S.profiles[m.uid]).replace('class="av ', `class="av ${m.lastCheckIn === T() ? "done" : ""} `)}<span>${esc((S.profiles[m.uid] || {}).nickname || "Member")}${m.uid === me ? " (you)" : ""}</span></button>`).join("")}</div>
        ${selM ? memberPanel(c, selM, isLead) : ""}</section>
      ${c.leaderUid === me && (ms.find(m => m.uid === me) || {}).code ? invitePanel(ms.find(m => m.uid === me).code, c.id) : ""}
      <section class="stack"><h2>Write to your Circle</h2>
        <div class="card stack"><textarea id="postText" maxlength="1000" placeholder="Share a struggle, a win, a prayer request or some encouragement."></textarea>
          <button class="btn" data-act="post">Post</button><div id="careSlot2"></div></div></section>
      <section class="stack"><h2>Circle feed</h2>${posts.length ? posts.map(p => postCard(c, p, isLead)).join("") : `<div class="empty">Nothing here yet. Be the first to say hello.</div>`}</section>
      <section class="stack"><button class="link" data-act="leaveAsk">Leave this Circle</button>
        ${S.confirming === "leave" ? `<div class="confirm">Leave ${esc(c.name)}? Your posts stay, but you will stop seeing this Circle.<button class="btn small danger" data-act="leave">Leave</button><button class="btn small ghost" data-act="cancel">Stay</button></div>` : ""}</section>
    </div>${nav()}`;
  },

  me: () => {
    const p = S.profile || {};
    return `<div class="stack-lg"><div class="row">${avatar(p, "lg")}<div><h1>${esc(p.nickname)}</h1><p class="small muted">Private: ${esc(S.account.realName || "")}, ${esc(S.user.email || "")}</p></div></div>
      <section class="stack"><h2>Your habits</h2>${S.habits.map(h => `<div class="card habit"><div><div class="hname">${esc(h.name)}<span class="tag ${h.type}">${h.type === "build" ? "Build" : "Quit"}</span>${h.private ? '<span class="tag priv">Private</span>' : ""}</div></div>
          <div class="hactions"><button class="link" data-act="togglePriv" data-id="${esc(h.id)}">${h.private ? "Share with my Circles" : "Make private"}</button><button class="link" data-act="delAsk" data-id="${esc(h.id)}">Remove</button></div>
          ${S.confirming === "del" + h.id ? `<div class="confirm">Remove this habit and all its history?<button class="btn small danger" data-act="delHabit" data-id="${esc(h.id)}">Remove</button><button class="btn small ghost" data-act="cancel">Keep it</button></div>` : ""}</div>`).join("")}
        <div class="card stack"><div class="field"><label for="newH">Add a habit</label><input type="text" id="newH" maxlength="60" placeholder="For example: Read 10 pages"></div>
          <div class="choices"><label class="choice"><input type="radio" name="newT" value="build" checked><b>Build</b><small>Tick it off each day</small></label><label class="choice"><input type="radio" name="newT" value="quit"><b>Quit</b><small>Count days clean</small></label></div>
          <label class="row small"><input type="checkbox" id="newShare" checked> Let my Circles see this habit</label>
          <button class="btn" data-act="addHabit">Add habit</button></div></section>
      <section class="stack"><h2>Daily reminder</h2><div class="card stack">
        <p class="small muted">Pick a time and add a daily reminder to your phone's calendar, so you never forget to check in.</p>
        <div class="field"><label for="remTime">Remind me every day at</label><input type="time" id="remTime" value="${esc(S.ob.remTime || "20:00")}"></div>
        <div class="row"><button class="btn small" data-act="remGoogle">Add to Google Calendar</button><button class="btn small ghost" data-act="remIcs">Download for iPhone or other calendars</button></div>
      </div></section>
      <section class="stack"><h2>Need to talk to someone?</h2><div class="care-card"><p>If you are having thoughts of hurting yourself, please call <b>Tele MANAS on 14416</b>. It is free and open day and night. In an emergency, call <b>112</b>.</p></div></section>
      <section class="stack"><h2>About this test</h2><p class="small muted">This is a test version of Circles. Your data may be reset when the test ends. Circles offers support from people who care. It does not replace a doctor or counsellor.</p>
        <button class="btn ghost" data-act="signout">Sign out</button></section>
    </div>${nav()}`;
  },

  friends: () => {
    const link = S.account.myInvite ? location.origin + location.pathname + "?friend=" + S.account.myInvite : "";
    return `<div class="stack-lg"><h1>Friends</h1>
      <p class="muted">Buddies are friends who keep each other going. They see the habits you share, can cheer or nudge you, and you can chat privately. Nobody becomes your buddy unless you both agree.</p>
      ${S.buddyIn.length ? `<section class="stack"><h2>Requests for you</h2>${S.buddyIn.map(r => `<div class="card stack"><div class="row">${avatar(S.profiles[r.from])}<div><b>${esc((S.profiles[r.from] || {}).nickname || "Someone")}</b><p class="small muted">wants to be your buddy</p></div></div>
          <div class="row"><button class="btn small" data-act="acceptBuddy" data-from="${esc(r.from)}">Accept</button><button class="btn small ghost" data-act="ignoreBuddy" data-from="${esc(r.from)}">Ignore</button></div>
          <p class="small muted">If you ignore this, they will not be told.</p></div>`).join("")}</section>` : ""}
      <section class="stack"><h2>Your buddies</h2>${S.buddies.length ? S.buddies.map(b => {
        const o = otherOf(b), p = S.profiles[o] || {}, sm = b["s_" + o], today = sm && sm.date === T() ? sm.shared || [] : [];
        const builds = today.filter(h => h.type === "build");
        return `<button class="card circle-card" data-act="openBuddy" data-pid="${esc(b.id)}"><div class="row">${avatar(p)}<div><b>${esc(p.nickname || "Buddy")}</b>${b["n_" + o] ? ` <span class="small muted">(${esc(b["n_" + o])})</span>` : ""}${unread(b) ? ' <span class="tag lead">New message</span>' : ""}
          <p class="small muted">${builds.length ? builds.filter(h => h.done).length + " of " + builds.length + " habits done today" : "No shared habits ticked today"}</p></div></div></button>`;
      }).join("") : `<div class="empty">No buddies yet. Invite a friend below, or tap someone in your Circle and choose Ask to be buddies.</div>`}</section>
      ${S.buddyOut.length ? `<section class="stack"><h2>Waiting for them to accept</h2>${S.buddyOut.map(r => `<div class="card row" style="justify-content:space-between"><div class="row">${avatar(S.profiles[r.to], "sm")}<b>${esc((S.profiles[r.to] || {}).nickname || "Member")}</b></div><button class="link" data-act="cancelBuddyReq" data-to="${esc(r.to)}">Cancel</button></div>`).join("")}</section>` : ""}
      <section class="stack"><h2>Invite a friend</h2><div class="card stack">
        <p class="small muted">Send your personal link to a friend. When they open it and sign in, they can choose to accept. They will see your nickname, not your real name.</p>
        ${link ? `<div class="copy">${esc(link)}</div><button class="btn small ghost" data-act="copyLink" data-link="${esc(link)}">Copy my invite link</button>` : `<button class="btn" data-act="makeInvite">Create my invite link</button>`}
      </div></section>
    </div>${nav()}`;
  },

  friendInvite: () => {
    const p = S.profiles[S.params.from] || {};
    return `<div class="stack-lg" style="padding-top:6vh"><div class="row">${avatar(p, "lg")}<div><p class="label">Buddy invite</p><h1>${esc(p.nickname || "A friend")} wants to be your buddy</h1></div></div>
      <div class="card stack"><p>If you accept, you will both see the habits you choose to share, you can cheer and nudge each other, and you can chat privately.</p><p class="small muted">Your real name stays private unless you choose to share it.</p></div>
      <button class="btn block" data-act="acceptInvite">Accept</button><button class="btn ghost block" data-act="declineInvite">No thanks</button></div>`;
  },

  buddy: () => {
    const b = S.buddies.find(x => x.id === S.params.pid);
    if (!b) return `<div class="stack-lg"><button class="back" data-act="nav" data-v="friends">‹ Friends</button><div class="empty">This buddy is no longer connected with you.</div></div>${nav()}`;
    const o = otherOf(b), me = S.user.uid, p = S.profiles[o] || {}, sm = b["s_" + o];
    const today = sm && sm.date === T() ? sm.shared || [] : (sm ? (sm.shared || []).map(h => ({ ...h, done: false })) : []);
    const theirName = b["n_" + o], myShared = b["n_" + me];
    return `<div class="stack-lg">
      <div class="stack"><button class="back" data-act="nav" data-v="friends">‹ Friends</button>
        <div class="row">${avatar(p, "lg")}<div><h1>${esc(p.nickname || "Buddy")}</h1>${theirName ? `<p class="small">Real name: <b>${esc(theirName)}</b></p>` : `<p class="small muted">Real name not shared</p>`}</div></div></div>
      <section class="stack"><h2>Their habits today</h2>${today.length ? `<div class="chips">${today.map(h => h.type === "build" ? `<span class="chip ${h.done ? "ok" : ""}">${esc(h.name)}${h.done ? " · done" : ""}</span>` : `<span class="chip">${esc(h.name)} · ${h.clean} days clean</span>`).join("")}</div>` : `<p class="small muted">They have not shared any habits.</p>`}
        <div class="row"><button class="btn small warm" data-act="buddyMsg" data-kind="cheer">Cheer them on</button><button class="btn small ghost" data-act="buddyMsg" data-kind="nudge">Send a nudge</button></div></section>
      <section class="stack"><h2>Chat</h2>
        <div class="stack">${S.chat.length ? S.chat.slice().reverse().map(m => chatLine(m, p)).join("") : `<p class="small muted">No messages yet. Say hello.</p>`}</div>
        <div class="card stack"><textarea id="chatText" maxlength="1000" placeholder="Write a message"></textarea><button class="btn" data-act="buddyMsg" data-kind="text">Send</button></div></section>
      <section class="stack"><h2>Real names</h2><div class="card stack">
        ${myShared ? `<p class="small">They can see your real name: <b>${esc(myShared)}</b></p><button class="link" data-act="hideName">Hide my real name from them</button>`
          : (S.confirming === "reveal" ? `<div class="confirm" style="flex-direction:column;align-items:stretch"><b>Share your real name with ${esc(p.nickname)}?</b><span>They will see <b>${esc(S.account.realName || "your name")}</b>. You can hide it again later, but they may remember it.</span><div class="row"><button class="btn small" data-act="revealName">Yes, share it</button><button class="btn small ghost" data-act="cancel">Cancel</button></div></div>`
          : `<p class="small muted">Your real name is private. Share it only if you want to.</p><button class="btn small ghost" data-act="revealAsk">Share my real name</button>`)}
        ${theirName ? "" : `<button class="link" data-act="buddyMsg" data-kind="reveal-ask">Ask them to share their real name</button>`}
      </div></section>
      <section class="stack"><button class="link" data-act="unbuddyAsk">Remove buddy</button>
        ${S.confirming === "unbuddy" ? `<div class="confirm">Stop being buddies with ${esc(p.nickname)}? Your chat will be closed.<button class="btn small danger" data-act="unbuddy">Remove</button><button class="btn small ghost" data-act="cancel">Keep</button></div>` : ""}</section>
    </div>${nav()}`;
  },

  admin: () => {
    const list = S.params.list || [];
    const base = location.origin + location.pathname;
    const reqs = (S.params.requests || []).filter(r => r.status === "pending");
    return `<div class="stack-lg"><h1>Admin</h1>
      <section class="stack"><h2>Requests to lead a Circle</h2>${reqs.length ? reqs.map(r => `<div class="card stack">
          <div class="row">${avatar(S.profiles[r.uid])}<div><b>${esc((S.profiles[r.uid] || {}).nickname || "Member")}</b><p class="small muted">Asked ${ago(tsOf(r.createdAt))}</p></div></div>
          <div class="chips"><span class="chip ok">${esc(r.habitName)} · ${r.days} ${r.habitType === "quit" ? "days clean" : "day streak"}</span></div>
          <div><p class="label">Circle</p><b>${esc(r.name)}</b><p class="small muted">${esc(r.goal)} · ${esc((AREAS[r.kind] || {}).label || "")}</p></div>
          <div><p class="label">Why they want to lead</p><p class="post-text">${esc(r.why)}</p></div>
          <div class="field"><label for="note_${esc(r.uid)}" class="small">Note to them (optional, shown if you decline)</label><input type="text" id="note_${esc(r.uid)}" maxlength="200"></div>
          <div class="row"><button class="btn small" data-act="approveReq" data-uid="${esc(r.uid)}">Approve</button><button class="btn small ghost" data-act="declineReq" data-uid="${esc(r.uid)}">Decline</button></div>
        </div>`).join("") : `<div class="empty">No requests waiting.</div>`}</section>
      <section class="stack"><h2>Create a Circle</h2><div class="card stack">
        <div class="field"><label for="cName">Name</label><input type="text" id="cName" maxlength="40" placeholder="For example: Bible in a Year"></div>
        <div class="field"><label for="cGoal">Daily goal</label><input type="text" id="cGoal" maxlength="100" placeholder="For example: Read one chapter every day"></div>
        <div class="field"><label for="cKind">Type</label><select id="cKind">${Object.entries(AREAS).map(([k, a]) => `<option value="${k}">${a.label}</option>`).join("")}</select></div>
        <p class="small muted">You will be the leader. You can hand it over to a member later.</p>
        <button class="btn" data-act="createCircle">Create Circle</button></div></section>
      <section class="stack"><h2>All Circles</h2>${list.length ? list.map(c => `<div class="card stack"><b>${esc(c.name)}</b><span class="small muted">${esc(c.goal)}</span>
          <span class="small">Circle code: <b>${esc(c.code || "")}</b></span>
          <span class="small muted">Invite link</span><div class="copy">${esc(base + "?join=" + c.id + "&code=" + (c.code || ""))}</div>
          <button class="btn small ghost" data-act="copyLink" data-link="${esc(base + "?join=" + c.id + "&code=" + (c.code || ""))}">Copy invite link</button></div>`).join("") : `<div class="empty">No Circles yet.</div>`}</section>
    </div>${nav()}`;
  },
};

function joinForm() {
  return `<div class="card stack"><div class="field"><label for="joinCode">Circle code</label><input type="text" id="joinCode" maxlength="40" placeholder="For example: BIBLE-7K2Q" autocomplete="off" autocapitalize="characters"></div>
    <p class="err" id="codeErr" hidden></p><button class="btn" data-act="lookupCode">Find Circle</button></div>`;
}
function unread(b) { const o = otherOf(b); return (b["a_" + o] || 0) > (b["r_" + S.user.uid] || 0); }
function buddyButton(uid) {
  if (S.buddies.some(b => b.members.includes(uid))) return `<p class="small muted">You are buddies. <button class="link" data-act="openBuddy" data-pid="${esc(pairId(uid, S.user.uid))}">Open chat</button></p>`;
  if (S.buddyOut.some(r => r.to === uid)) return `<p class="small muted">Buddy request sent.</p>`;
  if (S.buddyIn.some(r => r.from === uid)) return `<button class="btn small" data-act="acceptBuddy" data-from="${esc(uid)}">Accept their buddy request</button>`;
  return `<button class="link" data-act="askBuddy" data-uid="${esc(uid)}">Ask to be buddies</button>`;
}
function chatLine(m, other) {
  const mine = m.from === S.user.uid, who = mine ? "You" : (other.nickname || "Buddy");
  const body = m.kind === "cheer" ? `${esc(who)} ${mine ? "cheered them on" : "cheered you on"}`
    : m.kind === "nudge" ? `${esc(who)} ${mine ? "sent a gentle nudge" : "sent you a gentle nudge"}`
    : m.kind === "reveal-ask" ? `${esc(who)} asked ${mine ? "them" : "you"} to share ${mine ? "their" : "your"} real name.${mine ? "" : " You can choose below."}`
    : esc(m.text);
  return `<div class="note" style="${mine ? "border-left-color:var(--accent)" : ""}"><div><b>${esc(who)}</b><p class="post-text">${body}</p><p class="small muted">${ago(tsOf(m.createdAt))}</p></div></div>`;
}
function planSection(c, ms, isLead) {
  const pt = planToday(c), myM = ms.find(m => m.uid === S.user.uid) || {};
  const picker = isLead ? `<div class="field"><label for="planPick" class="small">${pt ? "Change the reading plan" : "Add a Bible reading plan for this Circle"}</label><div class="row" style="flex-wrap:nowrap"><select id="planPick">${Object.entries(PLANS).map(([k, p]) => `<option value="${k}" ${c.planId === k ? "selected" : ""}>${p.name}</option>`).join("")}</select><button class="btn small" data-act="setPlan">Start today</button></div></div>` : "";
  if (!pt) return isLead ? `<section class="stack"><h2>Reading plan</h2><div class="card stack">${picker}</div></section>` : "";
  if (pt.finished) return `<section class="stack"><h2>Reading plan</h2><div class="card stack"><p><b>${esc(pt.p.name)}</b> is finished. Well done, everyone.</p>${picker}</div></section>`;
  const readers = ms.filter(m => (m.read || {})[T()]).length, mine = !!(myM.read || {})[T()];
  return `<section class="stack"><h2>Today's reading</h2><div class="card stack">
    <p class="small muted">${esc(pt.p.name)} · Day ${pt.day} of ${pt.p.n}</p>
    <h3>${esc(pt.ref)}</h3>
    <div class="row"><a class="btn small ghost" href="${esc(pt.url)}" target="_blank" rel="noopener">Read ${esc(pt.ref)}</a>
      <button class="btn small ${mine ? "" : "warm"}" data-act="markRead" aria-pressed="${mine}">${mine ? "Read today ✓" : "Mark as read"}</button></div>
    <p class="small muted">${readers} of ${ms.length} have read it today</p>
    ${isLead ? `<details><summary class="small muted">Leader options</summary>${picker}</details>` : ""}</div></section>`;
}
function openChat(pid) {
  if (S.chatSub) { S.chatSub(); S.chatSub = null; }
  S.chat = [];
  S.chatSub = onSnapshot(query(collection(db, "buddies", pid, "messages"), orderBy("createdAt", "desc"), limit(80)), snap => {
    S.chat = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    if (S.view === "buddy" && S.params.pid === pid) { markChatRead(pid); render(); }
  }, () => {});
}
let lastReadWrite = 0;
async function markChatRead(pid) {
  const b = S.buddies.find(x => x.id === pid); if (!b || !unread(b)) return;
  if (Date.now() - lastReadWrite < 3000) return; lastReadWrite = Date.now();
  try { await updateDoc(doc(db, "buddies", pid), { ["r_" + S.user.uid]: Date.now() }); } catch (e) {}
}
function icsDate(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "T" + pad(d.getHours()) + pad(d.getMinutes()) + "00"; }
function reminderStart() {
  const t = (document.getElementById("remTime") || {}).value || "20:00"; S.ob.remTime = t;
  const [h, m] = t.split(":").map(Number), d = new Date(); d.setHours(h, m, 0, 0);
  if (d < new Date()) d.setDate(d.getDate() + 1);
  return d;
}
function leadSection() {
  const r = S.request;
  if (r && r.status === "pending") return `<div class="card stack"><b>Your request is waiting for approval</b><p class="small muted">You asked to lead <b>${esc(r.name)}</b>. The Circles team will look at it soon.</p><button class="link" data-act="cancelReq">Withdraw my request</button></div>`;
  if (r && r.status === "approved") {
    const joined = (S.account.circles || []).includes(r.cid);
    return `<div class="card stack"><b>Your Circle has been approved</b><p class="small muted">You are the leader of <b>${esc(r.name)}</b>. Open it to get your invite link.</p>
      <button class="btn" data-act="${joined ? "openCircle" : "openApproved"}" data-cid="${esc(r.cid)}">Open my Circle</button></div>`;
  }
  const best = bestRun(), days = best ? best.days : 0;
  const declined = r && r.status === "declined" ? `<div class="soft small"><b>Your last request was not approved.</b>${r.note ? " Note from the Circles team: " + esc(r.note) : ""} You can ask again.</div>` : "";
  if (days < LEAD_DAYS) {
    return `${declined}<div class="card stack"><p>You can ask to lead a Circle once you have a <b>${LEAD_DAYS} day streak</b> on a habit you are building, or <b>${LEAD_DAYS} days clean</b> from a habit you are quitting. That way, every leader has walked the road themselves.</p>
      <div class="row" style="flex-wrap:nowrap"><div class="bar" style="flex:1"><i style="width:${Math.min(100, days / LEAD_DAYS * 100)}%"></i></div><b>${days} of ${LEAD_DAYS}</b></div>
      <p class="small muted">${best ? `Your best right now: ${esc(best.name)}, ${days} ${best.type === "quit" ? "days clean" : "day streak"}. ${LEAD_DAYS - days} more to go.` : "Add a habit on the Me page to get started."}</p></div>`;
  }
  return `${declined}<div class="card stack"><p><b>You qualify to lead a Circle.</b> ${esc(best.name)}: ${days} ${best.type === "quit" ? "days clean" : "day streak"}.</p>
    <p class="small muted">Tell us about the Circle you want to lead. The Circles team will review your request before the Circle is created.${best.private ? " Because this habit is private, the Circles team will only see that it is a private habit and how many days you have kept it, not its name." : ""}</p>
    <div class="field"><label for="rName">Circle name</label><input type="text" id="rName" maxlength="40" placeholder="For example: Free Together"></div>
    <div class="field"><label for="rGoal">Daily goal</label><input type="text" id="rGoal" maxlength="100" placeholder="For example: Stay clean today and check in every evening"></div>
    <div class="field"><label for="rKind">Type</label><select id="rKind">${Object.entries(AREAS).map(([k, a]) => `<option value="${k}" ${best.type === "quit" && k === "free" ? "selected" : ""}>${a.label}</option>`).join("")}</select></div>
    <div class="field"><label for="rWhy">Why do you want to lead this Circle?</label><textarea id="rWhy" maxlength="600" placeholder="Share a little of your journey and how you want to help others."></textarea></div>
    <p class="err" id="reqErr" hidden></p>
    <button class="btn" data-act="sendReq">Send request</button></div>`;
}
function invitePanel(code, cid) {
  const link = location.origin + location.pathname + "?join=" + cid + "&code=" + code;
  return `<section class="stack"><h2>Invite people</h2><div class="card stack"><p class="small muted">As the leader, share this link or code with the people you want in this Circle.</p>
    <span class="small">Circle code: <b>${esc(code)}</b></span><div class="copy">${esc(link)}</div>
    <button class="btn small ghost" data-act="copyLink" data-link="${esc(link)}">Copy invite link</button></div></section>`;
}
function habitCard(h) {
  const conf = S.confirming === "slip" + h.id;
  const week = `<div class="week" aria-hidden="true">${weekStates(h).map((c, j) => `<span class="${c}">${addDays(todayDate(), j - 6).toLocaleDateString("en-IN", { weekday: "narrow" })}<i></i></span>`).join("")}</div>`;
  const tags = `<span class="tag ${h.type}">${h.type === "build" ? "Build" : "Quit"}</span>${h.private ? '<span class="tag priv">Private</span>' : ""}`;
  if (h.type === "build") {
    const on = !!(h.log || {})[T()];
    return `<div class="card habit"><div><div class="hname">${esc(h.name)}${tags}</div><p class="small muted">${streak(h)} day streak${on ? " · done today" : ""}</p></div>
      <button class="check ${on ? "on" : ""}" data-act="tick" data-id="${esc(h.id)}" aria-pressed="${on}" aria-label="Mark ${esc(h.name)} done today">${tickSvg}</button>${week}</div>`;
  }
  const c = cleanDays(h);
  return `<div class="card habit"><div><div class="hname">${esc(h.name)}${tags}</div></div>
    <div class="clean"><b>${c}</b><span class="small muted">${c === 1 ? "day" : "days"} clean</span></div>${week}
    <div class="hactions"><button class="btn small ghost" data-act="slipAsk" data-id="${esc(h.id)}">I slipped today</button></div>
    ${conf ? `<div class="confirm">That is okay. Your counter starts again from today. Keep going.<button class="btn small" data-act="slip" data-id="${esc(h.id)}">Start again</button><button class="btn small ghost" data-act="cancel">Cancel</button></div>` : ""}</div>`;
}
function memberPanel(c, m, isLead) {
  const p = S.profiles[m.uid] || {}, me = m.uid === S.user.uid;
  const sum = (m.summary && m.summary.date === T()) ? m.summary.shared || [] : (m.summary ? (m.summary.shared || []).map(h => ({ ...h, done: false })) : []);
  return `<div class="card stack"><div class="row">${avatar(p)}<div><b>${esc(p.nickname || "Member")}</b>${c.leaderUid === m.uid ? '<span class="tag lead">Leader</span>' : ""}<p class="small muted">${m.lastCheckIn === T() ? "Checked in today" : "Not checked in yet today"}</p></div></div>
    ${sum.length ? `<div class="chips">${sum.map(h => h.type === "build" ? `<span class="chip ${h.done ? "ok" : ""}">${esc(h.name)}${h.done ? " · done" : ""}</span>` : `<span class="chip">${esc(h.name)} · ${h.clean} days clean</span>`).join("")}</div>` : `<p class="small muted">No shared habits.</p>`}
    ${me ? "" : `<div class="row"><button class="btn small warm" data-act="nudge" data-kind="cheer" data-uid="${esc(m.uid)}">Cheer them on</button><button class="btn small ghost" data-act="nudge" data-kind="nudge" data-uid="${esc(m.uid)}">Send a nudge</button></div>${buddyButton(m.uid)}`}
    ${isLead && !me ? `<div class="row">${S.isAdmin && c.leaderUid !== m.uid ? `<button class="link" data-act="makeLeader" data-uid="${esc(m.uid)}">Make leader</button>` : ""}<button class="link" data-act="removeAsk" data-uid="${esc(m.uid)}">Remove from Circle</button></div>
      ${S.confirming === "rm" + m.uid ? `<div class="confirm">Remove ${esc(p.nickname)} from this Circle?<button class="btn small danger" data-act="removeMember" data-uid="${esc(m.uid)}">Remove</button><button class="btn small ghost" data-act="cancel">Cancel</button></div>` : ""}` : ""}</div>`;
}
function postCard(c, p, isLead) {
  const prof = S.profiles[p.uid] || {}, me = S.user.uid;
  const cheers = Object.keys(p.cheers || {}), mine = !!(p.cheers || {})[me];
  return `<article class="card post ${p.kind === "checkin" ? "checkin" : ""} ${p.care && isLead ? "care" : ""}">
    <div class="post-head">${avatar(prof)}<div><b>${esc(prof.nickname || "Member")}</b>${c.leaderUid === p.uid ? '<span class="tag lead">Leader</span>' : ""}<p class="small muted">${p.kind === "checkin" ? "Daily check in · " : ""}${ago(tsOf(p.createdAt))}</p></div></div>
    ${p.hidden ? `<p class="small muted">Hidden by the Circle leader. Only leaders can see this.</p>` : ""}
    ${p.care && isLead ? `<p class="small" style="color:var(--warm)"><b>This person may need care.</b> Please reach out to them gently.</p>` : ""}
    ${p.text ? `<p class="post-text">${esc(p.text)}</p>` : ""}
    ${p.kind === "checkin" && p.total ? `<div class="chips"><span class="chip ok">${p.done} of ${p.total} ${p.total === 1 ? "habit" : "habits"} done</span></div>` : ""}
    <div class="row" style="justify-content:space-between">
      <button class="cheer ${mine ? "on" : ""}" data-act="cheer" data-pid="${esc(p.id)}" aria-pressed="${mine}">${mine ? "Cheered" : "Cheer"}${cheers.length ? " · " + cheers.length : ""}</button>
      <span class="row">${p.uid !== me ? `<button class="link" data-act="reportAsk" data-pid="${esc(p.id)}">Report</button>` : `<button class="link" data-act="delPost" data-pid="${esc(p.id)}">Delete</button>`}
      ${isLead ? `<button class="link" data-act="hide" data-pid="${esc(p.id)}" data-h="${p.hidden ? "0" : "1"}">${p.hidden ? "Show" : "Hide"}</button>` : ""}</span></div>
    ${S.confirming === "rep" + p.id ? `<div class="confirm" style="flex-direction:column;align-items:stretch">Why are you reporting this post?
      <div class="row">${["Sexual content", "Harassment or threats", "Sharing private details", "Selling or spam", "Something else"].map(r => `<button class="btn small ghost" data-act="report" data-pid="${esc(p.id)}" data-r="${r}">${r}</button>`).join("")}</div><button class="link" data-act="cancel">Cancel</button></div>` : ""}
  </article>`;
}

function render() {
  const v = views[S.view] || views.loading;
  const active = document.activeElement, keepId = active && active.id, keepVal = active && "value" in active ? active.value : null;
  const drafts = {}; ["checkText", "postText", "joinCode", "newH", "customH", "cName", "cGoal", "rName", "rGoal", "rWhy", "chatText"].forEach(id => { const el = document.getElementById(id); if (el && el.value) drafts[id] = el.value; });
  $app.innerHTML = v();
  Object.entries(drafts).forEach(([id, val]) => { const el = document.getElementById(id); if (el && !el.value) el.value = val; });
  if (keepId) { const el = document.getElementById(keepId); if (el) { if (keepVal !== null && "value" in el) el.value = keepVal; el.focus(); } }
}

/* ---------------- actions ---------------- */
function suggestFrom(keys) {
  const out = [];
  keys.forEach(k => (AREAS[k] || { habits: [] }).habits.forEach(([name, type]) => out.push({ name, type, on: true, share: type === "build", since: T() })));
  return out;
}
async function finishOnboarding() {
  await updateDoc(doc(db, "users", S.user.uid), { onboarded: true });
  S.account.onboarded = true;
  if (pendingFriend) return openFriendInvite(pendingFriend);
  go("today");
}
async function openFriendInvite(token) {
  try {
    const inv = await getDoc(doc(db, "invites", token));
    if (!inv.exists()) { clearFriendInvite(); toast("That friend invite link is not valid any more."); return go("today"); }
    const from = inv.data().from;
    if (from === S.user.uid) { clearFriendInvite(); toast("This is your own invite link. Send it to a friend."); return go("friends"); }
    if (S.buddies.some(b => b.members.includes(from))) { clearFriendInvite(); return go("buddy", { pid: pairId(from, S.user.uid) }); }
    await loadProfiles([from]);
    go("friendInvite", { token, from });
  } catch (e) { clearFriendInvite(); go("today"); }
}
async function lookupCircle(code) {
  const k = code.trim().toUpperCase();
  const j = await getDoc(doc(db, "joinCodes", k));
  if (!j.exists()) return null;
  const c = await getDoc(doc(db, "circles", j.data().cid));
  return c.exists() ? { id: c.id, ...c.data() } : null;
}
async function openPromise(cid, code) {
  try {
    const s = await getDoc(doc(db, "circles", cid));
    if (!s.exists()) { toast("That invite link is not valid any more."); pendingInvite = null; return go(S.account && S.account.onboarded ? "circles" : "ob-areas"); }
    go("promise", { cid, code, preview: s.data() });
  } catch (e) { toast("Could not open that Circle. Please try again."); }
}

const actions = {
  async signin() {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { if (e.code !== "auth/popup-closed-by-user") toast("Sign in did not work. Please try again."); }
  },
  async signout() { if (S.chatSub) { S.chatSub(); S.chatSub = null; } stopSubs(S.subs); stopSubs(S.circleSubs); watchCircles._key = null; await signOut(auth); },
  nav(el) { go(el.dataset.v); if (el.dataset.v === "admin") loadAdmin(); },
  cancel() { S.confirming = null; render(); },

  async age() {
    const v = document.getElementById("dob").value, err = document.getElementById("ageErr");
    if (!v) { err.textContent = "Please enter your date of birth."; err.hidden = false; return; }
    const b = new Date(v + "T00:00"), n = new Date();
    let age = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) age--;
    if (age < 18) return go("too-young");
    await setDoc(doc(db, "users", S.user.uid), { adult: true, realName: S.user.displayName || "", email: S.user.email || "", circles: [], onboarded: false, createdAt: serverTimestamp() }, { merge: true });
    S.account = { ...(S.account || {}), adult: true, realName: S.user.displayName || "", circles: [], onboarded: false };
    go(S.profile ? "ob-privacy" : "ob-name");
  },
  color(el) { S.ob.nickname = document.getElementById("nick").value; S.ob.color = el.dataset.c; render(); },
  async saveName() {
    const n = document.getElementById("nick").value.trim(), err = document.getElementById("nickErr");
    if (n.length < 2) { err.textContent = "Please choose a nickname with at least 2 letters."; err.hidden = false; return; }
    const prof = { nickname: n, color: S.ob.color || COLORS[0], updatedAt: serverTimestamp() };
    await setDoc(doc(db, "profiles", S.user.uid), prof);
    S.profile = prof; S.profiles[S.user.uid] = prof;
    watchMine();
    go("ob-privacy");
  },
  privacyOk() { if (pendingInvite) return openPromise(pendingInvite.c, pendingInvite.k); go("ob-areas"); },
  area(el) { const k = el.dataset.k, a = S.ob.areas || []; S.ob.areas = a.includes(k) ? a.filter(x => x !== k) : [...a, k]; render(); },
  areasNext() { S.ob.suggest = suggestFrom(S.ob.areas || []); go("ob-habits"); },
  skipHabits() { go("ob-find"); },
  sugOn(el) { S.ob.suggest[+el.dataset.i].on = el.checked; render(); },
  sugShare(el) { S.ob.suggest[+el.dataset.i].share = el.checked; },
  addCustom(el) {
    const v = document.getElementById("customH").value.trim(); if (!v) return;
    document.getElementById("customH").value = "";
    S.ob.suggest.push({ name: v, type: el.dataset.t, on: true, share: el.dataset.t === "build", since: T() }); render();
  },
  async saveHabits() {
    document.querySelectorAll('[data-act="sugSince"]').forEach(i => { S.ob.suggest[+i.dataset.i].since = i.value || T(); });
    const keep = (S.ob.suggest || []).filter(h => h.on);
    let order = Date.now();
    for (const h of keep) await saveHabit({ id: "h" + uidShort(), name: h.name, type: h.type, private: !h.share, log: {}, slips: [], start: h.type === "quit" ? (h.since || T()) : T(), order: order++ });
    if ((S.account.circles || []).length) return finishOnboarding();
    go("ob-find");
  },
  finishOb() { pendingInvite = null; try { sessionStorage.removeItem("circles-invite"); } catch (e) {} if (S.account.onboarded) return go("circles"); finishOnboarding(); },

  async lookupCode() {
    const code = document.getElementById("joinCode").value, err = document.getElementById("codeErr");
    if (!code.trim()) { err.textContent = "Please enter the Circle code."; err.hidden = false; return; }
    const c = await lookupCircle(code).catch(() => null);
    if (!c) { err.textContent = "We could not find a Circle with that code. Please check it with your Circle leader."; err.hidden = false; return; }
    if ((S.account.circles || []).includes(c.id)) return go("circle", { cid: c.id });
    go("promise", { cid: c.id, code: code.trim().toUpperCase(), preview: c });
  },
  async promise() {
    const { cid, code } = S.params, err = document.getElementById("joinErr");
    try {
      await setDoc(doc(db, "circles", cid, "members", S.user.uid), { promise: true, code, joinedAt: serverTimestamp(), summary: summaryFor(), lastCheckIn: "" });
      await updateDoc(doc(db, "users", S.user.uid), { circles: arrayUnion(cid) });
      S.account.circles = [...new Set([...(S.account.circles || []), cid])];
      pendingInvite = null; try { sessionStorage.removeItem("circles-invite"); } catch (e) {}
      watchCircles();
      if (!S.account.onboarded) {
        if (!S.habits.length) { S.ob.suggest = suggestFrom([S.params.preview && S.params.preview.kind || "faith"]); return go("ob-habits"); }
        await updateDoc(doc(db, "users", S.user.uid), { onboarded: true }); S.account.onboarded = true;
      }
      toast("Welcome to the Circle"); go("circle", { cid });
    } catch (e) { console.error(e); err.textContent = "We could not add you to this Circle. The code may be wrong. Please check it with your Circle leader."; err.hidden = false; }
  },

  async tick(el) {
    const h = S.habits.find(x => x.id === el.dataset.id), log = { ...(h.log || {}) };
    if (log[T()]) delete log[T()]; else log[T()] = true;
    h.log = log; render(); await saveHabit(h);
  },
  slipAsk(el) { S.confirming = "slip" + el.dataset.id; render(); },
  async slip(el) {
    const h = S.habits.find(x => x.id === el.dataset.id); h.slips = [...new Set([...(h.slips || []), T()])];
    S.confirming = null; render(); await saveHabit(h); toast("Day one starts now. You can do this.");
  },
  async addHabit() {
    const name = document.getElementById("newH").value.trim(); if (!name) return;
    const type = document.querySelector('input[name="newT"]:checked').value, share = document.getElementById("newShare").checked;
    document.getElementById("newH").value = "";
    await saveHabit({ id: "h" + uidShort(), name, type, private: !share, log: {}, slips: [], start: T(), order: Date.now() });
    toast("Habit added");
  },
  async togglePriv(el) { const h = S.habits.find(x => x.id === el.dataset.id); h.private = !h.private; await saveHabit(h); },
  delAsk(el) { S.confirming = "del" + el.dataset.id; render(); },
  async delHabit(el) { await deleteDoc(doc(db, "users", S.user.uid, "habits", el.dataset.id)); S.confirming = null; scheduleSummary(); },

  async checkin() {
    const t = document.getElementById("checkText").value.trim();
    if (!t) return toast("Write one line about your day first.");
    const care = await postCheckin(t);
    toast("Check in shared with your Circle");
    render();
    if (care) { const s = document.getElementById("careSlot"); if (s) s.innerHTML = careCard(); }
  },
  openCircle(el) { go("circle", { cid: el.dataset.cid }); },
  pickMember(el) { S.params.member = S.params.member === el.dataset.uid ? null : el.dataset.uid; S.confirming = null; render(); },
  async post() {
    const box = document.getElementById("postText"), t = box.value.trim(); if (!t) return;
    const cid = S.params.cid, care = needsCare(t);
    try {
      await setDoc(doc(db, "circles", cid, "posts", "p" + Date.now() + uidShort()), { uid: S.user.uid, kind: "post", text: t, care, hidden: false, cheers: {}, createdAt: serverTimestamp() });
      box.value = "";
      if (care) { const s = document.getElementById("careSlot2"); if (s) s.innerHTML = careCard(); }
    } catch (e) { toast("Could not post. Please try again."); }
  },
  async cheer(el) {
    const cid = S.params.cid, p = (S.circles[cid].posts || []).find(x => x.id === el.dataset.pid);
    const on = !!(p.cheers || {})[S.user.uid];
    try { await updateDoc(doc(db, "circles", cid, "posts", p.id), { ["cheers." + S.user.uid]: on ? deleteField() : true }); } catch (e) { toast("Could not cheer. Please try again."); }
  },
  reportAsk(el) { S.confirming = "rep" + el.dataset.pid; render(); },
  async report(el) {
    try { await setDoc(doc(db, "reports", "r" + Date.now() + uidShort()), { from: S.user.uid, circleId: S.params.cid, postId: el.dataset.pid, reason: el.dataset.r, createdAt: serverTimestamp() }); toast("Thank you. The Circle team will look at this."); }
    catch (e) { toast("Could not send the report. Please try again."); }
    S.confirming = null; render();
  },
  async delPost(el) { try { await deleteDoc(doc(db, "circles", S.params.cid, "posts", el.dataset.pid)); } catch (e) { toast("Could not delete. Please try again."); } },
  async hide(el) { try { await updateDoc(doc(db, "circles", S.params.cid, "posts", el.dataset.pid), { hidden: el.dataset.h === "1" }); } catch (e) { toast("Could not change this post."); } },
  async nudge(el) {
    try {
      await setDoc(doc(db, "circles", S.params.cid, "nudges", "n" + Date.now() + uidShort()), { from: S.user.uid, to: el.dataset.uid, kind: el.dataset.kind, createdAt: serverTimestamp() });
      toast(el.dataset.kind === "cheer" ? "Cheer sent" : "Nudge sent");
    } catch (e) { toast("Could not send. Please try again."); }
  },
  async dismissNudge(el) { try { await deleteDoc(doc(db, "circles", el.dataset.cid, "nudges", el.dataset.id)); } catch (e) {} S.nudges = S.nudges.filter(n => n.id !== el.dataset.id); render(); },
  removeAsk(el) { S.confirming = "rm" + el.dataset.uid; render(); },
  async removeMember(el) { try { await deleteDoc(doc(db, "circles", S.params.cid, "members", el.dataset.uid)); S.params.member = null; toast("Member removed"); } catch (e) { toast("Could not remove this member."); } },
  async makeLeader(el) { try { await updateDoc(doc(db, "circles", S.params.cid), { leaderUid: el.dataset.uid }); toast("New leader set"); } catch (e) { toast("Could not change the leader."); } },
  leaveAsk() { S.confirming = "leave"; render(); },
  async leave() {
    const cid = S.params.cid;
    try { await deleteDoc(doc(db, "circles", cid, "members", S.user.uid)); await updateDoc(doc(db, "users", S.user.uid), { circles: arrayRemove(cid) }); S.account.circles = (S.account.circles || []).filter(x => x !== cid); delete S.circles[cid]; go("circles"); }
    catch (e) { toast("Could not leave. Please try again."); }
  },

  openBuddy(el) { go("buddy", { pid: el.dataset.pid }); },
  async makeInvite() {
    const token = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
    try {
      await setDoc(doc(db, "invites", token), { from: S.user.uid, createdAt: serverTimestamp() });
      await updateDoc(doc(db, "users", S.user.uid), { myInvite: token });
      S.account.myInvite = token; render();
    } catch (e) { console.error(e); toast("Could not create your link. Please try again."); }
  },
  async acceptInvite() {
    const { token, from } = S.params, me = S.user.uid, pid = pairId(from, me);
    try {
      await setDoc(doc(db, "buddies", pid), { members: [from, me].sort(), token, createdAt: serverTimestamp(), ["s_" + me]: summaryFor() });
      clearFriendInvite(); toast("You are now buddies"); go("buddy", { pid });
    } catch (e) { console.error(e); toast("Could not accept. Please try again."); }
  },
  declineInvite() { clearFriendInvite(); go("today"); },
  async askBuddy(el) {
    try { await setDoc(doc(db, "buddyReqs", el.dataset.uid + "_" + S.user.uid), { from: S.user.uid, to: el.dataset.uid, createdAt: serverTimestamp() }); toast("Buddy request sent"); }
    catch (e) { toast("Could not send. Please try again."); }
  },
  async cancelBuddyReq(el) { try { await deleteDoc(doc(db, "buddyReqs", el.dataset.to + "_" + S.user.uid)); } catch (e) {} },
  async acceptBuddy(el) {
    const from = el.dataset.from, me = S.user.uid, pid = pairId(from, me);
    try {
      await setDoc(doc(db, "buddies", pid), { members: [from, me].sort(), viaReq: true, createdAt: serverTimestamp(), ["s_" + me]: summaryFor() });
      await deleteDoc(doc(db, "buddyReqs", me + "_" + from));
      toast("You are now buddies"); go("buddy", { pid });
    } catch (e) { console.error(e); toast("Could not accept. Please try again."); }
  },
  async ignoreBuddy(el) { try { await deleteDoc(doc(db, "buddyReqs", S.user.uid + "_" + el.dataset.from)); } catch (e) {} },
  async buddyMsg(el) {
    const pid = S.params.pid, kind = el.dataset.kind;
    let text = "";
    if (kind === "text") { const box = document.getElementById("chatText"); text = box.value.trim(); if (!text) return; box.value = ""; }
    try {
      await setDoc(doc(db, "buddies", pid, "messages", "m" + Date.now() + uidShort()), { from: S.user.uid, kind, text, createdAt: serverTimestamp() });
      await updateDoc(doc(db, "buddies", pid), { ["a_" + S.user.uid]: Date.now(), ["r_" + S.user.uid]: Date.now() });
      if (kind === "cheer") toast("Cheer sent"); else if (kind === "nudge") toast("Nudge sent"); else if (kind === "reveal-ask") toast("Request sent");
      if (kind === "text" && needsCare(text)) toast("If you are struggling, please call Tele MANAS on 14416, free, day and night.");
    } catch (e) { console.error(e); toast("Could not send. Please try again."); }
  },
  revealAsk() { S.confirming = "reveal"; render(); },
  async revealName() {
    try { await updateDoc(doc(db, "buddies", S.params.pid), { ["n_" + S.user.uid]: S.account.realName || S.user.displayName || "" }); S.confirming = null; toast("Your real name is now shared with them"); }
    catch (e) { toast("Could not share. Please try again."); }
  },
  async hideName() { try { await updateDoc(doc(db, "buddies", S.params.pid), { ["n_" + S.user.uid]: deleteField() }); toast("Your real name is hidden again"); } catch (e) {} },
  unbuddyAsk() { S.confirming = "unbuddy"; render(); },
  async unbuddy() { try { await deleteDoc(doc(db, "buddies", S.params.pid)); go("friends"); } catch (e) { toast("Could not remove. Please try again."); } },
  async setPlan() {
    const planId = document.getElementById("planPick").value;
    try { await updateDoc(doc(db, "circles", S.params.cid), { planId, planStart: T() }); toast("Reading plan started"); } catch (e) { console.error(e); toast("Could not set the plan."); }
  },
  async markRead() {
    const c = S.circles[S.params.cid], my = (c.members || []).find(m => m.uid === S.user.uid) || {}, on = !!(my.read || {})[T()];
    try { await updateDoc(doc(db, "circles", c.id, "members", S.user.uid), { ["read." + T()]: on ? deleteField() : true }); } catch (e) { toast("Could not save. Please try again."); }
  },
  remGoogle() {
    const d = reminderStart(), e = new Date(d.getTime() + 10 * 6e4), url = location.origin + location.pathname;
    const q = new URLSearchParams({ action: "TEMPLATE", text: "Check in on Circles", details: "Tick your habits and write your check in: " + url, dates: icsDate(d) + "/" + icsDate(e), recur: "RRULE:FREQ=DAILY" });
    window.open("https://calendar.google.com/calendar/render?" + q.toString(), "_blank", "noopener");
  },
  remIcs() {
    const d = reminderStart(), url = location.origin + location.pathname;
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Circles//Reminder//EN", "BEGIN:VEVENT", "UID:circles-daily-" + S.user.uid + "@circles", "DTSTAMP:" + icsDate(new Date()), "DTSTART:" + icsDate(d), "DURATION:PT10M", "RRULE:FREQ=DAILY",
      "SUMMARY:Check in on Circles", "DESCRIPTION:Tick your habits and write your check in: " + url, "URL:" + url, "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Time to check in on Circles", "TRIGGER:PT0M", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" })); a.download = "circles-reminder.ics";
    document.body.appendChild(a); a.click(); a.remove();
  },
  async sendReq() {
    const name = document.getElementById("rName").value.trim(), goal = document.getElementById("rGoal").value.trim();
    const kind = document.getElementById("rKind").value, why = document.getElementById("rWhy").value.trim(), err = document.getElementById("reqErr");
    if (!name || !goal || why.length < 20) { err.textContent = "Please fill in the name and goal, and write a few sentences about why you want to lead."; err.hidden = false; return; }
    const best = bestRun();
    if (!best || best.days < LEAD_DAYS) return toast("You do not qualify yet.");
    try {
      await setDoc(doc(db, "circleRequests", S.user.uid), { uid: S.user.uid, name, goal, kind, why, habitName: best.private ? "A private habit" : best.name, habitType: best.type, days: best.days, status: "pending", createdAt: serverTimestamp() });
      toast("Request sent to the Circles team");
    } catch (e) { console.error(e); toast("Could not send your request. Please try again."); }
  },
  async cancelReq() { try { await deleteDoc(doc(db, "circleRequests", S.user.uid)); } catch (e) { toast("Could not withdraw. Please try again."); } },
  async openApproved(el) {
    const r = S.request;
    try {
      await setDoc(doc(db, "circles", r.cid, "members", S.user.uid), { promise: true, code: r.code, joinedAt: serverTimestamp(), summary: summaryFor(), lastCheckIn: "" });
      await updateDoc(doc(db, "users", S.user.uid), { circles: arrayUnion(r.cid) });
      S.account.circles = [...new Set([...(S.account.circles || []), r.cid])]; watchCircles();
      go("circle", { cid: r.cid });
    } catch (e) { console.error(e); toast("Could not open your Circle. Please try again."); }
  },
  async approveReq(el) {
    const r = (S.params.requests || []).find(x => x.uid === el.dataset.uid); if (!r) return;
    const code = (r.name.replace(/[^A-Za-z]/g, "").slice(0, 5) || "CIRCL").toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    const id = "c" + Date.now().toString(36);
    try {
      await setDoc(doc(db, "circles", id), { name: r.name, goal: r.goal, kind: r.kind, leaderUid: r.uid, createdAt: serverTimestamp() });
      await setDoc(doc(db, "joinCodes", code), { cid: id, createdAt: serverTimestamp() });
      await updateDoc(doc(db, "circleRequests", r.uid), { status: "approved", cid: id, code, decidedAt: serverTimestamp() });
      toast("Approved. Their Circle is ready."); loadAdmin();
    } catch (e) { console.error(e); toast("Could not approve. Please try again."); }
  },
  async declineReq(el) {
    const note = (document.getElementById("note_" + el.dataset.uid) || {}).value || "";
    try { await updateDoc(doc(db, "circleRequests", el.dataset.uid), { status: "declined", note: note.trim(), decidedAt: serverTimestamp() }); toast("Request declined"); loadAdmin(); }
    catch (e) { toast("Could not decline. Please try again."); }
  },
  async createCircle() {
    const name = document.getElementById("cName").value.trim(), goal = document.getElementById("cGoal").value.trim(), kind = document.getElementById("cKind").value;
    if (!name) return toast("Please give the Circle a name.");
    const code = (name.replace(/[^A-Za-z]/g, "").slice(0, 5) || "CIRCL").toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    const id = "c" + Date.now().toString(36);
    try {
      await setDoc(doc(db, "circles", id), { name, goal, kind, leaderUid: S.user.uid, createdAt: serverTimestamp() });
      await setDoc(doc(db, "joinCodes", code), { cid: id, createdAt: serverTimestamp() });
      await setDoc(doc(db, "circles", id, "members", S.user.uid), { promise: true, code, joinedAt: serverTimestamp(), summary: summaryFor(), lastCheckIn: "" });
      await updateDoc(doc(db, "users", S.user.uid), { circles: arrayUnion(id) });
      toast("Circle created"); loadAdmin();
    } catch (e) { console.error(e); toast("Could not create the Circle."); }
  },
  async copyLink(el) {
    try { await navigator.clipboard.writeText(el.dataset.link); toast("Invite link copied"); }
    catch (e) { toast("Select the link above and copy it."); }
  },
};
function careCard() {
  return `<div class="care-card"><b>We are glad you shared this.</b><p>You are not alone. If you are thinking about hurting yourself, please call <b>Tele MANAS on 14416</b>, free, day and night. In an emergency, call <b>112</b>. Your Circle leader will see this so they can check on you.</p></div>`;
}
async function loadAdmin() {
  try {
    const [snap, codes, reqs] = await Promise.all([getDocs(collection(db, "circles")), getDocs(collection(db, "joinCodes")), getDocs(collection(db, "circleRequests"))]);
    const requests = reqs.docs.map(d => ({ ...d.data({ serverTimestamps: "estimate" }), uid: d.id }));
    await loadProfiles(requests.map(r => r.uid));
    const byCid = {}; codes.docs.forEach(d => { byCid[d.data().cid] = d.id; });
    const list = snap.docs.map(d => ({ id: d.id, ...d.data(), code: byCid[d.id] || "" }));
    if (S.view === "admin") { S.params.list = list; S.params.requests = requests; render(); }
  } catch (e) { toast("Could not load Circles."); }
}

document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const a = actions[el.dataset.act]; if (!a) return;
  if (el.tagName === "INPUT") { if (el.type === "checkbox") a(el); return; }
  e.preventDefault(); a(el);
});
document.addEventListener("change", e => {
  const el = e.target.closest("[data-act]"); if (!el || el.tagName !== "INPUT" || el.type === "checkbox") return;
  const a = actions[el.dataset.act]; if (a) a(el);
});
actions.sugSince = el => { S.ob.suggest[+el.dataset.i].since = el.value; };

onAuthStateChanged(auth, user => {
  if (!user) { S.user = null; go("signin"); return; }
  startSession(user).catch(e => { console.error(e); $app.innerHTML = `<div class="empty">Something went wrong while loading Circles. Please refresh the page.</div>`; });
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
