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
// Separat nod breadcrumbs/{datum}/{pushKey} = { lat, lng, speed, heading, ts }.
// Skrivs av heartbeat-loopen i gps.js — både i rörelse och stillastående vid
// kaj (så Färjappens 5-min offline-timeout på pos.ts aldrig löser ut i onödan).
// Anslutningsstatus (lever/död) läses redan via .info/connected-lyssnaren.
//
// Rullande 60-minuters buffert, inte en logg: varje skrivning triggar en
// rensning av poster äldre än BREADCRUMB_RETENTION_MS, och en tömd datum-nod
// tas bort helt. En full sopning körs dessutom vid appstart (pruneAllBreadcrumbs)
// så data från en session som aldrig skrev igen (appen stängd) inte blir kvar
// för evigt — annars skulle bara framtida skrivningar trigga rensning.
let breadcrumbWriteWarned = false;
const BREADCRUMB_RETENTION_MS = 60 * 60 * 1000;

function writeBreadcrumb(lat, lng, speed, heading) {
  if (!db) return;
  const payload = { lat, lng, speed: speed ?? 0, heading: heading ?? -1, ts: Date.now() };
  db.ref('breadcrumbs/' + localDate()).push(payload)
    .then(
      () => pruneRecentBreadcrumbs(payload.ts),
      // OBS: felfunktionen här är en riktig andra-then-arg (inte SDK-quirken
      // med .catch() på push-referensen) eftersom vi har ett success-fall att köra
      e => {
        // Engångsvarning — kräver ".read"/".write": true för breadcrumbs i databasreglerna
        if (breadcrumbWriteWarned) return;
        breadcrumbWriteWarned = true;
        console.log('[Breadcrumbs] Skrivning nekades (kolla databasreglerna):', e?.message ?? String(e));
      }
    );
}

