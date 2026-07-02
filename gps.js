const GPS_SPEED_THRESHOLD  = 1.0;   // m/s – minsta fart för att GPS ska registrera avgång
const GPS_WARMUP_MS        = 30000;         // ms – GPS lyssnar men registrerar inga avgångar under uppvärmning
const GPS_DEPARTURE_GAP_MS    = 5 * 60 * 1000; // ms – minsta tid mellan två GPS-detekterade avgångar
const DEPARTURE_REMINDER_MS   = 22 * 60 * 1000; // ms – påminnelse om ingen ny avgång efter 22 min
const BREAK_TIMES               = ['08:30', '11:00', '16:30', '19:00'];
const BREAK_REMINDER_OFFSETS_MIN = [15, 10, 5];
function updateGpsAccuracy(accuracy, speed) {
  const wrapper = document.getElementById('gpsAccuracy');
  const dot     = document.getElementById('gpsDot');
  const txt     = document.getElementById('gpsText');
  if (!wrapper) return;
  wrapper.style.display = 'flex';
  txt.textContent = Math.round(accuracy) + 'm';
  dot.className = 'gps-dot ' + (accuracy < 10 ? 'good' : accuracy <= 30 ? 'ok' : 'poor');
  updateHdrSpeed(speed);
}

function updateHdrSpeed(speedMs) {
  const kn = (speedMs || 0) * 1.94384;
  const color = kn < 0.05 ? 'var(--muted)'
    : kn < 1.0  ? 'var(--text)'
    : kn <= 3.0 ? '#10B981'
    : '#F59E0B';
  const needle = document.getElementById('speedNeedle');
  if (needle) {
    const angle = (Math.min(kn, 6) / 6 * 180).toFixed(1);
    needle.setAttribute('transform', `rotate(${angle},36,32)`);
    needle.setAttribute('stroke', color);
  }
  const pivot = document.getElementById('speedPivot');
  if (pivot) pivot.setAttribute('fill', color);
  const val = document.getElementById('speedVal');
  if (val) { val.textContent = kn.toFixed(1) + ' kn'; val.setAttribute('fill', color); }
}

function hideGpsAccuracy() {
  const wrapper = document.getElementById('gpsAccuracy');
  if (wrapper) wrapper.style.display = 'none';
}
// ── GPS DEPARTURE WATCH ──
let geoWatchId = null;
let gpsWarmupUntil = 0;
let lastGpsDepartureTs = 0;
let tripSpeedSamples    = [];
let lastDepartureFbKey  = null;
let lastDepartureFbDate = null;
let lastKnownGpsPos     = null;
let currentGpsSpeedMs   = 0;
let reminderFired       = false;
let firedReminders      = new Set();

function playPing() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 520;
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (e) {}
}

let reminderHideTimer = null;
function showReminderBanner(msg) {
  const el = document.getElementById('reminderBanner');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(reminderHideTimer);
  reminderHideTimer = setTimeout(() => el.classList.remove('show'), 30000);
}

function checkDepartureReminder() {
  if (mode !== 'ferry') return;
  if (currentGpsSpeedMs > 0.5) return;
  if (reminderFired) return;
  const d = load();
  if (!d.trips.length) return;
  const last = [...d.trips].sort((a, b) => b.ts - a.ts)[0];
  if (!last.from) return;
  if (Date.now() - last.ts < DEPARTURE_REMINDER_MS) return;
  reminderFired = true;
  playPing();
  showReminderBanner('Kolla ' + last.from + ' 👀');
  console.log('[Påminnelse] 22 min sedan avgång från', last.from);
}

