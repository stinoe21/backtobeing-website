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
 *   - staat het mailadres al in de sheet, dan komt er géén tweede rij en géén
 *     tweede mail; de pagina meldt dat dit adres al op de lijst staat;
 *   - laat hooguit MAX_PER_VENSTER aanmeldingen per VENSTER_MINUTEN door, zodat een
 *     bot of een stortvloed de sheet en je mailquota niet kan vollopen;
 *   - optioneel een plafond op het totaal aantal personen (MAX_TOTAAL_PERSONEN);
 *   - voegt de kolom "Ingeschreven op" toe als die nog niet bestaat;
 *   - stuurt een bevestigingsmail (NL of EN) vanuit het account dat het script deployt.
 */

const SHEET_ID = '14wJ1cTU1kKhApDBKljp58i5_3GTCEqmFmf7F6IFZVQE';
const TAB_NAAM = ''; // leeg = eerste tabblad
const AFZENDER_NAAM = 'Back to Being';
const STUUR_BEVESTIGING = true;

// Beveiliging tegen een stortvloed: zoveel verzoeken mogen er per tijdvenster
// binnenkomen. Alles daarboven krijgt "het is druk, probeer het zo nog eens".
const MAX_PER_VENSTER = 50;
const VENSTER_MINUTEN = 10;

// Plafond op het totaal aantal personen op de lijst (hoofdpersoon + extra's).
// 0 = geen plafond. Nu de zaalcapaciteit: 200 personen.
const MAX_TOTAAL_PERSONEN = 200;

// Groter dan dit is geen echte aanmelding.
const MAX_BODY_TEKENS = 4000;

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
    const ruw = (e && e.postData && e.postData.contents) || '{}';
    if (ruw.length > MAX_BODY_TEKENS) return antwoord({ ok: false, code: 'ongeldig', fout: 'te groot' });
    const data = JSON.parse(ruw);

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
      return antwoord({ ok: false, code: 'ongeldig', fout: 'ongeldige invoer' });
    }

    const taal = data['Taal'] === 'en' ? 'en' : 'nl';
    rij['Taal'] = taal;
    rij['Ingeschreven op'] = Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'dd-MM-yyyy HH:mm');

    let uitkomst;
    try { uitkomst = schrijfRij(rij); }
    catch (err) { throw new Error('sheet: ' + err); }

    // 'bestaat' | 'druk' | 'vol': niets geschreven, dus ook geen mail.
    if (uitkomst !== 'ok') return antwoord({ ok: false, code: uitkomst });

    // De aanmelding staat; een mislukte mail mag die niet laten falen. Maar stil
    // falen is erger: het antwoord zegt of de mail weg is, en zo niet waarom.
    if (!STUUR_BEVESTIGING) return antwoord({ ok: true, mail: null });
    const mail = stuurBevestiging(rij, taal);
    return antwoord(mail.ok ? { ok: true, mail: true } : { ok: true, mail: false, mailFout: mail.fout });
  } catch (err) {
    console.error(err);
    return antwoord({ ok: false, code: 'fout', fout: String(err) });
  }
}

// Zodat je in de browser kunt zien dat de deployment leeft.
function doGet() {
  return antwoord({ ok: true, info: 'Back to Being première — gebruik POST' });
}

/**
 * Schrijft de rij, tenzij er een reden is om dat niet te doen.
 * Geeft terug: 'ok' | 'bestaat' | 'druk' | 'vol'.
 * Alles gebeurt binnen één slot, zodat twee aanmeldingen op hetzelfde moment
 * niet allebei door de dubbelcheck of langs het plafond glippen.
 */
function schrijfRij(rij) {
  const lock = LockService.getScriptLock();
  // Lukt het slot niet binnen 8 s, dan staan er te veel mensen tegelijk te wachten.
  if (!lock.tryLock(8000)) return 'druk';
  try {
    if (!binnenLimiet()) return 'druk';

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

    // Bestaande rijen: dubbel mailadres en totaal aantal personen.
    const laatsteRij = sheet.getLastRow();
    if (laatsteRij > 1) {
      const kMail = koppen.indexOf('Mailadress');
      const kAantal = koppen.indexOf('Aantal personen');
      const rijen = sheet.getRange(2, 1, laatsteRij - 1, koppen.length).getValues();
      let totaal = 0;
      for (let i = 0; i < rijen.length; i++) {
        if (kMail > -1 && String(rijen[i][kMail]).trim().toLowerCase() === rij['Mailadress']) return 'bestaat';
        if (kAantal > -1) totaal += parseInt(rijen[i][kAantal], 10) || 0;
      }
      if (MAX_TOTAAL_PERSONEN > 0 && totaal + rij['Aantal personen'] > MAX_TOTAAL_PERSONEN) return 'vol';
    } else if (MAX_TOTAAL_PERSONEN > 0 && rij['Aantal personen'] > MAX_TOTAAL_PERSONEN) {
      return 'vol';
    }

    const waarden = koppen.map(k => (k in rij ? rij[k] : ''));
    sheet.appendRow(waarden);
    return 'ok';
  } finally {
    lock.releaseLock();
  }
}

/**
 * Telt de verzoeken in het lopende tijdvenster. Wordt alleen binnen het slot
 * aangeroepen, dus lezen-en-ophogen kan niet door elkaar lopen. Elk verzoek
 * telt mee, ook een dubbele: het gaat om de druk op het script, niet om het
 * aantal geslaagde aanmeldingen.
 */
function binnenLimiet() {
  if (MAX_PER_VENSTER <= 0) return true;
  const cache = CacheService.getScriptCache();
  const vensterMs = VENSTER_MINUTEN * 60 * 1000;
  const sleutel = 'teller_' + Math.floor(Date.now() / vensterMs);
  const n = parseInt(cache.get(sleutel), 10) || 0;
  if (n >= MAX_PER_VENSTER) return false;
  cache.put(sleutel, String(n + 1), VENSTER_MINUTEN * 60 + 60);
  return true;
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
    return { ok: true };
  } catch (err) {
    // De rij staat al in de sheet; een mislukte mail mag de inschrijving niet
    // laten falen. De reden gaat mee terug in het antwoord en staat in Executions.
    console.error('Mail mislukt: ' + err);
    return { ok: false, fout: String(err).slice(0, 300) };
  }
}

/**
 * Handmatige test van alleen de mail: Run → testMail.
 * Bewust zonder try/catch: ontbreekt de toestemming om te mailen, dan vraagt
 * Google er nu om, en elke andere fout staat leesbaar in het Execution log.
 * Schrijft niets in de sheet.
 */
function testMail() {
  const aan = Session.getActiveUser().getEmail();
  console.log('Nog te versturen vandaag: ' + MailApp.getRemainingDailyQuota());
  MailApp.sendEmail({
    to: aan,
    subject: 'Test: bevestigingsmail première',
    body: 'Als je dit leest, mag het script mailen vanuit ' + aan + '.',
    name: AFZENDER_NAAM,
  });
  console.log('Testmail verstuurd naar ' + aan);
}

function antwoord(obj) {
  // Apps Script kan geen HTTP-statuscode zetten; de pagina leest `ok` en `code`
  // ('bestaat' | 'druk' | 'vol' | 'ongeldig' | 'fout').
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
