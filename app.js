// HOOK-TEST: tillfällig rad för att verifiera att pre-commit-hooken höjer
// APP_VERSION vid en riktig .js-ändring. Tas bort i nästa commit (git revert).
// ── DEBUG PANEL ──
const _debugLines = [];
const _origLog = console.log.bind(console);
console.log = function(...args) {
  _origLog(...args);
  const now = new Date();
  const ts = now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  _debugLines.push({ ts, msg });
  if (_debugLines.length > 200) _debugLines.shift();
  const log = document.getElementById('debugLog');
  if (log && document.getElementById('debugPanel').classList.contains('show')) {
    const el = document.createElement('div');
    el.className = 'dbg-line';
    el.innerHTML = `<span class="dbg-ts">${escapeHtml(ts)}</span><span class="dbg-msg">${escapeHtml(msg)}</span>`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }
};

function showDebugPanel() {
  const panel = document.getElementById('debugPanel');
  const log = document.getElementById('debugLog');
  log.innerHTML = '';
  _debugLines.forEach(({ ts, msg }) => {
    const el = document.createElement('div');
    el.className = 'dbg-line';
    el.innerHTML = `<span class="dbg-ts">${escapeHtml(ts)}</span><span class="dbg-msg">${escapeHtml(msg)}</span>`;
    log.appendChild(el);
  });
  log.scrollTop = log.scrollHeight;
  panel.classList.add('show');
}
function hideDebugPanel() { document.getElementById('debugPanel').classList.remove('show'); }
function clearDebugLog() { _debugLines.length = 0; document.getElementById('debugLog').innerHTML = ''; }
const CATS = [
  { id: 'personbil',  label: 'Personbil',  labelFi: 'Henkilöauto',   emoji: '🚗',  color: '#1D4ED8' },
  { id: 'paketbil',   label: 'Paketbil',   labelFi: 'Pakettiauto',   emoji: '🚐',  color: '#6D28D9' },
  { id: 'lastbil',    label: 'Lastbil',     labelFi: 'Kuorma-auto',   emoji: '🚛',  color: '#B91C1C' },
  { id: 'traktor',    label: 'Traktor',     labelFi: 'Traktori',      emoji: '🚜',  color: '#92400E' },
  { id: 'cykel',      label: 'Cykel',       labelFi: 'Polkupyörä',    emoji: '🚲',  color: '#065F46' },
  { id: 'mc',         label: 'MC',          labelFi: 'Moottoripyörä', emoji: '🏍️',  color: '#C2410C' },
  { id: 'fotgangare', label: 'Fotgängare',  labelFi: 'Jalankulkija',  emoji: '🚶',  color: '#0E7490' },
  { id: 'moped',      label: 'Moped',       labelFi: 'Mopo',          emoji: '🛵',  color: '#9D174D' },
  { id: 'fyrhjuling', label: 'Fyrhjuling',  labelFi: 'Mönkijä',       emoji: '🏎️',  color: '#3730A3' },
];

const APP_VERSION = "11.1";
const KEY = 'farjeraknare_v1';
localStorage.removeItem('farjeraknare_watlev'); // migrerat till Firebase config/watlev

// CO2 per avgång: bränslelogg 2022–2026 — snitt 12.2 L/h, ~2.0 L/tur, 2.68 kg CO2/L diesel
const CO2_PER_TRIP    = 5.4;
const CO2_PER_KM_CAR  = 0.12;  // kg CO2/km, förbränningsmotor
const CO2_PER_KM_EV   = 0.02;  // kg CO2/km, elbil
const CO2_PER_TRIP_EV = 0.1;   // kg CO2/avgång, hypotetisk elfärja (uppskattad)
const TRIP_GAP_MS          = 2 * 60 * 1000;
const KORTOM_LOCK_MS       = 2 * 60 * 1000;
const TRIP_VEHICLE_WINDOW_MS  = 3 * 60 * 1000; // ms – efterslängsfönster: loggar ≤ 3 min efter en avgång räknas till den

// Kronologisk fordonskoppling: en logg hör till första avgången vars ts +
// TRIP_VEHICLE_WINDOW_MS ligger vid eller efter loggen. Fordon lastas före
// avgång; fönstret efteråt fångar sena tryck när färjan redan lagt ut.
// Ingen logg mellan två avgångar tappas eller dubbelräknas (gamla ±3 min-
// fönstret tappade fordon loggade > 3 min före sin avgång → "tomma" rader).
function tripTsForLog(logTs, sortedTripTs) {
  for (const ts of sortedTripTs) {
    if (logTs <= ts + TRIP_VEHICLE_WINDOW_MS) return ts;
  }
  return null; // efter sista avgången + fönster — väntar på nästa avgång
}
const MODE_KEY             = 'farjeraknare_mode';
let mode = localStorage.getItem(MODE_KEY) || 'test';
// Elbilsandel av Personbil + Paketbil (nettodeltan; gamla loggar utan
// elbil-fält räknas som false och hamnar bara i totalen)
function evStats(logs) {
  let cars = 0, evs = 0;
  logs.forEach(l => {
    if (l.type !== 'personbil' && l.type !== 'paketbil') return;
    const d = l.delta ?? 1;
    cars += d;
    if (l.elbil) evs += d;
  });
  cars = Math.max(0, cars);
  evs = Math.max(0, Math.min(evs, cars));
  return { evs, cars, pct: cars > 0 ? Math.round(evs / cars * 100) : 0 };
}

function evStatsLine(logs) {
  const s = evStats(logs);
  return `${t('evStat')}: <strong>${s.evs}</strong> ${t('evOfWord')} ${s.cars} (${s.pct}%)`;
}

// Elbil-flagga för en −1-borttagning: speglar det senast tillagda (LIFO)
// fordonet av kategorin i det relevanta loggurvalet, så en borttagen elbil
// drar ner elbilsräkningen — utan detta tappas elbil-flaggan vid borttagning
function evFlagForRemoval(logs, catId) {
  const adds = logs.filter(l => l.type === catId && (l.delta ?? 1) > 0);
  if (!adds.length) return false;
  return !!adds.reduce((a, b) => (b.ts >= a.ts ? b : a)).elbil;
}

function co2CompareHtml(co2kg) {
  const iceKm     = Math.round(co2kg / CO2_PER_KM_CAR);
  const evKm      = Math.round(co2kg / CO2_PER_KM_EV);
  const ferryTrips = Math.round(co2kg / CO2_PER_TRIP_EV);
  return `<div class="co2-compare">${t('iceLabel')}: <strong>${iceKm}</strong> km (${t('iceDesc')}, ${CO2_PER_KM_CAR} kg/km)</div>` +
         `<div class="co2-compare co2-compare-ev">${t('evLabel')}: <strong>${evKm}</strong> km (${t('evDesc')}, ${CO2_PER_KM_EV} kg/km)</div>` +
         `<div class="co2-compare co2-compare-ferry">${t('ferryLabel')}: ${t('ferryPre')} <strong>${ferryTrips}</strong> ${t('ferryPost')} <span class="co2-est">(${t('uppskattat')})</span></div>`;
}

function toggleLang() {
  lang = lang === 'sv' ? 'fi' : 'sv';
  localStorage.setItem(LANG_KEY, lang);
  applyLang();
  if (currentView === 'Stats') renderStats();
  else if (currentView === 'Summary') goSummaryTab(summaryTab);
  renderCount();
}