function dateStrFromTs(ts) {
  const d = new Date(ts);
  return dateStrFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// Tar bort poster äldre än cutoff ur en redan hämtad datum-nod-snapshot, och
// hela datum-noden om den blir tom efteråt.
function pruneBreadcrumbSnapshot(dateStr, dateSnap, cutoff) {
  if (!dateSnap.exists()) return;
  const updates = {};
  let remaining = 0;
  dateSnap.forEach(ch => {
    const v = ch.val();
    if (v && typeof v.ts === 'number' && v.ts < cutoff) updates[ch.key] = null;
    else remaining++;
  });
  const toDelete = Object.keys(updates).length;
  if (!toDelete) return;
  db.ref('breadcrumbs/' + dateStr).update(updates).then(() => {
    console.log('[Breadcrumbs] Rensade', toDelete, 'post(er) äldre än 60 min i', dateStr);
    if (remaining === 0) {
      db.ref('breadcrumbs/' + dateStr).remove()
        .then(() => console.log('[Breadcrumbs] Tom datum-nod borttagen:', dateStr))
        .catch(() => {});
    }
  }).catch(() => {});
}

// Riktad rensning (säkerhets-/prestandafix): hämtar BARA poster äldre än
// cutoff via orderByChild('ts').endAt(cutoff) i stället för att läsa in hela
// datum-noden — avgörande eftersom detta anropas via heartbeaten var 10:e
// till 60:e sekund, inte bara en gång vid appstart (se pruneAllBreadcrumbs).
// KRÄVER "ts" .indexOn i databasreglerna för breadcrumbs/$date — verifierat
// direkt mot produktionsdatabasen att frågan ger ETT HÅRT FEL utan indexet
// (inte bara en varning), så tills regeln finns görs ingen riktad rensning
// alls (pruneAllBreadcrumbs vid appstart fortsätter fungera som backstop,
// den använder ingen orderBy-fråga).
let breadcrumbIndexWarned = false;
function pruneStaleBreadcrumbsQuery(dateStr, cutoff) {
  const ref = db.ref('breadcrumbs/' + dateStr);
  ref.orderByChild('ts').endAt(cutoff).once('value')
    .then(staleSnap => {
      if (!staleSnap.exists()) return null;
      const updates = {};
      staleSnap.forEach(ch => { updates[ch.key] = null; });
      const toDelete = Object.keys(updates).length;
      return ref.update(updates).then(() => {
        console.log('[Breadcrumbs] Rensade', toDelete, 'post(er) äldre än 60 min i', dateStr, '(riktad query)');
        return ref.limitToFirst(1).once('value'); // billig existens-check, ingen fulläsning
      });
    })
    .then(remainSnap => {
      if (remainSnap && !remainSnap.exists()) {
        return ref.remove().then(() => console.log('[Breadcrumbs] Tom datum-nod borttagen:', dateStr));
      }
    })
    .catch(e => {
      if (breadcrumbIndexWarned) return;
      breadcrumbIndexWarned = true;
      console.log('[Breadcrumbs] Riktad rensning misslyckades — lägg till "ts": {".indexOn": true} under breadcrumbs/$date i databasreglerna:', e?.message ?? String(e));
    });
}

// Körs efter varje ny skrivning: rensar dagens nod, och gårdagens också om
// 60-minutersfönstret just nu sträcker sig över en midnattsgräns
function pruneRecentBreadcrumbs(nowTs) {
  if (!db) return;
  const cutoff = nowTs - BREADCRUMB_RETENTION_MS;
  const today = localDate();
  const cutoffDateStr = dateStrFromTs(cutoff);
  const dates = cutoffDateStr === today ? [today] : [cutoffDateStr, today];
  dates.forEach(dateStr => pruneStaleBreadcrumbsQuery(dateStr, cutoff));
}

// Full sopning vid appstart — går igenom ALLA datum-noder (inte bara
// idag/igår) så en session som aldrig skrev igen inte lämnar data kvar
function pruneAllBreadcrumbs() {
  if (!db) return;
  const cutoff = Date.now() - BREADCRUMB_RETENTION_MS;
  db.ref('breadcrumbs').once('value').then(snap => {
    if (!snap.exists()) return;
    snap.forEach(dateSnap => pruneBreadcrumbSnapshot(dateSnap.key, dateSnap, cutoff));
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

    // ── Autentisering (säkerhetsfix) ──
    // Anonym inloggning förbereder appen för databasregler som kräver
    // auth != null i stället för true. Kräver att "Anonymous" aktiveras
    // under Firebase-konsolen → Authentication → Sign-in method — ETT
    // MANUELLT STEG SOM INTE KAN GÖRAS VIA KOD HÄRIFRÅN. Blockerar inte
    // resten av initieringen: så länge reglerna fortfarande tillåter
    // oautentiserad åtkomst fungerar appen som förut även om detta
    // misslyckas, och redan uppsatta .on('value')-lyssnare återansluter
    // automatiskt med ny auth-token när/om inloggningen lyckas senare.
    if (typeof firebase.auth === 'function') {
      firebase.auth().signInAnonymously().catch(e => {
        console.log('[Auth] Anonym inloggning misslyckades — aktivera "Anonymous" i Firebase-konsolen (Authentication → Sign-in method):', e?.message ?? String(e));
      });
    } else {
      console.log('[Auth] firebase-auth-compat.js saknas — ingen autentisering aktiv');
    }

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
    pruneAllBreadcrumbs();
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
// Driftlägesyta, helt frikopplad från GPS/avgångslogiken — rent
// informativt (visas internt på Status-fliken, påverkar ingen körningslogik).
// config/driftstatus = { status, beskrivning, timestamp } — aktuellt läge.
// config/driftstatus_history/{pushKey} = samma form, append-only logg.
let currentDriftstatus = null;

function initDriftstatusListener() {
  if (!db) return;
  db.ref('config/driftstatus').on('value', snap => {
    currentDriftstatus = snap.val();
    if (currentView === 'Driftstatus') renderCurrentDriftstatus();
  }, () => { currentDriftstatus = null; });
}

// status: 'normal' | 'service' | 'tankning' | 'utryckning' | 'annat'
// beskrivning: fritext, bara relevant för 'annat'
function submitDriftstatus(status, beskrivning) {
  const entry = { status, beskrivning: beskrivning || '', timestamp: Date.now() };
  if (!db) {
    console.log('[Driftstatus] Firebase ej tillgängligt — kunde inte spara', status);
    if (typeof showDriftstatusError === 'function') showDriftstatusError();
    return;
  }
  db.ref('config/driftstatus').set(entry)
    .then(() => {
      console.log('[Driftstatus] Satt till', status, entry.beskrivning ? '– ' + entry.beskrivning : '');
      if (typeof hideDriftstatusError === 'function') hideDriftstatusError();
    })
    // OBS: .set() ger en riktig Promise (till skillnad från .push(data), vars
    // ThennableReference aldrig triggar .catch() i compat 10.12.5 — se nedan)
    .catch(e => {
      console.log('[Driftstatus] Kunde inte spara (kolla databasreglerna):', e?.message ?? String(e));
      if (typeof showDriftstatusError === 'function') showDriftstatusError(e?.message ?? String(e));
    });
  // .push(entry).catch() skulle ALDRIG triggas (samma SDK-egenhet som i
  // writeBreadcrumb, v9.6) — .then(null, fn) används därför här också
  db.ref('config/driftstatus_history').push(entry).then(null, () => {});
}

// Senaste 10 statusändringarna, nyast först
function fetchDriftstatusHistory() {
  if (!db) return Promise.resolve([]);
  return db.ref('config/driftstatus_history').limitToLast(10).once('value')
    .then(snap => {
      const arr = [];
      snap.forEach(ch => arr.push({ id: ch.key, ...ch.val() }));
      return arr.reverse();
    })
    .catch(() => []);
}
