/**
 * Back to Being — inschrijvingen voor de première
 *
 * Hangt aan de spreadsheet "Première inschrijvingen":
 * https://docs.google.com/spreadsheets/d/14wJ1cTU1kKhApDBKljp58i5_3GTCEqmFmf7F6IFZVQE/edit
 *
 * Installeren (eenmalig):
 *   1. Open de sheet → Extensions → Apps Script.
 *   2. Vervang de inhoud van Code.gs door dit bestand → Save.
 *   3. Deploy → New deployment → type "Web app":
 *        Execute as: Me
 *        Who has access: Anyone
 *      → Deploy → sta de toestemmingen toe → kopieer de Web app URL.
 *   4. Plak die URL in premiere.html bij INSCHRIJF_URL.
 *
 * Bij elke wijziging aan dit script: Deploy → Manage deployments → potlood →
 * Version: New version → Deploy. Anders blijft de oude code draaien.
 *
 * Wat het doet bij een POST vanaf premiere.html:
 *   - leest de kolomkoppen uit rij 1 en zet de velden op naam in de juiste kolom
 *     (extra kolommen of een andere volgorde in de sheet zijn dus geen probleem);
 *   - schrijft elke inschrijving als nieuwe rij, ook als het mailadres al voorkomt;
 *   - voegt de kolom "Ingeschreven op" toe als die nog niet bestaat;
 *   - stuurt een bevestigingsmail (NL of EN) vanuit het account dat het script deployt.
 */

const SHEET_ID = '14wJ1cTU1kKhApDBKljp58i5_3GTCEqmFmf7F6IFZVQE';
const TAB_NAAM = ''; // leeg = eerste tabblad
const AFZENDER_NAAM = 'Back to Being';
const STUUR_BEVESTIGING = true;

const VELDEN = [
  'Voornaam',
  'Achternaam',
  'Mailadress',
  'Aantal personen',
  'Naam persoon (extra 1)',
  'Naam persoon (extra 2)',
  'Naam persoon (extra 3)',
  'Naam persoon (extra 4)',
];

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // Honeypot: bots vullen het verborgen veld in. Doe alsof het gelukt is.
    if (data.website) return antwoord({ ok: true });

    const rij = {};
    VELDEN.forEach(k => { rij[k] = String(data[k] || '').trim(); });
    rij['Mailadress'] = rij['Mailadress'].toLowerCase();
    const aantal = Math.min(5, Math.max(1, parseInt(rij['Aantal personen'], 10) || 1));
    rij['Aantal personen'] = aantal;
    // Namen van personen die niet meekomen horen niet in de sheet.
    for (let i = aantal; i <= 4; i++) rij['Naam persoon (extra ' + i + ')'] = '';

    if (!rij['Voornaam'] || !rij['Achternaam'] || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rij['Mailadress'])) {
      return antwoord({ ok: false, fout: 'ongeldige invoer' }, 400);
    }

    const taal = data['Taal'] === 'en' ? 'en' : 'nl';
    rij['Taal'] = taal;
    rij['Ingeschreven op'] = Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'dd-MM-yyyy HH:mm');

    try { schrijfRij(rij); }
    catch (err) { throw new Error('sheet: ' + err); }
    if (STUUR_BEVESTIGING) stuurBevestiging(rij, taal);

    return antwoord({ ok: true });
  } catch (err) {
    console.error(err);
    return antwoord({ ok: false, fout: String(err) }, 500);
  }
}

// Zodat je in de browser kunt zien dat de deployment leeft.
function doGet() {
  return antwoord({ ok: true, info: 'Back to Being première — gebruik POST' });
}

function schrijfRij(rij) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Gebonden aan de sheet: getActive werkt dan altijd, openById is de
    // terugvaloptie als het script los van de sheet is aangemaakt.
    const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SHEET_ID);
    const sheet = TAB_NAAM ? ss.getSheetByName(TAB_NAAM) : ss.getSheets()[0];
    if (!sheet) throw new Error('Tabblad niet gevonden');

    let laatsteKolom = Math.max(1, sheet.getLastColumn());
    let koppen = sheet.getRange(1, 1, 1, laatsteKolom).getValues()[0].map(k => String(k).trim());

    // Ontbrekende koppen (bijv. "Ingeschreven op") achteraan toevoegen.
    Object.keys(rij).forEach(k => {
      if (koppen.indexOf(k) === -1) {
        koppen.push(k);
        sheet.getRange(1, koppen.length).setValue(k);
      }
    });

    const waarden = koppen.map(k => (k in rij ? rij[k] : ''));
    sheet.appendRow(waarden);
  } finally {
    lock.releaseLock();
  }
}

function stuurBevestiging(rij, taal) {
  const naam = rij['Voornaam'];
  const n = rij['Aantal personen'];
  let onderwerp, tekst;
  if (taal === 'en') {
    onderwerp = 'You are on the list for the premiere';
    tekst =
      'Hi ' + naam + ',\n\n' +
      'Thank you for signing up for the premiere of Back to Being in November 2026.\n\n' +
      'We have your name on the list' + (n > 1 ? ' for ' + n + ' people' : '') + '. ' +
      'As soon as the venue and time are set, you will get an email from us.\n\n' +
      'See you in November,\nCaesar, Stijn and Max\nBack to Being';
  } else {
    onderwerp = 'Je staat op de lijst voor de première';
    tekst =
      'Hoi ' + naam + ',\n\n' +
      'Dank voor je inschrijving voor de première van Back to Being in november 2026.\n\n' +
      'Je naam staat op de lijst' + (n > 1 ? ' voor ' + n + ' personen' : '') + '. ' +
      'Zodra de plek en tijd vaststaan, krijg je een mail van ons.\n\n' +
      'Tot in november,\nCaesar, Stijn en Max\nBack to Being';
  }
  try {
    MailApp.sendEmail({ to: rij['Mailadress'], subject: onderwerp, body: tekst, name: AFZENDER_NAAM });
  } catch (err) {
    // De rij staat al in de sheet; een mislukte mail mag de inschrijving niet
    // laten falen. Zie Executions in Apps Script voor de reden.
    console.error('Mail mislukt: ' + err);
  }
}

function antwoord(obj) {
  // Apps Script kan geen HTTP-statuscode zetten; de pagina leest `ok`.
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Handmatige test: Run → testInschrijving. Zet een testrij in de sheet en
 *  vraagt bij de eerste keer om toestemming voor Sheets en Mail. */
function testInschrijving() {
  const e = { postData: { contents: JSON.stringify({
    'Voornaam': 'Test', 'Achternaam': 'Persoon', 'Mailadress': Session.getActiveUser().getEmail(),
    'Aantal personen': '2', 'Naam persoon (extra 1)': 'Tweede Persoon', 'Taal': 'nl'
  }) } };
  console.log(doPost(e).getContent());
}
