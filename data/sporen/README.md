# Sporen per dag

Hier komt per loopdag één bestand uit Garmin Connect, met een vaste naam:

```
data/sporen/dag-1.tcx
data/sporen/dag-2.tcx
...
```

`.\dag.cmd 3` pakt automatisch `data/sporen/dag-3.tcx`, en anders `dag-3.gpx`.

## Exporteer TCX, niet GPX

Garmin Connect → de activiteit van die dag → tandwiel rechtsboven →
**Export to TCX**.

Het verschil is niet cosmetisch:

| | GPX | TCX |
|---|---|---|
| Coördinaten | ja | ja |
| Hoogte per punt | ja | ja |
| **Totale afstand** | **nee** | **ja** |
| **Totale tijd** | **nee** | **ja** |

Een GPX is puur een lijst coördinaten; er staat geen enkele samenvatting in.
Dan moeten wij de afstand zelf uit de punten optellen, en dat wijkt af van wat
je horloge zegt. In een TCX staan Garmin's eigen cijfers in `<TotalTimeSeconds>`
en `<DistanceMeters>` per lap, dus dan toont de site precies dezelfde getallen.

Beide formaten van dezelfde testwandeling naast elkaar:

| | TCX (Garmin) | GPX (zelf berekend) |
|---|---|---|
| Afstand | 24,0 km | 24,4 km |
| Tijd | 4u37m | 4u32m |
| Hoogte | 66 hm | 66 hm |

De tijd is het duidelijkste verschil: Garmin telt de tijd per lap en laat een
pauze eruit. Wij zien een pauze alleen als een gat in de tijdstempels en moeten
gokken waar die begint.

Hoogtemeters rekenen we in beide gevallen zelf uit: ook een TCX heeft daar geen
totaal voor.

Een GPX werkt gewoon als je er al een hebt. Het script zegt er dan bij dat de
cijfers door ons berekend zijn.

## Hernoemen

Je krijgt een bestand met een naam als `activity_23743231128.tcx`. Hernoem hem
naar `dag-3.tcx` en zet hem hier neer. Wil je niet hernoemen:

```
.\dag.cmd 3 --spoor C:\Users\stijn\Downloads\activity_23743231128.tcx
```

Dan wordt hij wel gelezen, maar staat het originele spoor nergens bewaard.
Hier neerzetten is netter.

## Waarom ze in git staan maar niet op de site

Dit zijn de ruwe sporen: de bron waar alle cijfers op de pagina uit komen.
Die wil je bewaren. De site heeft ze niet nodig, want de vereenvoudigde
coördinaten staan al in `data/camino-log.json`. Daarom staat `data/sporen/` in
`.vercelignore` en gaat hij niet mee in de deploy.

Reken op ongeveer 2 MB per dag.
