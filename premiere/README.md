# Première · inschrijvingen met wachtrij

`premiere.html` (in de root, live op `/premiere`) is één scherm: de aankondiging
van de première in november en een formulier om je aan te melden. Wie zich
aanmeldt komt in de **wachtrij**; jij keurt in de sheet goed wie erbij is.

## Waar de data heen gaat

Google Sheet "Première inschrijvingen":
https://docs.google.com/spreadsheets/d/14wJ1cTU1kKhApDBKljp58i5_3GTCEqmFmf7F6IFZVQE/edit

Kolommen in rij 1 (de veldnamen in het formulier zijn hier exact gelijk aan):

```
Voornaam | Achternaam | Mailadress | Aantal personen | Naam persoon (extra 1) | Naam persoon (extra 2) | Naam persoon (extra 3) | Naam persoon (extra 4)
```

Het script zet er zelf `Taal`, `Ingeschreven op`, `Status`, `Goedkeuren` en
`Goedgekeurd op` achter. Kolommen mogen van plek wisselen: het script zoekt op
naam in rij 1.

## Hoe een aanmelding loopt

1. Het formulier POST een JSON-body naar `INSCHRIJF_URL` (bovenaan het script in
   `premiere.html`).
2. `apps-script.gs`, gedeployed als web-app aan de sheet, valideert de velden,
   controleert of het mailadres nieuw is en of de limiet niet bereikt is, schrijft
   dan een nieuwe rij met **Status `Wachtrij`** en een leeg vinkje in
   **`Goedkeuren`**, en stuurt de wachtrij-mail ("je aanmelding is ontvangen, je
   hoort van ons").
3. De pagina toont "Je staat in de wachtrij" zodra het script `{ ok: true }`
   terugstuurt.

## Wachtrij: goedkeuren in de sheet

- **Vink `Goedkeuren` aan** bij een rij. Het script zet dan `Status` op
  `Goedgekeurd`, vult `Goedgekeurd op` en stuurt de bevestigingsmail "je bent
  erbij" in de taal van de aanmelding.
- **Past de groep niet meer** (het totaal aan goedgekeurde personen zou boven
  `MAX_TOTAAL_PERSONEN` = 70 komen), dan gaat het vinkje vanzelf weer uit, de rij
  blijft `Wachtrij` en je ziet rechtsonder een melding met hoeveel plekken er
  nog zijn.
- **Vink je het weer uit**, dan gaat de status terug naar `Wachtrij` en wordt
  `Goedgekeurd op` leeggemaakt. De mail die al verstuurd is, gaat natuurlijk niet
  terug; mail die persoon dan zelf even.
- **Meerdere tegelijk**: selecteer de rijen en kies menu **Première →
  Geselecteerde rijen goedkeuren**. Rijen die al goedgekeurd zijn slaat het over.
- Nog eens aanvinken van een goedgekeurde rij stuurt géén tweede mail.
- Lukt de mail niet (quotum op, toestemming weg), dan staat er
  `Goedgekeurd (mail mislukt)` in de statuskolom en de reden in de melding en in
  Executions.

Handig: filter of sorteer op de kolom `Status` om de wachtrij te zien.

## ⚠️ Delen van de sheet: altijd op "Beperkt"

De sheet bevat namen en mailadressen. Het sheet-ID staat in dit bestand en in
`apps-script.gs`, en deze repo is publiek. Staat de sheet op "Iedereen met de
link", dan kan iedereen de hele lijst downloaden.

Zet daarom in de sheet **Delen → Algemene toegang → Beperkt** en nodig alleen
Stijn en Max persoonlijk uit. Het script draait als de eigenaar ("Execute as: Me")
en heeft de linkdeling niet nodig; het formulier blijft gewoon werken.

Let op: de trigger op het vinkje draait ook als jouw account, wie de sheet mag
bewerken kan dus goedkeuren en daarmee mails vanuit jouw account laten sturen.

## Dubbele aanmeldingen en beveiliging

Het script antwoordt met `{ ok: true }` of met `{ ok: false, code }`. De pagina
toont bij elke code een eigen melding:

| code | wanneer | wat de bezoeker ziet |
| --- | --- | --- |
| `bestaat` | het mailadres staat al in de sheet | "Je bent al aangemeld", met het contactadres voor wijzigingen en een link om een ander adres te gebruiken |
| `druk` | meer dan `MAX_PER_VENSTER` verzoeken in `VENSTER_MINUTEN`, of het slot is 8 s bezet | "Het is nu erg druk, probeer het over een paar minuten opnieuw" |
| `vol` | alleen als `MAX_AANMELDINGEN_PERSONEN` aanstaat en overschreden zou worden | "De wachtrij is vol", met het contactadres |
| `ongeldig` | naam of mailadres ontbreekt, of de body is te groot | de gewone veldmelding |

Bij geen van deze codes wordt er een rij geschreven of een mail gestuurd.

Instellingen bovenaan `apps-script.gs`:

- `MAX_PER_VENSTER = 50` en `VENSTER_MINUTEN = 10`: hooguit 50 verzoeken per tien
  minuten. Elk verzoek telt mee, ook een dubbele. De teller staat in de
  script-cache en wordt alleen binnen het slot gelezen en opgehoogd.
- `MAX_TOTAAL_PERSONEN = 70`: de zaalcapaciteit, een plafond op het totaal aantal
  **goedgekeurde** personen (hoofdpersoon plus extra's). Goedkeuren van een groep
  die er niet meer bij past, wordt geweigerd. `0` zet het plafond uit. Testrijen
  die je goedkeurt tellen ook mee, dus gooi die weg.
- `MAX_AANMELDINGEN_PERSONEN = 0`: plafond op álle aanmeldingen (wachtrij plus
  goedgekeurd). Staat uit: de wachtrij is onbeperkt en de pagina meldt nooit "vol".

Let op: wie een mailadres intypt dat al op de lijst staat, krijgt dat te zien. Dat
is de bedoeling, maar het betekent ook dat iemand kan nagaan of een bepaald adres
is aangemeld.

De logica is lokaal te testen zonder Google: zie `test-apps-script.js`
(`node premiere/test-apps-script.js`), inclusief het vinkje, het plafond en het menu.

## Inrichten (eenmalig, ~5 minuten)

1. Open de sheet → **Extensions → Apps Script**.
2. Vervang de inhoud van `Code.gs` door `apps-script.gs` → Save.
3. Kies bovenin de functie **`installeren`** → **Run** → toestemmingen toestaan.
   Dit maakt de kolommen `Status`, `Goedkeuren` en `Goedgekeurd op`, zet vinkjes
   bij bestaande rijen (die komen in `Wachtrij`; vink aan wie er al bij hoort) en
   installeert de trigger die op het vinkje reageert. Herlaad de sheet: het menu
   **Première** staat nu naast Help.
4. **Deploy → New deployment** → type **Web app** → *Execute as: Me* ·
   *Who has access: Anyone* → Deploy.
5. Kopieer de **Web app URL** (eindigt op `/exec`) en zet die in `premiere.html`
   bij `INSCHRIJF_URL`.
6. Test via de pagina met je eigen mailadres: rij met `Wachtrij` in de sheet en de
   wachtrij-mail in je inbox. Vink `Goedkeuren` aan: status `Goedgekeurd` en de
   "je bent erbij"-mail. Of run in Apps Script de functie `testInschrijving`.

Wijzig je het script later, dan moet je opnieuw deployen:
**Deploy → Manage deployments → potlood → Version: New version → Deploy.**
De trigger hoeft niet opnieuw; die wijst naar de functie, niet naar een versie.

Is er bestaande data in de sheet van vóór de wachtrij, dan hebben die mensen de
oude mail "je bent aangemeld" gekregen. Na `installeren` staan ze in `Wachtrij`;
vink ze aan om ze de bevestiging te sturen, of laat ze staan.

## Spam

Het formulier heeft een verborgen veld `website`. Vult een bot dat in, dan toont
de pagina de bedanktekst zonder dat er iets in de sheet komt.

## De twee mails

Beide mails zijn HTML, vanuit het Google-account dat het script deployt
(afzendernaam `AFZENDER_NAAM`), met hetzelfde ontwerp uit Figma, frames
`back-to-being-mailing-nl` en `back-to-being-mailing-en`:
- NL: https://www.figma.com/design/sAa0ga3n6JuO2OyhgKcuqp/Untitled?node-id=6-5
- EN: https://www.figma.com/design/sAa0ga3n6JuO2OyhgKcuqp/Untitled?node-id=15-57

| soort | wanneer | onderwerp (NL) |
| --- | --- | --- |
| `wachtrij` | direct na de aanmelding | "Je aanmelding voor de première van Back to Being is ontvangen" |
| `goedgekeurd` | na het vinkje in de sheet | "Je bent erbij: je plek voor de première van Back to Being is bevestigd" |

- De taal volgt de kolom `Taal` (de taalknop op de pagina): `nl` krijgt de
  Nederlandse mail, `en` de Engelse.
- Placeholders: `{{naam}}` is de voornaam in de aanhef en de volledige naam op het
  kaartje; het aantal personen komt uit de rij. Namen worden HTML-veilig gemaakt.
- Elke mail heeft ook een platte-tekstversie voor clients zonder HTML.
- Teksten staan in `MAIL_TEKST` in `apps-script.gs`: per taal de algemene regels,
  en onder `wachtrij` en `goedgekeurd` onderwerp, preheader, titel, intro en de
  titel van het kaartje. Kleuren en links in `MAIL_KLEUR` en `MAIL_LINKS`.
  "Voorkeuren aanpassen" is een mailto naar het contactadres; er is geen
  voorkeurenpagina.
- Lettertypes (Instrument Serif, Inter) laden via Google Fonts. Gmail toont in
  plaats daarvan Georgia en Arial; de opmaak blijft verder gelijk.

Lokaal bekijken zonder te versturen: `node premiere/test-apps-script.js` test de
inhoud; wil je de mails zien, run dan in Apps Script `testMail` (stuurt beide
Nederlandse versies naar jezelf, zonder rij in de sheet).

## Mail controleren

Het antwoord van het script op een aanmelding zegt of het versturen gelukt is:
`{ ok: true, mail: true }`, of `{ ok: true, mail: false, mailFout: "..." }`.
De aanmelding staat in beide gevallen in de sheet.

Komt er geen mail aan, run dan in Apps Script de functie **`testMail`**. Die
stuurt de twee mails één keer naar jezelf, zonder iets in de sheet te zetten.
Ontbreekt de toestemming om te mailen, dan vraagt Google er op dat moment om;
elke andere fout staat in het Execution log. Daarna opnieuw deployen als New version.

## Mailquota

`MailApp` mag vanuit een gewoon Gmail-account 100 mails per dag sturen, vanuit
Google Workspace 1500. Elke aanmelding kost nu twee mails (wachtrij plus
goedkeuring), dus reken met zo'n 50 aanmeldingen per dag; zet anders
`STUUR_BEVESTIGING` op `false` in het script.