function applyLang() {
  document.documentElement.lang = lang;
  document.body.classList.toggle('lang-fi', lang === 'fi');
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('hdrTitle',         '⛴ ' + t('appTitle'));
  set('langBtn',          lang === 'sv' ? '🇫🇮' : '🇸🇪');
  set('footerTotalLabel', t('footerLabel'));
  set('korTomBtn',        t('korTom'));
  set('undoDepartureBtn', t('undoAvgang'));
  set('undoBtn',          t('angra'));
  set('statsPerKatTitle', t('perKat'));
  set('statsPerTimmeTitle', t('perTimme'));
  set('sumTabIdag',       t('tabIdag'));
  set('sumTabVecka',      t('tabVecka'));
  set('sumTabManad',      t('tabManad'));
  set('sumTotalSub',      t('fordonidag'));
  set('peakLblHour',      t('toppimme'));
  set('peakLblFordon',    t('fordonLbl'));
  set('co2LblTurer',      t('turerIdag'));
  set('co2LblCO2',        t('co2idag'));
  set('resetBtnIdag',     t('aterstall'));
  set('modalTitle',       t('modalTitle'));
  set('modalBody',        t('modalBody'));
  set('modalCancel',      t('avbryt'));
  set('modalOk',          t('aterstallBtn'));
  set('departureBanner',  t('avgangReg'));
  set('countdownLabel',   t('nästaTur'));
  set('navCountLabel',    t('navCount'));
  set('navStatsLabel',    t('navStats'));
  set('navWeatherLabel',  t('navWeather'));
  set('navDriftstatusLabel', t('navDriftstatus'));
  set('weatherTitle',     t('weatherTitle'));
  set('statusCurrentTitle', t('statusCurrentTitle'));
  set('statusChooseTitle',  t('statusChooseTitle'));
  set('statusHistoryTitle', t('statusHistoryTitle'));
  const otherText = document.getElementById('statusOtherText');
  if (otherText) otherText.placeholder = t('statusOtherPlaceholder');
  const otherSubmit = document.getElementById('statusOtherSubmit');
  if (otherSubmit) otherSubmit.textContent = t('statusOtherSave');
  if (currentView === 'Driftstatus') renderDriftstatusView();
  updateThunderWarning(lastThunderInfo);
  applyMode();
  // Re-sync the current sync status label
  const dot = document.querySelector('#hdrSync .sync-dot');
  if (dot) {
    const state = dot.classList.contains('online') ? 'online' :
                  dot.classList.contains('connecting') ? 'connecting' :
                  dot.classList.contains('error') ? 'error' : 'local';
    setSyncStatus(state);
  }
}

function toggleMode() {
  mode = mode === 'ferry' ? 'test' : 'ferry';
  localStorage.setItem(MODE_KEY, mode);
  applyMode();
}

function applyMode() {
  const isFerry = mode === 'ferry';
  const mb = document.getElementById('modeBtn');
  const ml = document.getElementById('modeLabel');
  const kb = document.getElementById('korTomBtn');
  const ub = document.getElementById('undoDepartureBtn');
  const hs = document.getElementById('hdrSpeed');
  if (mb) mb.textContent = isFerry ? '🛳️' : '🧪';
  if (ml) ml.textContent = isFerry ? t('ferryMode') : t('testMode');
  if (kb) kb.style.display = isFerry ? 'none' : '';
  if (ub) ub.style.display = isFerry ? 'none' : '';
  if (hs) hs.style.display = isFerry ? '' : 'none';
  if (isFerry) startGpsWatch(); else stopGpsWatch();
  updateUndoDeparture();
  renderDepartureLog();
}

// ── COUNTDOWN ──
function updateCountdown() {
  const bar = document.getElementById('countdownBar');
  const txt = document.getElementById('countdownText');
  if (!bar || !txt) return;
  if (mode === 'ferry') { bar.style.display = 'none'; return; }
  const last = lastDepartureTs();
  if (!last) { bar.style.display = 'none'; return; }
  const remaining = KORTOM_LOCK_MS - (Date.now() - last);
  if (remaining <= 0) {
    bar.style.display = 'none';
    updateKorTomLock();
    return;
  }
  bar.style.display = 'flex';
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  txt.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
}
function localDate() {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

// Säkerhetsfix: config/driftstatus.beskrivning (och andra Firebase-fält som
// inte kräver autentisering för att skrivas) renderades oescapade via
// innerHTML — stored XSS. Används på all text/nyckel som kan komma från
// Firebase innan den infogas i en HTML-sträng, oavsett om målet är text-
// innehåll eller ett citerat attribut (t.ex. onclick="fn('${id}')") — samma
// teckenuppsättning (& < > " ') täcker båda kontexterna.
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function load() {
  try {
    const r = localStorage.getItem(KEY);
    if (!r) return { date: localDate(), logs: [], trips: [] };
    const d = JSON.parse(r);
    if (d.date !== localDate()) return { date: localDate(), logs: [], trips: [] };
    if (!d.trips) d.trips = [];
    return d;
  } catch { return { date: localDate(), logs: [], trips: [] }; }
}

function save(d) { localStorage.setItem(KEY, JSON.stringify(d)); }

function counts() {
  const d = load();
  const c = {};
  CATS.forEach(cat => c[cat.id] = 0);
  d.logs.forEach(l => { if (c[l.type] !== undefined) c[l.type] += (l.delta || 1); });
  CATS.forEach(cat => { c[cat.id] = Math.max(0, c[cat.id]); });
  return c;
}

function hourlyData() {
  const d = load();
  const h = {};
  d.logs.forEach(l => {
    const hr = new Date(l.ts).getHours();
    if (!h[hr]) h[hr] = {};
    if (!h[hr][l.type]) h[hr][l.type] = 0;
    h[hr][l.type] += (l.delta || 1);
  });
  return h;
}

function hourTotal(hObj) {
  return Math.max(0, Object.values(hObj).reduce((a, b) => a + b, 0));
}

// Smooth cubic-bezier path through points (Catmull-Rom style)
function smoothPath(xs, ys) {
  let d = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  const smoothing = 0.2;
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = i > 0 ? xs[i-1] : xs[i];
    const y0 = i > 0 ? ys[i-1] : ys[i];
    const x1 = xs[i], y1 = ys[i];
    const x2 = xs[i+1], y2 = ys[i+1];
    const x3 = i < xs.length - 2 ? xs[i+2] : x2;
    const y3 = i < xs.length - 2 ? ys[i+2] : y2;
    const cp1x = x1 + (x2 - x0) * smoothing;
    const cp1y = y1 + (y2 - y0) * smoothing;
    const cp2x = x2 - (x3 - x1) * smoothing;
    const cp2y = y2 - (y3 - y1) * smoothing;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  return d;
}

let hourTipTimer = null;
function showHourTip(cx, cy, label) {
  const tip = document.getElementById('hourTip');
  const text = document.getElementById('hourTipText');
  const rect = document.getElementById('hourTipRect');
  if (!tip || !text || !rect) return;
  text.setAttribute('x', cx);
  text.setAttribute('y', cy - 12);
  text.textContent = label;
  const bbox = text.getBBox();
  rect.setAttribute('x', bbox.x - 6);
  rect.setAttribute('y', bbox.y - 4);
  rect.setAttribute('width', bbox.width + 12);
  rect.setAttribute('height', bbox.height + 8);
  tip.style.opacity = '1';
  clearTimeout(hourTipTimer);
  hourTipTimer = setTimeout(() => { tip.style.opacity = '0'; }, 2200);
}

// ── BUILD BUTTONS ──
// ── ELBILS-FLAGGA ──
// ⚡-chip på Personbil/Paketbil: fungerar som ett läsläge (sticky). När det är
// på loggas varje personbil/paketbil som elbil tills användaren själv slår av
// det igen — nollställs inte automatiskt efter registrering.
const EV_CATS = ['personbil', 'paketbil'];
let evArmed = false;

function toggleEvArmed() {
  evArmed = !evArmed;
  if (navigator.vibrate) navigator.vibrate(8);
  updateEvToggle();
}

function updateEvToggle() {
  document.querySelectorAll('.ev-toggle').forEach(el => el.classList.toggle('armed', evArmed));
  // Ringmarkering på hela Personbil/Paketbil-knappen så det sticky-läget syns tydligt
  EV_CATS.forEach(id => document.getElementById('btn_' + id)?.classList.toggle('ev-on', evArmed));
}

function buildGrid() {
  const grid = document.getElementById('btnGrid');
  CATS.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'v-btn';
    btn.id = 'btn_' + cat.id;
    btn.style.backgroundColor = cat.color;
    btn.innerHTML =
      `<span class="v-btn-emoji">${cat.emoji}</span>` +
      `<span class="v-btn-label">${cat.label}</span>` +
      `<span class="v-btn-label-fi">${cat.labelFi}</span>` +
      `<span class="v-btn-badge" id="b_${cat.id}">0</span>`;
    if (EV_CATS.includes(cat.id)) {
      const chip = document.createElement('span');
      chip.className = 'ev-toggle';
      chip.textContent = '⚡';
      chip.addEventListener('click', e => { e.stopPropagation(); toggleEvArmed(); });
      btn.appendChild(chip);
    }
    btn.addEventListener('click', () => tap(cat.id, btn));

    let pressTimer = null;
    let longFired = false;
    let startX = 0, startY = 0;

    btn.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      longFired = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        longFired = true;
        removeOne(cat.id, btn);
      }, 700);
    }, { passive: true });

    btn.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (!t) return;
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
        clearTimeout(pressTimer);
      }
    }, { passive: true });

    btn.addEventListener('touchend', (e) => {
      clearTimeout(pressTimer);
      if (longFired) e.preventDefault();
    });

    btn.addEventListener('touchcancel', () => {
      clearTimeout(pressTimer);
    });

    grid.appendChild(btn);
  });
}

