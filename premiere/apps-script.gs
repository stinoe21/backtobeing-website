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
 *      Goedgekeurd op / Afwijzen / Afgewezen op / Herinnering sturen /
 *      Herinnering verstuurd op, zet vinkjes bij bestaande
 *      rijen en installeert de trigger die op de vinkjes reageert. Sta de
 *      toestemmingen toe.
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
 *   - Vink je "Afwijzen" aan, dan zet het script de Status op "Afgewezen",
 *     vult "Afgewezen op" en stuurt de mail "de première zit helaas vol", met
 *     de verwijzing naar de documentaire die daarna online komt. Een rij die al
 *     goedgekeurd is, wijs je niet per ongeluk af: haal daar eerst het vinkje
 *     bij "Goedkeuren" weg. Vinkje weer uit = terug naar "Wachtrij".
 *   - Menu "Première" in de sheet: geselecteerde rijen in één keer goedkeuren
 *     of afwijzen, en opnieuw installeren als de kolommen of de trigger
 *     ontbreken.
 *   - Herinnering: vink je "Herinnering sturen" aan bij een goedgekeurde rij,
 *     dan gaat de herinneringsmail "Nog één week tot de première" (praktische
 *     info, adres, foto's van de locatie) naar die gast en vult het script
 *     "Herinnering verstuurd op". Bij een rij die niet goedgekeurd is, gaat het
 *     vinkje weer uit. Is de datum al gevuld, dan gaat er geen tweede mail.
 *     Vinkje uit = niets (de mail is al weg). Voor iedereen in één keer: menu
 *     "Première → Herinnering sturen naar alle goedgekeurde gasten" (slaat
 *     rijen met een datum over, dus gerust vaker te draaien). Nog eens sturen:
 *     "Herinnering (opnieuw) sturen naar geselecteerde rijen". De tekst zegt
 *     "over precies een week": stuur hem dus op dinsdag 27 oktober. De foto's
 *     staan op backtobeing.tech (premiere-foyer.jpg, premiere-spiegel.jpg):
 *     eerst deployen.
 *   - Uitnodigingen: het tabblad "Uitnodigingen" heeft per persoon een code
 *     (Code | Van | Max personen | Gebruikt). Wie aanmeldt via
 *     premiere.html?code=<code> slaat de wachtrij over en is meteen
 *     goedgekeurd, zolang het maximum van die code niet vol is. De kolom
 *     "Uitnodiging" in de aanmeldlijst zegt via wie iemand binnenkwam.
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
const KOL_UITNODIGING = 'Uitnodiging';
// Afwijzen: wie er niet bij kan zijn. Een eigen vinkje, los van Goedkeuren.
const KOL_AFWIJZEN = 'Afwijzen';
const KOL_AFGEWEZEN_OP = 'Afgewezen op';
const STATUS_AFGEWEZEN = 'Afgewezen';
// Herinnering vlak voor de première: een vinkje om hem te sturen, en wanneer
// die naar deze rij is gegaan.
const KOL_HERINNERING = 'Herinnering sturen';
const KOL_HERINNERING_OP = 'Herinnering verstuurd op';
const WACHTRIJ_KOPPEN = [KOL_STATUS, KOL_GOEDKEUREN, KOL_GOEDGEKEURD_OP, KOL_UITNODIGING, KOL_AFWIJZEN, KOL_AFGEWEZEN_OP, KOL_HERINNERING, KOL_HERINNERING_OP];
// De kolommen met een vinkje: krijgen echte checkboxes.
const VINK_KOPPEN = [KOL_GOEDKEUREN, KOL_AFWIJZEN, KOL_HERINNERING];

// Persoonlijke uitnodigingslinks: premiere.html?code=<code>. De codes staan in
// dit tabblad van de sheet (niet in de repo, die is publiek). installeren maakt
// het tabblad aan met een code voor iedereen hieronder; pas de codes daarna
// gerust aan in de sheet.
const TAB_UITNODIGINGEN = 'Uitnodigingen';
const UITNODIGING_KOPPEN = ['Code', 'Van', 'Max personen', 'Gebruikt'];
const UITNODIGING_STANDAARD = [['Caesar', 10], ['Stijn', 10], ['Max', 10]];

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
    rij[KOL_UITNODIGING] = '';
    rij[KOL_AFWIJZEN] = false;
    rij[KOL_AFGEWEZEN_OP] = '';
    rij[KOL_HERINNERING] = false;
    rij[KOL_HERINNERING_OP] = '';
    const code = String(data['Code'] || '').trim();

    let uitkomst;
    try { uitkomst = schrijfRij(rij, code); }
    catch (err) { throw new Error('sheet: ' + err); }

    // 'bestaat' | 'druk' | 'vol': niets geschreven, dus ook geen mail.
    if (uitkomst.status !== 'ok') return antwoord({ ok: false, code: uitkomst.status });

    // Bij een geldige uitnodiging is de rij al goedgekeurd: dan meteen de
    // "je bent erbij"-mail. Het antwoord zegt de pagina wat er met de code gebeurde:
    // true (geen wachtrij), 'vol' of 'onbekend' (gewoon in de wachtrij).
    const uit = { ok: true };
    if (code) { uit.uitnodiging = uitkomst.uitnodiging; uit.via = uitkomst.van || ''; }
    const direct = uitkomst.uitnodiging === true;

    // De aanmelding staat; een mislukte mail mag die niet laten falen. Maar stil
    // falen is erger: het antwoord zegt of de mail weg is, en zo niet waarom.
    if (!STUUR_BEVESTIGING) { uit.mail = null; return antwoord(uit); }
    const mail = stuurMail(rij, taal, direct ? 'goedgekeurd' : 'wachtrij');
    uit.mail = mail.ok;
    if (!mail.ok) uit.mailFout = mail.fout;
    return antwoord(uit);
  } catch (err) {
    console.error(err);
    return antwoord({ ok: false, code: 'fout', fout: String(err) });
  }
}

// Zodat je in de browser kunt zien dat de deployment leeft. Met ?code=<code>
// controleert de pagina een uitnodigingslink vóór het invullen: geldig of niet,
// van wie, en of die al vol is. De lijst zelf gaat nooit naar buiten.
function doGet(e) {
  const code = String((e && e.parameter && e.parameter.code) || '').trim();
  if (!code) return antwoord({ ok: true, info: 'Back to Being première — gebruik POST' });
  try {
    const ss = openSpreadsheet();
    const uit = zoekUitnodiging(ss, code);
    if (!uit) return antwoord({ ok: true, geldig: false });
    const sheet = openSheet();
    const koppen = koppenVan(sheet);
    const gebruikt = gebruiktVia(sheet, koppen, uit.van);
    return antwoord({ ok: true, geldig: true, van: uit.van, vol: gebruikt >= uit.max });
  } catch (err) {
    console.error(err);
    return antwoord({ ok: false, code: 'fout', fout: String(err) });
  }
}

