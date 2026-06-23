# ARCHITECTURE.md

Fordonsräknare — teknisk arkitektur  
Version 4.3 · Uppdaterad 2026-06-22

---

## 1. Datamodell

### Firebase Realtime Database

Databasen heter `fordonsraknare` (region: europe-west1). All data är datumpartitionerad, d.v.s. varje dags data lever under en egen nod med datumsträngen `YYYY-MM-DD` som nyckel.

---

#### `days/{YYYY-MM-DD}/logs/{pushKey}`

Varje fordonshändelse sparas som en post i en event-sourcing-lista. UI:n rekonstruerar räknarstatus genom att summera alla deltan för dagen.

| Fält    | Typ      | Värden          | Beskrivning |
|---------|----------|-----------------|-------------|
| `type`  | string   | se CATS-listan  | Fordonstyp, t.ex. `"personbil"`, `"lastbil"`, `"cykel"` |
| `ts`    | number   | Unix ms         | Tidpunkt för händelsen |
| `delta` | number   | `1` eller `-1`  | +1 = fordon tillagt, −1 = fordon borttaget |

---

#### `turer/{YYYY-MM-DD}/{pushKey}`

En post per detekterad avgång. Fält utöver `ts` läggs till progressivt — GPS-koordinater vid avgången, riktning när klusterpunkter är kända, snitthastighet retroaktivt när nästa avgång detekteras.

| Fält              | Typ    | Närvaro         | Beskrivning |
|-------------------|--------|-----------------|-------------|
| `ts`              | number | alltid          | Unix ms för avgången |
| `lat`             | number | ferry-läge      | GPS-latitud vid avgången |
| `lng`             | number | ferry-läge      | GPS-longitud vid avgången |
| `from`            | string | när kluster känt | Avsändarpir: `"a"` eller `"b"` |
| `to`              | string | när kluster känt | Mottagarpir: `"a"` eller `"b"` |
| `avgSpeedKnots`   | number | ferry-läge      | Snitthastighet under *föregående* tur i knop, 1 decimal. Skrivs retroaktivt när nästa avgång detekteras. |

---

#### `bryggor/positioner/{pushKey}`

GPS-position vid varje avgång, används för att lära systemet var bryggornas är.

| Fält | Typ    | Beskrivning |
|------|--------|-------------|
| `lat` | number | GPS-latitud |
| `lng` | number | GPS-longitud |
| `ts`  | number | Unix ms |

---

#### `bryggor/centrum/`

Klustercenter beräknade med k-means (k=2) från alla sparade positioner. Uppdateras automatiskt vid varje ny avgång när ≥ 6 positioner finns.

```json
{
  "a": { "lat": 60.123, "lng": 24.456 },
  "b": { "lat": 60.124, "lng": 24.461 }
}
```

---

#### `bryggor/namn/`

Användarvalda namn på de två bryggorna. Defaultvärden används tills användaren ändrar.

```json
{ "a": "Brygga A", "b": "Brygga B" }
```

---

#### `config/version`

En enkel strängvärde med senaste appversionen, t.ex. `"4.3"`. Klienten jämför mot sin lokala `APP_VERSION` och visar en uppdateringsbanner om versionen inte stämmer.

---

### localStorage (primärt läscache)

Nyckel: `farjeraknare_v1`

```json
{
  "date": "2026-06-22",
  "logs": [
    { "id": "-Nxyz123", "type": "personbil", "ts": 1750000000000, "delta": 1 }
  ],
  "trips": [
    { "id": "-Nabc456", "ts": 1750000010000, "lat": 60.123, "lng": 24.456,
      "from": "a", "to": "b", "avgSpeedKnots": 4.2 }
  ]
}
```

All UI-rendering läser från localStorage, inte direkt från Firebase. Firebase-lyssnarna skriver till localStorage via `save()` när de tar emot uppdateringar. Det innebär att appen fungerar offline med sin senast kända data.

---

## 2. Systemkarta

### GPS-detekteringssystemet

Aktiveras när användaren byter till ferry-läge (`applyMode()`). Startar `navigator.geolocation.watchPosition()` med `enableHighAccuracy: true`.

**Uppvärmningstid (30 s):** Under de första 30 sekunderna samlar systemet hastighetsprover men triggar inga avgångar. GPS-mottagare levererar initialt opålitliga hastighetsvärden.

