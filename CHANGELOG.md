# Changelog

## v8.0 – 2026-07-02
- Ren omstrukturering: index.html uppdelad i separata filer, ingen funktionalitet ändrad
- style.css: all CSS
- i18n.js: översättningsobjektet T, t() och catName()
- firebase.js: Firebase-init, sync, versionskontroll, bryggmatchning och geofence (isWithinOperatingArea)
- gps.js: GPS-watch, avgångsdetektering, hastighetssampling, avgångs- och pauspåminnelser
- weather.js: FMI-vattenstånd och Open-Meteo-prognos
- app.js: state, UI-rendering, statistik, avgångshantering, bootstrap
- index.html innehåller nu bara struktur, <link> till style.css och <script>-taggar i rätt laddningsordning
- Pre-commit-hooken uppdaterad att leta efter APP_VERSION i app.js istället för index.html
- Verifierat i webbläsare: räkning, avgångsdetektering, språkbyte, färje-/testläge, statistik och väderflik (FMI + Open-Meteo) fungerar identiskt med tidigare

## v7.9 – 2026-07-01
- Pauspåminnelser i Färjeläge: 15, 10 och 5 min före varje paus (08:30, 11:00, 16:30, 19:00)
- Påminnelse spelar playPing() och visar banner: "Var på Pettu om X min — paus HH:MM"
- Om GPS-position är inom 50 m från Pettu visas istället "✓ På Pettu inför paus HH:MM"
- Varje påminnelse triggas bara en gång per dag — firedReminders (Set) nollställs vid midnatt
- Fungerar bara i Färjeläge, tyst i Testläge
- Nya konstanter: BREAK_TIMES, BREAK_REMINDER_OFFSETS_MIN

## v7.8 – 2026-06-30
- Bugg fixad: Open-Meteo timprognos visades inte trots att FMI-vattenståndskortet fungerade
- Promise.all ersatt med Promise.allSettled — ett misslyckat API-anrop blockerar inte längre det andra
- FMI-blocket har nu en egen try-catch, isolerat från timprognos-renderingen
- Null-guards i timprognos-loopen (speed ?? 0, gusts ?? 0) — Open-Meteo returnerar ibland null för enstaka timmar
- console.log på OM HTTP-status och antal timmar för felsökning; console.error vid nätverksfel eller HTTP-fel

## v7.7 – 2026-06-30
- Bugg fixad: radering av avgångsrad tog inte bort kopplade fordonsloggar — totalen stämde inte
- deleteDeparture() identifierar nu logs inom ±TRIP_VEHICLE_WINDOW_MS och tar bort dem från Firebase och localStorage
- console.log visar antal kopplade loggar och nettopåverkan på fordonsräkningen

## v7.6 – 2026-06-27
- Driftsgeofence: avgångar registreras bara inom 1000 m från Pettu eller Utö
- Ny funktion isWithinOperatingArea() återanvänder befintlig Haversine + bryggorConfig
- Ny konstant OPERATING_RADIUS_M = 1000
- Hastighetssampling sker fortfarande utanför området — bara avgångsregistreringen blockeras
- Debug-panel loggar "Utanför driftsområde — avgång ej registrerad" när hastighetströskel nås utanför området

## v7.5 – 2026-06-26
- Avgångsloggen visar nu "Start från Pettu" / "Start från Utö" (sv) och "Lähtö Petusta" / "Lähtö Ulkoluodosta" (fi) bredvid tidsstämpeln
- Om from saknas eller bryggan är okänd visas ingen text (TEST!-etiketten borttagen)
- Ny i18n: depFromPettu, depFromUto i båda språken

## v7.4 – 2026-06-26
- Vattenståndshistorik flyttad från localStorage till Firebase (config/watlev {value, ts})
- Trend beräknas mot senaste Firebase-värde; ignoreras om värdet är äldre än 2 timmar
- localStorage-nyckeln farjeraknare_watlev rensas vid start (migration)

## v7.3 – 2026-06-26
- Vattenståndskortet visar nu trend sedan föregående avläsning: ↑/↓/→ med diff i cm
- Tröskel: >+1 cm grön pil upp, <−1 cm röd pil ned, ±1 cm grå horisontalpil
- Föregående värde sparas i localStorage (farjeraknare_watlev) — trend visas korrekt även efter omladdning
- Ingen trend visas vid första laddningen (inget föregående värde)

## v7.2 – 2026-06-26
- Rubrik "Vindprognos" → "Havsvattenstånd" (sv) / "Meriveden korkeus" (fi)
- Fi `weatherGpsError`: "varmuuskopiointina" (fel ord, beteknar datasäkerhetskopia) → "varapaikkana"
- Fi `ferryPre`: "sama CO2 riittää" → "sama CO2 vastaa" (grammatiskt korrekt med partitiv "lähtöä")