let audioCtx = null;
function playClick() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  } catch (e) {}
}

// Brygga vid registreringstillfället: närmaste brygga inom 50 m enligt aktuell
// GPS-position, annars null (fordonet räknas i totalen men filtreras inte per plats)
function bryggaAtLogTime() {
  return lastKnownGpsPos
    ? getNearestBrygga(lastKnownGpsPos.lat, lastKnownGpsPos.lng, true)
    : null;
}

function tap(catId, btn) {
  if (navigator.vibrate) navigator.vibrate(12);
  playClick();
  btn.classList.remove('flash', 'flash-remove');
  void btn.offsetWidth;
  btn.classList.add('flash');

  checkDateRollover();
  const ts = Date.now();
  const lastActivity = lastActivityTs();
  if (mode !== 'ferry' && (!lastActivity || (ts - lastActivity) >= TRIP_GAP_MS)) {
    recordDeparture(ts);
    showDepartureBanner();
  }

  const d = load();
  const brygga = bryggaAtLogTime();
  // Elbil bara för personbil/paketbil när ⚡-chipet är armerat;
  // läget nollställs efter varje registrering oavsett kategori
  // Sticky: läget behålls mellan registreringar, nollställs bara manuellt
  const elbil = evArmed && EV_CATS.includes(catId);
  if (db && logsRef) {
    // push() returns the key synchronously → optimistic local write, then sync
    const ref = logsRef.push();
    d.logs.push({ id: ref.key, type: catId, ts, delta: 1, brygga, elbil });
    save(d);
    ref.set({ type: catId, ts, delta: 1, brygga, elbil }).catch(e => showAppError('tap', e?.message ?? String(e)));
  } else {
    d.logs.push({ id: 'local_' + ts + '_' + Math.random().toString(36).slice(2, 7), type: catId, ts, delta: 1, brygga, elbil });
    save(d);
  }
  renderCount();
}

function removeOne(catId, btn) {
  if (counts()[catId] <= 0) return;

  if (navigator.vibrate) navigator.vibrate([15, 50, 15]);
  playClick();
  btn.classList.remove('flash', 'flash-remove');
  void btn.offsetWidth;
  btn.classList.add('flash-remove');

  checkDateRollover();
  const ts = Date.now();
  const d = load();
  const brygga = bryggaAtLogTime();
  // Spegla det borttagna fordonets elbil-flagga så elbilsräkningen minskar rätt
  const elbil = evFlagForRemoval(d.logs, catId);
  if (db && logsRef) {
    const ref = logsRef.push();
    d.logs.push({ id: ref.key, type: catId, ts, delta: -1, brygga, elbil });
    save(d);
    ref.set({ type: catId, ts, delta: -1, brygga, elbil }).catch(e => showAppError('removeOne', e?.message ?? String(e)));
  } else {
    d.logs.push({ id: 'local_' + ts + '_' + Math.random().toString(36).slice(2, 7), type: catId, ts, delta: -1, brygga, elbil });
    save(d);
  }
  renderCount();
}

// ── TRIPS (turer) & CO2 ──
function recordDeparture(ts, lat, lng) {
  reminderFired = false;
  const rb = document.getElementById('reminderBanner');
  if (rb) rb.classList.remove('show');
  // Debug: visa vilka väntande fordon som kopplas till denna avgång
  {
    const d0 = load();
    const tripTsAsc = d0.trips.map(tr => tr.ts).sort((a, b) => a - b);
    const waiting = d0.logs.filter(l => tripTsForLog(l.ts, tripTsAsc) === null);
    const hms = t2 => new Date(t2).toLocaleTimeString('sv-SE');
    console.log('[Koppling] Ny avgång', hms(ts), '—', waiting.length, 'fordon kopplas');
    waiting.forEach(l => {
      console.log('[Koppling]', l.type, '(delta', (l.delta ?? 1) + ')', hms(l.ts),
        '→ avgång', hms(ts), '– diff', Math.round((l.ts - ts) / 1000), 's');
    });
  }
  const date = localDate();
  const data = { ts };
  if (lat !== undefined) {
    data.lat = lat;
    data.lng = lng;
    const brygga = getNearestBrygga(lat, lng);
    if (brygga) data.from = brygga;
  }
  // Skrivs alltid via offline-synk-kön: posten överlever omladdning och
  // flushas idempotent vid appstart, online-event och återfått anslutning
  const key = enqueueDeparture(date, data);
  if (key) {
    lastDepartureFbKey  = key;
    lastDepartureFbDate = date;
  } else {
    // Firebase aldrig initierat — visa avgången lokalt; kön synkar när db finns
    const d = load();
    const local = { id: 'local_' + ts + '_' + Math.random().toString(36).slice(2, 7), ts };
    if (data.from) local.from = data.from;
    d.trips.push(local);
    save(d);
  }
}