**Avgångsdetektering:** En avgång registreras när `pos.coords.speed >= 1.0 m/s` OCH minst 5 minuter har gått sedan förra GPS-detekterade avgången. Båda villkoren måste vara uppfyllda för att undvika dubbeltriggning under en tur.

**Hastighetsloggning:** Varje positiv hastighetsprov (m/s) samlas i `tripSpeedSamples[]`. Vid nästa avgång beräknas snittet, konverteras till knop, och skrivs till *föregående* avgångens Firebase-nod via `finalizeCurrentTripSpeed()`. Sedan nollställs arrayen.

**Android-anpassning:** `pos.coords.speed` returnerar `null` på många Android-enheter. Systemet samlar prover *innan* null-kontrollen körs — null-kontrollen blockerar bara avgångsdetekteringen, inte provsamlingen.

**Stoppbeteende:** `stopGpsWatch()` anropar `finalizeCurrentTripSpeed()` innan den rensar watchId, så att snitthastigheten för pågående tur sparas även om användaren byter till testläge.

---

### Firebase-synkroniseringssystemet

`initFirebase()` anropas vid appstart och sätter upp Firebase-klienten (compat SDK v10.12.5).

**Dagslyssnare:** `attachListeners()` skapar `.on('value')`-lyssnare på `days/{datum}/logs` och `turer/{datum}`. Lyssnarna är "live" — de skickar hela snapshots vid varje ändring, inte bara deltan. När en snapshot kommer: data skrivs till localStorage, `refreshAll()` anropas, avgångsloggen renderas om.

**Datumrollover:** `checkDateRollover()` körs varje gång `tick()` anropas (var 10:e sekund). Om systemklockan har rullat till ett nytt datum: gamla lyssnare kopplas loss, localStorage återställs till det nya datumet med tomma listor, och `attachListeners()` anropas igen för det nya datumets Firebase-noder.

**Brygglyssnare:** `initBryggorListener()` sätter upp `.on('value')`-lyssnare på `bryggor/centrum` och `bryggor/namn`. Dessa är *datumsoberoende* och kopplas bara in en gång.

**Synkstatus:** Synk-indikatorn i headern visar "Lokal" (ingen Firebase), "Synkad" eller "Fel" beroende på lyssnartillstånd.

**Positionskluster:** Vid varje GPS-avgång anropas `savePositionAndCluster()`, som:
1. Sparar positionen till `bryggor/positioner`
2. Läser *alla* sparade positioner
3. Kör k-means (k=2, max 30 iterationer) om ≥ 6 positioner finns
4. Skriver klustercentra till `bryggor/centrum`

Tröskeln på 6 positioner är vald för att klusterresultatet ska vara tillräckligt stabilt för att skriva till databasen.

---

### Väder-API-systemet

Hämtar prognosdata från Open-Meteo (gratis, ingen API-nyckel).

**Koordinater:** I ferry-läge används `lastKnownGpsPos` (sätts vid varje `watchPosition`-callback) för att geolokalisera väderfrågan utan ett extra GPS-anrop. I testläge, eller om GPS-positionen saknas, används fallback-koordinaten Nummela (60.333°N, 24.333°E).

**Frågan:** 2 dagars timdata, tidzon Europe/Helsinki: `windspeed_10m`, `windgusts_10m`, `winddirection_10m`, `temperature_2m`, `cape`.

**Visning:** Aktuell timme identifieras i svarslistan; 48 timmar framåt renderas som färgkodade rader (grön < 3 m/s, gul 3–6, orange 6–9, röd 9–12, mörkröd ≥ 12).

**Åskvarning:** Söker igenom de 24 närmaste timmarna efter `cape >= 500 J/kg`. Om träff:
- ≤ 6 h: röd ⚡-ikon + röd banner
- 6–12 h: gul ⚡-ikon, ingen banner
- > 12 h: ingen indikator

**Cache:** 30 minuters cache (`weatherLastFetch`). En bakgrundsintervall nollställer cachen och triggar omhämtning om väder-vyn är aktiv.

---

### Interaktionspunkter mellan systemen