## v7.1 – 2026-06-26
- FMI Hangö mareograf hittad: fmisid=134253 (59.823°N, 22.977°E = Hanko Russarö)
- Station bytt från Helsinki Kaivopuisto (132310) till Hangö Russarö (134253)
- Etiketten återställd till "Vattenstånd Hangö" / "Vedenpinta Hanko"

## v7.0 – 2026-06-26
- FMI vindkort borttaget — bara havsvattenstånd visas i väderfliken
- FMI vattenståndsstation bytt till Helsinki Kaivopuisto (fmisid=132310) — närmaste aktiva FMI-mareograf (Hangö finns inte i FMI:s öppna data)
- Bugg fixad: WATLEV-nyckeln (stor bokstav) används nu korrekt — vattenståndet visades inte trots lyckad hämtning
- Enhetskonvertering fixad: WATLEV från FMI är i mm, delas nu med 10 för att visa cm
- Debug-logging borttagen ur FMI-parsningen

## v5.8 – 2026-06-26
- FMI vindstation ändrad från `fmisid=100539` till `place=Utö` — fmisid returnerade ExceptionReport
- Lagt till raw XML-logg (800 tecken) även för vindanropet, synligt i debug-panelen

## v5.7 – 2026-06-26
- FMI-parsern hanterar nu både BsWFS (vinddata) och WML2/OM-format (mareografdata) — `::instant`-frågor returnerar WML2, inte BsWFS
- FMI vattenståndsurl ändrad från `fmisid=134254` till `place=Hanko` (stabilare sökning)
- Lagt till `console.log` på råxml och parsningsresultat för FMI vatten och vind (synligt i debug-panelen)
- `console.error` om FMI-anrop returnerar icke-OK HTTP-status

## v5.6 – 2026-06-26
- FMI vindstation ändrad från `place=Utö` till `fmisid=100539` (Utö i Skärgårdshavet, 59.7791°N 21.3744°E) — korrekt station
- FMI vattenstånd ändrad från `place=Utö` till `fmisid=134254` (Hangö mareograf) — Utö har ingen mareograf
- Vattenståndskortets etikett uppdaterad till "Vattenstånd Hangö" / "Hanko – vedenpinta"

## v5.5 – 2026-06-26
- Väderfliken hämtar nu data parallellt från FMI och Open-Meteo via `Promise.all`
- FMI: aktuellt vattenstånd (Utö mareograf) visas överst som färgkodad kort: grön ±20 cm, gul 20–50 cm, röd >50 eller <−20 cm
- FMI: senaste vindmätning från Utö visas som observationskort bredvid vattenståndet
- Open-Meteo behålls för CAPE (åskvarningslogik orörd), timtemperatur och timvind i prognosen
- Timrader i prognosen har nu väderikon baserad på WMO-kodtabellen: ☀️🌤️☁️🌫️🌧️❄️🌦️🌨️⛈️
- Om FMI-anrop misslyckas faller appen tyst tillbaka på enbart Open-Meteo — inga krascher

## v5.4 – 2026-06-24
- Hastighetsindikatorn i headern ersatt med en SVG-speedometer (halvcirkel, 0–6 knop)
- Nålen roterar i realtid baserat på aktuell GPS-hastighet
- Färgkodad båge: vit 0–1 kn, grön 1–3 kn, gul 3–6 kn (tonade zoner mot mörk bakgrund)
- Nål och siffra färgkodas identiskt med tidigare textindikator (grå/vit/grön/gul)
- Nollställs till grå nål + "0.0 kn" när GPS stoppas; döljs i Testläge

## v5.3 – 2026-06-24
- Statistik och Summering sammanslagna till en flik ("Statistik") med underflikar Idag / Vecka / Månad
- Idag-fliken visar i ordning: totalt fordon + snitt, toppimme, avgångar + CO2, CO2-jämförelser, avgångsstatistik, per kategori med staplar, per timme-graf
- Summering-fliken borttagen från navigationen
- Borttaget: `vSummary`, `navSummary`, `renderSummary()`, i18n-nycklarna `navSummary`
- `renderStats()` renderar nu hela Idag-innehållet; `goSummaryTab('Idag')` anropar `renderStats()`

## v5.2 – 2026-06-24
- "Per kategori"-sektionen borttagen från Summering-vyn (Idag-fliken) — informationen finns redan i Statistik-vyn med visuella staplar
- Borttaget: `#sumPerKatTitle`, `#sumCatList`, cat-list-renderingen i `renderSummary()`, och `applyLang`-raden för `sumPerKatTitle`

