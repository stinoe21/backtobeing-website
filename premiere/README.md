# Première · inschrijvingen

`premiere.html` (in de root, live op `/premiere`) is één scherm: de aankondiging
van de première in november en een formulier om je aan te melden.

## Waar de data heen gaat

Google Sheet "Première inschrijvingen":
https://docs.google.com/spreadsheets/d/14wJ1cTU1kKhApDBKljp58i5_3GTCEqmFmf7F6IFZVQE/edit

Kolommen in rij 1 (de veldnamen in het formulier zijn hier exact gelijk aan):

```
Voornaam | Achternaam | Mailadress | Aantal personen | Naam persoon (extra 1) | Naam persoon (extra 2) | Naam persoon (extra 3) | Naam persoon (extra 4)
```

Het script zet er zelf `Taal` en `Ingeschreven op` achter zodra de eerste
inschrijving binnenkomt. Kolommen mogen van plek wisselen: het script zoekt op
naam in rij 1.

## Hoe een inschrijving loopt

1. Het formulier POST een JSON-body naar `INSCHRIJF_URL` (bovenaan het script in
   `premiere.html`).
2. `apps-script.gs`, gedeployed als web-app aan de sheet, valideert de velden,
   controleert of het mailadres nieuw is en of de limiet niet bereikt is, schrijft
   dan een nieuwe rij en stuurt de bevestigingsmail (NL of EN, zie hieronder)
   vanuit het Google-account dat het script deployt.
3. De pagina toont de bedanktekst zodra het script `{ ok: true }` terugstuurt.

## ⚠️ Delen van de sheet: altijd op "Beperkt"

De sheet bevat namen en mailadressen. Het sheet-ID staat in dit bestand en in
`apps-script.gs`, en deze repo is publiek. Staat de sheet op "Iedereen met de
link", dan kan iedereen de hele lijst downloaden.

Zet daarom in de sheet **Delen → Algemene toegang → Beperkt** en nodig alleen
Stijn en Max persoonlijk uit. Het script draait als de eigenaar ("Execute as: Me")
en heeft de linkdeling niet nodig; het formulier blijft gewoon werken.

## Dubbele aanmeldingen en beveiliging

Het script antwoordt met `{ ok: true }` of met `{ ok: false, code }`. De pagina
toont bij elke code een eigen melding:

| code | wanneer | wat de bezoeker ziet |
| --- | --- | --- |
| `bestaat` | het mailadres staat al in de sheet | "Je staat al op de lijst", met het contactadres voor wijzigingen en een link om een ander adres te gebruiken |
| `druk` | meer dan `MAX_PER_VENSTER` verzoeken in `VENSTER_MINUTEN`, of het slot is 8 s bezet | "Het is nu erg druk, probeer het over een paar minuten opnieuw" |
| `vol` | `MAX_TOTAAL_PERSONEN` zou worden overschreden | "De lijst is vol", met het contactadres voor de wachtlijst |
| `ongeldig` | naam of mailadres ontbreekt, of de body is te groot | de gewone veldmelding |

Bij geen van deze codes wordt er een rij geschreven of een mail gestuurd.

Instellingen bovenaan `apps-script.gs`:

- `MAX_PER_VENSTER = 50` en `VENSTER_MINUTEN = 10`: hooguit 50 verzoeken per tien
  minuten. Elk verzoek telt mee, ook een dubbele. De teller staat in de
  script-cache en wordt alleen binnen het slot gelezen en opgehoogd.
- `MAX_TOTAAL_PERSONEN = 70`: plafond op het totaal aantal personen (hoofdpersoon
  plus extra's), nu de zaalcapaciteit. `0` zet het plafond uit. Testrijen in de
  sheet tellen ook mee, dus gooi die weg.

Let op: wie een mailadres intypt dat al op de lijst staat, krijgt dat te zien. Dat
is de bedoeling, maar het betekent ook dat iemand kan nagaan of een bepaald adres
is aangemeld.

De logica is lokaal te testen zonder Google: zie `test-apps-script.js`
(`node premiere/test-apps-script.js`).

## Inrichten (eenmalig, ~5 minuten)

1. Open de sheet → **Extensions → Apps Script**.
2. Vervang de inhoud van `Code.gs` door `apps-script.gs` → Save.
3. **Deploy → New deployment** → type **Web app** → *Execute as: Me* ·
   *Who has access: Anyone* → Deploy → toestemmingen toestaan.
4. Kopieer de **Web app URL** (eindigt op `/exec`) en zet die in `premiere.html`
   bij `INSCHRIJF_URL`.
5. Test via de pagina met je eigen mailadres: rij in de sheet en mail in je inbox.
   Of run in Apps Script de functie `testInschrijving`.

Wijzig je het script later, dan moet je opnieuw deployen:
**Deploy → Manage deployments → potlood → Version: New version → Deploy.**

## Spam

Het formulier heeft een verborgen veld `website`. Vult een bot dat in, dan toont
de pagina de bedanktekst zonder dat er iets in de sheet komt.

## Bevestigingsmail

Na elke geslaagde aanmelding stuurt het script direct een HTML-mail vanuit het
Google-account dat het script deployt (afzendernaam `AFZENDER_NAAM`). De ontwerpen
staan in Figma, frames `back-to-being-mailing-nl` en `back-to-being-mailing-en`:
- NL: https://www.figma.com/design/sAa0ga3n6JuO2OyhgKcuqp/Untitled?node-id=6-5
- EN: https://www.figma.com/design/sAa0ga3n6JuO2OyhgKcuqp/Untitled?node-id=15-57

- De taal volgt de kolom `Taal` (de taalknop op de pagina): `nl` krijgt de
  Nederlandse mail, `en` de Engelse.
- Placeholders: `{{naam}}` is de voornaam in de aanhef en de volledige naam op het
  kaartje "Aanmeldingsgegevens"; `{{aantal_personen}}` is het aantal uit het
  formulier. Namen worden HTML-veilig gemaakt.
- Elke mail heeft ook een platte-tekstversie voor clients zonder HTML.
- Teksten, kleuren en links staan bovenaan het mailgedeelte van `apps-script.gs`
  (`MAIL_TEKST`, `MAIL_KLEUR`, `MAIL_LINKS`). "Voorkeuren aanpassen" is een
  mailto naar het contactadres; er is geen voorkeurenpagina.
- Lettertypes (Instrument Serif, Inter) laden via Google Fonts. Gmail toont in
  plaats daarvan Georgia en Arial; de opmaak blijft verder gelijk.

Lokaal bekijken zonder te versturen: `node premiere/test-apps-script.js` test de
inhoud; wil je de mail zien, run dan in Apps Script `testMail` (stuurt de
Nederlandse versie naar jezelf, zonder rij in de sheet).

## Bevestigingsmail controleren

Het antwoord van het script zegt of het versturen gelukt is. Het antwoord is
`{ ok: true, mail: true }`, of `{ ok: true, mail: false, mailFout: "..." }`.
De aanmelding staat in beide gevallen in de sheet.

Komt er geen mail aan, run dan in Apps Script de functie **`testMail`**. Die
stuurt de echte bevestigingsmail één keer naar jezelf, zonder iets in de sheet te
zetten. Ontbreekt de toestemming om te mailen, dan vraagt Google er op dat
moment om; elke andere fout staat in het Execution log. Daarna opnieuw deployen als New version.

## Mailquota

`MailApp` mag vanuit een gewoon Gmail-account 100 mails per dag sturen, vanuit
Google Workspace 1500. Genoeg voor een première; zet anders `STUUR_BEVESTIGING`
op `false` in het script.
