/* ─── Firebase configuration ─────────────────────────────────────────────── */
const firebaseConfig = {
  apiKey:            'AIzaSyBRKLpnwbYa-ahTNRSaZUrTeNSYb2It5qE',
  authDomain:        'gsu-grad-planner.firebaseapp.com',
  projectId:         'gsu-grad-planner',
  storageBucket:     'gsu-grad-planner.firebasestorage.app',
  messagingSenderId: '414204042501',
  appId:             '1:414204042501:web:ee9bfbdcd3a4939574ab6c',
  measurementId:     'G-0BKCSKSPVL',
};

/* ─── FirebaseService ────────────────────────────────────────────────────── */
const FirebaseService = (() => {
  let db      = null;
  let planRef = null;
  let unsubscribe = null;

  function init() {
    try {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
      planRef = db.collection('planner').doc('sharedSchedule');
      return true;
    } catch (e) {
      console.error('[Firebase] init failed:', e);
      return false;
    }
  }

  async function load() {
    if (!planRef) return null;
    try {
      const snap = await planRef.get();
      return snap.exists ? snap.data() : null;
    } catch (e) {
      console.error('[Firebase] load failed:', e);
      return null;
    }
  }

  async function save(payload) {
    if (!planRef) return false;
    try {
      await planRef.set({
        ...payload,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: false });
      return true;
    } catch (e) {
      console.error('[Firebase] save failed:', e);
      return false;
    }
  }

  function listen(onData, onError) {
    if (!planRef) return () => {};
    if (unsubscribe) unsubscribe();
    unsubscribe = planRef.onSnapshot(snap => {
      onData(snap.exists ? snap.data() : null, snap.exists);
    }, err => {
      console.error('[Firebase] listener error:', err);
      if (onError) onError(err);
    });
    return () => { if (unsubscribe) unsubscribe(); };
  }

  return { init, load, save, listen };
})();
