# ARCHITECTURE.md

Fordonsräknare — teknisk arkitektur  
Version 7.6 · Uppdaterad 2026-06-27

---

## 1. Datamodell

### Firebase Realtime Database

Databasen heter `fordonsraknare` (region: europe-west1). All trafikdata är datumpartitionerad — varje dags data lever under en egen nod med datumsträngen `YYYY-MM-DD` som nyckel.

---

#### `days/{YYYY-MM-DD}/logs/{pushKey}`

Varje fordonshändelse sparas som en post i en event-sourcing-lista. UI:n rekonstruerar räknarstatus genom att summera alla deltan för dagen.

| Fält    | Typ    | Värden         | Beskrivning |
|---------|--------|----------------|-------------|
| `type`  | string | se CATS-listan | Fordonstyp, t.ex. `"personbil"`, `"lastbil"`, `"cykel"` |
| `ts`    | number | Unix ms        | Tidpunkt för händelsen |
| `delta` | number | `1` eller `-1` | +1 = fordon tillagt, −1 = fordon borttaget |

---

#### `turer/{YYYY-MM-DD}/{pushKey}`

En post per detekterad avgång. Fält utöver `ts` läggs till progressivt.

| Fält            | Typ    | Närvaro         | Beskrivning |
|-----------------|--------|-----------------|-------------|
| `ts`            | number | alltid          | Unix ms för avgången |
| `lat`           | number | ferry-läge      | GPS-latitud vid avgången |
| `lng`           | number | ferry-läge      | GPS-longitud vid avgången |
| `from`          | string | när brygga känd | Avsändarbrygga: `"Pettu"` eller `"Utö"` |
| `to`            | string | när brygga känd | Destinationsbrygga (reserverat, ej i aktiv användning) |
| `avgSpeedKnots` | number | ferry-läge      | Snitthastighet under *föregående* tur i knop, 1 decimal. Skrivs retroaktivt när nästa avgång detekteras. |

---

#### `config/version`

Sträng med senaste appversionen, t.ex. `"7.6"`. Klienten jämför mot sin lokala `APP_VERSION` och visar en uppdateringsbanner om versionerna inte matchar.

---

#### `config/bryggor/{id}`

Valfri Firebase-override av bryggornas koordinater och namn. Om noden saknas används `BRYGGOR_DEFAULT` i koden.

```json
{
  "pettu": { "id": "pettu", "name": "Pettu", "lat": 60.0385, "lng": 22.9226 },
  "uto":   { "id": "uto",   "name": "Utö",   "lat": 60.0411, "lng": 22.9151 }
}
```

---

#### `config/watlev`

Senast hämtat och sparat havsvattenstånd, används för att beräkna trendindikator vid nästa hämtning.

```json
{ "value": -3, "ts": 1750000000000 }
```

`value` är i hela centimeter (MW-referens). `ts` är Unix ms. Värden äldre än 2 timmar ignoreras vid trendberäkning.

---

### localStorage (primärt läscache)

Nyckel: `farjeraknare_v1`

```json
{
  "date": "2026-06-27",
  "logs": [
    { "id": "-Nxyz123", "type": "personbil", "ts": 1750000000000, "delta": 1 }
  ],
  "trips": [
    { "id": "-Nabc456", "ts": 1750000010000, "lat": 60.038, "lng": 22.922,
      "from": "Pettu", "avgSpeedKnots": 4.2 }
  ]
}
```

All UI-rendering läser från localStorage, inte direkt från Firebase. Firebase-lyssnarna skriver till localStorage via `save()` när de tar emot uppdateringar. Appen fungerar offline med senast kända data.

Övriga localStorage-nycklar:

| Nyckel              | Innehåll |
|---------------------|----------|
| `farjeraknare_lang` | Aktivt språk: `"sv"` eller `"fi"` |
| `farjeraknare_mode` | Aktivt läge: `"ferry"` eller `"test"` |

---

## 2. Systemkarta

### GPS-detekteringssystemet

Aktiveras när användaren byter till ferry-läge (`applyMode()`). Startar `navigator.geolocation.watchPosition()` med `enableHighAccuracy: true`.

**Uppvärmningstid (30 s):** Under de första 30 sekunderna samlar systemet hastighetsprover men triggar inga avgångar. GPS-mottagare levererar initialt opålitliga hastighetsvärden.

**Avgångsdetektering:** En avgång registreras när alla tre villkor uppfylls:
1. `pos.coords.speed >= 1.0 m/s`
2. Minst 5 minuter sedan föregående GPS-detekterad avgång
3. Positionen är inom 1000 m från Pettu eller Utö (driftsgeofence)

**Driftsgeofence:** `isWithinOperatingArea(lat, lng)` jämför position mot alla bryggpunkter i `bryggorConfig` med Haversine-avstånd. Om utanför 1000 m loggas `[GPS] Utanför driftsområde — avgång ej registrerad` i debug-panelen. Hastighetssampling sker oavsett position.

