// ── VERSION CHECK ──
function checkVersion() {
  if (!db) return;
  db.ref('config/version').once('value').then(snap => {
    const v = snap.val();
    if (v && String(v) !== String(APP_VERSION)) showUpdateBanner();
  }).catch(() => {});
}

function showUpdateBanner() {
  const el = document.getElementById('updateBanner');
  if (el) el.style.display = 'flex';
}

function dismissUpdateBanner() {
  const el = document.getElementById('updateBanner');
  if (el) el.style.display = 'none';
}
// ── FIREBASE SYNC ──
const firebaseConfig = {
  apiKey: "AIzaSyDregBlw1hjcHotJAk8938xXAjQKbHXS1Q",
  authDomain: "fordonsraknare.firebaseapp.com",
  projectId: "fordonsraknare",
  storageBucket: "fordonsraknare.firebasestorage.app",
  messagingSenderId: "260033893182",
  appId: "1:260033893282:web:328da94483ad4b245f926f",
  databaseURL: "https://fordonsraknare-default-rtdb.europe-west1.firebasedatabase.app"
};

let db = null, logsRef = null, tripsRef = null, currentRefDate = null;

function setSyncStatus(state) {
  const dot = document.querySelector('#hdrSync .sync-dot');
  const txt = document.getElementById('syncText');
  if (!dot || !txt) return;
  dot.className = 'sync-dot ' + state;
  txt.textContent = { online: t('syncOnline'), connecting: t('syncConnecting'), error: t('syncError'), local: t('syncLocal') }[state] || t('syncLocal');
}

function attachListeners() {
  logsRef.on('value', snap => {
    const logs = [];
    snap.forEach(ch => {
      const v = ch.val();
      logs.push({ id: ch.key, type: v.type, ts: v.ts, delta: v.delta, brygga: v.brygga ?? null, elbil: v.elbil ?? false });
    });
    logs.sort((a, b) => a.ts - b.ts);
    const d = load();
    d.logs = logs;
    save(d);
    refreshAll();
  }, () => setSyncStatus('error'));

  tripsRef.on('value', snap => {
    const trips = [];
    snap.forEach(ch => {
      const v = ch.val();
      const trip = { id: ch.key, ts: v.ts };
      if (v.lat !== undefined) { trip.lat = v.lat; trip.lng = v.lng; }
      if (v.from !== undefined) { trip.from = v.from; trip.to = v.to; }
      if (v.avgSpeedKnots !== undefined) { trip.avgSpeedKnots = v.avgSpeedKnots; }
      trips.push(trip);
    });
    trips.sort((a, b) => a.ts - b.ts);
    const d = load();
    d.trips = trips;
    save(d);
    refreshAll();
    updateKorTomLock();
    updateUndoDeparture();
    renderDepartureLog();
  }, () => setSyncStatus('error'));
}

function checkDateRollover() {
  if (!db || !currentRefDate) return;
  const today = localDate();
  if (currentRefDate === today) return;
  logsRef.off();
  tripsRef.off();
  currentRefDate = today;
  logsRef  = db.ref('days/' + today + '/logs');
  tripsRef = db.ref('turer/' + today);
  firedReminders = new Set();
  attachListeners();
}

// ── OFFLINE-SYNKKÖ (avgångshändelser) ──
// Realtime Database (compat) saknar diskpersistens på webben — enablePersistence()
// finns bara i Firestore, och RTDB:s interna skrivkö lever i minnet. Skrivs en
// avgång offline och sidan laddas om innan uppkopplingen återställts tappas den.
// Därför egen kö: posten läggs i localStorage INNAN Firebase-anropet och tas bort
// först när skrivningen bekräftats. Push-nyckeln (= sökvägen) genereras vid
// köläggning och persistas före varje skrivförsök — samma path + samma data gör
// varje retry idempotent, så en lyckad men obekräftad skrivning aldrig dubblas.
const PENDING_KEY = 'farjeraknare_pending';

function loadPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; }
  catch { return []; }
}

function savePending(q) { localStorage.setItem(PENDING_KEY, JSON.stringify(q)); }

