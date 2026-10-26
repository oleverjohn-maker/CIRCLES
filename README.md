# Circles pilot

A test version of Circles: grow together, one day at a time.

- `index.html`, `styles.css`, `app.js`: the app
- `firebase-config.js`: the Firebase web app settings (public by design)
- `firestore.rules`: the database security rules, pasted into Firebase console > Firestore > Rules
- `manifest.webmanifest`, `sw.js`, `icons/`: let people add Circles to their home screen

Only people who sign in with Google can use it, and only members of a Circle can read that Circle.