**Hastighetsloggning:** Varje positivt hastighetsprov (m/s) samlas i `tripSpeedSamples[]`. Vid nästa avgång beräknas snittet, konverteras till knop, och skrivs till *föregående* avgångens Firebase-nod via `finalizeCurrentTripSpeed()`. Sedan nollställs arrayen.

**Brygga-detektering:** Vid GPS-avgång anropar `recordDeparture()` → `getNearestBrygga(lat, lng)`. Om positionen är inom 50 m från en känd brygga sätts `from` till bryggens namn (`"Pettu"` eller `"Utö"`).

**Android-anpassning:** `pos.coords.speed` returnerar `null` på många Android-enheter. Systemet samlar prover *innan* null-kontrollen körs — null-kontrollen blockerar bara avgångsdetekteringen, inte provsamlingen.

**Stoppbeteende:** `stopGpsWatch()` anropar `finalizeCurrentTripSpeed()` innan watchId rensas, så att snitthastigheten för pågående tur sparas även om användaren byter till testläge.

---

### Bryggsystemet

**Statisk konfiguration:** `BRYGGOR_DEFAULT` i koden definierar Pettu och Utö med koordinater och namn.

**Firebase-override:** `initBryggorListener()` lyssnar på `config/bryggor` med `.on('value')`. Om noden finns ersätts `bryggorConfig` med värdena från Firebase. Ändras Firebase-konfigurationen uppdateras `bryggorConfig` live utan sidomladdning.

**Närmaste brygga:** `getNearestBrygga(lat, lng)` hittar den brygga inom `BRYGGA_RADIUS_M` (50 m) med minst avstånd. Returnerar bryggens namn, eller `null` om ingen är tillräckligt nära.

**Driftsgeofence:** `isWithinOperatingArea(lat, lng)` kontrollerar om positionen är inom `OPERATING_RADIUS_M` (1000 m) från *någon* brygga — ett mjukare villkor än BRYGGA_RADIUS_M. Används för att blockera avgångsregistrering när färjan inte är nära hamnområdet.

---

### Firebase-synkroniseringssystemet

`initFirebase()` anropas vid appstart (Firebase compat SDK v10.12.5).

**Dagslyssnare:** `attachListeners()` skapar `.on('value')`-lyssnare på `days/{datum}/logs` och `turer/{datum}`. Lyssnarna är live — de skickar hela snapshots vid varje ändring. När en snapshot kommer: data skrivs till localStorage, `refreshAll()` anropas, avgångsloggen renderas om.

**Datumrollover:** `checkDateRollover()` körs varje `tick()` (var 10:e sekund). Om systemklockan rullat till nytt datum: gamla lyssnare kopplas loss, localStorage återställs till nytt datum med tomma listor, `attachListeners()` anropas för ny dag.

**Brygglyssnare:** `initBryggorListener()` sätter upp `.on('value')`-lyssnare på `config/bryggor`. Datumsoberoende, kopplas in en gång.

**Synkstatus:** Synk-indikatorn i headern visar `"Lokal"` (ingen Firebase), `"Synkad"` eller `"Fel"`.

---

### Väder- och havsdatasystemet

Väderfliken hämtar data parallellt från två källor via `Promise.all`.

**FMI (Finnish Meteorological Institute):**
- Källa: `opendata.fmi.fi` WFS API, stored query `fmi::observations::mareograph::instant::simple`
- Station: Hanko Russarö, fmisid=134253 (59.823°N, 22.977°E)
- Parameter: `WATLEV` (mm, MW-referens) — divideras med 10 för cm-visning
- Svar: BsWFS XML-format, parsas av `parseFmiSimple()`
- Hämtar de senaste 2 timmarnas data; tar senaste icke-NaN-värdet

**Trendindikator:** Före rendering läses `config/watlev` från Firebase (föregående sparat värde med tidsstämpel). Trend visas om föregående värde är < 2 timmar gammalt:
- Diff > +1 cm → `↑ +X cm` (grön)
- Diff < −1 cm → `↓ X cm` (röd)
- Diff ±1 cm → `→` (grå)
Efter rendering sparas aktuellt värde till `config/watlev`.

**Open-Meteo:**
- Källa: `api.open-meteo.com` (gratis, ingen API-nyckel)
- Frågan: 2 dagars timdata, tidzon Europe/Helsinki: `windspeed_10m`, `windgusts_10m`, `winddirection_10m`, `temperature_2m`, `cape`, `weathercode`
- Koordinater: `lastKnownGpsPos` i ferry-läge, annars Nummela (60.333°N, 24.333°E)

**Vindvisning:** 48 timmar framåt som färgkodade rader (grön < 3 m/s → mörkröd ≥ 12) med WMO-väderikon per timme.

**Åskvarning:** Söker 24 närmaste timmar efter `cape >= 500 J/kg`:
- ≤ 6 h: röd ⚡-ikon + röd banner
- 6–12 h: gul ⚡-ikon, ingen banner
- > 12 h: ingen indikator

**Cache:** 30 minuters cache (`weatherLastFetch`). Bakgrundsintervall nollställer cachen och triggar omhämtning om väder-vyn är aktiv.

---

