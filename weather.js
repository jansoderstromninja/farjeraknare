const WEATHER_FALLBACK_LAT = 60.3333;
const WEATHER_FALLBACK_LON = 24.3333;
function buildFmiWaterUrl() {
  const now = new Date();
  const end   = now.toISOString().slice(0, 19) + 'Z';
  const start = new Date(now - 2 * 3600 * 1000).toISOString().slice(0, 19) + 'Z';
  return 'https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature' +
    '&storedquery_id=fmi::observations::mareograph::instant::simple' +
    '&fmisid=134253' +
    '&starttime=' + start + '&endtime=' + end;
}
// ── WEATHER ──
let weatherData = null;
let weatherLastFetch = 0;
let lastThunderInfo = null;

function thunderInfo(fromIdx) {
  const cape  = weatherData && weatherData.hourly && weatherData.hourly.cape;
  const times = weatherData && weatherData.hourly && weatherData.hourly.time;
  if (!cape || !times) return null;
  for (let i = fromIdx; i < fromIdx + 24 && i < cape.length; i++) {
    if ((cape[i] || 0) >= 500) {
      const hoursAway = i - fromIdx;
      const timeStr   = times[i].slice(11, 16);
      const todayDate = times[fromIdx] ? times[fromIdx].slice(0, 10) : '';
      const isNextDay = times[i].slice(0, 10) !== todayDate;
      return { hoursAway, timeStr, isNextDay };
    }
  }
  return null;
}

function thunderMessage(timeStr) {
  if (lang === 'fi') return `⚡ Ukkoskriski klo ${timeStr}`;
  return `⚡ Åskrisk kl ${timeStr}`;
}

function updateThunderWarning(info) {
  lastThunderInfo = info;
  const icon   = document.getElementById('thunderIcon');
  const banner = document.getElementById('thunderBanner');
  if (!info) {
    if (icon)   icon.style.display = 'none';
    if (banner) banner.style.display = 'none';
    return;
  }
  const { hoursAway, timeStr, isNextDay } = info;
  const isRed = hoursAway <= 6;
  if (icon) {
    icon.style.display = hoursAway <= 12 ? '' : 'none';
    icon.className = isRed ? 'thunder-icon red' : 'thunder-icon yellow';
  }
  if (banner) {
    banner.textContent = thunderMessage(timeStr);
    banner.style.display = 'block';
    banner.className = isRed ? 'thunder-banner' : 'thunder-banner thunder-banner-yellow';
  }
}

function windDirArrow(deg) {
  const rotation = (deg + 180) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" style="transform:rotate(${rotation}deg)"><path d="M11 2 L16 17 L11 13 L6 17 Z" fill="currentColor"/></svg>`;
}

function windColor(ms) {
  if (ms < 3)  return '#10B981';
  if (ms < 6)  return '#F59E0B';
  if (ms < 9)  return '#F97316';
  if (ms < 12) return '#EF4444';
  return '#991B1B';
}