## v5.1 – 2026-06-24
- Avgångsloggen visar nu `TEST!` (röd, fet text) på rader där GPS-koordinaterna inte matchade någon känd brygga inom 50 m — tydlig signal om att bryggornas koordinater behöver justeras
- Tidigare visades koordinaterna (60.1234,24.5678) som diagnostik; ersatt med den mer lättlästa TEST!-markeringen

## v5.0 – 2026-06-24
- Avgångspåminnelse tillagd i Färjeläge: om ingen ny avgång skett på 22 min visas "Kolla Pettu 👀" eller "Kolla Utö 👀" beroende på senaste avgångsbrygga
- Påminnelsen kräver att `from`-fältet är känt (brygga matchad inom 50 m), GPS-hastighet ≤ 0.5 m/s och att alarmet inte redan fired under denna avgångscykel
- Bannern visas diskret i Räkna-vyn och försvinner automatiskt efter 30 s; stängs direkt vid nästa registrerade avgång
- Ny funktion `playPing()`: mjukare ljud än klick-feedback (520 Hz sinus, 0.6 s decay)
- Ny konstant `DEPARTURE_REMINDER_MS = 22 * 60 * 1000`
- `currentGpsSpeedMs` spåras nu i GPS-callbacken och nollställs i `stopGpsWatch()`

## v4.9 – 2026-06-24
- k-means brygginlärning ersatt med hårdkodad koordinatmatchning mot Pettu (60.0385, 22.9226) och Utö (60.0411, 22.9151)
- Ny funktion `getNearestBrygga(lat, lng)`: beräknar Haversine-avstånd till varje känd brygga, returnerar namn om inom 50 m, annars null
- `from`-fältet i Firebase `turer/` innehåller nu bryggans namn direkt ("Pettu"/"Utö") istället för 'a'/'b'
- `initBryggorListener()` lyssnar nu på `config/bryggor/` i Firebase — koordinater kan åsidosättas utan koddeploy
- Borttaget: `savePositionAndCluster()`, `kMeans2()`, `geoDistSq()`, `getDirection()`, `bridgeData`, `bryggor/positioner`-skrivningar
- Borttaget: oanvända i18n-nycklar `bryggeADefault`/`bryggeBDefault`

## v4.8 – 2026-06-24
- Avgångsloggen: om `from` saknas (k-means ej kört) visas nu GPS-koordinaterna (lat/lng, 4 decimaler) istället för tom sträng — bekräftar att GPS-data finns i Firebase
- Bugg fixad: lång tryckning minskade räknaren men inte fordonsantalet på avgångsraden i loggen
  - Rotorsak: `veh`-räknaren filtrerade bara loggar med `delta > 0` och ignorerade `delta: -1`-händelser — nettot räknades aldrig ut
  - Fix: räknar nu med `.reduce()` på samtliga loggar inom tidsfönstret och summerar delta-värdena, klämt till 0
- Hastighetsfältet (X kn) borttaget från avgångsloggens rader — `.dep-speed`-CSS och `speedStr`-variabeln raderade

## v4.7 – 2026-06-23
- Bugg fixad: `bryggor/`-noden skapades aldrig i Firebase trots att GPS-avgångar registrerades med lat/lng
  - Rotorsak: `.push()` och `.once('value')` startades parallellt — `once` läste gamla snapshoten innan `push` hunnit bekräftas av servern, så antalet positioner räknades aldrig upp korrekt och k-means triggades aldrig
- Fix: `.once('value')` kedjas nu med `.then()` efter att `.push()` resolvar, så snapshoten alltid innehåller den nyss sparade positionen
- `console.log` tillagd i `savePositionAndCluster()` vid anrop och efter läsning av positionsantal
- `console.error` tillagd på varje Firebase-skrivning i funktionen
- Kommentar tillagd om att Firebase-regler måste tillåta skriv/läs till `bryggor/`

## v4.6 – 2026-06-23
- Avgångsloggen visar nu bara avsändarbryggan per rad ("Pettu") istället för hela riktningspilen ("Pettu → Utö")
- Bryggnamnsinmatningsfälten under avgångsloggen borttagna — bryggnamnens källdata (`bryggor/namn/`) läses fortfarande från Firebase
- Rader utan `from`-fält (k-means ej kört) visar bara klockslaget, ingen tom text
- Borttaget: `#bridgeNamn`-div, `.brygga-input`-stilar, `saveBridgeName()`-funktion