### Interaktionspunkter mellan systemen

| Från | Till | Mekanism |
|------|------|-----------|
| GPS-callback | Firebase | `recordDeparture()` skriver ny avgång till `turer/{datum}` |
| GPS-callback | Firebase | `finalizeCurrentTripSpeed()` uppdaterar föregående avgångs `avgSpeedKnots` |
| GPS-callback | `bryggorConfig` | `getNearestBrygga()` slår upp närmaste brygga och sätter `from` |
| GPS-callback | Geofence | `isWithinOperatingArea()` blockerar avgång om utanför 1000 m |
| GPS-callback | Väder-API | `lastKnownGpsPos` sätts; används av `loadWeather()` utan nytt GPS-anrop |
| Firebase-lyssnare | localStorage | Varje snapshot skriver fullständig data via `save()` |
| Firebase-lyssnare | UI | `refreshAll()` + `renderDepartureLog()` triggas vid varje Firebase-uppdatering |
| Firebase `config/bryggor` | `bryggorConfig` | Live-override av bryggkoordinater och namn |
| Firebase `config/watlev` | Väder-fliken | Läses för trendberäkning; skrivs efter varje FMI-hämtning |
| Väder-API | Header | `updateThunderWarning()` sätter ⚡-ikon och banner beroende på CAPE-värden |

---

## 3. Konstanter och designbeslut

| Konstant | Värde | Motivering |
|---|---|---|
| `GPS_SPEED_THRESHOLD` | `1.0 m/s` | Minsta hastighet för avgångsdetektering. Låg nog att fånga en sakta accelererande färja, hög nog att filtrera GPS-brus i stationärt läge (~0.1–0.5 m/s). |
| `GPS_WARMUP_MS` | `30 000 ms` | GPS levererar initialt opålitliga hastighetsvärden. 30 s ger signalstabilisering utan att missa en snabb avgång. |
| `GPS_DEPARTURE_GAP_MS` | `300 000 ms` (5 min) | Minsta tid mellan två GPS-detekterade avgångar. Förhindrar att hastighetstoppar under en tur triggar flera registreringar. |
| `TRIP_VEHICLE_WINDOW_MS` | `180 000 ms` (3 min) | Fordon registrerade ±3 min från en avgångstidpunkt kopplas till den avgången i loggen. Täcker inpåstigningstid. |
| `TRIP_GAP_MS` | `120 000 ms` (2 min) | Testläge: minsta tid mellan manuella avgångar. |
| `KORTOM_LOCK_MS` | `120 000 ms` (2 min) | Testläge: "Kör tom"-knappen låses 2 min efter en tom avgång. |
| `BRYGGA_RADIUS_M` | `50 m` | Maxavstånd för att en GPS-position ska matchas till en specifik brygga och sätta `from`-fältet. |
| `OPERATING_RADIUS_M` | `1 000 m` | Geofence-radie: avgångar registreras bara inom detta avstånd från en känd brygga. Fångar hela hamnområdet utan att kräva exakt bryggnärvaro. |
| `WEATHER_FALLBACK_LAT/LON` | `60.333°N, 24.333°E` | Nummela, Finland — fallback om GPS-position saknas i testläge. |
| `CAPE >= 500 J/kg` | — | Standardtröskel för åskarisk i meteorologi. |
| `CO2_PER_TRIP` | `8.7 kg` | Uppskattad CO2-emission per dieseldriven färjeöverfart. |

### Övriga designbeslut

**APP_VERSION** ökas automatiskt med +0.1 av en git pre-commit hook. Versionen skrivs inte manuellt.

**avgSpeedKnots skrivs retroaktivt.** Hastighetsprovet för tur N samlas under tur N, men skrivs till Firebase-noden för tur N−1 precis när tur N+1 detekteras. Det beror på att slutet av tur N och starten av tur N+1 är samma händelse.

**localStorage som primärt läscache** innebär att appen renderar omedelbart vid start och fungerar offline. Firebase-lyssnarna skriver till localStorage vid varje uppdatering; UI läser alltid från localStorage.

**Bryggor som namngivna entiteter.** Pirar identifieras med namn (`"Pettu"`, `"Utö"`) i stället för generiska etiketter (`"a"`, `"b"`). Namen syns direkt i avgångsloggen och kan översättas via i18n-systemet.

**Två separata radier för bryggor.** `BRYGGA_RADIUS_M` (50 m) används för att avgöra *vilken* brygga en avgång startar från. `OPERATING_RADIUS_M` (1 000 m) används för att avgöra *om* en avgång överhuvudtaget ska registreras. Separationen gör att geofencen kan vara generös (täcker hela hamnbassängen) utan att påverka noggrannheten i bryggidentifieringen.

**FMI-vattenstånd via WFS.** FMI tillhandahåller havsdata via ett OGC WFS-gränssnitt med BsWFS-format. `parseFmiSimple()` hanterar även WML2- och MultiPointCoverage-format för framtida kompatibilitet. Hanko Russarö (fmisid=134253) är den närmaste aktiva FMI-mareografstationen till Pettu/Utö-rutten.
