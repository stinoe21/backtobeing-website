/**
 * Back to Being — Camino paklijst herstructureren
 *
 * Plak dit volledige bestand in Apps Script vanuit je Google Sheet:
 *   Extensions → Apps Script → vervang Code.gs door dit bestand → Save → Run "updatePaklijst"
 * Eenmalig zal Google om toestemming vragen (Allow → eventueel "Go to <project> (unsafe)" → Allow).
 * Daarna bouwt het script 5 tabbladen volledig opnieuw op:
 *   1. Samenvatting
 *   2. Must-have (€~9.200)
 *   3. Nice-to-have (€~20.300)
 *   4. Scenario's (A/B/C/D)
 *   5. Sponsor-pijplijn
 *
 * Het script is idempotent — runnen kan zo vaak als je wilt.
 * Bestaande tabbladen met deze namen worden vervangen; andere tabs blijven onaangetast.
 *
 * Aannames (pas naar smaak aan in de tabbladen zelf):
 *   - 3 personen: Max Helmantel, Stijn Smit, Caesar Schoorl
 *   - 8 nachten (1 buffer Porto + 6 wandel + 1 Santiago)
 *   - 6 wandeldagen, 120 km Tui → Santiago, eind augustus 2026
 *   - 1× MacBook Air must-have (Stijn), 2× nice-to-have (Max + Caesar)
 *   - Trail runners i.p.v. boots (lichter, beter in hitte)
 *   - Monako Glass: $399 + $19 deposit ≈ €385 p.s. + import-marge in buffer
 */

// === Kleuren (matchen landing page palette) ===
const C = {
  tree:      '#2a3723',
  grass:     '#97a081',
  sky:       '#a7bdd5',
  charcoal:  '#161616',
  canvas:    '#fffef1',
  sand:      '#b9a26e',
  cream:     '#f4f1e6',
  inkSoft:   '#5a5a5a',
  rowAlt:    '#fbfaf2',
  headerBg:  '#2a3723',
  headerFg:  '#fffef1',
  catBg:     '#97a081',
  catFg:     '#161616',
  totalBg:   '#b9a26e',
  totalFg:   '#161616',
  sponsorBg: '#fff4d6',
};

function updatePaklijst() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Volgorde is belangrijk vanwege cross-tab formules:
  //   Must-have/Nice-to-have  →  Scenario's  →  Samenvatting (verwijst naar Scenario's)
  // Eén bron van waarheid voor de scenario-bedragen = de Scenario's-tab.
  buildMustHave(ss);
  buildNiceToHave(ss);
  SpreadsheetApp.flush(); // forceer dat de SUM-formules in E1 gerekend zijn

  buildScenarios(ss);
  SpreadsheetApp.flush();

  buildSummary(ss);
  buildSponsorPipeline(ss);
  SpreadsheetApp.flush(); // forceer dat de cross-tab formules opnieuw geëvalueerd zijn

  // Volgorde van tabs forceren
  const order = ['Samenvatting', 'Must-have', 'Nice-to-have', "Scenario's", 'Sponsor-pijplijn'];
  order.forEach((name, i) => {
    const sh = ss.getSheetByName(name);
    if (sh) {
      ss.setActiveSheet(sh);
      ss.moveActiveSheet(i + 1);
    }
  });

  ss.setActiveSheet(ss.getSheetByName('Samenvatting'));
  SpreadsheetApp.getActive().toast('Paklijst bijgewerkt ✓', 'Back to Being', 4);
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function resetSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet(name);
  return sh;
}

function styleHeader_(sh, row, cols) {
  sh.getRange(row, 1, 1, cols)
    .setBackground(C.headerBg)
    .setFontColor(C.headerFg)
    .setFontWeight('bold')
    .setFontSize(11)
    .setVerticalAlignment('middle');
  sh.setRowHeight(row, 32);
}

function styleCategory_(sh, row, cols, label) {
  sh.getRange(row, 1).setValue(label);
  sh.getRange(row, 1, 1, cols)
    .merge()
    .setBackground(C.catBg)
    .setFontColor(C.catFg)
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('left');
  sh.setRowHeight(row, 28);
}

function styleTotalRow_(sh, row, cols) {
  sh.getRange(row, 1, 1, cols)
    .setBackground(C.totalBg)
    .setFontColor(C.totalFg)
    .setFontWeight('bold')
    .setFontSize(11);
}

function styleSponsorRow_(sh, row, cols) {
  sh.getRange(row, 1, 1, cols).setBackground(C.sponsorBg);
}

function autosize_(sh, cols) {
  for (let c = 1; c <= cols; c++) sh.autoResizeColumn(c);
}