// Lägg en avgångsskrivning i kön och försök flusha direkt. Returnerar
// Firebase-nyckeln, eller null om Firebase aldrig initierats (path sätts
// då först vid flush, när db finns).
function enqueueDeparture(date, data) {
  const key = db ? db.ref('turer/' + date).push().key : null;
  const entry = {
    id: 'dep_' + data.ts + '_' + Math.random().toString(36).slice(2, 7),
    path: key ? 'turer/' + date + '/' + key : null,
    date,
    data,
  };
  const q = loadPending();
  q.push(entry);
  savePending(q);
  console.log('[Synkkö] Köad', entry.id, '→', entry.path ?? '(path sätts vid flush)');
  flushPending();
  return key;
}

let flushInProgress = false;
function flushPending() {
  if (!db || flushInProgress) return;
  const q = loadPending();
  if (!q.length) return;
  flushInProgress = true;
  console.log('[Synkkö] Flush startar —', q.length, 'väntande post(er)');
  let chain = Promise.resolve();
  q.forEach(entry => {
    chain = chain.then(() => {
      // Saknas path (Firebase var nere vid köläggning): generera nyckel och
      // persista den INNAN skrivförsöket så en avbruten flush återanvänder
      // samma sökväg nästa gång — idempotent retry
      if (!entry.path) {
        entry.path = 'turer/' + entry.date + '/' + db.ref('turer/' + entry.date).push().key;
        const cur = loadPending();
        const i = cur.findIndex(e => e.id === entry.id);
        if (i >= 0) { cur[i].path = entry.path; savePending(cur); }
      }
      return db.ref(entry.path).set(entry.data).then(() => {
        savePending(loadPending().filter(e => e.id !== entry.id));
        console.log('[Synkkö] Bekräftad', entry.id, '→', entry.path);
      });
    });
  });
  chain
    .catch(e => console.log('[Synkkö] Skrivning misslyckades — posten ligger kvar i kön:', e?.message ?? String(e)))
    .finally(() => { flushInProgress = false; });
}

// Ta bort oflushade köposter för en raderad avgång så flushen inte
// återuppväcker den efter att den tagits bort ur Firebase
function dropPendingForTrip(tripId) {
  const q = loadPending();
  const rest = q.filter(e => !(e.path && e.path.endsWith('/' + tripId)));
  if (rest.length !== q.length) {
    savePending(rest);
    console.log('[Synkkö] Köpost borttagen för raderad avgång', tripId);
  }
}

// ── GPS-BREADCRUMBS (lagring) ──
// Separat nod breadcrumbs/{datum}/{pushKey} = { lat, lng, speed, ts } — rå
// spårdata för framtida kartfunktion. Anslutningsstatus (lever/död) läses
// redan via .info/connected-lyssnaren och kräver ingen egen skrivning.
let breadcrumbWriteWarned = false;
function writeBreadcrumb(lat, lng, speed) {
  if (!db) return;
  // OBS: .catch() direkt på push-referensen registreras men körs aldrig i
  // compat-SDK:n (verifierat) — .then(null, fn) fungerar, därav formen nedan
  db.ref('breadcrumbs/' + localDate()).push({ lat, lng, speed, ts: Date.now() })
    .then(null, e => {
      // Engångsvarning — kräver ".read"/".write": true för breadcrumbs i databasreglerna
      if (breadcrumbWriteWarned) return;
      breadcrumbWriteWarned = true;
      console.log('[Breadcrumbs] Skrivning nekades (kolla databasreglerna):', e?.message ?? String(e));
    });
}

// Radera breadcrumbs äldre än 30 dagar vid appstart — datumnycklarna
// (YYYY-MM-DD) är lexikografiskt kronologiska så orderByKey + endBefore
// träffar exakt de gamla dagarna utan att läsa färsk data
const BREADCRUMB_RETENTION_DAYS = 30;
function cleanupBreadcrumbs() {
  if (!db) return;
  const c = new Date();
  c.setDate(c.getDate() - BREADCRUMB_RETENTION_DAYS);
  const cutoff = `${c.getFullYear()}-${pad(c.getMonth() + 1)}-${pad(c.getDate())}`;
  db.ref('breadcrumbs').orderByKey().endBefore(cutoff).once('value').then(snap => {
    const updates = {};
    snap.forEach(ch => { updates[ch.key] = null; });
    const n = Object.keys(updates).length;
    if (!n) return;
    db.ref('breadcrumbs').update(updates)
      .then(() => console.log('[Breadcrumbs] Städade', n, 'dag(ar) äldre än', cutoff))
      .catch(() => {});
  }).catch(e => console.log('[Breadcrumbs] Städning nekades (kolla databasreglerna):', e?.message ?? String(e)));
}

