/**
 * Back to Being — inschrijvingen voor de première, met wachtrij
 *
 * Hangt aan de spreadsheet "Première inschrijvingen":
 * https://docs.google.com/spreadsheets/d/14wJ1cTU1kKhApDBKljp58i5_3GTCEqmFmf7F6IFZVQE/edit
 *
 * Installeren (eenmalig):
 *   1. Open de sheet → Extensions → Apps Script.
 *   2. Vervang de inhoud van Code.gs door dit bestand → Save.
 *   3. Run → installeren (eenmalig): maakt de kolommen Status / Goedkeuren /
 *      Goedgekeurd op, zet vinkjes bij bestaande rijen en installeert de
 *      trigger die op het vinkje reageert. Sta de toestemmingen toe.
 *   4. Deploy → New deployment → type "Web app":
 *        Execute as: Me
 *        Who has access: Anyone
 *      → Deploy → kopieer de Web app URL.
 *   5. Plak die URL in premiere.html bij INSCHRIJF_URL.
 *
 * Bij elke wijziging aan dit script: Deploy → Manage deployments → potlood →
 * Version: New version → Deploy. Anders blijft de oude code draaien.
 *
 * Hoe het loopt:
 *   - Een aanmelding via premiere.html komt in de sheet met Status "Wachtrij"
 *     en een leeg vinkje in de kolom "Goedkeuren". De bezoeker krijgt de
 *     wachtrij-mail: "je aanmelding is ontvangen, je hoort van ons".
 *   - Vink je "Goedkeuren" aan, dan zet het script de Status op "Goedgekeurd",
 *     vult "Goedgekeurd op" en stuurt de bevestigingsmail "je bent erbij".
 *     Past de groep niet meer in de zaal (MAX_TOTAAL_PERSONEN), dan gaat het
 *     vinkje weer uit en zie je onderin een melding.
 *   - Vink je het weer uit, dan gaat de Status terug naar "Wachtrij"; de mail
 *     die al verstuurd is, kun je natuurlijk niet terughalen.
 *   - Menu "Première" in de sheet: geselecteerde rijen in één keer goedkeuren,
 *     en opnieuw installeren als de kolommen of de trigger ontbreken.
 *
 * Verder bij een POST vanaf premiere.html:
 *   - leest de kolomkoppen uit rij 1 en zet de velden op naam in de juiste kolom
 *     (extra kolommen of een andere volgorde in de sheet zijn dus geen probleem);
 *   - staat het mailadres al in de sheet, dan komt er géén tweede rij en géén
 *     tweede mail; de pagina meldt dat dit adres al is aangemeld;
 *   - laat hooguit MAX_PER_VENSTER aanmeldingen per VENSTER_MINUTEN door, zodat een
 *     bot of een stortvloed de sheet en je mailquota niet kan vollopen;
 *   - voegt ontbrekende kolommen ("Taal", "Ingeschreven op", "Status", ...) toe;
 *   - mails zijn HTML (NL of EN, ontwerp uit Figma "back-to-being-mailing-nl"
 *     en "-en") en gaan vanuit het account dat het script deployt.
 */

const SHEET_ID = '14wJ1cTU1kKhApDBKljp58i5_3GTCEqmFmf7F6IFZVQE';
const TAB_NAAM = ''; // leeg = eerste tabblad
const AFZENDER_NAAM = 'Back to Being';
const STUUR_BEVESTIGING = true;

// Beveiliging tegen een stortvloed: zoveel verzoeken mogen er per tijdvenster
// binnenkomen. Alles daarboven krijgt "het is druk, probeer het zo nog eens".
const MAX_PER_VENSTER = 50;
const VENSTER_MINUTEN = 10;

// Zaalcapaciteit: plafond op het aantal GOEDGEKEURDE personen (hoofdpersoon +
// extra's). Goedkeuren van een groep die er niet meer bij past, wordt geweigerd.
// 0 = geen plafond.
const MAX_TOTAAL_PERSONEN = 70;

// Plafond op alle aanmeldingen bij elkaar (wachtrij + goedgekeurd). 0 = uit:
// de wachtrij is dan onbeperkt en de pagina kan nooit "vol" melden.
const MAX_AANMELDINGEN_PERSONEN = 0;

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

