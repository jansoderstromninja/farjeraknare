# Färjeräknare

Mobilapp för att räkna fordon ombord på en färja, registrera turer och följa CO2-utsläpp. Byggd för att användas på Android och iOS direkt i webbläsaren – ingen installation krävs.

**Live:** https://jansoderstromninja.github.io/farjeraknare/

---

## Vad appen gör

**Räkna-fliken** – tryck på en fordonsknapp för att lägga till ett fordon i den kategorin. Håll ned för att ta bort ett. Nio kategorier: Personbil, Paketbil, Lastbil, Traktor, Cykel, MC, Fotgängare, Moped, Fyrhjuling.

**Turregistrering** – i Färjeläge registreras en ny avgång automatiskt när ett fordon läggs till efter minst 2 minuters inaktivitet. I Testläge används knappen "Kör tom" för att registrera avgångar manuellt. Badgarna på knapparna nollställs vid varje ny tur och visar antal fordon för pågående tur; footern visar alltid dagens totala antal.

**Statistik-fliken** – stapelgraf per kategori och ett mjukt SVG-timdiagram över trafikflödet under dagen.

**Summering-fliken** – total fordonsräkning, toppimme och CO2-statistik för Idag, senaste 7 dagarna och innevarande månad. CO2-jämförelse visas som tre rader:
- 🚗 ICE: motsvarande km med förbränningsmotor (0,12 kg/km)
- ⚡ EL: motsvarande km med elbil (0,02 kg/km)
- 🔋 Elfärja: antal turer en hypotetisk elfärja (0,1 kg/tur) hade klarat på samma CO2

**Väder-fliken** – 48-timmarsprognos med vindstyrka, vindbyar, vindriktning och temperatur per timme, hämtad från [Open-Meteo](https://open-meteo.com/). Raderna färgkodas efter vindstyrka (grön → gul → orange → röd → mörkröd). Om CAPE ≥ 500 J/kg inom de närmaste 12 timmarna visas en åskvarning med blinkande ⚡ i headern och en röd banner i vädervyn. Väderdata uppdateras automatiskt var 30:e minut.

---

## Lägen

| Läge | Turdetektering | GPS | Kör tom-knapp |
|------|---------------|-----|---------------|
| 🛳️ Färjeläge | Automatisk (2 min gap) | Aktiv (väderprognosposition) | Dold |
| 🧪 Testläge | Manuell | Av (Nummela som fallback) | Synlig |

Växla läge med 🛳️/🧪-knappen i headern. Valet sparas mellan sessioner.

---

## Språk

Svenska (standard) och finska, växla med 🇸🇪/🇫🇮-knappen. Valet sparas i `localStorage`.

---

## Teknisk stack

| Del | Teknik |
|-----|--------|
| Frontend | Vanilla HTML/CSS/JS, ingen byggprocess |
| Hosting | GitHub Pages |
| Databas | Firebase Realtime Database (Europe West 1) |
| Väder-API | Open-Meteo (gratis, ingen API-nyckel) |
| Synk | Delta-baserad event sourcing med optimistiska lokala skrivningar |
| Offline | `localStorage` som primär källa, Firebase som synkad kopia |

All kod finns i en enda fil: `index.html`.

---

## Versionshantering

`APP_VERSION` i `index.html` ökas automatiskt med 0.1 vid varje git commit via `.git/hooks/pre-commit`. Firebase-noden `config/version` kan uppdateras manuellt för att trigga en uppdateringsbanner hos alla aktiva användare.

Se [CHANGELOG.md](CHANGELOG.md) för fullständig versionshistorik.