function setColumnWidths_(sh, widths) {
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));
}

// Dropdown-regel voor de "Hebben / halen"-kolom
function makeHaveRule_() {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(['Nog halen', 'Besteld', 'Hebben we', 'Sponsor aangevraagd', 'Sponsor binnen'], true)
    .setAllowInvalid(true)
    .build();
}

// Begintoestand afleiden uit de oude 'status'
function mapHave_(status) {
  return status === 'Wachten' ? 'Sponsor aangevraagd' : 'Nog halen';
}

// Kleurcodering voor de "Hebben / halen"-kolom (kolom H = 8)
function addHaveConditionalFormatting_(sh, firstRow, lastRow) {
  if (!firstRow) return;
  const range = sh.getRange(firstRow, 8, lastRow - firstRow + 1, 1);
  const mk = (text, bg) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(text).setBackground(bg).setRanges([range]).build();
  const rules = sh.getConditionalFormatRules();
  rules.push(mk('Hebben we',          '#cfe6c4'));  // groen
  rules.push(mk('Sponsor binnen',     '#cfe6c4'));  // groen
  rules.push(mk('Besteld',            '#d7e3f0'));  // sky
  rules.push(mk('Sponsor aangevraagd', C.sponsorBg)); // geel
  rules.push(mk('Nog halen',          '#f3e2d0'));  // zand
  sh.setConditionalFormatRules(rules);
}

function hideGridlines_(sh) {
  try {
    Sheets.Spreadsheets.batchUpdate({
      requests: [{
        updateSheetProperties: {
          properties: { sheetId: sh.getSheetId(), gridProperties: { hideGridlines: true } },
          fields: 'gridProperties.hideGridlines'
        }
      }]
    }, sh.getParent().getId());
  } catch (e) {
    // Advanced Sheets service niet ingeschakeld — laat gridlines staan, geen blocker
  }
}

// ----------------------------------------------------------------------------
// 1. Samenvatting
// ----------------------------------------------------------------------------
function buildSummary(ss) {
  const sh = resetSheet_(ss, 'Samenvatting');

  // Titel
  sh.getRange('A1').setValue('Back to Being — Camino paklijst');
  sh.getRange('A1:F1').merge()
    .setBackground(C.headerBg).setFontColor(C.headerFg)
    .setFontWeight('bold').setFontSize(20)
    .setHorizontalAlignment('left').setVerticalAlignment('middle');
  sh.setRowHeight(1, 56);

  sh.getRange('A2').setValue('The world as our office · 120 km Tui → Santiago · eind augustus 2026');
  sh.getRange('A2:F2').merge()
    .setBackground(C.cream).setFontColor(C.charcoal)
    .setFontSize(11).setHorizontalAlignment('left').setVerticalAlignment('middle');
  sh.setRowHeight(2, 28);

  // Meta
  const meta = [
    ['Wandelaars',    'Max Helmantel · Stijn Smit · Caesar Schoorl'],
    ['Route',         'Camino Portugués: Tui (PT-grens) → Santiago de Compostela'],
    ['Afstand',       '120 km in 6 wandeldagen'],
    ['Verblijf',      '8 nachten totaal (1× Porto vooraf + 6× onderweg + 1× Santiago)'],
    ['Beneficiary',   'Stichting MIND — AI-tool wordt gratis overgedragen'],
    ['Docu',          'Hybride: eigen lichte kit + freelance cinematograaf key-dagen'],
    ['Budget cap',    '€30.000'],
  ];
  sh.getRange(4, 1, meta.length, 2).setValues(meta);
  sh.getRange(4, 1, meta.length, 1)
    .setFontWeight('bold').setBackground(C.cream);
  sh.getRange(4, 2, meta.length, 1).setBackground('#ffffff');

  // Bedragen-blok (formulas naar andere tabs)
  const startRow = 4 + meta.length + 2;
  sh.getRange(startRow - 1, 1).setValue('SCENARIO\'S').setFontWeight('bold').setFontSize(12);

  // Verwijst naar de Scenario's-tab (enige bron van waarheid).
  // Tabnaam bevat een apostrof → in formules verdubbeld: 'Scenario''s'.
  const scenarios = [
    ['Scenario A — Go Minimal',
      'Alleen must-have, alles zelf betalen',
      "='Scenario''s'!D4"],
    ['Scenario B — Ideaal (zelf betalen)',
      'Must + nice, alles zelf betalen',
      "='Scenario''s'!D5"],
    ['Scenario C — Met product-sponsoring',
      'Starlink + EcoFlow + Monako + 50% Decathlon + Apple-leen + camera-leen weggehaald',
      "='Scenario''s'!D6"],
    ['Scenario D — Met productie-partner (Videoland/RTL)',
      'Bovenop C: editor + distributie gedekt door productie-partner',
      "='Scenario''s'!D7"],
  ];

  styleHeader_(sh, startRow, 3);
  sh.getRange(startRow, 1, 1, 3).setValues([['Scenario', 'Toelichting', 'Bedrag']]);

  scenarios.forEach((row, i) => {
    const r = startRow + 1 + i;
    // Tekst-velden via setValues, formule expliciet via setFormula (NL-locale-safe)
    sh.getRange(r, 1, 1, 2).setValues([[row[0], row[1]]]);
    sh.getRange(r, 3).setFormula(row[2]);
    sh.getRange(r, 3).setNumberFormat('€#,##0').setFontWeight('bold');
    if (i % 2 === 1) sh.getRange(r, 1, 1, 3).setBackground(C.rowAlt);
  });

  // Footer
  const noteRow = startRow + scenarios.length + 3;
  sh.getRange(noteRow, 1).setValue(
    'Notities: bedragen worden automatisch berekend uit tabbladen "Must-have" en "Nice-to-have". ' +
    'Pas aantallen of prijzen daar aan; deze tab volgt vanzelf.'
  ).setFontColor(C.inkSoft).setFontStyle('italic');
  sh.getRange(noteRow, 1, 1, 6).merge().setWrap(true);
  sh.setRowHeight(noteRow, 40);

  setColumnWidths_(sh, [260, 460, 130, 100, 100, 100]);
  sh.setFrozenRows(2);
  hideGridlines_(sh);
}