| Från | Till | Mekanism |
|------|------|-----------|
| GPS-callback | Firebase | `recordDeparture()` skriver ny avgång till `turer/{datum}` |
| GPS-callback | Firebase | `finalizeCurrentTripSpeed()` uppdaterar föregående avgångs `avgSpeedKnots` |
| GPS-callback | Firebase | `savePositionAndCluster()` skriver position och uppdaterar klustercentra |
| GPS-callback | Väder-API | `lastKnownGpsPos` sätts; används av `loadWeather()` utan nytt GPS-anrop |
| Firebase-lyssnare | localStorage | Varje snapshot skriver fullständig data via `save()` |
| Firebase-lyssnare | UI | `refreshAll()` + `renderDepartureLog()` triggas vid varje Firebase-uppdatering |
| Väder-API | Header | `updateThunderWarning()` sätter ⚡-ikon och banner beroende på CAPE-värden |

---

## 3. Konstanter och designbeslut

| Konstant | Värde | Motivering |
|---|---|---|
| `GPS_SPEED_THRESHOLD` | `1.0 m/s` | Minsta hastighet för avgångsdetektering. Låg nog att fånga en sakta accelererande färja, hög nog att filtrera GPS-brus i stationärt läge (~0.1–0.5 m/s). |
| `GPS_WARMUP_MS` | `30 000 ms` (30 s) | GPS levererar initialt opålitliga hastighetsvärden. 30 s ger signalstabilisering utan att missa en snabb avgång. |
| `GPS_DEPARTURE_GAP_MS` | `300 000 ms` (5 min) | Minsta tid mellan två GPS-detekterade avgångar. Förhindrar att en tur med hastighetstoppar triggar flera avgångar. Sätts till 5 min, lägre än kortaste normala färjetur. |
| `TRIP_VEHICLE_WINDOW_MS` | `180 000 ms` (3 min) | Fordon registrerade ±3 min från en avgångstidpunkt kopplas till den avgången i loggen. Täcker inpåstigningstid. |
| `TRIP_GAP_MS` | `120 000 ms` (2 min) | Testläge: minsta tid mellan manuella avgångar. Förhindrar dubbelregistrering. |
| `KORTOM_LOCK_MS` | `120 000 ms` (2 min) | Testläge: "Kör tom"-knappen låses 2 min efter en tom avgång. Förhindrar oavsiktliga klick i rad. |
| `CO2_PER_TRIP` | `8.7 kg` | Uppskattad CO2-emission per dieseldriven färjeöverfart. Används i statistikvyn. |
| `CO2_PER_KM_CAR` | `0.12 kg/km` | Genomsnittlig emission, förbränningsbil. Referensvärde för CO2-jämförelseberäkning. |
| `CO2_PER_KM_EV` | `0.02 kg/km` | Emission, elbil (inkl. produktion). Ingår i samma jämförelse. |
| `CO2_PER_TRIP_EV` | `0.1 kg` | Hypotetisk emission om färjan vore elektrisk. Visas som "vad om"-alternativ i statistiken. |
| `WEATHER_FALLBACK_LAT/LON` | `60.333°N, 24.333°E` | Nummela, Finland — ungefärlig position för den faktiska bron. Används om GPS-position saknas i testläge. |
| `CAPE >= 500 J/kg` | — | Konvektivt tillgänglig potentiell energi. 500 J/kg är standardtröskel i meteorologi för åskarisk. |

### Övriga designbeslut

**APP_VERSION** ökas automatiskt med +0.1 av en git pre-commit hook. Versionen skrivs inte manuellt.

**k-means kräver ≥ 6 positioner** innan klustercentra skrivs till Firebase. Under den tröskeln är spridningen för stor för att en tvåpunktskluster ska ge meningsfull riktningsinformation.

**avgSpeedKnots skrivs retroaktivt.** Hastighetsprovet för tur N samlas *under* tur N, men skrivs till Firebase-noden för tur N-1 precis när tur N+1 detekteras. Det beror på att slutet av tur N och starten av tur N+1 är samma händelse.

**localStorage som primärt läscache** innebär att appen renderar omedelbart vid start (ingen Firebase-fördröjning) och fungerar offline med senast kända data. Firebase-lyssnarna skriver till localStorage vid varje uppdatering; UI läser alltid från localStorage.