## v4.5 – 2026-06-23
- Media query `@media (max-width: 389px)` för smala mobilskärmar (iPhone SE 375px och liknande)
- Hastighetsindikatorn krymps från 30px till 22px, klockan från 22px till 18px, titelfonten från 16px till 14px
- Header-padding minskas till 8px 10px, knapp-padding och gap i `hdr-mid` reduceras
- Lägestext ("Testläge 🧪") döljs i sync-raden på smala skärmar — läget syns redan via ikonen
- Påverkar inte Galaxy Tab A8 eller bredare skärmar

## v4.4 – 2026-06-23
- Dold debug-panel tillagd: visas när användaren trycker fem gånger snabbt på versionsnumret i headern
- Panelen visar de senaste 200 loggmeddelandena med tidsstämpel HH:MM:SS, rullar automatiskt till botten
- `console.log` wrappas globalt vid appstart – alla befintliga loggutskrifter syns i panelen utan kodändringar
- Panelen har "Rensa"- och "Stäng"-knappar; är helt dold i normalläge och påverkar inte prestanda

## v4.2 – 2026-06-21
- Hastighetsfältet i Firebase döpt om från `avgSpeed` till `avgSpeedKnots`, avrundad till 1 decimal
- `console.log` tillagd vid varje speed-sampl och vid varje Firebase-skrivning för enkel felsökning i DevTools
- Firebase-lyssnaren läser nu `avgSpeedKnots` från turer-noden
- Avgångsloggen visar `"2.8 kn"` om värde finns, annars `"— kn"` (tidigare tomt)

## v4.1 – 2026-06-21
- Avgångsloggen visar nu alla 10 rader utan klippning; `overflow: hidden` borttaget från `#departureLog` – loggen tar den höjd den behöver och sidan scrollar naturligt via `.view { overflow-y: auto }`

## v4.0 – 2026-06-21
- Avgångsloggen komprimerad: padding 3px 10px, font-size 11px, gap 5px, min-height 26px per rad – alla 10 rader ryms utan scroll på mobilskärm i portrait; `overflow: hidden` ersätter scroll
- Bugg fixad: snitthastighet loggades inte tillförlitligt – `pos.coords.speed` är null på många Android-enheter, vilket ledde till tidig `return` och inga sparade samplar
  - Rotorsak: `pos.coords.speed` är frivillig i Geolocation API:et och returneras som `null` av många Android-enheters GPS-chip. Den tidigare `if (speed === null || speed === undefined) return` låg längst upp i callbacken, före pushen till `tripSpeedSamples`, så arrayen fylldes aldrig på dessa enheter.
- Ny struktur för hastighetssampling: samplar samlas vid varje watchPosition-callback *innan* null-check och warmup-guard; endast positiva värden (> 0) sparas; warmup-spärren blockerar bara avgångsdetektering, inte sampling
- Ny funktion `finalizeCurrentTripSpeed()`: beräknar snitt av insamlade samplar och skriver `avgSpeed` till Firebase; anropas både vid ny GPS-avgångsdetektering och i `stopGpsWatch()` (sista turen för dagen skrivs nu alltid)

## v3.9 – 2026-06-21
- Avgångsloggen visar nu de 10 senaste avgångarna (tidigare 5); loggen scrollar vertikalt om den inte ryms på skärmen (`max-height: 320px; overflow-y: auto`)
- Varje rad i avgångsloggen har en ✕-knapp som tar bort just den avgången från Firebase och lokalt – inte bara senaste; ny funktion `deleteDeparture(tripId)` hanterar borttagning av godtycklig avgång
- `undoLastDeparture()` använder nu `deleteDeparture()` internt för att undvika kodduplicering
- Bugg fixad: snitthastighet skrevs inte för tomturer om inga samplar översteg GPS_SPEED_THRESHOLD; åtgärd: faller tillbaka på alla samplar (inte bara "rörliga") om inga rörliga samplar finns – avgångar utan fordon får alltid snitthastighet skriven till Firebase om GPS-data finns
  - Rotorsak: finaliseringskoden filtrerade `tripSpeedSamples` med `s => s >= GPS_SPEED_THRESHOLD` och skrev till Firebase endast om `moving.length > 0`. En tomtur med samplar under 1 m/s — t.ex. lugnt hav, kort dockningstid eller GPS-noise — fick aldrig något hastighetsfält skrivet.

## v3.8 – 2026-06-21
- Hastighetsindikatorn flyttad från hdr-sync till hdr-mid (centrerat i headern, mellan språkflaggan och lägesikonen)
- Stor siffra: font-size 30px, font-weight 800, tabular-nums
- Färgkodning efter hastighet i knop: grå < 0.05 kn (stillastående), vit < 1.0 kn, grön 1.0–3.0 kn, gul > 3.0 kn
- Visas bara i Färjeläge; döljs i Testläge via `applyMode()`; nollställs till grå "0.0 kn" när GPS stoppas
- Borttaget: det gamla `·`-separatorelementet och `#gpsSpeed`-spann i hdr-sync