let bannerTimer = null;
function showDepartureBanner() {
  const el = document.getElementById('departureBanner');
  if (!el) return;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function tripsToday() {
  return load().trips.length;
}

function fetchDayTrips(dStr) {
  if (!db) {
    if (dStr === localDate()) return Promise.resolve(tripsToday());
    return Promise.resolve(0);
  }
  return db.ref('turer/' + dStr).once('value')
    .then(snap => snap.numChildren())
    .catch(() => 0);
}

function fetchDayLogsRaw(dStr) {
  if (!db) {
    if (dStr === localDate()) return Promise.resolve(load().logs.map(l => ({ type: l.type, ts: l.ts, delta: l.delta, elbil: l.elbil ?? false })));
    return Promise.resolve([]);
  }
  return db.ref('days/' + dStr + '/logs').once('value')
    .then(snap => {
      const arr = [];
      snap.forEach(ch => { const v = ch.val(); arr.push({ type: v.type, ts: v.ts, delta: v.delta || 1, elbil: v.elbil ?? false }); });
      return arr;
    })
    .catch(() => []);
}

function fetchDayTripTs(dStr) {
  if (!db) {
    if (dStr === localDate()) return Promise.resolve(load().trips.map(tr => tr.ts).sort((a, b) => a - b));
    return Promise.resolve([]);
  }
  return db.ref('turer/' + dStr).once('value')
    .then(snap => {
      const arr = [];
      snap.forEach(ch => { const v = ch.val(); if (v.ts) arr.push(v.ts); });
      return arr.sort((a, b) => a - b);
    })
    .catch(() => []);
}

function lastDepartureTs() {
  const trips = load().trips;
  return trips.length ? Math.max(...trips.map(t => t.ts)) : 0;
}

// Most recent vehicle tap OR departure (Kör tom also counts as activity, so it
// doesn't get immediately followed by a duplicate auto-detected departure)
function lastActivityTs() {
  const logs = load().logs;
  const lastLogTs = logs.length ? logs[logs.length - 1].ts : 0;
  return Math.max(lastLogTs, lastDepartureTs());
}

function updateKorTomLock() {
  const btn = document.getElementById('korTomBtn');
  if (!btn) return;
  if (mode === 'ferry') { btn.disabled = false; return; }
  const last = lastDepartureTs();
  btn.disabled = !!last && (Date.now() - last < KORTOM_LOCK_MS);
}

function korTom() {
  recordDeparture(Date.now());
  updateKorTomLock();
  updateUndoDeparture();
}

function deleteDeparture(tripId) {
  const d = load();
  const trip = d.trips.find(t => t.id === tripId);
  if (!trip) return;

  // Find and remove vehicle logs chronologically linked to this departure
  const allTripTsAsc = d.trips.map(tr => tr.ts).sort((a, b) => a - b);
  const linked = d.logs.filter(l => tripTsForLog(l.ts, allTripTsAsc) === trip.ts);
  const netVehicles = linked.reduce((s, l) => s + (l.delta ?? 1), 0);
  console.log('[deleteDeparture] tripId:', tripId, '— kopplade loggar:', linked.length, '(netto', netVehicles, 'fordon)');
  if (db && linked.length > 0) {
    const dateStr = localDate();
    linked.forEach(l => {
      if (l.id && !String(l.id).startsWith('local_')) {
        db.ref('days/' + dateStr + '/logs/' + l.id).remove()
          .then(() => console.log('[deleteDeparture] Borttagen log', l.id, l.type, 'delta:', l.delta))
          .catch(e => showAppError('deleteDeparture', e?.message ?? String(e)));
      }
    });
  }
  d.logs = d.logs.filter(l => tripTsForLog(l.ts, allTripTsAsc) !== trip.ts);

  // Remove the departure itself — även ur synk-kön så en senare flush
  // inte återuppväcker den raderade avgången
  dropPendingForTrip(tripId);
  if (db && tripId && !String(tripId).startsWith('local_')) {
    db.ref('turer/' + localDate() + '/' + tripId).remove()
      .catch(e => showAppError('deleteDeparture', e?.message ?? String(e)));
  }
  d.trips = d.trips.filter(t => t.id !== tripId);
  save(d);

  if (lastDepartureFbKey === tripId) {
    lastDepartureFbKey  = null;
    lastDepartureFbDate = null;
  }
  updateKorTomLock();
  updateUndoDeparture();
  renderCount();
}

function undoLastDeparture() {
  const d = load();
  if (!d.trips.length) return;
  deleteDeparture(d.trips[d.trips.length - 1].id);
}

function updateUndoDeparture() {
  const btn = document.getElementById('undoDepartureBtn');
  if (!btn) return;
  btn.disabled = load().trips.length === 0;
}

function undoLast() {
  checkDateRollover();
  const d = load();
  if (!d.logs.length) return;
  const last = d.logs[d.logs.length - 1];
  if (db && logsRef && last.id && !String(last.id).startsWith('local_')) {
    logsRef.child(last.id).remove().catch(e => showAppError('undoLast', e?.message ?? String(e)));
  }
  d.logs.pop();
  save(d);
  renderCount();
}

function tripCounts() {
  const lastTs = lastDepartureTs();
  if (!lastTs) return null;
  const d = load();
  const c = {};
  CATS.forEach(cat => c[cat.id] = 0);
  d.logs.filter(l => l.ts >= lastTs).forEach(l => {
    if (c[l.type] !== undefined) c[l.type] += (l.delta || 1);
  });
  CATS.forEach(cat => { c[cat.id] = Math.max(0, c[cat.id]); });
  return c;
}

// ── RENDER: COUNT VIEW ──
function renderCount() {
  const c = counts();
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const badges = tripCounts() || c;
  CATS.forEach(cat => {
    const el = document.getElementById('b_' + cat.id);
    if (el) el.textContent = badges[cat.id];
  });
  document.getElementById('footerTotal').textContent = total;
  document.getElementById('undoBtn').disabled = (load().logs.length === 0);
  renderDepartureLog();
}

// ── AVGÅNGSPREDIKTION (förenklad — internt, visas i Statistik) ──
// Visar bara läge: vid kaj (ingen avgångsgissning) eller på väg med aktuell
// fart och fartbaserad ankomsttid. All schemalogik (kvartsgrid, pauser,
// trafikstopp, brådskande korsning) är borttagen.

// Avstånd mellan bryggorna, beräknat en gång från standardkoordinaterna
const PIER_DISTANCE_M = geoDistMeters(
  BRYGGOR_DEFAULT[0].lat, BRYGGOR_DEFAULT[0].lng,
  BRYGGOR_DEFAULT[1].lat, BRYGGOR_DEFAULT[1].lng
);

function predictDeparture() {
  // På väg — destination = motsatt brygga från senaste avgång,
  // överfartstid = bryggavstånd / aktuell hastighet
  if (currentGpsSpeedMs > 0.5) {
    const trips   = load().trips;
    const last    = trips.length ? [...trips].sort((a, b) => b.ts - a.ts)[0] : null;
    const origin  = last?.from ?? null;
    const dest    = origin === 'Pettu' ? 'Utö' : origin === 'Utö' ? 'Pettu' : null;
    const speedKn = currentGpsSpeedMs * 1.94384;
    // För låg fart för rimlig uträkning → ingen ETA, bara riktning
    const eta = (last && speedKn >= 0.5)
      ? new Date(last.ts + (PIER_DISTANCE_M / currentGpsSpeedMs) * 1000)
      : null;
    return { state: 'underway', pier: dest, speedKn, eta };
  }

  // Vid kaj — bara position, ingen avgångsgissning
  const pier = lastKnownGpsPos
    ? getNearestBrygga(lastKnownGpsPos.lat, lastKnownGpsPos.lng, true)
    : null;
  if (pier) return { state: 'atQuay', pier };

  return { state: 'unknown', pier: null };
}

const PRED_AT_KEY = { Pettu: 'predAtPettu', Utö: 'predAtUto' };

function renderPrediction() {
  const el = document.getElementById('predictionCard');
  if (!el) return;
  const p  = predictDeparture();
  const hm = d => d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  let stateStr, etaStr;
  switch (p.state) {
    case 'underway':
      // p.pier kommer från config/bryggor.name (Firebase, ej autentiserad skrivning) — escapa
      stateStr = '⛴ ' + t('predUnderway') + (p.pier ? ' → ' + escapeHtml(p.pier) : '');
      etaStr   = p.speedKn.toFixed(1) + ' kn';
      if (p.eta) etaStr += ` · ${t('predArrival')} ${t('predCirca')} ${hm(p.eta)}`;
      break;
    case 'atQuay':
      stateStr = '⚓ ' + t(PRED_AT_KEY[p.pier] ?? 'predUnknown');
      etaStr   = '';
      break;
    default:
      stateStr = '❔ ' + t('predUnknown');
      etaStr   = '';
  }
  el.innerHTML =
    `<div class="co2-card">` +
      `<div class="sec-title" style="margin:0 0 8px">${t('predTitle')}</div>` +
      `<div class="peak-val">${stateStr}</div>` +
      (etaStr ? `<div class="peak-lbl" style="margin-top:4px">${etaStr}</div>` : '') +
    `</div>`;
}

// ── RENDER: STATUS VIEW (driftläge — internt, ingen koppling till GPS/prediktion) ──
const DRIFTSTATUS_CATS = [
  { id: 'normal',     labelKey: 'statusNormal',     emoji: '✅' },
  { id: 'service',    labelKey: 'statusService',    emoji: '🔧' },
  { id: 'tankning',   labelKey: 'statusTankning',   emoji: '⛽' },
  { id: 'utryckning', labelKey: 'statusUtryckning', emoji: '🚨' },
  { id: 'annat',      labelKey: 'statusAnnat',      emoji: '✏️' },
];

function buildDriftstatusButtons() {
  const grid = document.getElementById('statusBtnGrid');
  if (!grid) return;
  grid.innerHTML = '';
  DRIFTSTATUS_CATS.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'status-btn';
    btn.id = 'statusBtn_' + cat.id;
    btn.innerHTML = `<span class="status-btn-emoji">${cat.emoji}</span><span>${t(cat.labelKey)}</span>`;
    btn.addEventListener('click', () => {
      const wrap = document.getElementById('statusOtherWrap');
      if (cat.id === 'annat') {
        wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
        if (wrap.style.display !== 'none') document.getElementById('statusOtherText').focus();
        return;
      }
      wrap.style.display = 'none';
      submitDriftstatus(cat.id, '');
    });
    grid.appendChild(btn);
  });
}

