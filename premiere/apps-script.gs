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
 *   - stuurt een HTML-bevestigingsmail (NL of EN, ontwerpen uit Figma "back-to-being-
 *     mailing-nl" en "-en") met naam en aantal personen ingevuld, vanuit het
 *     account dat het script deployt.
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
// 0 = geen plafond. Nu de zaalcapaciteit: 70 personen.
const MAX_TOTAAL_PERSONEN = 70;

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

// Kleuren en lettertypes van de site (premiere.html / Figma "back-to-being-mailing-nl" en "-en").
const MAIL_KLEUR = {
  canvas: '#fffef1', kaart: '#faf8f2', sand: '#b9a26e', tree: '#2a3723',
  ink: '#161616', inkZacht: '#5c5c5c', inkLicht: '#737373', lijn: '#e8e2d2',
};
const MAIL_SERIF = "'Instrument Serif', Georgia, 'Times New Roman', serif";
const MAIL_SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";
const MAIL_LINKS = {
  instagram: 'https://www.instagram.com/backtobeingtech/',
  tiktok: 'https://www.tiktok.com/@backtobeing.tech',
  youtube: 'https://www.youtube.com/watch?v=v32XZxS0QCA',
  website: 'https://backtobeing.tech',
  contact: 'caesar.schoorl@gmail.com',
};

const MAIL_TEKST = {
  nl: {
    onderwerp: 'Je bent aangemeld voor de première van Back to Being',
    preheader: 'Je aanmelding is binnen. Zodra datum en locatie vaststaan, hoor je van ons.',
    titel: 'Je bent aangemeld voor de première van Back to Being',
    aanhef: 'Beste {{naam}},',
    intro: 'Wat ontzettend fijn dat je erbij bent. We kijken er enorm naar uit om dit bijzondere moment samen te beleven en de documentaire voor het eerst met jou te delen.',
    kaartTitel: 'Aanmeldingsgegevens',
    bezoeker: 'Bezoeker',
    aantal: 'Aantal personen',
    noot: '* De datum en locatie zijn nog niet 100% definitief. Zodra we hier meer zekerheid over hebben, sturen we je alle praktische informatie per e-mail.',
    groet: 'Tot snel,',
    team: 'Team Back to Being',
    reden: 'Je ontvangt deze e-mail omdat je je hebt aangemeld voor de première van Back to Being.',
    voorkeuren: 'Voorkeuren aanpassen',
    website: 'Website',
  },
  en: {
    onderwerp: 'You are registered for the premiere of Back to Being',
    preheader: 'Your registration is in. As soon as the date and location are confirmed, we will let you know.',
    titel: 'You are registered for the premiere of Back to Being',
    aanhef: 'Dear {{naam}},',
    intro: "We're really looking forward to experiencing this special moment together and sharing the documentary with you for the first time.",
    kaartTitel: 'Registration Information',
    bezoeker: 'Visitor',
    aantal: 'Number of people',
    noot: "* The date and location are not yet 100% confirmed. As soon as we have more certainty about these details, we'll send you all the practical information by email.",
    groet: 'See you soon,',
    team: 'Team Back to Being',
    reden: 'You are receiving this email because you signed up for the premiere of Back to Being.',
    voorkeuren: 'Change Preferences',
    website: 'Website',
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Bouwt de bevestigingsmail (onderwerp, platte tekst en HTML) uit de rij.
 * Placeholders: {{naam}} = voornaam in de aanhef, volledige naam op het kaartje;
 * {{aantal_personen}} = het aantal uit het formulier.
 */
function bouwMail(rij, taal) {
  const t = MAIL_TEKST[taal === 'en' ? 'en' : 'nl'];
  const voornaam = rij['Voornaam'];
  const volledigeNaam = (rij['Voornaam'] + ' ' + rij['Achternaam']).trim();
  const aantal = String(rij['Aantal personen']);
  const k = MAIL_KLEUR;

  const tekst =
    t.aanhef.replace('{{naam}}', voornaam) + '\n\n' +
    t.intro + '\n\n' +
    t.kaartTitel + '\n' +
    t.bezoeker + ': ' + volledigeNaam + '\n' +
    t.aantal + ': ' + aantal + '\n\n' +
    t.noot + '\n\n' +
    t.groet + '\n' + t.team + '\n\n' +
    t.reden + '\n' + MAIL_LINKS.website;

  const link = (href, label) =>
    '<a href="' + href + '" style="color:' + k.inkLicht + ';font-family:' + MAIL_SANS + ';font-size:11px;text-decoration:underline;">' + label + '</a>';
  const bolletje = '<span style="display:inline-block;width:4px;height:4px;border-radius:2px;background:#cbd0c0;vertical-align:middle;margin:0 8px;"></span>';

  const html =
    '<!DOCTYPE html><html lang="' + (taal === 'en' ? 'en' : 'nl') + '"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
    '<title>' + escapeHtml(t.onderwerp) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">' +
    '</head>' +
    '<body style="margin:0;padding:0;background:' + k.canvas + ';">' +
    // Preheader: de regel die de inbox naast het onderwerp toont, onzichtbaar in de mail zelf.
    '<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:' + k.canvas + ';opacity:0;">' + escapeHtml(t.preheader) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + k.canvas + ';">' +
    '<tr><td align="center" style="padding:48px 14px 40px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">' +

    // Hero
    '<tr><td align="center" style="padding:40px 32px 56px;">' +
    '<div style="max-width:444px;font-family:' + MAIL_SERIF + ';font-size:32px;line-height:1.15;color:' + k.tree + ';">' + escapeHtml(t.titel) + '</div>' +
    '</td></tr>' +

    // Bericht
    '<tr><td style="padding:0 32px 24px;">' +
    '<p style="margin:0 0 20px;font-family:' + MAIL_SANS + ';font-size:15px;font-weight:500;color:' + k.ink + ';">' + escapeHtml(t.aanhef.replace('{{naam}}', voornaam)) + '</p>' +
    '<p style="margin:0 0 20px;font-family:' + MAIL_SANS + ';font-size:14px;line-height:1.6;color:' + k.ink + ';">' + escapeHtml(t.intro) + '</p>' +

    // Kaartje met aanmeldingsgegevens
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + k.kaart + ';border:1px solid ' + k.sand + ';border-radius:11px;">' +
    '<tr><td style="padding:24px;">' +
    '<div style="margin:0 0 16px;font-family:' + MAIL_SERIF + ';font-style:italic;font-size:20px;color:' + k.tree + ';">' + escapeHtml(t.kaartTitel) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:' + MAIL_SANS + ';font-size:13px;color:' + k.ink + ';">' +
    '<tr><td style="padding:0 0 8px;color:' + k.inkLicht + ';">' + escapeHtml(t.bezoeker) + '</td><td align="right" style="padding:0 0 8px;font-weight:600;">' + escapeHtml(volledigeNaam) + '</td></tr>' +
    '<tr><td colspan="2" style="border-top:1px solid ' + k.lijn + ';font-size:0;line-height:0;">&nbsp;</td></tr>' +
    '<tr><td style="padding:8px 0 0;color:' + k.inkLicht + ';">' + escapeHtml(t.aantal) + '</td><td align="right" style="padding:8px 0 0;font-weight:600;">' + escapeHtml(aantal) + '</td></tr>' +
    '</table>' +
    '</td></tr></table>' +

    '<p style="margin:20px 0 0;font-family:' + MAIL_SANS + ';font-size:13px;line-height:1.6;color:' + k.inkZacht + ';">' + escapeHtml(t.noot) + '</p>' +
    '<p style="margin:36px 0 0;font-family:' + MAIL_SANS + ';font-size:14px;color:' + k.ink + ';">' + escapeHtml(t.groet) + '</p>' +
    '<p style="margin:4px 0 0;font-family:' + MAIL_SERIF + ';font-style:italic;font-size:18px;color:' + k.tree + ';">' + escapeHtml(t.team) + '</p>' +
    '</td></tr>' +

    // Footer
    '<tr><td style="padding:76px 0 0;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + k.kaart + ';border:1px solid ' + k.sand + ';border-radius:11px;">' +
    '<tr><td align="center" style="padding:40px 32px 48px;">' +
    '<div style="font-family:' + MAIL_SERIF + ';font-size:22px;color:' + k.tree + ';">back to being</div>' +
    '<p style="margin:20px 0 0;font-family:' + MAIL_SANS + ';font-size:11px;line-height:1.5;color:' + k.inkLicht + ';">' + escapeHtml(t.reden) + '</p>' +
    '<p style="margin:20px 0 0;line-height:1;">' + link('mailto:' + MAIL_LINKS.contact, t.voorkeuren) + '</p>' +
    '<p style="margin:20px 0 0;line-height:1;white-space:nowrap;">' +
    link(MAIL_LINKS.instagram, 'Instagram') + bolletje + link(MAIL_LINKS.tiktok, 'TikTok') + bolletje +
    link(MAIL_LINKS.youtube, 'YouTube') + bolletje + link(MAIL_LINKS.website, t.website) +
    '</p>' +
    '</td></tr></table>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';

  return { onderwerp: t.onderwerp, tekst: tekst, html: html };
}

function stuurBevestiging(rij, taal) {
  const mail = bouwMail(rij, taal);
  try {
    // Verstuurd vanuit het account dat het script deployt, met de naam hieronder.
    MailApp.sendEmail({
      to: rij['Mailadress'],
      subject: mail.onderwerp,
      body: mail.tekst,
      htmlBody: mail.html,
      name: AFZENDER_NAAM,
    });
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
 * Stuurt de echte HTML-bevestiging (NL) naar jezelf, zonder iets in de sheet te
 * zetten. Bewust zonder try/catch: ontbreekt de toestemming om te mailen, dan
 * vraagt Google er nu om, en elke andere fout staat leesbaar in het Execution log.
 */
function testMail() {
  const aan = Session.getActiveUser().getEmail();
  console.log('Nog te versturen vandaag: ' + MailApp.getRemainingDailyQuota());
  const rij = { 'Voornaam': 'Test', 'Achternaam': 'Persoon', 'Mailadress': aan, 'Aantal personen': 2 };
  const mail = bouwMail(rij, 'nl');
  MailApp.sendEmail({ to: aan, subject: 'Test: ' + mail.onderwerp, body: mail.tekst, htmlBody: mail.html, name: AFZENDER_NAAM });
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