function parseFmiSimple(xmlText, label) {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const latest = {};

    // Format 1: BsWFS simple (used by weather::simple queries)
    const bsElements = doc.getElementsByTagNameNS('*', 'BsWfsElement');
    if (bsElements.length > 0) {
      Array.from(bsElements).forEach(el => {
        const name   = el.getElementsByTagNameNS('*', 'ParameterName')[0]?.textContent?.trim();
        const valStr = el.getElementsByTagNameNS('*', 'ParameterValue')[0]?.textContent?.trim();
        const time   = el.getElementsByTagNameNS('*', 'Time')[0]?.textContent?.trim();
        if (!name || valStr === 'NaN') return;
        const val = parseFloat(valStr);
        if (!isNaN(val) && (!latest[name] || time > latest[name].time))
          latest[name] = { value: val, time };
      });
      if (label) console.log('[FMI ' + label + '] BsWFS parsed:', JSON.stringify(latest));
      return Object.keys(latest).length ? latest : null;
    }

    // Format 2: WML2/OM (MeasurementTimeseries)
    const tsList = doc.getElementsByTagNameNS('*', 'MeasurementTimeseries');
    if (tsList.length > 0) {
      Array.from(tsList).forEach(ts => {
        const gmlId = ts.getAttributeNS('http://www.opengis.net/gml/3.2', 'id')
                   || ts.getAttribute('gml:id') || ts.getAttribute('id') || '';
        const param = gmlId.split('-').pop();
        if (!param) return;
        const tvps = ts.getElementsByTagNameNS('*', 'MeasurementTVP');
        let lastVal = null, lastTime = null;
        Array.from(tvps).forEach(tvp => {
          const valStr = tvp.getElementsByTagNameNS('*', 'value')[0]?.textContent?.trim();
          const time   = tvp.getElementsByTagNameNS('*', 'time')[0]?.textContent?.trim();
          if (!valStr || valStr === 'NaN') return;
          const val = parseFloat(valStr);
          if (!isNaN(val)) { lastVal = val; lastTime = time; }
        });
        if (lastVal !== null) latest[param] = { value: lastVal, time: lastTime };
      });
      if (label) console.log('[FMI ' + label + '] WML2 parsed:', JSON.stringify(latest));
      return Object.keys(latest).length ? latest : null;
    }

    // Format 3: MultiPointCoverage (used by mareograph::multipointcoverage)
    // gml:tupleList contains lines of "timestamp value1 value2..." for each time step
    // We only requested one parameter (wlev), so each line is "timestamp value"
    const tupleEl = doc.getElementsByTagNameNS('*', 'tupleList')[0];
    if (tupleEl) {
      const lines = tupleEl.textContent.trim().split('\n').map(s => s.trim()).filter(Boolean);
      let lastVal = null, lastTime = null;
      lines.forEach(line => {
        const parts = line.split(/\s+/);
        if (parts.length < 2) return;
        const val = parseFloat(parts[parts.length - 1]);
        if (!isNaN(val)) { lastVal = val; lastTime = parts[0]; }
      });
      if (label) console.log('[FMI ' + label + '] MPC parsed: wlev =', lastVal, 'at', lastTime);
      if (lastVal !== null) return { wlev: { value: lastVal, time: lastTime } };
    }

    if (label) {
      const tagNames = new Set(Array.from(doc.getElementsByTagNameNS('*', '*')).map(e => e.localName));
      console.log('[FMI ' + label + '] elements in XML:', Array.from(tagNames).sort().join(', '));
    }
    if (label) console.log('[FMI ' + label + '] no known format found in XML');
    return null;
  } catch (e) {
    if (label) console.log('[FMI ' + label + '] parse error:', e);
    return null;
  }
}

function wmoIcon(code) {
  if (code === 0)              return '☀️';
  if (code <= 2)               return '🌤️';
  if (code === 3)              return '☁️';
  if (code <= 49)              return '🌫️';
  if (code <= 67)              return '🌧️';
  if (code <= 77)              return '❄️';
  if (code <= 82)              return '🌦️';
  if (code <= 86)              return '🌨️';
  return '⛈️';
}

function waterLevelColor(cm) {
  if (cm >= -20 && cm <= 20) return '#10B981';
  if (cm > 20 && cm <= 50)   return '#F59E0B';
  return '#EF4444';
}