function submitOtherDriftstatus() {
  const el = document.getElementById('statusOtherText');
  const text = (el?.value ?? '').trim();
  if (!text) { el?.focus(); return; }
  submitDriftstatus('annat', text);
  el.value = '';
  document.getElementById('statusOtherWrap').style.display = 'none';
}

function driftstatusLabel(status) {
  const cat = DRIFTSTATUS_CATS.find(c => c.id === status);
  return cat ? `${cat.emoji} ${t(cat.labelKey)}` : t('statusNormal');
}

function renderCurrentDriftstatus() {
  const el = document.getElementById('statusCurrentCard');
  if (!el) return;
  const cur = currentDriftstatus;
  const hm = ts => new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  if (!cur || !cur.status || cur.status === 'normal') {
    el.innerHTML = `<div class="peak-val">${driftstatusLabel('normal')}</div>`;
    return;
  }
  const sinceStr = cur.timestamp ? ` ${t('statusSince')} ${hm(cur.timestamp)}` : '';
  // beskrivning är fritext skriven till Firebase utan autentisering — stored XSS om oescapad
  const descStr = cur.beskrivning ? `<div class="peak-lbl" style="margin-top:4px">${escapeHtml(cur.beskrivning)}</div>` : '';
  el.innerHTML =
    `<div class="peak-val">${driftstatusLabel(cur.status)}${sinceStr}</div>` + descStr;
}

function renderDriftstatusHistory() {
  const el = document.getElementById('statusHistoryList');
  if (!el) return;
  el.innerHTML = `<div class="empty">${t('hamtar')}</div>`;
  fetchDriftstatusHistory().then(entries => {
    if (currentView !== 'Driftstatus') return;
    if (!entries.length) { el.innerHTML = `<div class="empty">${t('statusEmpty')}</div>`; return; }
    const hm = ts => new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = entries.map(e =>
      `<div class="status-hist-row">` +
        `<span class="status-hist-time">${hm(e.timestamp)}</span>` +
        `<span class="status-hist-label">${driftstatusLabel(e.status)}</span>` +
        (e.beskrivning ? `<span class="status-hist-desc">${escapeHtml(e.beskrivning)}</span>` : '') +
      `</div>`
    ).join('');
  });
}

// Synligt felmeddelande i UI:t — utan detta var en misslyckad skrivning
// (t.ex. nekad av databasreglerna) helt tyst för användaren; felet syntes
// bara i console.log/debug-panelen, som ingen normalt har öppen
function showDriftstatusError(detail) {
  const el = document.getElementById('statusErrorBanner');
  if (!el) return;
  el.textContent = t('statusSaveError') + (detail ? ` (${detail})` : '');
  el.style.display = '';
}

function hideDriftstatusError() {
  const el = document.getElementById('statusErrorBanner');
  if (el) el.style.display = 'none';
}