function checkBreakReminders() {
  if (mode !== 'ferry') return;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const breakTime of BREAK_TIMES) {
    const [bh, bm] = breakTime.split(':').map(Number);
    const breakMin = bh * 60 + bm;
    for (const offset of BREAK_REMINDER_OFFSETS_MIN) {
      const key = breakTime + '_' + offset;
      if (firedReminders.has(key)) continue;
      if (nowMin !== breakMin - offset) continue;
      firedReminders.add(key);
      playPing();
      let atPettu = false;
      if (lastKnownGpsPos) {
        atPettu = getNearestBrygga(lastKnownGpsPos.lat, lastKnownGpsPos.lng) === 'Pettu';
      }
      const msg = atPettu
        ? '✓ På Pettu inför paus ' + breakTime
        : 'Var på Pettu om ' + offset + ' min — paus ' + breakTime;
      showReminderBanner(msg);
      console.log('[Paus] Påminnelse ' + key + (atPettu ? ' (på Pettu)' : ''));
    }
  }
}

function startGpsWatch() {
  if (!navigator.geolocation || geoWatchId !== null) return;
  gpsWarmupUntil = Date.now() + GPS_WARMUP_MS;
  console.log('[GPS] Färjeläge aktiverat – uppvärmning 30s');
  const ml = document.getElementById('modeLabel');
  if (ml) ml.textContent = '🛳️ Stabiliserar…';
  setTimeout(() => {
    if (mode === 'ferry') {
      if (ml) ml.textContent = t('ferryMode');
      console.log('[GPS] GPS-detektering aktiv');
    }
  }, GPS_WARMUP_MS);
  geoWatchId = navigator.geolocation.watchPosition(
    pos => {
      lastKnownGpsPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const speed = pos.coords.speed;
      currentGpsSpeedMs = speed ?? 0;
      updateGpsAccuracy(pos.coords.accuracy, speed);
      // Collect every positive sample continuously — before warmup guard and null guard
      if (speed != null && speed > 0) {
        tripSpeedSamples.push(speed);
        console.log('[GPS] Speed sample:', speed.toFixed(2), 'm/s –', tripSpeedSamples.length, 'samplar totalt');
      }
      // Departure detection only after warmup and with valid speed
      if (speed == null || Date.now() < gpsWarmupUntil) return;
      const now = Date.now();
      if (speed >= GPS_SPEED_THRESHOLD && (now - lastGpsDepartureTs >= GPS_DEPARTURE_GAP_MS)) {
        if (!isWithinOperatingArea(pos.coords.latitude, pos.coords.longitude)) {
          console.log('[GPS] Utanför driftsområde — avgång ej registrerad');
        } else {
          lastGpsDepartureTs = now;
          finalizeCurrentTripSpeed();
          tripSpeedSamples = [];
          console.log('[GPS] Avgång detekterad, fart =', speed.toFixed(2), 'm/s');
          recordDeparture(now, pos.coords.latitude, pos.coords.longitude);
          showDepartureBanner();
          renderCount();
        }
      }
    },
    err => console.warn('[GPS] Fel:', err.message),
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 }
  );
}

function finalizeCurrentTripSpeed() {
  if (!db || !lastDepartureFbKey || !tripSpeedSamples.length) return;
  const avg = tripSpeedSamples.reduce((a, b) => a + b, 0) / tripSpeedSamples.length;
  const avgKn = parseFloat((avg * 1.94384).toFixed(1));
  console.log('[GPS] Sparar avgSpeedKnots:', avgKn, 'kn till tur', lastDepartureFbKey, '(', tripSpeedSamples.length, 'samplar)');
  db.ref('turer/' + lastDepartureFbDate + '/' + lastDepartureFbKey)
    .update({ avgSpeedKnots: avgKn })
    .catch(e => console.error('[GPS] avgSpeedKnots fel:', e));
}

function stopGpsWatch() {
  if (geoWatchId !== null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
    gpsWarmupUntil = 0;
    lastGpsDepartureTs = 0;
    currentGpsSpeedMs  = 0;
    finalizeCurrentTripSpeed();
    tripSpeedSamples  = [];
    lastDepartureFbKey  = null;
    lastDepartureFbDate = null;
    console.log('[GPS] Testläge aktiverat');
  }
  hideGpsAccuracy();
  updateHdrSpeed(0);
}