// Kolommen van de wachtrij. Het script maakt ze aan als ze ontbreken.
const KOL_STATUS = 'Status';
const KOL_GOEDKEUREN = 'Goedkeuren';
const KOL_GOEDGEKEURD_OP = 'Goedgekeurd op';
const STATUS_WACHTRIJ = 'Wachtrij';
const STATUS_GOEDGEKEURD = 'Goedgekeurd';
const WACHTRIJ_KOPPEN = [KOL_STATUS, KOL_GOEDKEUREN, KOL_GOEDGEKEURD_OP];

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
    rij['Ingeschreven op'] = nu();
    rij[KOL_STATUS] = STATUS_WACHTRIJ;
    rij[KOL_GOEDKEUREN] = false;
    rij[KOL_GOEDGEKEURD_OP] = '';

    let uitkomst;
    try { uitkomst = schrijfRij(rij); }
    catch (err) { throw new Error('sheet: ' + err); }

    // 'bestaat' | 'druk' | 'vol': niets geschreven, dus ook geen mail.
    if (uitkomst !== 'ok') return antwoord({ ok: false, code: uitkomst });

    // De aanmelding staat; een mislukte mail mag die niet laten falen. Maar stil
    // falen is erger: het antwoord zegt of de mail weg is, en zo niet waarom.
    if (!STUUR_BEVESTIGING) return antwoord({ ok: true, mail: null });
    const mail = stuurMail(rij, taal, 'wachtrij');
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

function nu() {
  return Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'dd-MM-yyyy HH:mm');
}

function openSheet() {
  // Gebonden aan de sheet: getActive werkt dan altijd, openById is de
  // terugvaloptie als het script los van de sheet is aangemaakt.
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SHEET_ID);
  const sheet = TAB_NAAM ? ss.getSheetByName(TAB_NAAM) : ss.getSheets()[0];
  if (!sheet) throw new Error('Tabblad niet gevonden');
  return sheet;
}

/**
 * Leest rij 1 en voegt ontbrekende koppen achteraan toe. Geeft de koppen
 * terug (index 0 = kolom 1) plus een opzoekfunctie op naam (0-based, -1 = weg).
 */
function koppenVan(sheet, gewenst) {
  const laatsteKolom = Math.max(1, sheet.getLastColumn());
  const koppen = sheet.getRange(1, 1, 1, laatsteKolom).getValues()[0].map(k => String(k).trim());
  (gewenst || []).forEach(k => {
    if (koppen.indexOf(k) === -1) {
      koppen.push(k);
      sheet.getRange(1, koppen.length).setValue(k);
    }
  });
  return koppen;
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

    const sheet = openSheet();
    const koppen = koppenVan(sheet, Object.keys(rij));

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
      if (MAX_AANMELDINGEN_PERSONEN > 0 && totaal + rij['Aantal personen'] > MAX_AANMELDINGEN_PERSONEN) return 'vol';
    } else if (MAX_AANMELDINGEN_PERSONEN > 0 && rij['Aantal personen'] > MAX_AANMELDINGEN_PERSONEN) {
      return 'vol';
    }

    const waarden = koppen.map(k => (k in rij ? rij[k] : ''));
    sheet.appendRow(waarden);
    // Het vinkje: een echte checkbox in plaats van het woord FALSE.
    const kVink = koppen.indexOf(KOL_GOEDKEUREN);
    if (kVink > -1) sheet.getRange(sheet.getLastRow(), kVink + 1).insertCheckboxes();
    return 'ok';
  } finally {
    lock.releaseLock();
  }
}

/* ---------- wachtrij: goedkeuren vanuit de sheet ---------- */

/**
 * Eenmalig uitvoeren (Run → installeren, of via het menu Première):
 * kolommen aanmaken, vinkjes bij bestaande rijen zetten, lege status op
 * "Wachtrij" en de trigger installeren die op het vinkje reageert.
 * Mag vaker draaien; doet dan niets dubbel.
 */
function installeren() {
  const sheet = openSheet();
  const koppen = koppenVan(sheet, WACHTRIJ_KOPPEN);
  const kStatus = koppen.indexOf(KOL_STATUS) + 1;
  const kVink = koppen.indexOf(KOL_GOEDKEUREN) + 1;
  const laatsteRij = sheet.getLastRow();
  if (laatsteRij > 1) {
    sheet.getRange(2, kVink, laatsteRij - 1, 1).insertCheckboxes();
    const statussen = sheet.getRange(2, kStatus, laatsteRij - 1, 1).getValues();
    for (let i = 0; i < statussen.length; i++) {
      if (!String(statussen[i][0]).trim()) sheet.getRange(i + 2, kStatus).setValue(STATUS_WACHTRIJ);
    }
  }
  // Een gewone onEdit mag niet mailen; daarom een installeerbare trigger.
  const al = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'bijBewerking');
  if (!al) {
    ScriptApp.newTrigger('bijBewerking').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  }
  melding('Wachtrij staat klaar: vink "' + KOL_GOEDKEUREN + '" aan om iemand toe te laten.');
}