## v3.7 – 2026-06-21
- Bugg fixad: byte till väderfliken registrerade en falsk avgång i Färjeläge; åtgärd: GPS-positionen cachas i `lastKnownGpsPos` vid varje watchPosition-uppdatering och används direkt i `loadWeather` utan nytt geolokaliserings-anrop
  - Rotorsak: `loadWeather()` anropade `navigator.geolocation.getCurrentPosition()` i Färjeläge för att hämta koordinater till väder-API:et. På många mobila webbläsare levererar detta anrop svaret via samma interna GPS-kö som `watchPosition`, vilket utlöste departure-callbacken. Om färjan rörde sig och minst 5 minuter hade passerat sedan senaste avgång registrerades en falsk avgång.
- Ångra avgång nu tillgänglig i Färjeläge: ett diskret ✕-knappar läggs till på senaste raden i avgångsloggen; anropar samma `undoLastDeparture()`-funktion som Testläget; tar bort avgången från Firebase och lokalt utan bekräftelsemodal
- Bugg fixad: `undoLastDeparture()` nollställer nu `lastDepartureFbKey`/`lastDepartureFbDate` efter borttagning
  - Rotorsak: `finalizeCurrentTripSpeed()` använde `lastDepartureFbKey` utan att kontrollera om den posten fortfarande existerade. Firebase `.update()` på en raderad sökväg skapar ett nytt minimalt fragment — `{avgSpeed: X}` utan `ts` — som hamnade kvar permanent i databasen.

## v3.6 – 2026-06-21
- Realtidshastighet i headern: visar aktuell fart i knop bredvid GPS-noggrannhetsindikatorn (`3.2 kn`); uppdateras vid varje GPS-callback; visar `0.0 kn` vid stillastående; döljs tillsammans med noggrannhetsindikatorn när GPS är inaktiv eller Testläge är aktivt
- Separator `·` mellan noggrannhets- och hastighetsvisning i headern
- Snitthastighet per tur: hastighetssamplingar samlas efter varje avgång; vid nästa avgång beräknas snitt för rörliga samplar (fart ≥ GPS_SPEED_THRESHOLD); snitthastigheten sparas som `avgSpeed` i Firebase under `turer/DATUM/PUSHKEY` via `.update()`
- Avgångsloggen visar nu hastigheten per rad: `09:39  Utö → Pettu  2 fordon  2.8 kn`; tomturer och avgångar utan hastighetsdata lämnar hastighetsfältet tomt
- `recordDeparture` fångar nu Firebase push-nyckeln och sparar den i `lastDepartureFbKey`/`lastDepartureFbDate` för uppdatering vid nästa avgång

## v3.5 – 2026-06-21
- GPS-noggrannhetsindikator i headern (bredvid synkpricken): färgad prick + siffra i meter
- Grön < 10 m, gul 10–30 m, röd > 30 m; uppdateras vid varje GPS-callback
- Visas bara i Färjeläge; döljs automatiskt när GPS stoppas eller läge byts till Testläge

## v3.3 – 2026-06-21
- **Avgångsfönster ±3 min**: `TRIP_VEHICLE_WINDOW_MS = 3 min`; fordon kopplas till närmaste avgång inom ±3 min (inte bara strikt före)
- **Brygginlärning via k-means (k=2)**: GPS-position sparas till Firebase `bryggor/positioner/` vid varje GPS-detekterad avgång; efter 3+ positioner klustreras de automatiskt i Brygga A och Brygga B; klustercentrum sparas i `bryggor/centrum/`
- **Riktning per avgång**: avgångsposter i Firebase `turer/DATUM/` får `lat`, `lng`, `from` och `to`; riktning beräknas mot närmaste klustercenter vid avgångstidpunkten
- **Namngivning av bryggor**: två textfält i Räkna-vyn (synliga i Färjeläge) ger `Brygga A ↔ Brygga B`; sparas i Firebase `bryggor/namn/`; stöder t.ex. "Pettu" och "Utö"
- **Avgångslogg**: de 5 senaste avgångarna visas ovanför footern i Räkna-vyn (bara i Färjeläge); varje rad: `HH:MM  Från → Till  N fordon`; tomturer markeras i rött; uppdateras live via Firebase-lyssnaren
- OBS: lägg till `bryggor` i Firebase Realtime Database-reglerna med `.read: true, .write: true`