// ----------------------------------------------------------------------------
// 2. Must-have
// ----------------------------------------------------------------------------
function buildMustHave(ss) {
  const sh = resetSheet_(ss, 'Must-have');

  // Rij 1 = GRAND TOTAL (formule in F1) + inpak-teller, rij 3 = headers
  sh.getRange('A1').setValue('TOTAAL must-have').setFontWeight('bold');
  sh.getRange('B1').setValue('Ingepakt:').setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange('C1').setFormula('=COUNTIF(A4:A200,TRUE)&" / "&(COUNTIF(A4:A200,TRUE)+COUNTIF(A4:A200,FALSE))')
    .setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange('E1').setValue('SOM →').setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange('F1').setFormula('=SUM(F4:F200)').setNumberFormat('€#,##0').setFontWeight('bold');
  sh.getRange('A1:F1').setBackground(C.totalBg);

  const headers = ['Ingepakt', 'Item', 'Aantal', 'Prijs €', 'Eenheid', 'Subtotaal',
                   'Eigenaar', 'Hebben / halen', 'Waar te kopen', 'Sponsor target?', 'Notitie'];
  sh.getRange(3, 1, 1, headers.length).setValues([headers]);
  styleHeader_(sh, 3, headers.length);

  const rows = [
    // [category, item, aantal, prijs, eenheid, eigenaar, waar, sponsor, status, notitie]
    ['Tech essentials',
      ['Monako Glass (AI-bril)',                3, 385, 'per stuk', 'Team',   'monako.ai',                'Sponsor: DM Candy Yue (X/LinkedIn)',     'Wachten', '$399 + $19 deposit; levering juli-aug krap'],
      ['Bluetooth muis (Logitech Pebble 2)',    3, 45,  'per stuk', 'Team',   'coolblue.nl',              '',                                       'Open',    'Voor cursor-besturing AI-agents'],
      ['Starlink Mini hardware',                1, 199, 'eenmalig', 'Team',   'starlink.com/nl',          'Sponsor: Starlink NL PR',                'Wachten', 'Was €599 bij launch'],
      ['Starlink Roam (1 mnd Regional 50GB)',   1, 50,  'per mnd',  'Team',   'starlink.com/nl/roam',     'Sponsor: Starlink NL PR',                'Wachten', ''],
      ['Kabels + USB-C adapters + extensions',  3, 40,  'per stuk', 'Team',   'bol.com',                  '',                                       'Open',    'USB-C PD, multiport, EU-plug'],
      ['Powerbank 20.000mAh (voor onderweg)',   3, 40,  'per stuk', 'Persoon','bol.com',                  '',                                       'Open',    'Bril/AirPods/telefoon laden tijdens wandelen'],
      ['Reservekabels + EU-plugs (backup)',     1, 30,  'set',      'Team',   'bol.com',                  '',                                       'Open',    'Eén kabel kapot = halve dag verloren'],
      ['MacBook Air 15" M4 — Stijn',            1, 1399,'per stuk', 'Stijn',  'apple.com/nl',             'Sponsor: Amac/CoolBlue PR',              'Wachten', 'Huidige laptop is op (zie audit)'],
    ],
    ['Slapen',
      ['Slaapzak-liner (silk/cotton)',          3, 25,  'per stuk', 'Persoon','decathlon.nl',             '',                                       'Open',    'Vaak verplicht in albergues; ~100g'],
      ['Oordoppen + slaapmasker',               3, 15,  'per stuk', 'Persoon','bol.com',                  '',                                       'Open',    'Albergues = snurkfestival'],
    ],
    ['Wandelgear',
      ['Hiking rugzak 40-50L (Forclaz MT100)',  3, 160, 'per stuk', 'Persoon','decathlon.nl',             'Sponsor: Decathlon NL marketing',        'Wachten', 'Geventileerde rug, 1.6kg'],
      ['Trail runners (Hoka/Salomon)',          3, 150, 'per stuk', 'Persoon','runnersworld.nl/decathlon','Sponsor: Decathlon NL',                  'Wachten', 'GEEN boots — augustushitte. ≥100km inlopen vooraf!'],
      ['Trekkingstokken (Forclaz MT500)',       3, 40,  'per stuk', 'Persoon','decathlon.nl',             'Sponsor: Decathlon NL',                  'Open',    '-25% druk op knieën'],
      ['Hoofdlamp (Petzl Tikkina)',             3, 25,  'per stuk', 'Persoon','decathlon.nl',             '',                                       'Open',    'Vroege starts 5:30u tegen hitte'],
    ],
    ['Kleding',
      ['Technische kleding-set (merino/synth)', 3, 250, 'per pers.','Persoon','decathlon.nl',             'Sponsor: Decathlon NL',                  'Wachten', '2× shirt, 1× broek zip-off, ondergoed merino'],
      ['Wandelsokken (Smartwool/Darn Tough)',   9, 18,  'per paar', 'Persoon','decathlon.nl',             '',                                       'Open',    '3 paar p.p. — belangrijkste blaarpreventie'],
      ['Regenjack waterproof shell',            3, 60,  'per stuk', 'Persoon','decathlon.nl',             'Sponsor: Decathlon NL',                  'Open',    'Galicië kan regenen in aug'],
      ['Zonbescherming (hoed + bril + SPF50)',  3, 70,  'per pers.','Persoon','decathlon.nl',             '',                                       'Open',    'Richting PT-grens piekt op 36°C'],
    ],
    ['Voet & medisch',
      ['Blaren-kit (Compeed + leukotape + vaseline)', 3, 15, 'per pers.', 'Persoon','etos.nl',           '',                                       'Open',    'Zonder dit val je uit op dag 3'],
      ['EHBO + ibuprofen + electrolyten',       1, 60,  'set',      'Team',   'etos.nl/decathlon',        '',                                       'Open',    'Hitte = uitdrogingsrisico (SiS/Maurten)'],
    ],
    ['Hygiëne & veiligheid',
      ['Microvezel-handdoek + toilet + wasstrips', 3, 20, 'per pers.','Persoon','decathlon.nl',          '',                                       'Open',    'Albergues geven geen handdoek'],
      ['Kabelslot (klein, voor backpack)',      3, 10,  'per stuk', 'Persoon','bol.com',                  '',                                       'Open',    'Apparatuur kan niet onbeheerd op albergue-bed'],
    ],
    ['Documenten',
      ['Credencial (pelgrimspaspoort)',         3, 3,   'per stuk', 'Persoon','Confraternity NL / Tui',   '',                                       'Open',    'Verplicht voor albergue + Compostela aan finish'],
    ],
    ['Water & hydratatie',
      ['Waterbladder 2-3L + filter',            3, 55,  'per pers.','Persoon','decathlon.nl',             '',                                       'Open',    'Hitte + beperkte watervoorz. tussen dorpen'],
    ],
    ['Reizen & vervoer',
      ['Vlucht heen (AMS → Porto, 1-way)',      3, 110, 'per pers.','Persoon','vueling/transavia',        '',                                       'Open',    'Boek 6 weken vooraf'],
      ['Vlucht terug (Santiago → AMS, 1-way)',  3, 90,  'per pers.','Persoon','vueling/transavia',        '',                                       'Open',    'SCQ → AMS direct'],
      ['Bus/trein Porto → Tui (start)',         3, 15,  'per pers.','Persoon','Rede Expressos / Renfe',   '',                                       'Open',    '~2u'],
    ],
    ['Logies & eten',
      ['Albergues (6 nachten × 3 pers × €11)',  1, 198, 'totaal',   'Team',   'ter plaatse',              '',                                       'Open',    'Publieke albergues Galicië €10-12 p.p.'],
      ['Hostel/Airbnb (2 nachten × 3 pers × €60)', 1, 360,'totaal','Team',   'booking.com',              '',                                       'Open',    'Aankomst Porto + finish Santiago'],
      ['Eten (8 dagen × 3 pers × €30)',         1, 720, 'totaal',   'Team',   'lokaal',                   '',                                       'Open',    'Menu del peregrino + supermarkt'],
    ],
    ['Verzekering & buffer',
      ['Reisverzekering + €8k equipment-rider', 1, 380, 'eenmalig', 'Team',   'ANWB / Allianz',           'Sponsor: ANWB content-deal?',            'Open',    'Camera + Starlink + laptops gedekt'],
      ['Onvoorzien (10% buffer)',               1, 700, 'eenmalig', 'Team',   '—',                        '',                                       'Open',    'Reparaties, vervangkleding, import-marge bril'],
    ],
  ];

  // Schrijven met categorie-headers
  const haveRule = makeHaveRule_();
  let firstDataRow = 0, lastDataRow = 0;
  let r = 4;
  rows.forEach(([catLabel, ...items]) => {
    styleCategory_(sh, r, headers.length, catLabel);
    r++;
    items.forEach((item, idx) => {
      // item = [naam, aantal, prijs, eenheid, eigenaar, waar, sponsor, status, notitie]
      if (!firstDataRow) firstDataRow = r;
      lastDataRow = r;
      const subFormula = '=C' + r + '*D' + r;
      // A=Ingepakt(checkbox) B=Item C=Aantal D=Prijs E=Eenheid F=Subtotaal
      // G=Eigenaar H=Hebben/halen I=Waar J=Sponsor K=Notitie
      sh.getRange(r, 2, 1, 10).setValues([[
        item[0], item[1], item[2], item[3], subFormula,
        item[4], mapHave_(item[7]), item[5], item[6], item[8]
      ]]);
      sh.getRange(r, 1).insertCheckboxes();
      sh.getRange(r, 8).setDataValidation(haveRule);
      if (idx % 2 === 1) sh.getRange(r, 1, 1, headers.length).setBackground(C.rowAlt);
      if (String(item[6] || '').toLowerCase().includes('sponsor')) {
        sh.getRange(r, 10).setBackground(C.sponsorBg).setFontWeight('bold');
      }
      r++;
    });
  });

  // Format kolommen
  sh.getRange('D4:D' + r).setNumberFormat('€#,##0');
  sh.getRange('F4:F' + r).setNumberFormat('€#,##0').setFontWeight('bold');
  sh.getRange('C4:C' + r).setHorizontalAlignment('center');
  sh.getRange('A4:A' + r).setHorizontalAlignment('center');
  addHaveConditionalFormatting_(sh, firstDataRow, lastDataRow);

  setColumnWidths_(sh, [70, 300, 60, 75, 85, 95, 85, 150, 200, 250, 340]);
  sh.setFrozenRows(3);
  hideGridlines_(sh);
}