// Menu in de sheet.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Première')
    .addItem('Geselecteerde rijen goedkeuren', 'keurSelectieGoed')
    .addSeparator()
    .addItem('Wachtrij installeren / herstellen', 'installeren')
    .addToUi();
}

/**
 * Installeerbare onEdit-trigger. Reageert alleen op de kolom "Goedkeuren"
 * onder de kopregel: aan = goedkeuren, uit = terug naar de wachtrij.
 */
function bijBewerking(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getSheetId() !== openSheet().getSheetId()) return;
  if (e.range.getRow() < 2 || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
  const koppen = koppenVan(sheet);
  if (e.range.getColumn() !== koppen.indexOf(KOL_GOEDKEUREN) + 1) return;
  const aan = e.value === true || e.value === 'TRUE' || e.value === 'true';
  const uit = e.value === false || e.value === 'FALSE' || e.value === 'false';
  if (aan) keurGoed(sheet, e.range.getRow());
  else if (uit) zetTerugInWachtrij(sheet, e.range.getRow());
}

// Menu: alle geselecteerde rijen goedkeuren (wat al goedgekeurd is, slaat het over).
function keurSelectieGoed() {
  const sheet = openSheet();
  const sel = sheet.getActiveRange();
  if (!sel) { melding('Selecteer eerst een of meer rijen.'); return; }
  let n = 0;
  for (let r = Math.max(2, sel.getRow()); r < sel.getRow() + sel.getNumRows(); r++) {
    if (keurGoed(sheet, r) === 'ok') n++;
  }
  melding(n === 1 ? '1 aanmelding goedgekeurd.' : n + ' aanmeldingen goedgekeurd.');
}

/**
 * Keurt één rij goed: past de groep in de zaal, dan Status "Goedgekeurd",
 * datum erbij, vinkje aan en de bevestigingsmail. Geeft terug:
 * 'ok' | 'al' (was al goedgekeurd) | 'vol' | 'leeg' (geen aanmelding in de rij).
 * Binnen het slot, zodat twee goedkeuringen tegelijk niet samen over het
 * plafond gaan.
 */
function keurGoed(sheet, rijNr) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const koppen = koppenVan(sheet, WACHTRIJ_KOPPEN);
    const kStatus = koppen.indexOf(KOL_STATUS), kVink = koppen.indexOf(KOL_GOEDKEUREN);
    const kOp = koppen.indexOf(KOL_GOEDGEKEURD_OP), kAantal = koppen.indexOf('Aantal personen');
    const kMail = koppen.indexOf('Mailadress');
    const laatsteRij = sheet.getLastRow();
    if (rijNr < 2 || rijNr > laatsteRij) return 'leeg';
    const rijen = sheet.getRange(2, 1, laatsteRij - 1, koppen.length).getValues();
    const eigen = rijen[rijNr - 2];
    const rij = {};
    koppen.forEach((k, i) => { rij[k] = eigen[i]; });
    if (!String(rij['Mailadress'] || '').trim()) return 'leeg';
    if (String(rij[KOL_STATUS]).trim() === STATUS_GOEDGEKEURD) {
      if (rij[KOL_GOEDKEUREN] !== true) sheet.getRange(rijNr, kVink + 1).setValue(true);
      return 'al';
    }

    const aantal = parseInt(rij['Aantal personen'], 10) || 1;
    if (MAX_TOTAAL_PERSONEN > 0) {
      let goedgekeurd = 0;
      for (let i = 0; i < rijen.length; i++) {
        if (i !== rijNr - 2 && String(rijen[i][kStatus]).trim() === STATUS_GOEDGEKEURD) {
          goedgekeurd += parseInt(rijen[i][kAantal], 10) || 0;
        }
      }
      if (goedgekeurd + aantal > MAX_TOTAAL_PERSONEN) {
        sheet.getRange(rijNr, kVink + 1).setValue(false);
        melding('Past niet: ' + goedgekeurd + ' van de ' + MAX_TOTAAL_PERSONEN + ' plekken zijn al vergeven, deze groep is ' + aantal + '. ' + rij['Mailadress'] + ' blijft in de wachtrij.');
        return 'vol';
      }
    }

    sheet.getRange(rijNr, kStatus + 1).setValue(STATUS_GOEDGEKEURD);
    sheet.getRange(rijNr, kOp + 1).setValue(nu());
    if (rij[KOL_GOEDKEUREN] !== true) sheet.getRange(rijNr, kVink + 1).setValue(true);

    if (STUUR_BEVESTIGING) {
      const taal = rij['Taal'] === 'en' ? 'en' : 'nl';
      const mail = stuurMail(rij, taal, 'goedgekeurd');
      if (!mail.ok) {
        sheet.getRange(rijNr, kStatus + 1).setValue(STATUS_GOEDGEKEURD + ' (mail mislukt)');
        melding('Goedgekeurd, maar de mail naar ' + rij['Mailadress'] + ' is niet verstuurd: ' + mail.fout);
      }
    }
    return 'ok';
  } finally {
    lock.releaseLock();
  }
}