async function loadWeather() {
  const container  = document.getElementById('weatherList');
  const fmiStatus  = document.getElementById('fmiStatus');
  const updEl      = document.getElementById('weatherUpdated');
  if (!container) return;
  container.innerHTML = `<div class="empty">${t('hamtar')}</div>`;
  if (fmiStatus) fmiStatus.innerHTML = '';
  let lat = WEATHER_FALLBACK_LAT, lon = WEATHER_FALLBACK_LON, gpsUsed = false;
  if (mode === 'ferry' && lastKnownGpsPos) {
    lat = lastKnownGpsPos.lat; lon = lastKnownGpsPos.lng; gpsUsed = true;
  }
  // Aktuella parameternamn — legacy-aliaset windgusts_10m accepteras av API:et men
  // returnerar bara null sedan Open-Meteo släppte det (windspeed/winddirection funkar än)
  const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,cape,weather_code&wind_speed_unit=ms&forecast_days=2&timezone=Europe%2FHelsinki`;

  // allSettled: ett misslyckat anrop blockerar inte det andra
  const [omResult, fmiResult] = await Promise.allSettled([
    fetch(omUrl),
    fetch(buildFmiWaterUrl()).catch(() => null),
  ]);

  // ── FMI vattenstånd (oberoende — fel här påverkar inte timprognosen) ──
  try {
    const fmiWaterResp = fmiResult.status === 'fulfilled' ? fmiResult.value : null;
    let fmiWater = null;
    if (fmiWaterResp?.ok) {
      fmiWater = parseFmiSimple(await fmiWaterResp.text(), null);
    }
    if (fmiStatus && fmiWater?.WATLEV != null) {
      const cm  = Math.round(fmiWater.WATLEV.value / 10);
      const col = waterLevelColor(cm);
      const sign = cm > 0 ? '+' : '';
      let trendHtml = '';
      if (db) {
        try {
          const snap = await db.ref('config/watlev').once('value');
          const prev = snap.val();
          if (prev && typeof prev.value === 'number' && typeof prev.ts === 'number') {
            if (Date.now() - prev.ts < 2 * 3600 * 1000) {
              const diff = cm - prev.value;
              if (diff > 1)       trendHtml = `<div class="fmi-card-trend" style="color:#10B981">↑ +${diff} cm</div>`;
              else if (diff < -1) trendHtml = `<div class="fmi-card-trend" style="color:#EF4444">↓ ${diff} cm</div>`;
              else                trendHtml = `<div class="fmi-card-trend" style="color:var(--muted)">→</div>`;
            }
          }
        } catch (e) { /* Firebase otillgänglig — ingen trend */ }
        db.ref('config/watlev').set({ value: cm, ts: Date.now() }).catch(() => {});
      }
      fmiStatus.innerHTML = `<div class="fmi-cards"><div class="fmi-card">` +
        `<div class="fmi-card-value" style="color:${col}">🌊 ${sign}${cm} cm</div>` +
        trendHtml +
        `<div class="fmi-card-label">${lang === 'fi' ? 'Vedenpinta Hanko' : 'Vattenstånd Hangö'}</div>` +
        `</div></div>`;
    }
  } catch (fmiErr) {
    console.error('[FMI] Fel vid rendering:', fmiErr);
  }

  // ── Open-Meteo timprognos ──
  if (omResult.status === 'rejected') {
    console.error('[OM] fetch-fel:', omResult.reason);
    container.innerHTML = `<div class="empty">${t('weatherError')}</div>`;
    if (updEl) updEl.textContent = '';
    updateThunderWarning(null);
    return;
  }
  const omResp = omResult.value;
  console.log('[OM] HTTP', omResp.status, omUrl.slice(0, 80));
  if (!omResp.ok) {
    const body = await omResp.text().catch(() => '');
    console.error('[OM] HTTP-fel', omResp.status, ':', body.slice(0, 300));
    container.innerHTML = `<div class="empty">${t('weatherError')}</div>`;
    if (updEl) updEl.textContent = '';
    updateThunderWarning(null);
    return;
  }
  try {
    weatherData = await omResp.json();
    console.log('[OM] JSON OK, timmar:', weatherData?.hourly?.time?.length);
    weatherLastFetch = Date.now();

    const now = new Date();
    // Helsinki-timme via formatToParts — locale-strängslicing är motorberoende
    // (Safari kan formatera annorlunda än Chrome) och föll då tyst tillbaka
    // till idx 0 = midnattens data i stället för aktuell timme
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Helsinki',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hourCycle: 'h23',
      }).formatToParts(now).map(p => [p.type, p.value])
    );
    const hDate = `${parts.year}-${parts.month}-${parts.day}`;
    const hHour = parts.hour;
    const times = weatherData.hourly.time;
    let idx = times.findIndex(s => s.slice(0, 10) === hDate && s.slice(11, 13) === hHour);
    if (idx < 0) {
      console.error('[OM] Hittade inte aktuell timme', hDate, hHour,
        '— times:', times[0], '…', times[times.length - 1]);
      idx = 0;
    }
    console.log('[OM] Aktuell timme', hDate, hHour + ':xx → idx', idx, '=', times[idx]);
    console.log('[OM] Råvärden för', times[idx] + ':',
      'vind', weatherData.hourly.wind_speed_10m[idx], 'm/s,',
      'byar', weatherData.hourly.wind_gusts_10m[idx], 'm/s,',
      'riktning', weatherData.hourly.wind_direction_10m[idx], '°,',
      'temp', weatherData.hourly.temperature_2m[idx], '°C');
    console.log('[OM] Rå wind_gusts_10m (från', times[idx].slice(11, 16) + '):',
      JSON.stringify(weatherData.hourly.wind_gusts_10m.slice(idx, idx + 6)));
    console.log('[OM] Riktning', times[idx].slice(11, 16), '=',
      weatherData.hourly.wind_direction_10m[idx], '° → pilrotation',
      (weatherData.hourly.wind_direction_10m[idx] + 180) % 360, '°');
    let html = '';
    for (let i = idx; i < idx + 48 && i < times.length; i++) {
      const speed = weatherData.hourly.wind_speed_10m[i] ?? 0;
      const gusts = weatherData.hourly.wind_gusts_10m[i] ?? 0;
      const dir   = weatherData.hourly.wind_direction_10m[i];
      const temp  = weatherData.hourly.temperature_2m[i];
      const wcode = weatherData.hourly.weather_code?.[i];
      const color = windColor(speed);
      const bold  = speed >= 12 ? 'font-weight:800;' : '';
      html +=
        `<div class="wind-row" style="border-left:3px solid ${color}">` +
          `<div class="wind-wmo">${wcode != null ? wmoIcon(wcode) : ''}</div>` +
          `<div class="wind-time">${times[i].slice(11, 16)}</div>` +
          `<div class="wind-main">` +
            `<span class="wind-speed" style="color:${color};${bold}">${t('windLabel')}: ${speed.toFixed(1)} m/s</span>` +
            `<span class="wind-gust">${t('gustLabel')}: ${gusts.toFixed(1)} m/s</span>` +
            `<span class="wind-temp">🌡️ ${temp != null ? temp.toFixed(1) : '—'}°C</span>` +
          `</div>` +
          `<div class="wind-dir">${windDirArrow(dir)}</div>` +
        `</div>`;
    }
    if (!html) html = `<div class="empty">${t('weatherError')}</div>`;
    container.innerHTML = html;
    if (updEl) updEl.textContent = `${t('weatherUpdated')} ${now.toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' })}`;
    if (!gpsUsed && mode === 'ferry')
      container.insertAdjacentHTML('beforeend', `<div class="weather-note">${t('weatherGpsError')}</div>`);
    updateThunderWarning(thunderInfo(idx));
  } catch (e) {
    console.error('[OM] JSON/rendering-fel:', e);
    container.innerHTML = `<div class="empty">${t('weatherError')}</div>`;
    if (updEl) updEl.textContent = '';
    updateThunderWarning(null);
  }
}

function renderWeather() {
  if (!weatherLastFetch || Date.now() - weatherLastFetch > 30 * 60 * 1000) loadWeather();
}