function initFirebase() {
  if (typeof firebase === 'undefined') { setSyncStatus('local'); return; }
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    currentRefDate = localDate();
    logsRef  = db.ref('days/' + currentRefDate + '/logs');
    tripsRef = db.ref('turer/' + currentRefDate);
    setSyncStatus('connecting');

    // Connection state — vid återfått serveranslutning flushas synk-kön
    db.ref('.info/connected').on('value', s => {
      setSyncStatus(s.val() === true ? 'online' : 'connecting');
      if (s.val() === true) flushPending();
    });

    attachListeners();
    initBryggorListener();
    initDriftstatusListener();
    checkVersion();
    flushPending(); // poster köade före en omladdning synkas vid appstart
    cleanupBreadcrumbs();
  } catch (e) {
    db = null; logsRef = null; tripsRef = null; currentRefDate = null;
    setSyncStatus('local');
  }
}

// Explicit anslutningshantering: webbläsarens nätverkshändelser styr RTDB-
// anslutningen direkt i stället för att vänta på SDK:ns egen timeout
window.addEventListener('online', () => {
  console.log('[Synkkö] Nätverk åter — goOnline + flush');
  if (db) firebase.database().goOnline();
  flushPending();
});
window.addEventListener('offline', () => {
  console.log('[Synkkö] Nätverk borta — goOffline');
  if (db) firebase.database().goOffline();
});
// ── PIER MATCHING ──
// Koordinater kan åsidosättas via Firebase config/bryggor/{id}: { name, lat, lng }
// Firebase-regler måste tillåta läsning av config/: { ".read": true }
const BRYGGOR_DEFAULT = [
  { id: 'pettu', name: 'Pettu', lat: 60.0385, lng: 22.9226 },
  { id: 'uto',   name: 'Utö',   lat: 60.0411, lng: 22.9151 },
];
let bryggorConfig = BRYGGOR_DEFAULT;
const BRYGGA_RADIUS_M = 50;
const OPERATING_RADIUS_M = 1000;

function geoDistMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getNearestBrygga(lat, lng, quiet) {
  let nearest = null, minDist = Infinity;
  bryggorConfig.forEach(b => {
    const d = geoDistMeters(lat, lng, b.lat, b.lng);
    if (d < minDist) { minDist = d; nearest = b; }
  });
  if (nearest && minDist <= BRYGGA_RADIUS_M) {
    if (!quiet) console.log('[Bryggor] Närmaste brygga:', nearest.name, '–', minDist.toFixed(0), 'm');
    return nearest.name;
  }
  if (!quiet) console.log('[Bryggor] Ingen brygga inom', BRYGGA_RADIUS_M, 'm (närmast:', nearest?.name, minDist.toFixed(0), 'm)');
  return null;
}

function isWithinOperatingArea(lat, lng) {
  return bryggorConfig.some(b => geoDistMeters(lat, lng, b.lat, b.lng) <= OPERATING_RADIUS_M);
}

function initBryggorListener() {
  if (!db) return;
  db.ref('config/bryggor').on('value', snap => {
    const v = snap.val();
    if (v && typeof v === 'object') {
      bryggorConfig = Object.values(v);
      console.log('[Bryggor] Konfiguration laddad från Firebase:', JSON.stringify(bryggorConfig));
    }
    renderDepartureLog();
  });
}

// ── DRIFTSTATUS ──
// Manuell driftstatus i Firebase config/driftstatus: "normal" | "service".
// Sätts manuellt i Firebase-konsolen; "service" stänger av avgångsprediktionen.
let driftstatus = 'normal';

function initDriftstatusListener() {
  if (!db) return;
  const ref = db.ref('config/driftstatus');
  // Skapa noden med "normal" om den saknas (tyst om skrivregler blockerar)
  ref.once('value').then(snap => {
    if (snap.val() === null) ref.set('normal').catch(() => {});
  }).catch(() => {});
  ref.on('value', snap => {
    driftstatus = snap.val() === 'service' ? 'service' : 'normal';
    console.log('[Driftstatus]', driftstatus);
    renderPrediction();
  });
}