// Vinkje uit: terug naar de wachtrij. De mail die al verstuurd is, blijft verstuurd.
function zetTerugInWachtrij(sheet, rijNr) {
  const koppen = koppenVan(sheet, WACHTRIJ_KOPPEN);
  const kStatus = koppen.indexOf(KOL_STATUS) + 1, kOp = koppen.indexOf(KOL_GOEDGEKEURD_OP) + 1;
  const status = String(sheet.getRange(rijNr, kStatus).getValue()).trim();
  if (status.indexOf(STATUS_GOEDGEKEURD) !== 0) return;
  sheet.getRange(rijNr, kStatus).setValue(STATUS_WACHTRIJ);
  sheet.getRange(rijNr, kOp).setValue('');
  melding('Terug in de wachtrij. Let op: de bevestigingsmail was al verstuurd.');
}

// Klein bericht onderin de sheet; buiten de sheet (web-app) alleen in het log.
function melding(tekst) {
  console.log(tekst);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(tekst, 'Première', 8); } catch (err) { /* geen sheet open */ }
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

// Teksten van de twee mails. De algemene regels staan per taal bovenaan; per
// soort ('wachtrij' na de aanmelding, 'goedgekeurd' na het vinkje in de sheet)
// verschillen onderwerp, preheader, titel, intro en de titel van het kaartje.
const MAIL_TEKST = {
  nl: {
    aanhef: 'Beste {{naam}},',
    bezoeker: 'Bezoeker',
    aantal: 'Aantal personen',
    noot: '* De datum en locatie zijn nog niet 100% definitief. Zodra we hier meer zekerheid over hebben, sturen we je alle praktische informatie per e-mail.',
    groet: 'Tot snel,',
    team: 'Team Back to Being',
    reden: 'Je ontvangt deze e-mail omdat je je hebt aangemeld voor de première van Back to Being.',
    voorkeuren: 'Voorkeuren aanpassen',
    website: 'Website',
    wachtrij: {
      onderwerp: 'Je aanmelding voor de première van Back to Being is ontvangen',
      preheader: 'Je staat in de wachtrij. Zodra we je plek kunnen bevestigen, hoor je van ons.',
      titel: 'Je staat in de wachtrij voor de première van Back to Being',
      intro: 'Wat fijn dat je erbij wilt zijn. We hebben je aanmelding ontvangen en je staat nu in de wachtrij. Er is plek voor 70 mensen, dus we bekijken de aanmeldingen één voor één. Zodra we je plek kunnen bevestigen, krijg je van ons een mail.',
      kaartTitel: 'Aanmeldingsgegevens',
    },
    goedgekeurd: {
      onderwerp: 'Je bent erbij: je plek voor de première van Back to Being is bevestigd',
      preheader: 'Je plek is bevestigd. Zodra datum en locatie vaststaan, hoor je van ons.',
      titel: 'Je plek voor de première van Back to Being is bevestigd',
      intro: 'Goed nieuws: je bent erbij. Wat ontzettend fijn dat je komt. We kijken er enorm naar uit om dit bijzondere moment samen te beleven en de documentaire voor het eerst met jou te delen.',
      kaartTitel: 'Je plek',
    },
  },
  en: {
    aanhef: 'Dear {{naam}},',
    bezoeker: 'Visitor',
    aantal: 'Number of people',
    noot: "* The date and location are not yet 100% confirmed. As soon as we have more certainty about these details, we'll send you all the practical information by email.",
    groet: 'See you soon,',
    team: 'Team Back to Being',
    reden: 'You are receiving this email because you signed up for the premiere of Back to Being.',
    voorkeuren: 'Change Preferences',
    website: 'Website',
    wachtrij: {
      onderwerp: 'We received your sign-up for the premiere of Back to Being',
      preheader: 'You are on the waiting list. As soon as we can confirm your place, we will let you know.',
      titel: 'You are on the waiting list for the premiere of Back to Being',
      intro: "We're glad you want to be there. We received your sign-up and you are now on the waiting list. There is room for 70 people, so we go through the sign-ups one by one. As soon as we can confirm your place, you will get an email from us.",
      kaartTitel: 'Registration Information',
    },
    goedgekeurd: {
      onderwerp: 'You are in: your place at the premiere of Back to Being is confirmed',
      preheader: 'Your place is confirmed. As soon as the date and location are set, we will let you know.',
      titel: 'Your place at the premiere of Back to Being is confirmed',
      intro: "Good news: you're in. We're really looking forward to experiencing this special moment together and sharing the documentary with you for the first time.",
      kaartTitel: 'Your place',
    },
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Bouwt een mail (onderwerp, platte tekst en HTML) uit de rij.
 * soort: 'wachtrij' (na de aanmelding) of 'goedgekeurd' (na het vinkje).
 * Placeholders: {{naam}} = voornaam in de aanhef, volledige naam op het kaartje;
 * het aantal personen komt uit de rij.
 */
function bouwMail(rij, taal, soort) {
  const basis = MAIL_TEKST[taal === 'en' ? 'en' : 'nl'];
  const t = Object.assign({}, basis, basis[soort === 'goedgekeurd' ? 'goedgekeurd' : 'wachtrij']);
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

function stuurMail(rij, taal, soort) {
  const mail = bouwMail(rij, taal, soort);
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
    // De rij staat al in de sheet; een mislukte mail mag de inschrijving of de
    // goedkeuring niet laten falen. De reden gaat mee terug en staat in Executions.
    console.error('Mail mislukt: ' + err);
    return { ok: false, fout: String(err).slice(0, 300) };
  }
}

/**
 * Handmatige test van alleen de mails: Run → testMail.
 * Stuurt de echte wachtrij-mail en de goedkeuringsmail (NL) naar jezelf, zonder
 * iets in de sheet te zetten. Bewust zonder try/catch: ontbreekt de toestemming
 * om te mailen, dan vraagt Google er nu om, en elke andere fout staat leesbaar
 * in het Execution log.
 */
function testMail() {
  const aan = Session.getActiveUser().getEmail();
  console.log('Nog te versturen vandaag: ' + MailApp.getRemainingDailyQuota());
  const rij = { 'Voornaam': 'Test', 'Achternaam': 'Persoon', 'Mailadress': aan, 'Aantal personen': 2 };
  ['wachtrij', 'goedgekeurd'].forEach(soort => {
    const mail = bouwMail(rij, 'nl', soort);
    MailApp.sendEmail({ to: aan, subject: 'Test: ' + mail.onderwerp, body: mail.tekst, htmlBody: mail.html, name: AFZENDER_NAAM });
  });
  console.log('Twee testmails verstuurd naar ' + aan);
}

function antwoord(obj) {
  // Apps Script kan geen HTTP-statuscode zetten; de pagina leest `ok` en `code`
  // ('bestaat' | 'druk' | 'vol' | 'ongeldig' | 'fout').
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Handmatige test: Run → testInschrijving. Zet een testrij (Status Wachtrij) in
 *  de sheet en vraagt bij de eerste keer om toestemming voor Sheets en Mail.
 *  Vink daarna in de sheet "Goedkeuren" aan om ook de goedkeuring te testen. */
function testInschrijving() {
  const e = { postData: { contents: JSON.stringify({
    'Voornaam': 'Test', 'Achternaam': 'Persoon', 'Mailadress': Session.getActiveUser().getEmail(),
    'Aantal personen': '2', 'Naam persoon (extra 1)': 'Tweede Persoon', 'Taal': 'nl'
  }) } };
  console.log(doPost(e).getContent());
}