// ----------------------------------------------------------------------------
// 3. Nice-to-have
// ----------------------------------------------------------------------------
function buildNiceToHave(ss) {
  const sh = resetSheet_(ss, 'Nice-to-have');

  sh.getRange('A1').setValue('TOTAAL nice-to-have').setFontWeight('bold');
  sh.getRange('B1').setValue('Ingepakt:').setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange('C1').setFormula('=COUNTIF(A4:A200,TRUE)&" / "&(COUNTIF(A4:A200,TRUE)+COUNTIF(A4:A200,FALSE))')
    .setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange('E1').setValue('SOM →').setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange('F1').setFormula('=SUM(F4:F200)').setNumberFormat('€#,##0').setFontWeight('bold');
  sh.getRange('A1:F1').setBackground(C.totalBg);

  const headers = ['Ingepakt', 'Item', 'Aantal', 'Prijs €', 'Eenheid', 'Subtotaal',
                   'Eigenaar', 'Hebben / halen', 'Waar te kopen', 'Sponsor target?', 'Notitie'];
  sh.getRange(3, 1, 1, headers.length).setValues([headers]);
  styleHeader_(sh, 3, headers.length);

  const rows = [
    ['Tech upgrade',
      ['MacBook Air 15" M4 — Max',              1, 1399, 'per stuk', 'Max',    'apple.com/nl',            'Sponsor: Apple/Amac PR (leen)',          'Open', 'Optioneel — afh. van Max huidige machine'],
      ['MacBook Air 15" M4 — Caesar',           1, 1399, 'per stuk', 'Caesar', 'apple.com/nl',            'Sponsor: Apple/Amac PR (leen)',          'Open', 'Optioneel — afh. van Caesar huidige machine'],
      ['XReal Air 2 Pro (backup-bril)',         1, 499,  'per stuk', 'Team',   'xreal.com',               'Sponsor: XReal NL/EU outreach',          'Open', 'Insurance tegen Monako-leverrisico'],
      ['EcoFlow River 3 Plus + 110W zonnepaneel', 1, 670, 'set',     'Team',   'powerstationshop.eu',     'Sponsor: EcoFlow creator-deal',          'Open', 'Voor docu-shoots + albergue zonder stopcontact'],
    ],
    ['Mini-docu productie',
      ['Sony A7C II + 2 lenzen',                1, 2800, 'kit',      'Team',   'cameranu.nl',             'Sponsor: cameraleen-deal',               'Open', 'Body 24-105 + 35mm prime'],
      ['DJI RS3 gimbal + Rode Wireless ME',     1, 800,  'set',      'Team',   'cameranu.nl',             'Sponsor: cameraleen-deal',               'Open', ''],
      ['DJI Mini 4 Pro drone',                  1, 799,  'per stuk', 'Team',   'dji.com/nl',              'Sponsor: DJI creator / Coolblue',        'Open', 'C0 — geen drone-license vereist'],
      ['Geheugen + SSD 1TB + reserve-accu',     1, 400,  'set',      'Team',   'cameranu.nl',             '',                                       'Open', ''],
      ['Editor docu (freelance, ~15 dagen)',    1, 4500, 'totaal',   'Team',   'freelance.nl',            'Sponsor: post-prod partner',             'Open', 'Of via Videoland-deal'],
      ['Distributie + festival-inschrijvingen', 1, 1000, 'totaal',   'Team',   'IDFA / netflix-sub',      '',                                       'Open', ''],
    ],
    ['Marketing & landing page',
      ['Marketing/ads landing page + social',   1, 1500, 'totaal',   'Team',   'Meta/Google Ads',         '',                                       'Open', 'Pre-trip awareness + sponsor-leads'],
    ],
    ['Comfort & marges',
      ['Reservegear (extra schoenen/kleding/Starlink-backup)', 1, 1200, 'set','Team','decathlon.nl',     '',                                       'Open', 'Verloren/kapot tijdens trip'],
      ['Extra hotelnachten (1× Porto vooraf + 2× Santiago na)', 1, 700, 'totaal','Team','booking.com',  '',                                       'Open', 'Rust + docu-overdracht'],
      ['Verzekering verhoogd naar €12k equipment-cap', 1, 170, 'eenmalig','Team','ANWB',                  '',                                       'Open', 'Bovenop must-have verzekering'],
      ['Onvoorzien marge nice-to-have (10%)',   1, 2500, 'eenmalig', 'Team',   '—',                       '',                                       'Open', ''],
    ],
  ];

  const haveRule = makeHaveRule_();
  let firstDataRow = 0, lastDataRow = 0;
  let r = 4;
  rows.forEach(([catLabel, ...items]) => {
    styleCategory_(sh, r, headers.length, catLabel);
    r++;
    items.forEach((item, idx) => {
      if (!firstDataRow) firstDataRow = r;
      lastDataRow = r;
      const subFormula = '=C' + r + '*D' + r;
      sh.getRange(r, 2, 1, 10).setValues([[
        item[0], item[1], item[2], item[3], subFormula,
        item[4], mapHave_(item[7]), item[5], item[6], item[8]
      ]]);
      sh.getRange(r, 1).insertCheckboxes();
      sh.getRange(r, 8).setDataValidation(haveRule);
      if (idx % 2 === 1) sh.getRange(r, 1, 1, headers.length).setBackground(C.rowAlt);
      if (String(item[6] || '').toLowerCase().includes('sponsor')) {
        sh.getRange(r, 10).setBackground(C.sponsorBg).setFontWeight('bold');
      }
      r++;
    });
  });

  sh.getRange('D4:D' + r).setNumberFormat('€#,##0');
  sh.getRange('F4:F' + r).setNumberFormat('€#,##0').setFontWeight('bold');
  sh.getRange('C4:C' + r).setHorizontalAlignment('center');
  sh.getRange('A4:A' + r).setHorizontalAlignment('center');
  addHaveConditionalFormatting_(sh, firstDataRow, lastDataRow);

  setColumnWidths_(sh, [70, 300, 60, 75, 85, 95, 85, 150, 200, 250, 340]);
  sh.setFrozenRows(3);
  hideGridlines_(sh);
}