## v3.2 – 2026-06-21
- Bugg fixad: avgångar dubbelräknades (Firebase visade 5, appen visade 10)
- Rotorsak: `recordDeparture()` skapade en optimistisk lokal kopia (`d.trips.push()`) innan Firebase-lyssnaren hunnit ersätta localStorage, vilket ledde till att lokal och Firebase-data ackumulerades i stället för att den ena ersatte den andra
- Lösning: `recordDeparture()` skriver nu bara till Firebase (`ref.set({ts})`); `tripsRef.on('value')`-lyssnaren är ensam källa för `d.trips` i localStorage (den ersätter alltid – `d.trips = trips`, aldrig push)
- Firebase SDK:n triggar lyssnaren för sin lokala cache omedelbart, även offline, så ingen optimistisk lokal skrivning behövs
- Offline-läget (`!db`) behåller lokal push som fallback

## v3.1 – 2026-06-21
- Bugg fixad: fordonsräkningen nollställdes inte vid midnatt eftersom `logsRef` pekade kvar på gårdagens Firebase-sökväg
  - Rotorsak: `logsRef` initierades en enda gång i `initFirebase()` med `localDate()` vid uppstarten och återanvändes sedan oförändrad i alla skrivanrop. `tripsRef` drabbades inte eftersom avgångsskrivningar alltid använde `db.ref('turer/' + localDate())` — ett nytt datumhämtning vid varje operation.
- Ny funktion `attachListeners()` extraherad från `initFirebase()` för att kunna återanvändas vid datumbyte
- Ny funktion `checkDateRollover()`: om `localDate()` skiljer sig från `currentRefDate` lyfts lyssnarena av gamla sökvägen och kopplas om till dagens sökväg
- `checkDateRollover()` anropas i `tap()`, `removeOne()` och `undoLast()` – precis innan `logsRef` används för skrivning
- `tripsRef` fungerade redan korrekt (avgångar skrevs direkt via `db.ref('turer/' + localDate())`) – nu är `logsRef` konsekvent

## v3.0 – 2026-06-20
- Vindriktningspilarna i väderfliken uppgraderade från 8 Unicode-symboler till kontinuerlig SVG-rotation
- Pilen roteras exakt enligt vindgraden (API-graden + 180° = vindets riktning) utan quantisering till fasta sektorer
- Stöder i praktiken alla 360 grader – inga fasta 16-sektorsgränser behövs med SVG-rotation

## v2.9 – 2026-06-20
- Ny sektion "Avgångsstatistik" i Summering-vyn på alla tre flikar (Idag, Vecka, Månad)
- **Idag**: snitt fordon/avgång, max fordon/avgång, antal tomturer, avgångar per timme
- **Vecka/Månad**: snitt avgångar/dag, snitt fordon/avgång, totalt tomturer
- Ny hjälpfunktion `calcDepartureStats(logs, tripTs)` kopplar ihop fordonsloggar med avgångstidpunkter via binary-search-liknande findIndex
- Ny hjälpfunktion `fetchDayLogsRaw(dStr)` hämtar råa `{type, ts, delta}`-poster från Firebase
- Ny hjälpfunktion `fetchDayTripTs(dStr)` hämtar sorterade avgångstidpunkter från Firebase
- Statistikkortet visas inte alls om det inte finns några avgångar (tomt = inga rader)
- Finska översättningar tillagda för alla sju statistiketiketter

## v2.8 – 2026-06-20
- GPS-avgångsdetektering: ny konstant `GPS_DEPARTURE_GAP_MS = 5 min` förhindrar att hastighetsvariationer under samma tur triggar flera avgångar
- Gapet gäller enbart GPS-detektering i Färjeläge – "Kör tom"-knappen och "Ångra avgång" i Testläge påverkas inte

## v2.7 – 2026-06-20
- Uppvärmningsperiod vid byte till Färjeläge: GPS lyssnar 30 s innan avgångsdetektering aktiveras; headern visar "🛳️ Stabiliserar…" under uppvärmningen och återgår sedan till "Färjeläge 🛳️"
- Ny konstant `GPS_WARMUP_MS = 30000` bland övriga GPS-konstanter
- Konsol-logg vid lägesbyte: "Färjeläge aktiverat – uppvärmning 30s" / "GPS-detektering aktiv" / "Testläge aktiverat"
- Ny knapp "Ångra avgång" i Testläge: tar bort senaste avgången från Firebase och localStorage utan bekräftelsedialog; knappen döljs i Färjeläge och är avaktiverad om inga avgångar finns