function nu() {
  return Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'dd-MM-yyyy HH:mm');
}

function openSpreadsheet() {
  // Gebonden aan de sheet: getActive werkt dan altijd, openById is de
  // terugvaloptie als het script los van de sheet is aangemaakt.
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SHEET_ID);
}

function openSheet() {
  const ss = openSpreadsheet();
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
 * Geeft terug { status: 'ok' | 'bestaat' | 'druk' | 'vol', uitnodiging, van }.
 * uitnodiging: true als de code geldig was en de rij meteen is goedgekeurd,
 * 'vol' als de code op is, 'onbekend' als de code niet bestaat; anders leeg.
 * Alles gebeurt binnen één slot, zodat twee aanmeldingen op hetzelfde moment
 * niet allebei door de dubbelcheck, langs het plafond of langs het maximum van
 * een uitnodiging glippen.
 */
function schrijfRij(rij, code) {
  const lock = LockService.getScriptLock();
  // Lukt het slot niet binnen 8 s, dan staan er te veel mensen tegelijk te wachten.
  if (!lock.tryLock(8000)) return { status: 'druk' };
  try {
    if (!binnenLimiet()) return { status: 'druk' };

    const sheet = openSheet();
    const koppen = koppenVan(sheet, Object.keys(rij));
    const uitkomst = { status: 'ok' };

    // Uitnodigingslink: geldig en nog niet vol, dan meteen goedgekeurd.
    if (code) {
      const uit = zoekUitnodiging(openSpreadsheet(), code);
      if (!uit) {
        uitkomst.uitnodiging = 'onbekend';
      } else {
        uitkomst.van = uit.van;
        const gebruikt = gebruiktVia(sheet, koppen, uit.van);
        if (gebruikt + rij['Aantal personen'] > uit.max) {
          uitkomst.uitnodiging = 'vol';
        } else {
          uitkomst.uitnodiging = true;
          rij[KOL_STATUS] = STATUS_GOEDGEKEURD;
          rij[KOL_GOEDKEUREN] = true;
          rij[KOL_GOEDGEKEURD_OP] = nu();
          rij[KOL_UITNODIGING] = uit.van;
          schrijfGebruikt(uit, gebruikt + rij['Aantal personen']);
        }
      }
    }

    // Bestaande rijen: dubbel mailadres en totaal aantal personen.
    const laatsteRij = sheet.getLastRow();
    if (laatsteRij > 1) {
      const kMail = koppen.indexOf('Mailadress');
      const kAantal = koppen.indexOf('Aantal personen');
      const rijen = sheet.getRange(2, 1, laatsteRij - 1, koppen.length).getValues();
      let totaal = 0;
      for (let i = 0; i < rijen.length; i++) {
        if (kMail > -1 && String(rijen[i][kMail]).trim().toLowerCase() === rij['Mailadress']) return { status: 'bestaat' };
        if (kAantal > -1) totaal += parseInt(rijen[i][kAantal], 10) || 0;
      }
      if (MAX_AANMELDINGEN_PERSONEN > 0 && totaal + rij['Aantal personen'] > MAX_AANMELDINGEN_PERSONEN) return { status: 'vol' };
    } else if (MAX_AANMELDINGEN_PERSONEN > 0 && rij['Aantal personen'] > MAX_AANMELDINGEN_PERSONEN) {
      return { status: 'vol' };
    }

    const waarden = koppen.map(k => (k in rij ? rij[k] : ''));
    sheet.appendRow(waarden);
    // De vinkjes: echte checkboxes in plaats van het woord TRUE/FALSE.
    VINK_KOPPEN.forEach(k => {
      const kVink = koppen.indexOf(k);
      if (kVink > -1) sheet.getRange(sheet.getLastRow(), kVink + 1).insertCheckboxes();
    });
    return uitkomst;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- uitnodigingen: wachtrij overslaan met een code ---------- */

/** Zoekt de code (hoofdletterongevoelig) in het tabblad Uitnodigingen.
 *  Geeft { van, max, rijNr } of null. */
function zoekUitnodiging(ss, code) {
  const tab = ss.getSheetByName(TAB_UITNODIGINGEN);
  if (!tab || tab.getLastRow() < 2) return null;
  const gezocht = String(code).trim().toLowerCase();
  if (!gezocht) return null;
  const rijen = tab.getRange(2, 1, tab.getLastRow() - 1, 3).getValues();
  for (let i = 0; i < rijen.length; i++) {
    if (String(rijen[i][0]).trim().toLowerCase() === gezocht && String(rijen[i][1]).trim()) {
      return { van: String(rijen[i][1]).trim(), max: parseInt(rijen[i][2], 10) || 0, rijNr: i + 2 };
    }
  }
  return null;
}

/** Telt hoeveel personen al via deze uitnodiger binnen zijn (kolom "Uitnodiging"). */
function gebruiktVia(sheet, koppen, van) {
  const kVia = koppen.indexOf(KOL_UITNODIGING), kAantal = koppen.indexOf('Aantal personen');
  const laatsteRij = sheet.getLastRow();
  if (kVia < 0 || kAantal < 0 || laatsteRij < 2) return 0;
  const rijen = sheet.getRange(2, 1, laatsteRij - 1, koppen.length).getValues();
  let n = 0;
  for (let i = 0; i < rijen.length; i++) {
    if (String(rijen[i][kVia]).trim().toLowerCase() === van.toLowerCase()) n += parseInt(rijen[i][kAantal], 10) || 0;
  }
  return n;
}

// Ter info in het tabblad: de kolom "Gebruikt". De echte telling komt altijd
// uit de aanmeldlijst, dus een verwijderde rij telt vanzelf niet meer mee.
function schrijfGebruikt(uit, n) {
  try {
    openSpreadsheet().getSheetByName(TAB_UITNODIGINGEN).getRange(uit.rijNr, 4).setValue(n);
  } catch (err) { console.error('Gebruikt bijwerken mislukt: ' + err); }
}

/** Maakt het tabblad Uitnodigingen met een code per persoon, als het nog niet bestaat. */
function maakUitnodigingenTab(ss) {
  if (ss.getSheetByName(TAB_UITNODIGINGEN)) return false;
  const tab = ss.insertSheet(TAB_UITNODIGINGEN);
  tab.getRange(1, 1, 1, UITNODIGING_KOPPEN.length).setValues([UITNODIGING_KOPPEN]);
  UITNODIGING_STANDAARD.forEach(([van, max]) => tab.appendRow([nieuweCode(van), van, max, 0]));
  return true;
}

// bijv. "max-k7p4": leesbaar, maar niet te raden. Zonder 0/o/1/l-verwarring.
function nieuweCode(van) {
  const tekens = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += tekens.charAt(Math.floor(Math.random() * tekens.length));
  return String(van).toLowerCase().replace(/[^a-z0-9]+/g, '') + '-' + s;
}

/* ---------- wachtrij: goedkeuren vanuit de sheet ---------- */

/**
 * Eenmalig uitvoeren (Run → installeren, of via het menu Première):
 * kolommen aanmaken, vinkjes (Goedkeuren, Afwijzen, Herinnering sturen) bij bestaande rijen
 * zetten, lege status op "Wachtrij" en de trigger installeren die op de
 * vinkjes reageert.
 * Mag vaker draaien; doet dan niets dubbel.
 */
function installeren() {
  const sheet = openSheet();
  // Het vinkje "Herinnering sturen" hoort naast "Herinnering verstuurd op", niet
  // helemaal rechts. Bestaat de datumkolom al en het vinkje nog niet, dan komt
  // er een kolom links ervan bij.
  const bestaand = koppenVan(sheet);
  if (bestaand.indexOf(KOL_HERINNERING) === -1 && bestaand.indexOf(KOL_HERINNERING_OP) > -1) {
    const kOp = bestaand.indexOf(KOL_HERINNERING_OP) + 1;
    sheet.insertColumnBefore(kOp);
    sheet.getRange(1, kOp).setValue(KOL_HERINNERING);
  }
  const koppen = koppenVan(sheet, WACHTRIJ_KOPPEN);
  const kStatus = koppen.indexOf(KOL_STATUS) + 1;
  const laatsteRij = sheet.getLastRow();
  if (laatsteRij > 1) {
    VINK_KOPPEN.forEach(k => sheet.getRange(2, koppen.indexOf(k) + 1, laatsteRij - 1, 1).insertCheckboxes());
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
  const nieuwTab = maakUitnodigingenTab(openSpreadsheet());
  melding('Wachtrij staat klaar: vink "' + KOL_GOEDKEUREN + '" aan om iemand toe te laten, "' + KOL_AFWIJZEN + '" als er geen plek is, "' + KOL_HERINNERING + '" voor de herinnering.' +
    (nieuwTab ? ' Tabblad "' + TAB_UITNODIGINGEN + '" aangemaakt met de uitnodigingscodes.' : ''));
}

// Menu in de sheet.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Première')
    .addItem('Geselecteerde rijen goedkeuren', 'keurSelectieGoed')
    .addItem('Geselecteerde rijen afwijzen', 'wijsSelectieAf')
    .addSeparator()
    .addItem('Herinnering sturen naar alle goedgekeurde gasten', 'stuurHerinneringen')
    .addItem('Herinnering (opnieuw) sturen naar geselecteerde rijen', 'stuurHerinneringSelectie')
    .addSeparator()
    .addItem('Wachtrij en uitnodigingen installeren / herstellen', 'installeren')
    .addToUi();
}

/**
 * Installeerbare onEdit-trigger. Reageert alleen op de vinkjes onder de
 * kopregel: "Goedkeuren" en "Afwijzen" (aan = goedkeuren of afwijzen, uit =
 * terug naar de wachtrij) en "Herinnering sturen" (aan = de herinnering
 * sturen; uit doet niets, de mail is al weg).
 */
function bijBewerking(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getSheetId() !== openSheet().getSheetId()) return;
  if (e.range.getRow() < 2 || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
  const koppen = koppenVan(sheet);
  const kolom = e.range.getColumn();
  const goedkeuren = kolom === koppen.indexOf(KOL_GOEDKEUREN) + 1;
  const afwijzen = kolom === koppen.indexOf(KOL_AFWIJZEN) + 1;
  const herinnering = kolom === koppen.indexOf(KOL_HERINNERING) + 1;
  if (!goedkeuren && !afwijzen && !herinnering) return;
  const aan = e.value === true || e.value === 'TRUE' || e.value === 'true';
  const uit = e.value === false || e.value === 'FALSE' || e.value === 'false';
  if (goedkeuren) {
    if (aan) keurGoed(sheet, e.range.getRow());
    else if (uit) zetTerugInWachtrij(sheet, e.range.getRow());
  } else if (afwijzen) {
    if (aan) wijsAf(sheet, e.range.getRow());
    else if (uit) zetAfwijzingTerug(sheet, e.range.getRow());
  } else {
    if (aan) stuurHerinneringRij(sheet, e.range.getRow());
    else if (uit) melding('De herinnering die al verstuurd is, gaat niet terug. Nog eens sturen: menu Première → Herinnering (opnieuw) sturen naar geselecteerde rijen.');
  }
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

// Menu: alle geselecteerde rijen afwijzen (wat al afgewezen of goedgekeurd is, slaat het over).
function wijsSelectieAf() {
  const sheet = openSheet();
  const sel = sheet.getActiveRange();
  if (!sel) { melding('Selecteer eerst een of meer rijen.'); return; }
  let n = 0;
  for (let r = Math.max(2, sel.getRow()); r < sel.getRow() + sel.getNumRows(); r++) {
    if (wijsAf(sheet, r) === 'ok') n++;
  }
  melding(n === 1 ? '1 aanmelding afgewezen.' : n + ' aanmeldingen afgewezen.');
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
    // Was de rij eerder afgewezen (er kwam een plek vrij), dan gaat dat vinkje uit.
    if (rij[KOL_AFWIJZEN] === true) sheet.getRange(rijNr, koppen.indexOf(KOL_AFWIJZEN) + 1).setValue(false);
    if (rij[KOL_AFGEWEZEN_OP]) sheet.getRange(rijNr, koppen.indexOf(KOL_AFGEWEZEN_OP) + 1).setValue('');

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

/**
 * Wijst één rij af: Status "Afgewezen", datum erbij, vinkje aan en de mail
 * "de première zit helaas vol". Geeft terug:
 * 'ok' | 'al' (was al afgewezen) | 'goedgekeurd' (niet afgewezen: haal eerst
 * het vinkje bij Goedkeuren weg) | 'leeg' (geen aanmelding in de rij).
 */
function wijsAf(sheet, rijNr) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const koppen = koppenVan(sheet, WACHTRIJ_KOPPEN);
    const kStatus = koppen.indexOf(KOL_STATUS), kVink = koppen.indexOf(KOL_AFWIJZEN);
    const kOp = koppen.indexOf(KOL_AFGEWEZEN_OP);
    if (rijNr < 2 || rijNr > sheet.getLastRow()) return 'leeg';
    const eigen = sheet.getRange(rijNr, 1, 1, koppen.length).getValues()[0];
    const rij = {};
    koppen.forEach((k, i) => { rij[k] = eigen[i]; });
    if (!String(rij['Mailadress'] || '').trim()) return 'leeg';
    const status = String(rij[KOL_STATUS]).trim();
    if (status.indexOf(STATUS_AFGEWEZEN) === 0) {
      if (rij[KOL_AFWIJZEN] !== true) sheet.getRange(rijNr, kVink + 1).setValue(true);
      return 'al';
    }
    // Een bevestigde gast krijgt niet per ongeluk de mail dat het vol zit.
    if (status.indexOf(STATUS_GOEDGEKEURD) === 0) {
      sheet.getRange(rijNr, kVink + 1).setValue(false);
      melding(rij['Mailadress'] + ' is al goedgekeurd en is niet afgewezen. Haal eerst het vinkje bij "' + KOL_GOEDKEUREN + '" weg.');
      return 'goedgekeurd';
    }

    sheet.getRange(rijNr, kStatus + 1).setValue(STATUS_AFGEWEZEN);
    sheet.getRange(rijNr, kOp + 1).setValue(nu());
    if (rij[KOL_AFWIJZEN] !== true) sheet.getRange(rijNr, kVink + 1).setValue(true);

    if (STUUR_BEVESTIGING) {
      const taal = rij['Taal'] === 'en' ? 'en' : 'nl';
      const mail = stuurMail(rij, taal, 'afgewezen');
      if (!mail.ok) {
        sheet.getRange(rijNr, kStatus + 1).setValue(STATUS_AFGEWEZEN + ' (mail mislukt)');
        melding('Afgewezen, maar de mail naar ' + rij['Mailadress'] + ' is niet verstuurd: ' + mail.fout);
      }
    }
    return 'ok';
  } finally {
    lock.releaseLock();
  }
}

// Vinkje bij Afwijzen uit: terug naar de wachtrij. De mail blijft verstuurd.
function zetAfwijzingTerug(sheet, rijNr) {
  const koppen = koppenVan(sheet, WACHTRIJ_KOPPEN);
  const kStatus = koppen.indexOf(KOL_STATUS) + 1, kOp = koppen.indexOf(KOL_AFGEWEZEN_OP) + 1;
  const status = String(sheet.getRange(rijNr, kStatus).getValue()).trim();
  if (status.indexOf(STATUS_AFGEWEZEN) !== 0) return;
  sheet.getRange(rijNr, kStatus).setValue(STATUS_WACHTRIJ);
  sheet.getRange(rijNr, kOp).setValue('');
  melding('Terug in de wachtrij. Let op: de mail dat het vol zit was al verstuurd.');
}

/* ---------- herinnering vlak voor de première ---------- */

/**
 * Vinkje "Herinnering sturen" aan: stuurt de herinnering naar die ene rij en
 * vult de datum. Geeft terug: 'ok' | 'al' (datum stond al, geen tweede mail) |
 * 'niet-goedgekeurd' (vinkje gaat weer uit) | 'leeg' | 'mislukt'.
 * Binnen het slot, zodat een dubbele klik niet twee mails stuurt.
 */
function stuurHerinneringRij(sheet, rijNr) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const koppen = koppenVan(sheet, WACHTRIJ_KOPPEN);
    const kStatus = koppen.indexOf(KOL_STATUS), kVink = koppen.indexOf(KOL_HERINNERING);
    const kOp = koppen.indexOf(KOL_HERINNERING_OP);
    if (rijNr < 2 || rijNr > sheet.getLastRow()) return 'leeg';
    const eigen = sheet.getRange(rijNr, 1, 1, koppen.length).getValues()[0];
    const rij = {};
    koppen.forEach((k, i) => { rij[k] = eigen[i]; });
    if (!String(rij['Mailadress'] || '').trim()) return 'leeg';
    if (String(rij[KOL_STATUS]).trim().indexOf(STATUS_GOEDGEKEURD) !== 0) {
      sheet.getRange(rijNr, kVink + 1).setValue(false);
      melding(rij['Mailadress'] + ' is niet goedgekeurd, dus geen herinnering. Keur de rij eerst goed.');
      return 'niet-goedgekeurd';
    }
    if (String(rij[KOL_HERINNERING_OP]).trim()) {
      melding('De herinnering naar ' + rij['Mailadress'] + ' is al verstuurd op ' + rij[KOL_HERINNERING_OP] + '. Nog eens sturen: menu Première → Herinnering (opnieuw) sturen naar geselecteerde rijen.');
      return 'al';
    }
    const uitkomst = verstuurHerinneringen(sheet, koppen, [rijNr]);
    return uitkomst.gelukt === 1 ? 'ok' : 'mislukt';
  } finally {
    lock.releaseLock();
  }
}

/**
 * Menu: de herinneringsmail naar iedereen met Status "Goedgekeurd" die hem nog
 * niet had (kolom "Herinnering verstuurd op" leeg). Vraagt eerst om bevestiging
 * en houdt het dagquotum van MailApp in de gaten: is dat op, dan stopt het en
 * zegt de melding hoeveel rijen er nog wachten; morgen gewoon nog eens draaien.
 * Ook aan te roepen via Run → stuurHerinneringen (zonder bevestigingsvraag).
 */
function stuurHerinneringen() {
  const sheet = openSheet();
  const koppen = koppenVan(sheet, WACHTRIJ_KOPPEN);
  const kStatus = koppen.indexOf(KOL_STATUS), kOp = koppen.indexOf(KOL_HERINNERING_OP);
  const kMail = koppen.indexOf('Mailadress'), kAantal = koppen.indexOf('Aantal personen');
  const laatsteRij = sheet.getLastRow();
  const rijNrs = [];
  let personen = 0;
  if (laatsteRij > 1) {
    const rijen = sheet.getRange(2, 1, laatsteRij - 1, koppen.length).getValues();
    for (let i = 0; i < rijen.length; i++) {
      if (String(rijen[i][kStatus]).trim().indexOf(STATUS_GOEDGEKEURD) !== 0) continue;
      if (!String(rijen[i][kMail]).trim() || String(rijen[i][kOp]).trim()) continue;
      rijNrs.push(i + 2);
      personen += parseInt(rijen[i][kAantal], 10) || 1;
    }
  }
  if (!rijNrs.length) { melding('Iedereen die goedgekeurd is, heeft de herinnering al gehad.'); return; }
  const quotum = MailApp.getRemainingDailyQuota();
  if (!bevestig('Herinnering sturen naar ' + rijNrs.length + ' gasten (' + personen + ' personen)?\n' +
      'Vandaag kunnen er nog ' + quotum + ' mails weg.' + (quotum < rijNrs.length ? ' Dat is niet genoeg: de rest kun je morgen sturen.' : ''))) {
    melding('Niets verstuurd.');
    return;
  }
  verstuurHerinneringen(sheet, koppen, rijNrs);
}

// Menu: de herinnering (nog eens) naar de geselecteerde rijen, ook als die hem al hadden.
function stuurHerinneringSelectie() {
  const sheet = openSheet();
  const sel = sheet.getActiveRange();
  if (!sel) { melding('Selecteer eerst een of meer rijen.'); return; }
  const koppen = koppenVan(sheet, WACHTRIJ_KOPPEN);
  const kStatus = koppen.indexOf(KOL_STATUS), kMail = koppen.indexOf('Mailadress');
  const rijNrs = [], overgeslagen = [];
  for (let r = Math.max(2, sel.getRow()); r < sel.getRow() + sel.getNumRows() && r <= sheet.getLastRow(); r++) {
    const eigen = sheet.getRange(r, 1, 1, koppen.length).getValues()[0];
    if (!String(eigen[kMail]).trim()) continue;
    if (String(eigen[kStatus]).trim().indexOf(STATUS_GOEDGEKEURD) === 0) rijNrs.push(r);
    else overgeslagen.push(String(eigen[kMail]).trim());
  }
  if (overgeslagen.length) melding('Niet goedgekeurd, dus geen herinnering: ' + overgeslagen.join(', '));
  if (!rijNrs.length) { if (!overgeslagen.length) melding('Geen aanmeldingen in de selectie.'); return; }
  if (!bevestig('Herinnering sturen naar ' + rijNrs.length + (rijNrs.length === 1 ? ' gast' : ' gasten') + ' in de selectie?')) {
    melding('Niets verstuurd.');
    return;
  }
  verstuurHerinneringen(sheet, koppen, rijNrs);
}

/** Stuurt de herinnering naar de rijen, vult de datum en zet het vinkje aan.
 *  Stopt als het quotum op is. Geeft { gelukt, mislukt, quotumOp } terug. */
function verstuurHerinneringen(sheet, koppen, rijNrs) {
  const kOp = koppen.indexOf(KOL_HERINNERING_OP), kVink = koppen.indexOf(KOL_HERINNERING);
  let gelukt = 0, mislukt = [], quotumOp = 0;
  for (let i = 0; i < rijNrs.length; i++) {
    if (MailApp.getRemainingDailyQuota() < 1) { quotumOp = rijNrs.length - i; break; }
    const eigen = sheet.getRange(rijNrs[i], 1, 1, koppen.length).getValues()[0];
    const rij = {};
    koppen.forEach((k, j) => { rij[k] = eigen[j]; });
    const taal = rij['Taal'] === 'en' ? 'en' : 'nl';
    const mail = stuurMail(rij, taal, 'herinnering');
    if (mail.ok) {
      sheet.getRange(rijNrs[i], kOp + 1).setValue(nu());
      if (rij[KOL_HERINNERING] !== true) sheet.getRange(rijNrs[i], kVink + 1).setValue(true);
      gelukt++;
    } else {
      // Geen datum en vinkje uit, zodat de rij bij een volgende ronde weer meegaat.
      if (rij[KOL_HERINNERING] === true) sheet.getRange(rijNrs[i], kVink + 1).setValue(false);
      mislukt.push(rij['Mailadress'] + ' (' + mail.fout + ')');
    }
  }
  let tekst = (gelukt === 1 ? '1 herinnering verstuurd.' : gelukt + ' herinneringen verstuurd.');
  if (mislukt.length) tekst += ' Mislukt: ' + mislukt.join(', ') + '.';
  if (quotumOp) tekst += ' Het dagquotum is op: ' + quotumOp + ' rijen wachten nog, draai dit morgen opnieuw.';
  melding(tekst);
  return { gelukt: gelukt, mislukt: mislukt.length, quotumOp: quotumOp };
}

// Ja/nee-vraag in de sheet. Vanuit de editor (Run) is er geen venster: dan is het ja.
function bevestig(vraag) {
  let ui;
  try { ui = SpreadsheetApp.getUi(); } catch (err) { console.log('Geen venster, dus door: ' + vraag); return true; }
  return ui.alert('Première', vraag, ui.ButtonSet.YES_NO) === ui.Button.YES;
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
  // Voor de herinnering: route, de twee zalen en de foto's (staan in de root
  // van de site, dus pas na een deploy bereikbaar).
  route: 'https://www.google.com/maps/search/?api=1&query=Het+Vondelpark+Paviljoen%2C+Vondelpark+3%2C+1071+AA+Amsterdam',
  foyer: 'https://hetvondelparkpaviljoen.nl/zalen/de-foyer-bar/',
  spiegel: 'https://hetvondelparkpaviljoen.nl/zalen/de-spiegel/',
  fotoFoyer: 'https://backtobeing.tech/premiere-foyer.jpg',
  fotoSpiegel: 'https://backtobeing.tech/premiere-spiegel.jpg',
};

// Teksten van de drie mails rond de aanmelding. De algemene regels staan per
// taal bovenaan; per soort ('wachtrij' na de aanmelding, 'goedgekeurd' en
// 'afgewezen' na een vinkje in de sheet) verschillen onderwerp, preheader,
// titel, intro en de titel van het kaartje. Een soort mag ook een algemene
// regel overschrijven. Leeg = weglaten: 'afgewezen' heeft geen kaartje en geen
// voetnoot, wel een tweede alinea ('vervolg').
// De herinnering vlak voor de première heeft een eigen ontwerp: HERINNERING_TEKST.
const MAIL_TEKST = {
  nl: {
    aanhef: 'Beste {{naam}},',
    bezoeker: 'Bezoeker',
    aantal: 'Aantal personen',
    noot: 'De première is op dinsdag 3 november 2026 in Het Vondelpark Paviljoen, Vondelpark 3, 1071 AA Amsterdam. Inloop vanaf 19:00, tot uiterlijk 21:00. Meer over de locatie: https://hetvondelparkpaviljoen.nl/',
    groet: 'Tot snel,',
    team: 'Team Back to Being',
    reden: 'Je ontvangt deze e-mail omdat je je hebt aangemeld voor de première van Back to Being.',
    voorkeuren: 'Voorkeuren aanpassen',
    website: 'Website',
    wachtrij: {
      onderwerp: 'Je aanmelding voor de première van Back to Being is ontvangen',
      preheader: 'Je staat op de reservelijst. Komt er een plek vrij, dan laten we het je meteen weten.',
      titel: 'Je staat op de reservelijst voor de première van Back to Being',
      intro: 'Wat fijn dat je erbij wilt zijn. Alle 70 plekken zijn inmiddels vergeven, maar we hebben je aanmelding ontvangen en je staat nu op de reservelijst. Valt er iemand af, dan nemen we de reservelijst op volgorde van aanmelding door. Zodra er een plek voor je is, laten we het je per mail weten.',
      kaartTitel: 'Aanmeldingsgegevens',
    },
    goedgekeurd: {
      onderwerp: 'Je bent erbij: je plek voor de première van Back to Being is bevestigd',
      preheader: 'Je plek is bevestigd. Dinsdag 3 november, inloop vanaf 19:00 in Het Vondelpark Paviljoen in Amsterdam.',
      titel: 'Je plek voor de première van Back to Being is bevestigd',
      intro: 'Goed nieuws: je bent erbij. Wat ontzettend fijn dat je komt. We kijken er enorm naar uit om dit bijzondere moment samen te beleven en de documentaire voor het eerst met jou te delen.',
      kaartTitel: 'Je plek',
    },
    afgewezen: {
      onderwerp: 'De première van Back to Being zit vol, maar je staat op de reservelijst',
      preheader: 'Alle 70 plekken zijn vergeven. Meldt iemand zich af, dan hoor je van ons dat je mag komen.',
      titel: 'De première zit vol, maar je staat op de reservelijst',
      intro: 'Wat fijn dat je erbij wilt zijn. Helaas waren er veel meer aanmeldingen dan de 70 plekken die we hebben, en die zijn inmiddels allemaal vergeven. We hebben je daarom op de reservelijst gezet.',
      vervolg: 'Meldt iemand zich af, dan komt die plek vrij en nemen we de reservelijst op volgorde van aanmelding door. Je krijgt dan een mail dat je mag komen; je hoeft verder niets te doen. Lukt het uiteindelijk niet, dan hoef je de documentaire niet te missen: na de première op 3 november komt hij naar verwachting online, op backtobeing.tech en op onze socials.',
      kaartTitel: '',
      noot: '',
      groet: 'Hartelijke groet,',
    },
  },
  en: {
    aanhef: 'Dear {{naam}},',
    bezoeker: 'Visitor',
    aantal: 'Number of people',
    noot: 'The premiere is on Tuesday 3 November 2026 at Het Vondelpark Paviljoen, Vondelpark 3, 1071 AA Amsterdam. Doors open at 19:00, ends by 21:00 at the latest. More about the venue: https://hetvondelparkpaviljoen.nl/',
    groet: 'See you soon,',
    team: 'Team Back to Being',
    reden: 'You are receiving this email because you signed up for the premiere of Back to Being.',
    voorkeuren: 'Change Preferences',
    website: 'Website',
    wachtrij: {
      onderwerp: 'We received your sign-up for the premiere of Back to Being',
      preheader: 'You are on the reserve list. If a place opens up, we will let you know right away.',
      titel: 'You are on the reserve list for the premiere of Back to Being',
      intro: "We're glad you want to be there. All 70 places have now been taken, but we received your sign-up and you are on the reserve list. If someone drops out, we go through the reserve list in order of sign-up. As soon as there is a place for you, we will let you know by email.",
      kaartTitel: 'Registration Information',
    },
    goedgekeurd: {
      onderwerp: 'You are in: your place at the premiere of Back to Being is confirmed',
      preheader: 'Your place is confirmed. Tuesday 3 November, doors open at 19:00 at Het Vondelpark Paviljoen in Amsterdam.',
      titel: 'Your place at the premiere of Back to Being is confirmed',
      intro: "Good news: you're in. We're really looking forward to experiencing this special moment together and sharing the documentary with you for the first time.",
      kaartTitel: 'Your place',
    },
    afgewezen: {
      onderwerp: 'The premiere of Back to Being is full, but you are on the reserve list',
      preheader: 'All 70 places are taken. If someone cancels, we will let you know that you can come.',
      titel: 'The premiere is full, but you are on the reserve list',
      intro: 'Thank you for wanting to be there. Unfortunately there were many more sign-ups than the 70 places we have, and all of them are now taken. We have therefore put you on the reserve list.',
      vervolg: 'If someone cancels, that place opens up and we go through the reserve list in order of sign-up. You will then get an email that you can come; there is nothing else you need to do. If it does not work out in the end, you do not have to miss the documentary: after the premiere on 3 November we expect to put it online, on backtobeing.tech and on our socials.',
      kaartTitel: '',
      noot: '',
      groet: 'Warm regards,',
    },
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Bouwt een mail (onderwerp, platte tekst en HTML) uit de rij.
 * soort: 'wachtrij' (na de aanmelding), 'goedgekeurd' of 'afgewezen' (na een
 * vinkje in de sheet) of 'herinnering' (via het menu, een week voor de
 * première; eigen ontwerp, zie bouwHerinnering).
 * Placeholders: {{naam}} = voornaam in de aanhef, volledige naam op het kaartje;
 * het aantal personen komt uit de rij.
 */
function bouwMail(rij, taal, soort) {
  const basis = MAIL_TEKST[taal === 'en' ? 'en' : 'nl'];
  if (soort === 'herinnering') return bouwHerinnering(rij, taal);
  const t = Object.assign({}, basis, basis[soort === 'goedgekeurd' || soort === 'afgewezen' ? soort : 'wachtrij']);
  const voornaam = rij['Voornaam'];
  const volledigeNaam = (rij['Voornaam'] + ' ' + rij['Achternaam']).trim();
  const aantal = String(rij['Aantal personen']);
  const k = MAIL_KLEUR;

  // Lege onderdelen (vervolg, kaartje, voetnoot) vallen weg.
  const tekst = [
    t.aanhef.replace('{{naam}}', voornaam),
    t.intro,
    t.vervolg,
    t.kaartTitel && (t.kaartTitel + '\n' + t.bezoeker + ': ' + volledigeNaam + '\n' + t.aantal + ': ' + aantal),
    t.noot,
    t.groet + '\n' + t.team,
    t.reden + '\n' + MAIL_LINKS.website,
  ].filter(Boolean).join('\n\n');

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
    (t.vervolg ? '<p style="margin:0 0 20px;font-family:' + MAIL_SANS + ';font-size:14px;line-height:1.6;color:' + k.ink + ';">' + escapeHtml(t.vervolg) + '</p>' : '') +

    // Kaartje met aanmeldingsgegevens (niet in de afwijzingsmail)
    (t.kaartTitel ?
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + k.kaart + ';border:1px solid ' + k.sand + ';border-radius:11px;">' +
    '<tr><td style="padding:24px;">' +
    '<div style="margin:0 0 16px;font-family:' + MAIL_SERIF + ';font-style:italic;font-size:20px;color:' + k.tree + ';">' + escapeHtml(t.kaartTitel) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:' + MAIL_SANS + ';font-size:13px;color:' + k.ink + ';">' +
    '<tr><td style="padding:0 0 8px;color:' + k.inkLicht + ';">' + escapeHtml(t.bezoeker) + '</td><td align="right" style="padding:0 0 8px;font-weight:600;">' + escapeHtml(volledigeNaam) + '</td></tr>' +
    '<tr><td colspan="2" style="border-top:1px solid ' + k.lijn + ';font-size:0;line-height:0;">&nbsp;</td></tr>' +
    '<tr><td style="padding:8px 0 0;color:' + k.inkLicht + ';">' + escapeHtml(t.aantal) + '</td><td align="right" style="padding:8px 0 0;font-weight:600;">' + escapeHtml(aantal) + '</td></tr>' +
    '</table>' +
    '</td></tr></table>' : '') +

    (t.noot ? '<p style="margin:20px 0 0;font-family:' + MAIL_SANS + ';font-size:13px;line-height:1.6;color:' + k.inkZacht + ';">' + escapeHtml(t.noot) + '</p>' : '') +
    '<p style="margin:' + (t.kaartTitel || t.noot ? '36px' : '16px') + ' 0 0;font-family:' + MAIL_SANS + ';font-size:14px;color:' + k.ink + ';">' + escapeHtml(t.groet) + '</p>' +
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

// De herinnering een week voor de première. Ontwerp uit Figma, frame
// "back-to-being-herinnering-premiere-nl" (node 39-2); de Engelse versie
// (node 52-5) is hier een vertaling van de Nederlandse.
// **vet** in een alinea wordt vet in de mail; {{naam}} = voornaam.
const HERINNERING_TEKST = {
  nl: {
    onderwerp: 'Reminder: Nog één week tot de première van Back to Being',
    preheader: 'Dinsdag 3 november, vanaf 19.00 uur in Het Vondelparkpaviljoen. Alles wat je moet weten op een rij.',
    titel: 'Nog één week tot de première',
    datum: '3 november 2026',
    aanhef: 'Hi {{naam}},',
    intro: [
      'Over precies een week, gaat **Back to Being** in première, en jij bent erbij!',
      'Met meer dan 120 aanmeldingen en slechts 70 beschikbare plekken kijken we ernaar uit om jou op deze bijzondere locatie te verwelkomen en de première samen te beleven.',
    ],
    kopPraktisch: 'Praktische informatie',
    praktisch: [
      'Vanaf **19.00 uur** ben je van harte welkom om in de foyer alvast gezellig een drankje te drinken, bestel gerust waar je zin in hebt, want alle drankjes zijn voor onze rekening.',
      'Om **19.30 uur** begint de première en sluiten de deuren, zorg dus dat je op tijd aanwezig bent om rustig binnen te komen en je plek in te nemen.',
      'We rekenen op je komst, maar mocht je toch verhinderd zijn of vertraging hebben, laat het ons dan zo snel mogelijk weten via **06 83032377**, zodat we bij een afmelding iemand anders blij kunnen maken met jouw plek.',
    ],
    kopLocatie: 'Locatie',
    adres: ['Het Vondelparkpaviljoen', 'Vondelpark 3', '1071 AA Amsterdam'],
    routeLink: 'Bekijk de locatie in Google Maps',
    kopImpressies: 'Impressies van de locatie',
    fotos: [
      { titel: 'Foyer', tekst: 'Een warm welkom in de foyer.', src: MAIL_LINKS.fotoFoyer, href: MAIL_LINKS.foyer },
      { titel: 'Bioscoopzaal', tekst: 'De Spiegel in het paviljoen.', src: MAIL_LINKS.fotoSpiegel, href: MAIL_LINKS.spiegel },
    ],
    slot: 'Tot bij de première!',
    groet: 'Met vriendelijke groet,',
    afzender: ['Caesar Schoorl', 'Team Back to Being'],
    meerInfo: 'Meer informatie',
    // De voettekst: label, linktekst, link. Gescheiden door bolletjes.
    links: [
      ['Website', 'backtobeing.tech', MAIL_LINKS.website],
      ['Instagram', '@backtobeingtech', MAIL_LINKS.instagram],
      ['TikTok', '@backtobeing.tech', MAIL_LINKS.tiktok],
      ['YouTube', 'Back to Being', MAIL_LINKS.youtube],
      ['Route', 'Google Maps', MAIL_LINKS.route],
    ],
    ruimtes: 'Ruimtes',
    ruimteLinks: [['Foyer', MAIL_LINKS.foyer], ['De Spiegel', MAIL_LINKS.spiegel]],
  },
  en: {
    onderwerp: 'Reminder: One week to go until the premiere of Back to Being',
    preheader: 'Tuesday 3 November, from 19:00 at Het Vondelparkpaviljoen. Everything you need to know at a glance.',
    titel: 'One week to go until the premiere',
    datum: '3 November 2026',
    aanhef: 'Hi {{naam}},',
    intro: [
      "In exactly one week, **Back to Being** premieres, and you're in!",
      'With more than 120 sign-ups and only 70 available places, we look forward to welcoming you at this special venue and experiencing the premiere together.',
    ],
    kopPraktisch: 'Practical information',
    praktisch: [
      "From **19:00** you're welcome in the foyer for a drink beforehand. Order whatever you like: all drinks are on us.",
      'At **19:30** the premiere starts and the doors close, so please make sure you arrive on time to come in calmly and take your seat.',
      "We're counting on you, but if you can't make it after all or are running late, please let us know as soon as possible on **+31 6 83032377**, so that if you cancel we can make someone else happy with your place.",
    ],
    kopLocatie: 'Venue',
    adres: ['Het Vondelparkpaviljoen', 'Vondelpark 3', '1071 AA Amsterdam'],
    routeLink: 'View the location in Google Maps',
    kopImpressies: 'Impressions of the venue',
    fotos: [
      { titel: 'Foyer', tekst: 'A warm welcome in the foyer.', src: MAIL_LINKS.fotoFoyer, href: MAIL_LINKS.foyer },
      { titel: 'Cinema', tekst: 'De Spiegel in the pavilion.', src: MAIL_LINKS.fotoSpiegel, href: MAIL_LINKS.spiegel },
    ],
    slot: 'See you at the premiere!',
    groet: 'Kind regards,',
    afzender: ['Caesar Schoorl', 'Team Back to Being'],
    meerInfo: 'More information',
    links: [
      ['Website', 'backtobeing.tech', MAIL_LINKS.website],
      ['Instagram', '@backtobeingtech', MAIL_LINKS.instagram],
      ['TikTok', '@backtobeing.tech', MAIL_LINKS.tiktok],
      ['YouTube', 'Back to Being', MAIL_LINKS.youtube],
      ['Route', 'Google Maps', MAIL_LINKS.route],
    ],
    ruimtes: 'Rooms',
    ruimteLinks: [['Foyer', MAIL_LINKS.foyer], ['De Spiegel', MAIL_LINKS.spiegel]],
  },
};

// **vet** naar <strong>, de rest HTML-veilig.
function vetNaarHtml(tekst) {
  return escapeHtml(tekst).replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:600;">$1</strong>');
}

/** De herinneringsmail: eigen opbouw, zelfde kleuren en lettertypes als de andere mails. */
function bouwHerinnering(rij, taal) {
  const t = HERINNERING_TEKST[taal === 'en' ? 'en' : 'nl'];
  const k = MAIL_KLEUR;
  const aanhef = t.aanhef.replace('{{naam}}', rij['Voornaam']);
  const plat = s => s.replace(/\*\*/g, '');

  const tekst = [
    aanhef,
    t.intro.map(plat).join('\n\n'),
    t.kopPraktisch + '\n\n' + t.praktisch.map(plat).join('\n\n'),
    t.kopLocatie + '\n' + t.adres.join('\n') + '\n' + t.routeLink + ': ' + MAIL_LINKS.route,
    t.kopImpressies + '\n' + t.fotos.map(f => f.titel + ': ' + f.tekst + ' ' + f.href).join('\n'),
    t.slot,
    t.groet + '\n' + t.afzender.join('\n'),
    t.meerInfo + '\n' + t.links.map(l => l[0] + ': ' + l[2]).join('\n') + '\n' + t.ruimtes + ': ' + t.ruimteLinks.map(r => r[0] + ' ' + r[1]).join(' / '),
  ].join('\n\n');

  const alinea = s => '<p style="margin:0 0 20px;font-family:' + MAIL_SANS + ';font-size:14px;line-height:1.6;color:' + k.ink + ';">' + vetNaarHtml(s) + '</p>';
  const kop = s => '<p style="margin:28px 0 20px;font-family:' + MAIL_SANS + ';font-size:15px;font-weight:600;color:' + k.tree + ';">' + escapeHtml(s) + '</p>';
  const voetLink = (href, label) => '<a href="' + href + '" style="color:' + k.inkZacht + ';text-decoration:underline;">' + escapeHtml(label) + '</a>';
  const bolletje = ' <span style="color:' + k.sand + ';">&bull;</span> ';
  const kaart = f =>
    '<td width="50%" valign="top" style="padding:0 8px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ' + k.lijn + ';border-radius:11px;overflow:hidden;">' +
    '<tr><td style="border-radius:11px 11px 0 0;overflow:hidden;line-height:0;font-size:0;">' +
    '<a href="' + f.href + '" style="display:block;"><img src="' + f.src + '" width="100%" alt="' + escapeHtml(f.titel) + '" style="display:block;width:100%;height:auto;border:0;border-radius:11px 11px 0 0;"></a>' +
    '</td></tr>' +
    '<tr><td style="padding:16px 16px 20px;">' +
    '<div style="font-family:' + MAIL_SANS + ';font-size:14px;font-weight:600;color:' + k.tree + ';">' + escapeHtml(f.titel) + '</div>' +
    '<div style="margin-top:6px;font-family:' + MAIL_SANS + ';font-size:13px;line-height:1.5;color:' + k.inkZacht + ';">' + escapeHtml(f.tekst) + '</div>' +
    '</td></tr></table></td>';

  const html =
    '<!DOCTYPE html><html lang="' + (taal === 'en' ? 'en' : 'nl') + '"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
    '<title>' + escapeHtml(t.onderwerp) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">' +
    '</head>' +
    '<body style="margin:0;padding:0;background:' + k.canvas + ';">' +
    '<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:' + k.canvas + ';opacity:0;">' + escapeHtml(t.preheader) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + k.canvas + ';">' +
    '<tr><td align="center" style="padding:48px 0 0;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">' +

    // Titel en datum
    '<tr><td align="center" style="padding:40px 32px 0;">' +
    '<div style="font-family:' + MAIL_SERIF + ';font-size:36px;line-height:1.15;color:' + k.tree + ';">' + escapeHtml(t.titel) + '</div>' +
    '<div style="margin-top:24px;font-family:' + MAIL_SERIF + ';font-size:18px;color:' + k.inkZacht + ';">' + escapeHtml(t.datum) + '</div>' +
    '</td></tr>' +

    // Bericht
    '<tr><td style="padding:40px 32px 0;">' +
    '<p style="margin:0 0 28px;font-family:' + MAIL_SANS + ';font-size:15px;font-weight:500;color:' + k.ink + ';">' + escapeHtml(aanhef) + '</p>' +
    t.intro.map(alinea).join('') +
    kop(t.kopPraktisch) +
    t.praktisch.map(alinea).join('') +
    kop(t.kopLocatie) +
    '<p style="margin:0;font-family:' + MAIL_SANS + ';font-size:14px;line-height:1.6;color:' + k.ink + ';">' + t.adres.map(escapeHtml).join('<br>') + '<br>' +
    '<a href="' + MAIL_LINKS.route + '" style="color:' + k.ink + ';font-weight:600;text-decoration:underline;">' + escapeHtml(t.routeLink) + '</a></p>' +
    kop(t.kopImpressies) +
    '</td></tr>' +

    // Fotokaarten
    '<tr><td style="padding:0 24px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' + t.fotos.map(kaart).join('') + '</tr></table>' +
    '</td></tr>' +

    // Afsluiting
    '<tr><td style="padding:40px 32px 56px;">' +
    '<p style="margin:0 0 24px;font-family:' + MAIL_SANS + ';font-size:14px;line-height:1.6;color:' + k.ink + ';">' + escapeHtml(t.slot) + '</p>' +
    '<p style="margin:0 0 24px;font-family:' + MAIL_SERIF + ';font-style:italic;font-size:18px;color:' + k.tree + ';">' + escapeHtml(t.groet) + '</p>' +
    '<p style="margin:0;font-family:' + MAIL_SERIF + ';font-style:italic;font-size:18px;line-height:1.4;color:' + k.tree + ';">' + t.afzender.map(escapeHtml).join('<br>') + '</p>' +
    '</td></tr>' +
    '</table></td></tr>' +

    // Voettekst: meer informatie
    '<tr><td align="center" style="background:' + k.kaart + ';border-top:1px solid ' + k.lijn + ';padding:32px 0 40px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;"><tr><td style="padding:0 32px;">' +
    '<p style="margin:0 0 12px;font-family:' + MAIL_SANS + ';font-size:13px;font-weight:600;color:' + k.ink + ';">' + escapeHtml(t.meerInfo) + '</p>' +
    '<p style="margin:0;font-family:' + MAIL_SANS + ';font-size:12px;line-height:1.8;color:' + k.inkZacht + ';">' +
    t.links.map(l => escapeHtml(l[0]) + ': ' + voetLink(l[2], l[1])).join(bolletje) + bolletje +
    escapeHtml(t.ruimtes) + ': ' + t.ruimteLinks.map(r => voetLink(r[1], r[0])).join(' / ') +
    '</p>' +
    '</td></tr></table>' +
    '</td></tr>' +

    '</table></body></html>';

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
 * Stuurt de echte wachtrij-mail, de goedkeuringsmail, de afwijzingsmail en de
 * herinneringsmail (NL) naar jezelf, zonder iets in de sheet te zetten. Bewust zonder try/catch: ontbreekt de toestemming
 * om te mailen, dan vraagt Google er nu om, en elke andere fout staat leesbaar
 * in het Execution log.
 */
function testMail() {
  const aan = Session.getActiveUser().getEmail();
  console.log('Nog te versturen vandaag: ' + MailApp.getRemainingDailyQuota());
  const rij = { 'Voornaam': 'Test', 'Achternaam': 'Persoon', 'Mailadress': aan, 'Aantal personen': 2 };
  ['wachtrij', 'goedgekeurd', 'afgewezen', 'herinnering'].forEach(soort => {
    const mail = bouwMail(rij, 'nl', soort);
    MailApp.sendEmail({ to: aan, subject: 'Test: ' + mail.onderwerp, body: mail.tekst, htmlBody: mail.html, name: AFZENDER_NAAM });
  });
  console.log('Vier testmails verstuurd naar ' + aan);
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