// Global variant av samma mönster, synlig oavsett aktiv flik — tidigare
// svalde tap()/removeOne()/undoLast()/deleteDeparture()/adjustTripVehicle()/
// doReset() alla Firebase-fel tyst (.catch(() => {})), så en misslyckad
// synk (t.ex. nekad av databasreglerna) var osynlig för användaren
let appErrorTimer = null;
function showAppError(context, detail) {
  console.error('[' + context + ']', detail);
  const el = document.getElementById('appErrorBanner');
  if (!el) return;
  el.textContent = t('appSyncError') + (detail ? ` (${detail})` : '');
  el.style.display = '';
  clearTimeout(appErrorTimer);
  appErrorTimer = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

function renderDriftstatusView() {
  hideDriftstatusError();
  buildDriftstatusButtons();
  renderCurrentDriftstatus();
  renderDriftstatusHistory();
}

// ── RENDER: STATS VIEW ──
function renderStats() {
  renderPrediction();
  const c = counts();
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const h = hourlyData();
  const hrs = Object.keys(h).map(Number);

  // ── Summary cards ──
  document.getElementById('sumTotal').textContent = total;
  const evRow = document.getElementById('sumEvRow');
  if (evRow) evRow.innerHTML = evStatsLine(load().logs);
  if (hrs.length) {
    const peak = hrs.reduce((best, hr) => hourTotal(h[hr]) > hourTotal(h[best]) ? hr : best, hrs[0]);
    const pn = hourTotal(h[peak]);
    document.getElementById('peakHour').textContent =
      `${pad(peak)}:00 – ${pad(peak + 1 < 24 ? peak + 1 : 0)}:00`;
    document.getElementById('peakCount').textContent = `${pn} ${t('fordonEnhet')}`;
    document.getElementById('sumAvg').innerHTML =
      `${t('snitt')}: <strong>${Math.round(total / hrs.length)}</strong> ${t('snittTim')}`;
  } else {
    document.getElementById('peakHour').textContent = '—';
    document.getElementById('peakCount').textContent = '—';
    document.getElementById('sumAvg').textContent = `${t('snitt')}: — ${t('snittTim')}`;
  }
  const trips = tripsToday();
  const co2 = trips * CO2_PER_TRIP;
  document.getElementById('sumTripCount').textContent = trips;
  document.getElementById('sumCO2').textContent = co2.toFixed(1) + ' kg';
  document.getElementById('sumCO2Compare').innerHTML = co2CompareHtml(co2);
  const d = load();
  const deptStats = calcDepartureStats(
    d.logs.map(l => ({ type: l.type, ts: l.ts, delta: l.delta })),
    d.trips.map(tr => tr.ts).sort((a, b) => a - b)
  );
  document.getElementById('sumDeptStatsIdag').innerHTML = deptStatsCardHtml(deptStats, null);

  // ── Per category (with bars) ──
  const maxCat = Math.max(...Object.values(c), 1);
  const cl = document.getElementById('statsCatList');
  cl.innerHTML = '';
  CATS.forEach(cat => {
    const n = c[cat.id];
    const bw = Math.round(n / maxCat * 100);
    cl.innerHTML +=
      `<div class="cat-row">` +
        `<span class="cat-emoji">${cat.emoji}</span>` +
        `<span class="cat-name">${catName(cat)}</span>` +
        `<div class="cat-bar-bg"><div class="cat-bar" style="width:${bw}%;background:${cat.color}"></div></div>` +
        `<span class="cat-count">${n}</span>` +
      `</div>`;
  });

  // ── Per hour chart ──
  const hl = document.getElementById('statsHourList');
  hrs.sort((a, b) => a - b);

  if (!hrs.length) {
    hl.innerHTML = `<div class="empty">${t('ingaFordon')}</div>`;
    return;
  }

  // Hour range: data hours padded by one hour before/after, clamped to 0–23
  const minH = Math.max(0, hrs[0] - 1);
  const maxH = Math.min(23, hrs[hrs.length - 1] + 1);
  const range = [];
  for (let hr = minH; hr <= maxH; hr++) range.push(hr);

  const values = range.map(hr => h[hr] ? hourTotal(h[hr]) : 0);
  const maxV = Math.max(...values, 1);
  const totalData = hrs.reduce((sum, hr) => sum + hourTotal(h[hr]), 0);
  const avg = totalData / hrs.length;

  const W = 320, H = 200;
  const padL = 28, padR = 10, padT = 14, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;

  const stepX = plotW / (range.length - 1);
  const xs = range.map((_, i) => padL + i * stepX);
  const ys = values.map(v => padT + plotH - (v / maxV) * plotH);
  const yAvg = padT + plotH - (avg / maxV) * plotH;

  const linePath = smoothPath(xs, ys);
  const fillPath = `${linePath} L${xs[xs.length-1].toFixed(1)},${baseY} L${xs[0].toFixed(1)},${baseY} Z`;

  let xLabels = '';
  let points = '';
  range.forEach((hr, i) => {
    const n = values[i];
    const x = xs[i].toFixed(1), y = ys[i].toFixed(1);
    const tip = `${pad(hr)}:00 — ${n} ${t('fordonEnhet')}`;
    xLabels += `<text x="${x}" y="${H - 6}" text-anchor="middle" style="font-size:9px; fill:var(--muted);">${hr}</text>`;
    points +=
      `<circle cx="${x}" cy="${y}" r="13" fill="transparent" style="cursor:pointer;" onclick="showHourTip(${x},${y},'${tip}')" onmouseenter="showHourTip(${x},${y},'${tip}')"></circle>` +
      `<circle cx="${x}" cy="${y}" r="3.5" style="fill:#3B82F6; stroke:var(--surface); stroke-width:1.5; pointer-events:none;"></circle>`;
  });

  hl.innerHTML =
    `<svg class="hour-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
      `<defs>` +
        `<linearGradient id="hourFillGrad" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0%" stop-color="#3B82F6" stop-opacity="0.4"></stop>` +
          `<stop offset="100%" stop-color="#3B82F6" stop-opacity="0"></stop>` +
        `</linearGradient>` +
      `</defs>` +
      `<line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" style="stroke:var(--border); stroke-width:1;"></line>` +
      `<line x1="${padL}" y1="${yAvg.toFixed(1)}" x2="${W - padR}" y2="${yAvg.toFixed(1)}" style="stroke:var(--muted); stroke-width:1; stroke-dasharray:4 3;"></line>` +
      `<path d="${fillPath}" fill="url(#hourFillGrad)"></path>` +
      `<path d="${linePath}" fill="none" style="stroke:#3B82F6; stroke-width:2.5;"></path>` +
      points +
      `<text x="${padL - 5}" y="${baseY + 3}" text-anchor="end" style="font-size:9px; fill:var(--muted);">0</text>` +
      `<text x="${padL - 5}" y="${padT + 7}" text-anchor="end" style="font-size:9px; fill:var(--muted);">${maxV}</text>` +
      xLabels +
      `<g id="hourTip" style="opacity:0; transition:opacity .15s; pointer-events:none;">` +
        `<rect id="hourTipRect" rx="4" ry="4" style="fill:var(--surface2); stroke:var(--border);"></rect>` +
        `<text id="hourTipText" text-anchor="middle" style="font-size:11px; font-weight:700; fill:var(--text);"></text>` +
      `</g>` +
    `</svg>` +
    `<div class="hour-chart-avg">${t('snitt')}: <strong>${Math.round(avg)}</strong> ${t('snittTim')}</div>`;
}

// ── RENDER: SUMMARY HISTORY (Vecka / Månad) ──
function dateStrFromParts(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

function last7Days() {
  const dates = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dates.push(dateStrFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  }
  return dates;
}

function currentMonthDays() {
  const now = new Date();
  const dates = [];
  for (let day = 1; day <= now.getDate(); day++) {
    dates.push(dateStrFromParts(now.getFullYear(), now.getMonth() + 1, day));
  }
  return dates;
}

function fmtDayLabel(dStr) {
  const [y, m, d] = dStr.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString(t('locale'), { weekday: 'short', day: 'numeric', month: 'short' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Resolve a single day's total: live Firebase count, or local cache for today when offline
function fetchDayTotal(dStr) {
  if (!db) {
    if (dStr === localDate()) return Promise.resolve(Object.values(counts()).reduce((a, b) => a + b, 0));
    return Promise.resolve(0);
  }
  return db.ref('days/' + dStr + '/logs').once('value')
    .then(snap => {
      const c = {};
      snap.forEach(ch => {
        const v = ch.val();
        c[v.type] = (c[v.type] || 0) + (v.delta || 1);
      });
      return Object.values(c).reduce((sum, n) => sum + Math.max(0, n), 0);
    })
    .catch(() => 0);
}

function dayListHtml(dates, totals, trips) {
  let rows = '';
  dates.forEach((dStr, i) => {
    const co2 = trips[i] * CO2_PER_TRIP;
    rows +=
      `<div class="day-row">` +
        `<span class="day-date">${fmtDayLabel(dStr)}</span>` +
        `<span class="day-count">${totals[i]}</span>` +
        `<span class="day-co2">${co2.toFixed(1)} kg</span>` +
      `</div>`;
  });
  return `<div class="day-list">${rows}</div>`;
}

function calcDepartureStats(logs, tripTs) {
  if (!tripTs.length) return null;
  const sorted = [...tripTs].sort((a, b) => a - b);
  const buckets = new Array(sorted.length).fill(0);
  logs.forEach(l => {
    if ((l.delta || 1) <= 0) return;
    // Kronologisk koppling: första avgången vars ts + fönster >= loggen
    const ts = tripTsForLog(l.ts, sorted);
    if (ts !== null) buckets[sorted.indexOf(ts)] += 1;
  });
  const tripCount = sorted.length;
  const totalVeh = buckets.reduce((a, b) => a + b, 0);
  const maxVehicles = Math.max(...buckets);
  const emptyTrips = buckets.filter(b => b === 0).length;
  const avgVehicles = tripCount > 0 ? totalVeh / tripCount : null;
  let tripsPerHour = null;
  if (tripCount >= 2) {
    const spanH = (sorted[sorted.length - 1] - sorted[0]) / 3600000;
    if (spanH >= 0.5) tripsPerHour = tripCount / spanH;
  }
  return { avgVehicles, maxVehicles, emptyTrips, tripsPerHour, tripCount, totalVeh };
}

function deptStatsCardHtml(stats, dayCount) {
  if (!stats || !stats.tripCount) return '';
  const title = t('avgStatsTitle');
  const fmt = v => (v !== null && v !== undefined) ? v.toFixed(1) : '—';
  const fmtI = v => (v !== null && v !== undefined) ? String(v) : '—';
  if (dayCount == null) {
    return `<div class="co2-card">` +
      `<div class="sec-title" style="margin:0 0 10px">${title}</div>` +
      `<div class="co2-row">` +
        `<div><div class="peak-lbl">${t('avgSnitt')}</div><div class="peak-val">${fmt(stats.avgVehicles)}</div></div>` +
        `<div class="peak-right"><div class="peak-lbl">${t('avgMax')}</div><div class="peak-val">${fmtI(stats.maxVehicles)}</div></div>` +
      `</div>` +
      `<div class="co2-row" style="margin-top:10px">` +
        `<div><div class="peak-lbl">${t('avgTomma')}</div><div class="peak-val">${fmtI(stats.emptyTrips)}</div></div>` +
        `<div class="peak-right"><div class="peak-lbl">${t('avgPerTimme')}</div><div class="peak-val">${fmt(stats.tripsPerHour)}</div></div>` +
      `</div>` +
    `</div>`;
  } else {
    const avgPerDay = stats.tripCount / dayCount;
    return `<div class="co2-card">` +
      `<div class="sec-title" style="margin:0 0 10px">${title}</div>` +
      `<div class="co2-row">` +
        `<div><div class="peak-lbl">${t('avgSnittPerDag')}</div><div class="peak-val">${fmt(avgPerDay)}</div></div>` +
        `<div><div class="peak-lbl">${t('avgSnitt')}</div><div class="peak-val">${fmt(stats.avgVehicles)}</div></div>` +
        `<div class="peak-right"><div class="peak-lbl">${t('avgTommaTotal')}</div><div class="peak-val">${fmtI(stats.emptyTrips)}</div></div>` +
      `</div>` +
    `</div>`;
  }
}

function renderWeek() {
  const container = document.getElementById('sumVeckaContent');
  container.innerHTML = `<div class="empty">${t('hamtar')}</div>`;
  const dates = last7Days();
  Promise.all([
    Promise.all(dates.map(fetchDayTotal)),
    Promise.all(dates.map(fetchDayTrips)),
    Promise.all(dates.map(fetchDayLogsRaw)),
    Promise.all(dates.map(fetchDayTripTs))
  ]).then(([totals, trips, allLogs, allTripTs]) => {
    if (summaryTab !== 'Vecka') return;
    const total = totals.reduce((a, b) => a + b, 0);
    const co2 = trips.reduce((a, b) => a + b, 0) * CO2_PER_TRIP;
    const deptStats = calcDepartureStats(allLogs.flat(), allTripTs.flat());
    container.innerHTML =
      `<div class="total-card">` +
        `<div class="total-big">${total}</div>` +
        `<div class="total-sub">${t('weekSub')}</div>` +
        `<div class="total-avg">${evStatsLine(allLogs.flat())}</div>` +
        `<div class="total-avg">CO2: <strong>${co2.toFixed(1)} kg</strong></div>` +
        co2CompareHtml(co2) +
      `</div>` +
      deptStatsCardHtml(deptStats, dates.length) +
      dayListHtml(dates, totals, trips) +
      `<div class="period-avg">${t('snittCO2')}: <strong>${(co2 / dates.length).toFixed(1)}</strong> ${t('kgDag')}</div>`;
  });
}

function renderMonth() {
  const container = document.getElementById('sumManadContent');
  container.innerHTML = `<div class="empty">${t('hamtar')}</div>`;
  const dates = currentMonthDays();
  Promise.all([
    Promise.all(dates.map(fetchDayTotal)),
    Promise.all(dates.map(fetchDayTrips)),
    Promise.all(dates.map(fetchDayLogsRaw)),
    Promise.all(dates.map(fetchDayTripTs))
  ]).then(([totals, trips, allLogs, allTripTs]) => {
    if (summaryTab !== 'Manad') return;
    const total = totals.reduce((a, b) => a + b, 0);
    const avg = total / dates.length;
    const co2 = trips.reduce((a, b) => a + b, 0) * CO2_PER_TRIP;
    const monthName = new Date().toLocaleDateString(t('locale'), { month: 'long' });
    const monthSub = lang === 'fi' ? `ajoneuvoa tässä kuussa (${monthName})` : `fordon i ${monthName}`;
    const deptStats = calcDepartureStats(allLogs.flat(), allTripTs.flat());
    container.innerHTML =
      `<div class="total-card">` +
        `<div class="total-big">${total}</div>` +
        `<div class="total-sub">${monthSub}</div>` +
        `<div class="total-avg">${t('snitt')}: <strong>${Math.round(avg)}</strong> ${t('snittDag')}</div>` +
        `<div class="total-avg">${evStatsLine(allLogs.flat())}</div>` +
        `<div class="total-avg">CO2: <strong>${co2.toFixed(1)} kg</strong></div>` +
        co2CompareHtml(co2) +
      `</div>` +
      deptStatsCardHtml(deptStats, dates.length) +
      dayListHtml(dates, totals, trips) +
      `<div class="period-avg">${t('snittCO2')}: <strong>${(co2 / dates.length).toFixed(1)}</strong> ${t('kgDag')}</div>`;
  });
}

// ── VIEW SWITCHING ──
const VIEWS = ['Count', 'Stats', 'Weather', 'Driftstatus'];
let currentView = 'Count';
function goView(name) {
  currentView = name;
  VIEWS.forEach(v => {
    document.getElementById('v' + v).classList.toggle('active', v === name);
    document.getElementById('nav' + v).classList.toggle('active', v === name);
  });
  if (name === 'Stats')       goSummaryTab(summaryTab);
  if (name === 'Weather')     renderWeather();
  if (name === 'Driftstatus') renderDriftstatusView();
}

const SUMMARY_TABS = ['Idag', 'Vecka', 'Manad'];
let summaryTab = 'Idag';
function goSummaryTab(name) {
  summaryTab = name;
  SUMMARY_TABS.forEach(t => {
    document.getElementById('sumTab' + t).classList.toggle('active', t === name);
    document.getElementById('sumPanel' + t).classList.toggle('active', t === name);
  });
  if (name === 'Idag')  renderStats();
  if (name === 'Vecka') renderWeek();
  if (name === 'Manad') renderMonth();
}

// Re-render whatever is on screen (used by the live Firebase listener)
function refreshAll() {
  renderCount();
  if (currentView === 'Stats' && summaryTab === 'Idag') renderStats();
}

// ── RESET ──
function confirmReset() { document.getElementById('resetModal').classList.add('show'); }
function hideReset()    { document.getElementById('resetModal').classList.remove('show'); }
function doReset() {
  if (db) {
    db.ref('days/' + localDate()).remove().catch(e => showAppError('doReset', e?.message ?? String(e)));
    db.ref('turer/' + localDate()).remove().catch(e => showAppError('doReset', e?.message ?? String(e)));
  }
  save({ date: localDate(), logs: [], trips: [] });
  hideReset();
  renderCount();
  updateKorTomLock();
  goView('Count');
}

// ── CLOCK ──
function tick() {
  const n = new Date();
  document.getElementById('hdrTime').textContent =
    n.toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' });
  document.getElementById('hdrDate').textContent =
    n.toLocaleDateString(t('locale'), { weekday: 'long', day: 'numeric', month: 'long' });
  updateKorTomLock();
  checkDepartureReminder();
  checkBreakReminders();
  if (currentView === 'Stats' && summaryTab === 'Idag') renderPrediction();
}

// Expanderad avgångsrad (per kategori-redigering); null = ingen expanderad
let expandedTripId = null;

function toggleDepRow(tripId) {
  expandedTripId = expandedTripId === tripId ? null : tripId;
  renderDepartureLog();
}

// Tidsstämpel som garanterat kopplas kronologiskt till just denna avgång:
// normalt avgångens egen ts, men om föregående avgångs efterslängsfönster
// når över den (täta avgångar) flyttas stämpeln precis förbi fönstret.
function correctionTsForTrip(trip, tripTsAsc) {
  const prev = tripTsAsc.filter(ts => ts < trip.ts).pop();
  return prev != null
    ? Math.max(trip.ts, prev + TRIP_VEHICLE_WINDOW_MS + 1)
    : trip.ts;
}

// Korrigering av historisk avgång: skriver en vanlig fordonslogg (delta ±1)
// med ts inne i avgångens fönster — totaler/statistik/CO2 räknas om automatiskt
// eftersom allt redan summeras från logs/.
function adjustTripVehicle(tripId, catId, delta) {
  const d = load();
  const trip = d.trips.find(tr => tr.id === tripId);
  if (!trip) return;
  const tripTsAsc = d.trips.map(tr => tr.ts).sort((a, b) => a - b);
  if (delta < 0) {
    const cur = d.logs
      .filter(l => tripTsForLog(l.ts, tripTsAsc) === trip.ts && l.type === catId)
      .reduce((s, l) => s + (l.delta ?? 1), 0);
    if (cur <= 0) return;
  }
  playClick();
  const ts = correctionTsForTrip(trip, tripTsAsc);
  const brygga = trip.from ?? null; // avgångens brygga, inte nuvarande GPS-position
  // Vid −1: spegla flaggan från det senast tillagda fordonet i denna avgång
  const tripLogs = d.logs.filter(l => tripTsForLog(l.ts, tripTsAsc) === trip.ts);
  const elbil = delta < 0 ? evFlagForRemoval(tripLogs, catId) : false;
  console.log('[Korrigering]', catId, delta > 0 ? '+1' : '−1', 'på avgång',
    new Date(trip.ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }));
  if (db && logsRef) {
    const ref = logsRef.push();
    d.logs.push({ id: ref.key, type: catId, ts, delta, brygga, elbil });
    save(d);
    ref.set({ type: catId, ts, delta, brygga, elbil }).catch(e => showAppError('adjustTripVehicle', e?.message ?? String(e)));
  } else {
    d.logs.push({ id: 'local_' + ts + '_' + Math.random().toString(36).slice(2, 7), type: catId, ts, delta, brygga, elbil });
    save(d);
  }
  renderCount();
}

function renderDepartureLog() {
  const el = document.getElementById('departureLog');
  if (!el) return;
  if (mode !== 'ferry') { el.style.display = 'none'; return; }
  const d = load();
  const trips = [...d.trips].sort((a, b) => b.ts - a.ts).slice(0, 10);
  if (!trips.length) { el.style.display = 'none'; return; }

  const allTripTsAsc = d.trips.map(tr => tr.ts).sort((a, b) => a - b);
  const rows = trips.map(trip => {
    const hm = new Date(trip.ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    const DEP_FROM_KEY = { Pettu: 'depFromPettu', Utö: 'depFromUto' };
    const dirStr = (trip.from && DEP_FROM_KEY[trip.from]) ? t(DEP_FROM_KEY[trip.from]) : '';
    const tripLogs = d.logs.filter(l => tripTsForLog(l.ts, allTripTsAsc) === trip.ts);
    const veh = Math.max(0, tripLogs.reduce((sum, l) => sum + (l.delta ?? 1), 0));
    const vehStr = veh === 0
      ? `0 <span class="dep-empty">(${t('depTom')})</span>`
      : `${veh}`;
    // trip.id är en Firebase-nyckel — auto-ID:n från appens egen push() är
    // säkra, men databasreglerna hindrar inte en direkt .set() på en
    // godtycklig nyckel (citationstecken tillåtna i RTDB-nycklar), så
    // attribut-utbrytning i onclick="..." är möjlig utan escaping
    const tripIdSafe = escapeHtml(trip.id);
    const row = `<div class="dep-row" onclick="toggleDepRow('${tripIdSafe}')"><span class="dep-time">${hm}</span><span class="dep-dir">${dirStr}</span><span class="dep-count">${vehStr} ${t('depFordon')}</span><button class="dep-undo" onclick="event.stopPropagation(); deleteDeparture('${tripIdSafe}')" title="${t('undoAvgang')}">✕</button></div>`;
    if (trip.id !== expandedTripId) return row;

    const detail = CATS.map(cat => {
      const n = Math.max(0, tripLogs
        .filter(l => l.type === cat.id)
        .reduce((s, l) => s + (l.delta ?? 1), 0));
      return `<div class="dep-cat-row">` +
        `<span class="dep-cat-emoji">${cat.emoji}</span>` +
        `<span class="dep-cat-name">${catName(cat)}</span>` +
        `<span class="dep-cat-count">${n}</span>` +
        `<button class="dep-adj-btn" onclick="event.stopPropagation(); adjustTripVehicle('${tripIdSafe}','${cat.id}',-1)"${n === 0 ? ' disabled' : ''}>−</button>` +
        `<button class="dep-adj-btn" onclick="event.stopPropagation(); adjustTripVehicle('${tripIdSafe}','${cat.id}',1)">+</button>` +
        `</div>`;
    }).join('');
    return row + `<div class="dep-detail">${detail}</div>`;
  }).join('');

  el.innerHTML = rows;
  el.style.display = '';
}
buildGrid();
applyLang();
renderCount();
tick();
setInterval(tick, 10000);
initFirebase();
document.getElementById('versionText').textContent = '· v' + APP_VERSION;
(function() {
  let tapCount = 0, tapTimer = null;
  document.getElementById('versionText').addEventListener('click', () => {
    tapCount++;
    clearTimeout(tapTimer);
    if (tapCount >= 5) { tapCount = 0; showDebugPanel(); return; }
    tapTimer = setTimeout(() => { tapCount = 0; }, 1500);
  });
})();
updateCountdown();
setInterval(updateCountdown, 1000);
setInterval(() => { weatherLastFetch = 0; if (currentView === 'Weather') loadWeather(); }, 30 * 60 * 1000);