## v2.6 – 2026-06-20
- Nedräkningstimer dold i Färjeläge (`updateCountdown` returnerar direkt om `mode === 'ferry'`)
- "Kör tom"-knappen låses inte längre efter avgång i Färjeläge (`updateKorTomLock` hoppar över låslogiken)
- I Testläge fungerar timer och knapp-lås precis som tidigare
- `KORTOM_LOCK_MS`-konstanten behålls men tillämpas bara i Testläge

## v2.5 – 2026-06-20
- Dubbel-avgångsregistrering fixad: GPS och fordonstillägg delar nu på samma avgångslogik istället för att köra parallellt
  - Rotorsak: `tap()` och `watchPosition`-callbacken anropade `recordDeparture()` oberoende av varandra i Färjeläge utan gemensam koordinering. Varje fysisk avgång utlöste därmed båda kodvägarna och skrevs dubbelt till Firebase.
- I Färjeläge registrerar fordonstillägg (`tap()`) inte längre avgång – GPS är primär källa
- I Testläge registrerar fordonstillägg avgång som tidigare (2 min gap-logik)
- "Kör tom" registrerar alltid avgång manuellt oavsett läge
- Ny konstant `GPS_SPEED_THRESHOLD = 1.0` m/s (sänkt från 1.5) bland övriga konstanter

## v2.4 – 2026-06-20
- Åskvarning visar nu exakt klockslag för den första riskiga timmen: "⚡ Åskrisk kl HH:MM" (rött ≤6h, gult ≤12h)
- "tur"/"turer" ersatt med "avgång"/"avgångar" i alla användarvänliga strängar (sv); finska: "ylitys/ylitykset" → "lähtö/lähdöt"
- GPS-avgångsdetektering implementerad i Färjeläge: `navigator.geolocation.watchPosition` startas när Färjeläge aktiveras och stoppas vid byte till Testläge; om farten överstiger 1,5 m/s och senaste aktivitet var ≥ 2 min sedan registreras en avgång automatiskt; debug-meddelanden loggas till konsolen

