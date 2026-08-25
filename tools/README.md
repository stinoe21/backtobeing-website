# Camino-blog: runbook

De pagina staat op **backtobeing.tech/volg** (`volg.html` in de root). Alles wat
hij toont komt uit `data/camino-log.json`. Er draait niets server-side: pushen
naar `main` is publiceren.

Deze map wordt **niet** gedeployed (staat in `.vercelignore`).

---

## Waarom een Garmin-export en niet de Strava API

Sinds 1 juni 2026 vereist de Strava API een betaald abonnement, ook om je
**eigen** activiteiten te lezen. Er is geen uitzondering voor hobbyprojecten.

Garmin Connect laat elke activiteit wel gratis exporteren. Geen sleutels, geen
abonnement, geen externe dienst die kan omvallen terwijl jullie in Galicië
lopen.

**Exporteer TCX, niet GPX.** Een GPX is puur een lijst coördinaten en bevat
geen enkele samenvatting, dus dan tellen wij de afstand zelf uit de punten op.
Een TCX draagt Garmin's eigen `TotalTimeSeconds` en `DistanceMeters` per lap,
en die nemen we letterlijk over.

Dezelfde testwandeling in beide formaten:

| | TCX (Garmin) | GPX (zelf berekend) |
|---|---|---|
| Afstand | 24,0 km | 24,4 km |
| Tijd | 4u37m | 4u32m |
| Hoogte | 66 hm | 66 hm |

De tijd is het duidelijkste verschil: Garmin telt per lap en laat een pauze
eruit. Wij zien een pauze alleen als een gat in de tijdstempels en moeten
gokken waar die begint.

GPX werkt gewoon; het script meldt dan dat de cijfers berekend zijn.
Hoogtemeters berekenen we in beide gevallen zelf: die staan in geen van beide
formaten als totaal.

---

## Eenmalig, vóór vertrek

1. **Dependencies installeren** (doe dit thuis, niet op hotelwifi: `sharp`
   downloadt een platform-specifieke binary)
   ```
   cd tools
   npm install
   ```