// ----------------------------------------------------------------------------
// 4. Scenario's
// ----------------------------------------------------------------------------
function buildScenarios(ss) {
  const sh = resetSheet_(ss, "Scenario's");

  sh.getRange('A1').setValue('Scenario\'s — wat kost het werkelijk?');
  sh.getRange('A1:E1').merge()
    .setBackground(C.headerBg).setFontColor(C.headerFg)
    .setFontWeight('bold').setFontSize(18)
    .setHorizontalAlignment('left').setVerticalAlignment('middle');
  sh.setRowHeight(1, 50);

  const headers = ['Scenario', 'Wat zit erin', 'Sponsoring afgetrokken', 'Totaal', 'Verschil met €30k cap'];
  sh.getRange(3, 1, 1, headers.length).setValues([headers]);
  styleHeader_(sh, 3, headers.length);

  // Rijen — formules verwijzen naar Must-have!F1 en Nice-to-have!F1 (subtotaal-kolom)
  const data = [
    [
      'A — Go Minimal',
      'Alleen must-have. Geen camera-gear, geen extra MacBooks, geen drone. Telefoonfootage voor docu.',
      '€0',
      "='Must-have'!F1",
      "=30000-D4",
    ],
    [
      'B — Ideaal (zelf betalen)',
      'Must-have + nice-to-have volledig. Eigen camera-kit, extra MacBooks, drone, editor.',
      '€0',
      "='Must-have'!F1+'Nice-to-have'!F1",
      "=30000-D5",
    ],
    [
      'C — Met product-sponsoring',
      'Bovenop B: Starlink (€249), EcoFlow (€670), Monako (€1.155), 50% Decathlon (€1.071), Apple-leen (€4.197), camera-leen (€4.800).',
      '€12.142',
      "='Must-have'!F1+'Nice-to-have'!F1-12142",
      "=30000-D6",
    ],
    [
      'D — Met productie-partner (Videoland/RTL)',
      'Bovenop C: editor (€4.500) + distributie (€1.000) + camera dubbele besparing al gerekend.',
      '€17.642',
      "='Must-have'!F1+'Nice-to-have'!F1-17642",
      "=30000-D7",
    ],
  ];

  data.forEach((row, i) => {
    const r = 4 + i;
    // Tekst (kol 1-3) via setValues, formules (kol 4 totaal, kol 5 verschil) expliciet
    sh.getRange(r, 1, 1, 3).setValues([[row[0], row[1], row[2]]]);
    sh.getRange(r, 4).setFormula(row[3]);
    sh.getRange(r, 5).setFormula(row[4]);
    sh.getRange(r, 4).setNumberFormat('€#,##0').setFontWeight('bold').setFontSize(13);
    sh.getRange(r, 5).setNumberFormat('€#,##0;[Red]-€#,##0').setFontWeight('bold');
    sh.setRowHeight(r, 58);
    if (i % 2 === 1) sh.getRange(r, 1, 1, headers.length).setBackground(C.rowAlt);
  });

  sh.getRange(4, 1, data.length, 1).setFontWeight('bold');
  sh.getRange(4, 2, data.length, 5).setWrap(true);

  // Notitie
  const noteRow = 4 + data.length + 2;
  sh.getRange(noteRow, 1).setValue('Aannames:');
  sh.getRange(noteRow, 1).setFontWeight('bold');

  const notes = [
    '• Sponsor-bedragen Scenario C zijn realistische streefcijfers, geen toezeggingen. Zie tabblad "Sponsor-pijplijn".',
    '• Scenario D vooronderstelt dat een productie-partner camera-crew én editor levert in ruil voor co-branding.',
    '• Het MIND-handover-evenement zelf zit niet in deze begroting — apart in te plannen na finish.',
    '• Vlucht-aanname: AMS→OPO heen + SCQ→AMS terug (split-routing is goedkoper dan retour).',
  ];
  notes.forEach((n, i) => {
    sh.getRange(noteRow + 1 + i, 1, 1, 5).merge();
    sh.getRange(noteRow + 1 + i, 1).setValue(n).setFontColor(C.inkSoft).setWrap(true);
  });

  setColumnWidths_(sh, [280, 460, 180, 130, 180]);
  sh.setFrozenRows(3);
  hideGridlines_(sh);
}

