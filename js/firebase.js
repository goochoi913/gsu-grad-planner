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

/* ─── FirebaseService ────────────────────────────────────────────────────────
   planner/sharedSchedule  the plan: upcoming terms, courses, meeting times, view settings
   planner/academicRecord  past terms with grades, and advisor exceptions (stored only here)
   ────────────────────────────────────────────────────────────────────────── */
const FirebaseService = (() => {
  let db = null;
  const refs = {}, unsubscribe = {};

  function init() {
    try {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
      refs.plan = db.collection('planner').doc('sharedSchedule');
      refs.record = db.collection('planner').doc('academicRecord');
      return true;
    } catch (e) {
      console.error('[Firebase] init failed:', e);
      return false;
    }
  }

  const stamped = payload => ({ ...payload, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });

  async function save(which, payload) {
    if (!refs[which]) return false;
    try {
      await refs[which].set(stamped(payload), { merge: false });
      return true;
    } catch (e) {
      console.error(`[Firebase] ${which} save failed:`, e);
      return false;
    }
  }

  // Writes both documents at once — finishing a term moves its courses from the plan into the record.
  async function saveBoth(plan, record) {
    if (!db) return false;
    try {
      const batch = db.batch();
      batch.set(refs.plan, stamped(plan));
      batch.set(refs.record, stamped(record));
      await batch.commit();
      return true;
    } catch (e) {
      console.error('[Firebase] batch save failed:', e);
      return false;
    }
  }

  function listen(which, onData, onError) {
    if (!refs[which]) return () => {};
    if (unsubscribe[which]) unsubscribe[which]();
    unsubscribe[which] = refs[which].onSnapshot(snap => {
      onData(snap.exists ? snap.data() : null, snap.exists);
    }, err => {
      console.error(`[Firebase] ${which} listener error:`, err);
      if (onError) onError(err);
    });
    return unsubscribe[which];
  }

  return { init, save, saveBoth, listen };
})();
