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
   schrijft een nieuwe rij en stuurt een bevestigingsmail (NL of EN) vanuit het
   Google-account dat het script deployt.
3. De pagina toont de bedanktekst zodra het script `{ ok: true }` terugstuurt.

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

## Mailquota

`MailApp` mag vanuit een gewoon Gmail-account 100 mails per dag sturen, vanuit
Google Workspace 1500. Genoeg voor een première; zet anders `STUUR_BEVESTIGING`
op `false` in het script.
