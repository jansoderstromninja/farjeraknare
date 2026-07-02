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
      logs.push({ id: ch.key, type: v.type, ts: v.ts, delta: v.delta });
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

function initFirebase() {
  if (typeof firebase === 'undefined') { setSyncStatus('local'); return; }
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    currentRefDate = localDate();
    logsRef  = db.ref('days/' + currentRefDate + '/logs');
    tripsRef = db.ref('turer/' + currentRefDate);
    setSyncStatus('connecting');

    // Connection state
    db.ref('.info/connected').on('value', s => {
      setSyncStatus(s.val() === true ? 'online' : 'connecting');
    });

    attachListeners();
    initBryggorListener();
    initDriftstatusListener();
    checkVersion();
  } catch (e) {
    db = null; logsRef = null; tripsRef = null; currentRefDate = null;
    setSyncStatus('local');
  }
}
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