## v2.3 – 2026-06-20
- Fordonsantal per kategori i statistikvyn (`.cat-count`) visas nu i `var(--text)` istället för kategoriernas egna färger; stapeln behåller sin färg
- Fordonsantal per dag i vecko/månadsvy (`.day-count`) ändrad från blå (#3B82F6) till `var(--text)` för bättre kontrast
- CO2-värde per dag (`.day-co2`) explicit satt till #a0b4cc (ljusare muted)
- Toppimme och fordonsantal i summering (`.peak-val`): `font-weight` höjd till 800, explicit `color: var(--text)`
- Stor totalsiffra (`.total-big`): explicit `color: var(--text)` för att förhindra oavsiktlig opacity-arv

## v2.2 – 2026-06-20
- Alla fontstorlekar ökade proportionerligt för bättre läsbarhet på mobil och surfplatta
- `--muted`-färgen ljusare (#7a90b0 → #a0b4cc) för bättre kontrast mot mörk bakgrund; `.sync-dot.local` uppdaterad till `var(--muted)`
- Väderrader (vindstyrka, byar, temperatur, riktning) betydligt större text
- Åskvarning visar nu *när* risken inträffar (istället för bara ja/nej):
  - Rödikon + röd banner om åsk­risk inom 6 timmar
  - Gul ikon + gul banner om risk inom 12 timmar
  - Tidpunkt visas som "närmaste 2 timmarna", "om ca X timmar" eller "ikväll/imorgon kl HH:00"
  - Ingen varning om risken är mer än 24 timmar bort
- Scanning utökad till 24 h (var 12 h)

## v2.0 – 2026-06-20
- Utökad väderprognosvy från 12 till 48 timmar
- Åskvarning baserad på CAPE (Convective Available Potential Energy): om CAPE ≥ 500 J/kg inom närmaste 12 h visas en blinkande ⚡-ikon i headern och en röd varningsbanner i väderfliken
- `cape` tillagd som Open-Meteo-parameter vid sidan av vind och temperatur

## v1.9 – 2026-06-20
- Vindriktningstypografin korrigerad 180° (API-grader anger varifrån vinden blåser, inte vart den blåser)
- Etiketter tillagda i varje väderrad: "Vind: X m/s" och "Byar: X m/s" på svenska / "Tuuli" och "Puuskat" på finska
- Temperatur per timme tillagd i väderraderna (🌡️ X°C) via `temperature_2m` i API-anropet

## v1.8 – 2026-06-20
- Badges på fordonsknapparna visar nu antal för pågående tur (räknar log-poster sedan senaste avgång); faller tillbaka på dagstotal när ingen tur är aktiv
- "Kör tom"-knappen döljs i Färjeläge (GPS sköter turdetektering automatiskt) och visas i Testläge

## v1.7 – 2026-06-20
- Färjeläge / Testläge-toggle tillagd i headern (🛳️ / 🧪), sparas i localStorage
- I Testläge är auto-turdetektering avstängd; avgångar registreras manuellt via "Kör tom"
- Aktivt läge visas som etikett bredvid synkpricken
- Ny väder-flik (🌬️) med vindprognos för kommande 12 h från Open-Meteo API
- Vinddata per timme: hastighet (m/s), vindbyar (m/s), riktningspil och färgkodad vänsterkant
  - Färgskala: grön 0–3, gul 3–6, orange 6–9, röd 9–12, mörkröd 12+ m/s
- GPS-position används i Färjeläge; Nummela (60.3333, 24.3333) som fallback i Testläge
- Väderdata uppdateras automatiskt var 30:e minut

## v1.6 – 2026-06-19
- Bugg fixad: på Android/Chrome detekterades inte ny tur automatiskt om appen hade pausats (localStorage var tom när Firebase-lyssnaren ännu inte hunnit ladda data)
  - Rotorsak: turdetekteringen läste `lastActivityTs()` ur `d.trips` i localStorage. Android pausar Chrome aggressivt och rensar ofta processens minne; vid återaktivering var localStorage ännu inte ifyllt av Firebase-lyssnaren, `lastActivityTs()` returnerade null och tolkades som "ingen tidigare aktivitet" — nästa fordonstillägg skapade en ny tur i stället för att fortsätta den pågående.
- Turdetekteringsgräns sänkt från 7 min till 2 min inaktivitet
- Nedräkningstimer sänkt från 5 min till 2 min

## v1.5 – 2026-06-17
- Elfärje-CO2-raden visar nu hur många elfärjetur (à 0,1 kg CO2) som motsvarar dagens totala dieselutsläpp
- Format: "🔋 Elfärja: samma CO2 räcker till X turer (uppskattat)"

## v1.4 – 2026-06-17
- Elfärje-CO2-raden omformad till km-jämförelseformat (samma layout som ICE- och EL-raderna)

## v1.3 – 2026-06-17
- Ny CO2-jämförelsepost tillagd i Summering: hypotetisk elfärja (0,1 kg CO2/tur, uppskattat)

## v1.2 – 2026-06-17
- Versionsnummer visas i headern bredvid synkpricken (· v1.x)
- Nedräkningstimer visas ovanför footern efter varje registrerad avgång

## v1.1 – 2026-06-17
- Intern testversion för att verifiera att pre-commit hook för versionsnumrering fungerade

## v1.0 – 2026-06-17
- Versionshantering introducerad: `APP_VERSION`-konstant och automatisk ökning (+0.1) via git pre-commit hook
- Firebase-kontroll av `config/version` vid start: om servervärdet skiljer sig visas en uppdateringsbanner med "Ladda om"-knapp

## Tidig utveckling – 2026-06-15 till 2026-06-17

Funktioner tillagda innan versionshanteringen infördes:

- **Grundläggande räknare** (2026-06-15): nio fordonskategorier (Personbil, Paketbil, Lastbil, Traktor, Cykel, MC, Fotgängare, Moped, Fyrhjuling), tryck för att räkna, mobilanpassad layout
- **Finska etiketter och ljudåterkoppling** (2026-06-16): finska fordonsnamn på knapparna, klickljud vid tryck via WebAudio API
- **Firebase Realtime Database-synk** (2026-06-16): live-synkronisering mellan enheter, delta-baserad event sourcing (`delta: 1` / `-1`), synkstatusindikator (prick + text)
- **SVG-timdiagram** (2026-06-16): mjuk kurvgraf med Catmull-Rom-interpolation ersatte stapellista
- **Historikflikar** (2026-06-16): Summering-vyn fick flikarna Idag / Vecka / Månad med aggregerad data från Firebase
- **Lång tryckning för att ångra** (2026-06-16): håll ned en fordonsknapp för att ta bort en räkning
- **Automatisk turdetektering och CO2-spårning** (2026-06-16): ny tur registreras automatiskt när en fordon läggs till efter ≥ 7 min paus; CO2-beräkning (8,7 kg/tur) visas i Summering
- **Språkväxling svenska / finska** (2026-06-17): 🇸🇪/🇫🇮-knapp i headern, sparas i localStorage; CSS-klass `body.lang-fi` växlar etikettprioritering utan att DOM:en byggs om
- **CO2-jämförelse två rader** (2026-06-17): 🚗 ICE (0,12 kg/km) och ⚡ EL (0,02 kg/km) visas som separata rader i Summering