2. **Optioneel: automatische Engelse vertaling.** Wil je die, kopieer dan
   `tools/.env.example` naar `tools/.env` en zet er je `ANTHROPIC_API_KEY` in
   (van https://platform.claude.com). Zonder key blijft `tekst_en` leeg en
   toont de Engelse pagina het Nederlands, met de melding dat het nog niet
   vertaald is. Zonder `.env` werkt alles verder gewoon.

3. **Droogloop.** Loop een rondje met de Garmin, exporteer de TCX en draai het
   hele pad één keer echt. Zie hieronder.

---

## Even kijken hoe het eruit gaat zien

Wil je de pagina zien zoals hij onderweg wordt, zonder te wachten tot je in
Portugal staat:

```
node tools/demo.mjs aan 3     zet demo-invoer klaar voor dag 1 t/m 3
.\dag.cmd 1 --skip-vertaling
npx serve .                   en dan http://localhost:3000/volg
node tools/demo.mjs uit       alles weer weg
```

`demo.mjs` maakt alleen **invoer** aan: een TCX die de geplande etappe volgt,
een stuk tekst en een paar foto's die al in de repo staan. Daarna draai je het
gewone dagcommando, dus je test de echte keten en geen namaakversie ernaast.

`uit` verwijdert precies de bestanden die `aan` heeft aangemaakt (die lijst
staat in `data/.demo.json`) en haalt alleen die dagen uit het logboek. Wat jij
zelf hebt neergezet blijft staan.

**Zet de demo uit voor je pusht.** Anders staan er verzonnen dagen live.

---

## Elke avond onderweg

1. **Exporteer het spoor.** Garmin Connect (app of web) → de activiteit van
   vandaag → tandwiel rechtsboven → **Export to TCX**.
   Zet het bestand neer als `data/sporen/dag-3.tcx`.

   Staat hij nog in je Downloads onder een naam als `activity_1234.tcx`, dan
   kun je hem ook zo aanwijzen:
   ```
   .\dag.cmd 3 --spoor C:\Users\stijn\Downloads\activity_1234.tcx
   ```

2. Schrijf je verhaal in `data/teksten/dag-3.md`:
   ```markdown
   # De regen van Redondela

   Eerste alinea.

   Tweede alinea.
   ```
   De `#`-regel wordt de titel. Lege regel tussen alinea's.

3. Zet de foto's van die dag in `photos-origineel/dag-3/`
   (die map blijft lokaal; alleen de verkleinde versies gaan mee in git).
   Een video (`.mp4`/`.mov`) mag er gewoon tussen: hij wordt verkleind tot
   720p (ffmpeg komt mee met `npm install`) en krijgt een poster-beeld;
   op de site speelt hij af zodra je hem groot opent.

4. Draai vanuit de projectroot:
   ```
   .\dag.cmd 3
   ```

5. Committen en pushen (het script print deze regels ook):
   ```
   git add data photos
   git commit -m "Voeg dag 3 toe aan de Camino-blog"
   git push
   ```

Binnen een minuut staat het live.

---

## Opties

| Commando | Wat het doet |
|---|---|
| `.\dag.cmd 3` | alles: route, foto's, vertaling |
| `.\dag.cmd 3 --alleen-fotos` | werkt offline, alleen foto's verwerken |
| `.\dag.cmd 3 --skip-route` | tekst en foto's, geen routegegevens |
| `.\dag.cmd 3 --skip-vertaling` | geen Engelse vertaling |
| `.\dag.cmd 3 --spoor <pad>` | TCX of GPX ergens anders vandaan halen |
| `.\dag.cmd 3 --forceer` | foto's opnieuw verwerken, opnieuw vertalen |

---

## Als er iets misgaat

Het script is **idempotent**: opnieuw draaien is altijd veilig en overschrijft
nooit je eigen tekst. Elke stap faalt apart, de rest gaat door.

| Melding | Wat te doen |
|---|---|
| `geen spoor gevonden voor dag N` | Exporteer hem uit Garmin Connect, of wijs hem aan met `--spoor <pad>`. |
| `geen trackpunten gevonden` | Je hebt een route- of waypoint-bestand geëxporteerd in plaats van een activiteit. |
| `het bestand bevat geen tijd` | Kan bij sommige exports. De site toont dan afstand en hoogte, geen looptijd. |
| `Garmin meldt N% meer/minder afstand` | Garmins afstand wijkt af van wat uit de GPS-punten volgt. Bij een tunnel of slecht bereik is dat normaal; Garmin vult die gaten met de versnellingsmeter. |
| `vertaling mislukt` | Geen probleem, de site toont Nederlands met een melding. Later `.\dag.cmd 3` opnieuw. |
| `sharp is niet geinstalleerd` | `cd tools && npm install` |
| Geen internet | `--alleen-fotos`, of gewoon `.\dag.cmd 3 --skip-vertaling`: het spoor is een lokaal bestand, dus route en foto's werken offline. Lokaal committen, pushen als er wifi is. Meerdere dagen tegelijk pushen mag. |

Een dag die ontbreekt is geen probleem: de pagina toont wat er is. Een dag
zonder spoor krijgt geen cijfers, maar de kaart vult het gat op met de geplande
etappe zodat de lijn doorloopt.

---

## Waar staat wat

| Bestand | Rol |
|---|---|
| `volg.html` | de pagina zelf, standalone |
| `data/camino-route.json` | de geplande route (19 punten, 6 etappes), van Valença naar Santiago. Spiegelt `caminoRoute`/`caminoStages` in `index.html`, **maar die begint nog in Tui** en schrijft plaatsnamen zonder accenten: bij een wijziging beide bijwerken. |
| `data/camino-log.json` | het logboek, met de hand bewerkbaar |
| `data/sporen/dag-N.tcx` | de ruwe export uit Garmin Connect (wel in git, niet gedeployed) |
| `data/teksten/dag-N.md` | jouw ruwe tekst (wordt niet gedeployed) |
| `photos-origineel/dag-N/` | onbewerkte telefoonfoto's (niet in git) |
| `photos/dag-N/` | verkleinde webp's, EXIF en GPS gestript (wel in git); video's als 720p-mp4 met een poster-webp ernaast |

---

## Let op

- **Foto's worden gestript.** `sharp` gooit alle metadata weg, inclusief de
  GPS-coördinaten van waar de foto genomen is. Dat is bewust.
- **De GPS-tracks staan wel publiek.** Daarmee is zichtbaar waar jullie elke
  avond gestopt zijn. Wil je dat niet, publiceer een dag dan pas de ochtend
  erna.
- **Hoogtemeters zijn een schatting.** Een GPS-hoogte schommelt per meting, en
  die ruis optellen geeft een veel te hoog getal. `lib/gpx.mjs` strijkt de
  reeks daarom eerst glad en telt pas daarna, met een drempel van 3 meter. Bij
  een test met ruis van ±2 m gaf de ongefilterde methode 404 hm waar het
  antwoord 60 was; met filter komt er 62 uit. Garmin telt op zijn eigen manier,
  dus verwacht kleine verschillen met wat je horloge zegt.
- **`tools/.env` mag nooit in git.** Gecontroleerd met
  `git check-ignore -v tools/.env`.
