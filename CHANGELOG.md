# Changelog

## v3.1 – 2026-06-21
- Bugg fixad: fordonsräkningen nollställdes inte vid midnatt eftersom `logsRef` pekade kvar på gårdagens Firebase-sökväg
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