// ----------------------------------------------------------------------------
// 5. Sponsor-pijplijn
// ----------------------------------------------------------------------------
function buildSponsorPipeline(ss) {
  const sh = resetSheet_(ss, 'Sponsor-pijplijn');

  sh.getRange('A1').setValue('Sponsor-pijplijn — wie, wat, waarde, status');
  sh.getRange('A1:G1').merge()
    .setBackground(C.headerBg).setFontColor(C.headerFg)
    .setFontWeight('bold').setFontSize(18)
    .setHorizontalAlignment('left').setVerticalAlignment('middle');
  sh.setRowHeight(1, 50);

  const headers = ['Partij', 'Item(s)', 'Geschatte waarde', 'Realisme', 'Contact / aanpak', 'Status', 'Volgende stap'];
  sh.getRange(3, 1, 1, headers.length).setValues([headers]);
  styleHeader_(sh, 3, headers.length);

  const rows = [
    ['Monako Glass',
      '3× AI-bril + content-deal',
      1155,
      '⭐⭐⭐⭐⭐ Zeer hoog',
      'DM Candy Yue via X / LinkedIn. Pitch: "Eerste publieke 6-daagse stress-test voor live coding op de Camino."',
      'Nieuw',
      'DM versturen deze week + LinkedIn post Caesar tonen als bewijs'],
    ['Starlink NL',
      'Mini hardware + 1 mnd Roam',
      249,
      '⭐⭐⭐⭐ Hoog',
      'Starlink EU PR via support-form. Use-case: 3 founders × AI × Camino is posterboy content.',
      'Nieuw',
      'Outreach email + LP-link sturen'],
    ['EcoFlow',
      'River 3 Plus + 110W zonnepaneel',
      670,
      '⭐⭐⭐⭐ Hoog',
      'EcoFlow Creator Program. Loan-unit met optie tot behoud na trip.',
      'Nieuw',
      'Aanmelden creator-portal + pitch met docu-teaser'],
    ['Decathlon NL',
      'Rugzakken + kleding + schoenen + trekkingstokken + regenjacks',
      1071,
      '⭐⭐⭐ Middel',
      'Quechua/Forclaz marketing AMS. Vraag 50% korting + co-branding op docu.',
      'Nieuw',
      'LinkedIn outreach naar PR-team Amsterdam HQ'],
    ['XReal NL/EU',
      'XReal Air 2 Pro als backup-bril',
      499,
      '⭐⭐⭐ Middel',
      'Email + use-case pitch (Monako-fallback). Insurance tegen leverdatum-risico.',
      'Nieuw',
      'Pitch deck met risico-scenario opzetten'],
    ['Apple / reseller',
      '2× MacBook Air 15" M4 (leen voor trip)',
      2798,
      '⭐⭐ Laag',
      'Direct Apple onhaalbaar. Via Amac/CoolBlue PR: leen-set in ruil voor content-pakket.',
      'Nieuw',
      'Pitch deck + audience-bewijs naar Amac marketing'],
    ['Videoland / RTL / IDFA-netwerk',
      'Productie-crew + editor + distributie',
      10300,
      '⭐⭐⭐ Middel',
      'Aparte productie-pitch. Levert camera-crew én post-prod in ruil voor exclusieve eerste-rechten op de mini-docu.',
      'Nieuw',
      'Verkennend gesprek + treatment opstellen'],
    ['ANWB / Allianz',
      'Reisverzekering met €8k+ equipment-cap',
      380,
      '⭐⭐⭐ Middel',
      'ANWB doet vaker content-deals voor avontuurlijke reizen. Verzekering + PR-bijdrage.',
      'Nieuw',
      'Outreach via ANWB Customer Pact'],
    ['Coolblue / Cameranu',
      'Camera-leen + accessoires',
      4800,
      '⭐⭐⭐ Middel',
      'Cameranu doet creator-leenpakketten. Vraag 14-daagse lease met co-promotion.',
      'Nieuw',
      'Aanvraag via Cameranu PR'],
  ];

  rows.forEach((row, i) => {
    const r = 4 + i;
    sh.getRange(r, 1, 1, headers.length).setValues([row]);
    sh.getRange(r, 3).setNumberFormat('€#,##0').setFontWeight('bold');
    sh.getRange(r, 1, 1, headers.length).setWrap(true);
    if (i % 2 === 1) sh.getRange(r, 1, 1, headers.length).setBackground(C.rowAlt);
    sh.setRowHeight(r, 60);
  });

  // Totaal-rij
  const totalRow = 4 + rows.length + 1;
  sh.getRange(totalRow, 1).setValue('TOTALE potentiële sponsor-waarde');
  sh.getRange(totalRow, 3).setFormula('=SUM(C4:C' + (totalRow - 1) + ')').setNumberFormat('€#,##0');
  styleTotalRow_(sh, totalRow, headers.length);

  setColumnWidths_(sh, [200, 290, 130, 150, 350, 90, 290]);
  sh.setFrozenRows(3);
  hideGridlines_(sh);
}
