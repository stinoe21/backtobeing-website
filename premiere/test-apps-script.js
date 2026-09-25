// Draait apps-script.gs lokaal met nagebootste Google-diensten: node premiere/test-apps-script.js
const fs = require('fs'), vm = require('vm');
const bron = fs.readFileSync(process.argv[2] || require('path').join(__dirname, 'apps-script.gs'), 'utf8');

function maakWereld(opts = {}) {
  const mails = []; const cache = {}; const triggers = []; const toasts = [];
  const tabs = {};
  let volgendId = 1;
  function maakTab(naam, rijen) {
    const id = volgendId++;
    const cel = (r, c) => { while (rijen.length < r) rijen.push([]); return rijen[r - 1]; };
    const sheet = {
      rijen, getName: () => naam,
      getSheetId: () => id,
      getLastColumn: () => Math.max(1, ...rijen.map(x => x.length)),
      getLastRow: () => rijen.length,
      getActiveRange: () => opts.selectie ? range(opts.selectie[0], 1, opts.selectie[1] - opts.selectie[0] + 1, 1) : null,
      getRange: (r, c, nr = 1, nc = 1) => range(r, c, nr, nc),
      appendRow: w => rijen.push(w),
    };
    function range(r, c, nr, nc) {
      return {
        getSheet: () => sheet, getRow: () => r, getColumn: () => c, getNumRows: () => nr, getNumColumns: () => nc,
        getValues: () => rijen.slice(r - 1, r - 1 + nr).map(x => Array.from({ length: nc }, (_, i) => x[c - 1 + i] ?? '')),
        setValues: vs => vs.forEach((rijW, i) => rijW.forEach((v, j) => { cel(r + i, c + j)[c + j - 1] = v; })),
        getValue: () => rijen[r - 1]?.[c - 1] ?? '',
        setValue: v => { cel(r, c)[c - 1] = v; },
        insertCheckboxes: () => { for (let i = 0; i < nr; i++) { const rr = cel(r + i, c); if (rr[c - 1] !== true) rr[c - 1] = false; } },
      };
    }
    tabs[naam] = sheet;
    return sheet;
  }
  const sheet = maakTab('Blad1', [['Voornaam','Achternaam','Mailadress','Aantal personen ','Naam persoon (extra 1)','Naam persoon (extra 2)','Naam persoon (extra 3)','Naam persoon (extra 4)']]);
  const rijen = sheet.rijen;
  if (opts.uitnodigingen) maakTab('Uitnodigingen', [['Code','Van','Max personen','Gebruikt'], ...opts.uitnodigingen]);
  const range = (r, c, nr, nc) => sheet.getRange(r, c, nr, nc);
  const ss = {
    getSheets: () => [sheet], getSheetByName: n => tabs[n] || null, toast: t => toasts.push(t),
    insertSheet: n => maakTab(n, []),
  };
  const menu = { addItem() { return this; }, addSeparator() { return this; }, addToUi() {} };
  const ctx = {
    console: { log() {}, error() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => null, getUi: () => ({ createMenu: () => menu }) },
    LockService: { getScriptLock: () => ({ tryLock: () => !opts.slotBezet, waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    MailApp: { sendEmail: m => { if (opts.mailKapot) throw new Error('geen toestemming om te mailen'); mails.push(m); }, getRemainingDailyQuota: () => 100 },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      newTrigger: fn => ({ forSpreadsheet() { return this; }, onEdit() { return this; }, create: () => triggers.push({ getHandlerFunction: () => fn }) }),
    },
    Utilities: { formatDate: () => '17-09-2026 16:00' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType() { return this; }, getContent: () => t }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'ik@voorbeeld.nl' }) },
  };
  vm.createContext(ctx);
  let code = bron;
  // De test kiest zelf de plafonds, los van wat er in het script is ingesteld.
  code = code.replace(/const MAX_TOTAAL_PERSONEN = \d+;/, 'const MAX_TOTAAL_PERSONEN = ' + (opts.plafond || 0) + ';');
  code = code.replace(/const MAX_AANMELDINGEN_PERSONEN = \d+;/, 'const MAX_AANMELDINGEN_PERSONEN = ' + (opts.plafondAanmeldingen || 0) + ';');
  vm.runInContext(code, ctx);
  const post = d => JSON.parse(vm.runInContext('doPost', ctx)({ postData: { contents: JSON.stringify(d) } }).getContent());
  const get = code => JSON.parse(vm.runInContext('doGet', ctx)({ parameter: code ? { code } : {} }).getContent());
  const kol = naam => rijen[0].findIndex(k => String(k).trim() === naam);
  // Nabootsing van het vinkje in de sheet: waarde zetten en de trigger afvuren.
  const vink = (rijNr, aan) => {
    const c = kol('Goedkeuren') + 1;
    rijen[rijNr - 1][c - 1] = aan;
    vm.runInContext('bijBewerking', ctx)({ range: range(rijNr, c, 1, 1), value: aan ? 'TRUE' : 'FALSE' });
  };
  // Een bewerking ergens anders in de sheet, zonder de waarde te zetten.
  const bewerk = (rijNr, c, v) => vm.runInContext('bijBewerking', ctx)({ range: range(rijNr, c, 1, 1), value: v });
  const run = naam => vm.runInContext(naam, ctx)();
  const status = rijNr => rijen[rijNr - 1][kol('Status')];
  return { post, get, rijen, mails, triggers, toasts, kol, vink, bewerk, run, status, tabs };
}
const basis = (mail, n = 1, extra = {}) => ({ Voornaam: 'A', Achternaam: 'B', Mailadress: mail, 'Aantal personen': String(n), Taal: 'nl', ...extra });
const vijf = { 'Naam persoon (extra 1)': 'a', 'Naam persoon (extra 2)': 'b', 'Naam persoon (extra 3)': 'c', 'Naam persoon (extra 4)': 'd' };
let fouten = 0;
function check(naam, cond, info) { console.log((cond ? 'OK  ' : 'FOUT') + '  ' + naam + (cond ? '' : '  -> ' + JSON.stringify(info))); if (!cond) fouten++; }

// 1. nieuw, dan dubbel (ook met andere hoofdletters en spaties)
let w = maakWereld();
let r = w.post(basis('Jan@Voorbeeld.nl', 2, { 'Naam persoon (extra 1)': 'Piet' }));
check('nieuwe aanmelding ok', r.ok === true && w.rijen.length === 2 && w.mails.length === 1, r);
check('mailadres in kleine letters opgeslagen', w.rijen[1][2] === 'jan@voorbeeld.nl', w.rijen[1]);
check('kolommen Taal en Ingeschreven op toegevoegd', w.rijen[0].includes('Taal') && w.rijen[0].includes('Ingeschreven op'), w.rijen[0]);
check('kolommen Status, Goedkeuren en Goedgekeurd op toegevoegd', ['Status','Goedkeuren','Goedgekeurd op'].every(k => w.rijen[0].includes(k)), w.rijen[0]);
check('nieuwe aanmelding staat in de wachtrij met leeg vinkje', w.status(2) === 'Wachtrij' && w.rijen[1][w.kol('Goedkeuren')] === false && w.rijen[1][w.kol('Goedgekeurd op')] === '', w.rijen[1]);
check('aanmelding krijgt de wachtrij-mail', /aanmelding .* is ontvangen/.test(w.mails[0].subject) && /wachtrij/.test(w.mails[0].htmlBody), w.mails[0].subject);
r = w.post(basis('  JAN@voorbeeld.NL '));
check('dubbel mailadres -> code bestaat', r.ok === false && r.code === 'bestaat', r);
check('dubbel: geen tweede rij, geen tweede mail', w.rijen.length === 2 && w.mails.length === 1, [w.rijen.length, w.mails.length]);

// 2. limiet: 50 erdoor, de 51e niet
w = maakWereld();
let ok = 0; for (let i = 0; i < 50; i++) if (w.post(basis('p' + i + '@v.nl')).ok) ok++;
r = w.post(basis('p50@v.nl'));
check('50 aanmeldingen in het venster slagen', ok === 50, ok);
check('51e in hetzelfde venster -> code druk', r.ok === false && r.code === 'druk', r);
check('51e niet geschreven, geen mail', w.rijen.length === 51 && w.mails.length === 50, [w.rijen.length, w.mails.length]);

// 3. slot bezet -> druk
w = maakWereld({ slotBezet: true });
r = w.post(basis('x@v.nl'));
check('slot niet te krijgen -> code druk', r.code === 'druk' && w.rijen.length === 1, r);

// 4. goedkeuren via het vinkje
w = maakWereld({ plafond: 70 });
w.post(basis('anna@v.nl', 3, { Voornaam: 'Anna', Achternaam: 'de Vries', 'Naam persoon (extra 1)': 'x', 'Naam persoon (extra 2)': 'y' }));
w.post(basis('tom@v.nl', 1, { Voornaam: 'Tom', Taal: 'en' }));
w.vink(2, true);
check('vinkje aan -> Status Goedgekeurd met datum', w.status(2) === 'Goedgekeurd' && w.rijen[1][w.kol('Goedgekeurd op')] === '17-09-2026 16:00', w.rijen[1]);
check('goedkeuring stuurt de "je bent erbij"-mail', w.mails.length === 3 && /Je bent erbij/.test(w.mails[2].subject) && /Beste Anna,/.test(w.mails[2].htmlBody), w.mails.map(m => m.subject));
check('goedkeuringsmail: naam, aantal en kaartje "Je plek"', /Anna de Vries/.test(w.mails[2].htmlBody) && />3<\/td>/.test(w.mails[2].htmlBody) && /Je plek<\/div>/.test(w.mails[2].htmlBody));
check('andere rij blijft in de wachtrij', w.status(3) === 'Wachtrij', w.rijen[2]);
w.vink(2, true);
check('nog eens aanvinken -> geen tweede mail', w.mails.length === 3, w.mails.length);
w.vink(3, true);
check('EN-rij krijgt de Engelse goedkeuringsmail', /You are in/.test(w.mails[3].subject) && /Dear Tom,/.test(w.mails[3].htmlBody) && !/Beste|wachtrij/.test(w.mails[3].htmlBody), w.mails[3].subject);
w.vink(2, false);
check('vinkje uit -> terug naar Wachtrij, datum leeg, melding', w.status(2) === 'Wachtrij' && w.rijen[1][w.kol('Goedgekeurd op')] === '' && /al verstuurd/.test(w.toasts.at(-1)), [w.rijen[1], w.toasts]);
check('vinkje uit stuurt geen mail', w.mails.length === 4, w.mails.length);

// 4b. bewerking buiten de kolom Goedkeuren doet niets
w = maakWereld();
w.post(basis('q@v.nl'));
w.bewerk(2, w.kol('Voornaam') + 1, 'Nieuw');
check('bewerking in een andere kolom -> niets', w.status(2) === 'Wachtrij' && w.mails.length === 1);
w.bewerk(1, w.kol('Goedkeuren') + 1, 'TRUE');
check('bewerking in de kopregel -> niets', w.mails.length === 1);

// 5. plafond geldt voor goedgekeurde personen, niet voor de wachtrij
w = maakWereld({ plafond: 5 });
w.post(basis('a@v.nl', 3, { 'Naam persoon (extra 1)': 'x', 'Naam persoon (extra 2)': 'y' }));
w.post(basis('b@v.nl', 3, { 'Naam persoon (extra 1)': 'x', 'Naam persoon (extra 2)': 'y' }));
r = w.post(basis('c@v.nl', 2, { 'Naam persoon (extra 1)': 'x' }));
check('wachtrij boven het plafond: aanmelden kan gewoon', r.ok === true && w.rijen.length === 4, r);
w.vink(2, true);
check('plafond 5: eerste 3 goedgekeurd', w.status(2) === 'Goedgekeurd');
w.vink(3, true);
check('plafond 5: 3 erbij past niet -> vinkje weer uit, blijft Wachtrij, melding', w.status(3) === 'Wachtrij' && w.rijen[2][w.kol('Goedkeuren')] === false && /Past niet/.test(w.toasts.at(-1)), [w.rijen[2], w.toasts]);
check('plafond: geen mail bij weigering', w.mails.length === 4, w.mails.length);
w.vink(4, true);
check('plafond 5: 2 erbij past precies', w.status(4) === 'Goedgekeurd', w.rijen[3]);

// 5b. plafond 70: 14 groepen van 5 vullen de zaal precies, daarna is het vol
w = maakWereld({ plafond: 70 });
for (let i = 0; i < 15; i++) w.post(basis('g' + i + '@v.nl', 5, vijf));
ok = 0; for (let i = 0; i < 14; i++) { w.vink(i + 2, true); if (w.status(i + 2) === 'Goedgekeurd') ok++; }
check('plafond 70: 14 groepen van 5 goedgekeurd', ok === 14, ok);
w.vink(16, true);
check('plafond 70: de 15e groep past niet', w.status(16) === 'Wachtrij', w.rijen[15]);

// 5c. oud plafond op alle aanmeldingen (standaard uit)
w = maakWereld({ plafondAanmeldingen: 5 });
w.post(basis('a@v.nl', 3, { 'Naam persoon (extra 1)': 'x', 'Naam persoon (extra 2)': 'y' }));
r = w.post(basis('b@v.nl', 3, { 'Naam persoon (extra 1)': 'x', 'Naam persoon (extra 2)': 'y' }));
check('plafond op aanmeldingen: 3 erbij gaat over 5 -> code vol', r.code === 'vol' && w.rijen.length === 2, r);

// 6. menu: geselecteerde rijen goedkeuren
w = maakWereld({ plafond: 70, selectie: [2, 4] });
for (let i = 0; i < 4; i++) w.post(basis('s' + i + '@v.nl'));
w.run('keurSelectieGoed');
check('menu: rijen 2 t/m 4 goedgekeurd, rij 5 niet', [2,3,4].every(n => w.status(n) === 'Goedgekeurd') && w.status(5) === 'Wachtrij', w.rijen.map(x => x[w.kol('Status')]));
check('menu: drie goedkeuringsmails, vinkjes aan', w.mails.length === 7 && [1,2,3].every(i => w.rijen[i][w.kol('Goedkeuren')] === true), w.mails.length);

// 7. installeren: kolommen, vinkjes, lege status, trigger (en nog eens is niets dubbel)
w = maakWereld();
w.rijen.push(['Oud','Persoon','oud@v.nl',1,'','','','']);
w.run('installeren');
check('installeren: kolommen erbij, bestaande rij in Wachtrij met vinkje', w.status(2) === 'Wachtrij' && w.rijen[1][w.kol('Goedkeuren')] === false, w.rijen);
check('installeren: trigger geïnstalleerd', w.triggers.length === 1 && w.triggers[0].getHandlerFunction() === 'bijBewerking');
w.run('installeren');
check('installeren nog eens: geen tweede trigger', w.triggers.length === 1 && w.rijen[0].filter(k => k === 'Status').length === 1);

// 7b. uitnodigingscodes: wachtrij overslaan
const codes = [['max-k7p4', 'Max', 3, 0], ['stijn-abcd', 'Stijn', 10, 0]];
w = maakWereld({ plafond: 70, uitnodigingen: codes });
r = w.get('MAX-K7P4');
check('GET met geldige code: geldig, van, niet vol (hoofdletters mogen)', r.ok && r.geldig === true && r.van === 'Max' && r.vol === false, r);
check('GET met onbekende code: ongeldig, zonder lijst', w.get('nep').geldig === false && !('van' in w.get('nep')), w.get('nep'));
check('GET zonder code: gewone levensteken', /gebruik POST/.test(w.get().info));
r = w.post(basis('gast1@v.nl', 2, { 'Naam persoon (extra 1)': 'x', Code: 'max-k7p4', Voornaam: 'Gast' }));
check('aanmelding met code: ok, uitnodiging true, via Max', r.ok === true && r.uitnodiging === true && r.via === 'Max', r);
check('code: rij meteen Goedgekeurd, vinkje aan, datum, Uitnodiging=Max', w.status(2) === 'Goedgekeurd' && w.rijen[1][w.kol('Goedkeuren')] === true && w.rijen[1][w.kol('Goedgekeurd op')] === '17-09-2026 16:00' && w.rijen[1][w.kol('Uitnodiging')] === 'Max', w.rijen[1]);
check('code: meteen de "je bent erbij"-mail, geen wachtrij-mail', w.mails.length === 1 && /Je bent erbij/.test(w.mails[0].subject), w.mails.map(m => m.subject));
check('code: kolom Gebruikt in het tabblad bijgewerkt', w.tabs['Uitnodigingen'].rijen[1][3] === 2, w.tabs['Uitnodigingen'].rijen);
r = w.post(basis('gast2@v.nl', 2, { 'Naam persoon (extra 1)': 'x', Code: 'max-k7p4' }));
check('code vol (2+2 > 3): ok, uitnodiging=vol, rij in de wachtrij met wachtrij-mail', r.ok === true && r.uitnodiging === 'vol' && r.via === 'Max' && w.status(3) === 'Wachtrij' && w.rijen[2][w.kol('Uitnodiging')] === '' && /is ontvangen/.test(w.mails[1].subject), [r, w.rijen[2]]);
check('GET na vol: vol=true', w.get('max-k7p4').vol === false && w.post(basis('gast3@v.nl', 1, { Code: 'max-k7p4' })).uitnodiging === true && w.get('max-k7p4').vol === true, w.get('max-k7p4'));
r = w.post(basis('gast4@v.nl', 1, { Code: 'bestaat-niet' }));
check('onbekende code: ok, uitnodiging=onbekend, gewoon wachtrij', r.ok === true && r.uitnodiging === 'onbekend' && w.status(5) === 'Wachtrij', r);
r = w.post(basis('gast5@v.nl', 1));
check('zonder code: geen uitnodiging-veld in het antwoord', r.ok === true && !('uitnodiging' in r), r);
r = w.post(basis('gast1@v.nl', 1, { Code: 'stijn-abcd' }));
check('dubbel adres met code: nog steeds code bestaat', r.code === 'bestaat', r);
w.vink(2, false); w.vink(2, true);
check('uitgenodigde rij uit- en aanvinken werkt als gewone rij', w.status(2) === 'Goedgekeurd' && w.rijen[1][w.kol('Uitnodiging')] === 'Max');
// zonder tabblad: codes doen niets, aanmelden werkt gewoon
w = maakWereld();
r = w.post(basis('a@v.nl', 1, { Code: 'max-k7p4' }));
check('geen tabblad Uitnodigingen: code onbekend, wachtrij', r.uitnodiging === 'onbekend' && w.status(2) === 'Wachtrij', r);
check('geen tabblad: GET zegt ongeldig', w.get('max-k7p4').geldig === false);
// installeren maakt het tabblad met drie codes
w.run('installeren');
let tab = w.tabs['Uitnodigingen'];
check('installeren: tabblad Uitnodigingen met Caesar, Stijn en Max, 10 elk', tab && tab.rijen.length === 4 && tab.rijen.slice(1).map(x => x[1]).join() === 'Caesar,Stijn,Max' && tab.rijen.slice(1).every(x => x[2] === 10), tab && tab.rijen);
check('installeren: codes zien eruit als naam-xxxx', tab.rijen.slice(1).every(x => /^(caesar|stijn|max)-[a-z0-9]{4}$/.test(x[0])), tab.rijen);
const codeCaesar = tab.rijen[1][0];
w.run('installeren');
check('installeren nog eens: tabblad blijft, codes blijven', w.tabs['Uitnodigingen'].rijen.length === 4 && w.tabs['Uitnodigingen'].rijen[1][0] === codeCaesar);
check('gegenereerde code werkt meteen', w.get(codeCaesar).geldig === true && w.get(codeCaesar).van === 'Caesar');
check('kolom Uitnodiging aangemaakt door installeren', w.rijen[0].includes('Uitnodiging'), w.rijen[0]);

// 8. mail mislukt: aanmelding en goedkeuring tellen wel
w = maakWereld({ mailKapot: true, plafond: 70 });
r = w.post(basis('m@v.nl'));
check('mail mislukt: rij staat, ok=true, mail=false met reden', r.ok === true && r.mail === false && /toestemming/.test(r.mailFout) && w.rijen.length === 2, r);
w.vink(2, true);
check('goedkeuring met kapotte mail: status meldt het', /Goedgekeurd \(mail mislukt\)/.test(w.status(2)) && /niet verstuurd/.test(w.toasts.at(-1)), [w.status(2), w.toasts]);
w = maakWereld();
r = w.post(basis('m2@v.nl'));
check('mail gelukt: antwoord meldt mail=true', r.ok === true && r.mail === true, r);

// 9. ongeldig, honeypot, te groot
w = maakWereld();
check('ongeldig mailadres -> code ongeldig', w.post(basis('geen-mail')).code === 'ongeldig');
r = w.post({ ...basis('bot@v.nl'), website: 'http://spam' });
check('honeypot: ok maar niets geschreven', r.ok === true && w.rijen.length === 1 && w.mails.length === 0, r);
check('te grote body geweigerd', w.post({ ...basis('g@v.nl'), rommel: 'x'.repeat(5000) }).code === 'ongeldig');
// 10. extra namen boven het aantal worden gewist
w = maakWereld();
w.post(basis('n@v.nl', 1, { 'Naam persoon (extra 1)': 'mag niet' }));
check('naam van niet-meekomend persoon gewist', w.rijen[1][4] === '', w.rijen[1]);

// 11. de wachtrij-mail: HTML uit het Figma-ontwerp, placeholders ingevuld, NL of EN
w = maakWereld();
w.post(basis('anna@v.nl', 3, { Voornaam: 'Anna', Achternaam: 'de Vries', 'Naam persoon (extra 1)': 'x', 'Naam persoon (extra 2)': 'y' }));
let m = w.mails[0];
check('mail heeft onderwerp, tekst en HTML', m.subject && m.body && /^<!DOCTYPE html>/.test(m.htmlBody), Object.keys(m));
check('NL: onderwerp in het Nederlands', /aanmelding voor de première/.test(m.subject), m.subject);
check('NL: aanhef met voornaam', /Beste Anna,/.test(m.htmlBody), m.htmlBody.slice(0, 200));
check('NL: volledige naam en aantal op het kaartje', /Anna de Vries/.test(m.htmlBody) && />3<\/td>/.test(m.htmlBody));
check('NL: geen placeholder blijven staan', !/\{\{/.test(m.htmlBody) && !/\{\{/.test(m.body), m.body);
check('NL: tekstversie bevat naam en aantal', /Beste Anna,/.test(m.body) && /Aantal personen: 3/.test(m.body), m.body);
w.post(basis('tom@v.nl', 1, { Voornaam: 'Tom', Achternaam: "O'Brien <b>", Taal: 'en' }));
m = w.mails[1];
check('EN: onderwerp en aanhef in het Engels', /premiere of Back to Being/.test(m.subject) && /Dear Tom,/.test(m.htmlBody), m.subject);
check('EN: HTML in de naam wordt onschadelijk gemaakt', /O&#39;Brien &lt;b&gt;/.test(m.htmlBody) && !/<b>/.test(m.htmlBody));
check('EN: Nederlandse tekst komt niet voor', !/Aanmeldingsgegevens|Bezoeker|Tot snel|wachtrij/.test(m.htmlBody));
w.post(basis('geen-taal@v.nl', 1, { Taal: 'xx' }));
check('onbekende taal -> Nederlands', /aanmelding voor de première/.test(w.mails[2].subject), w.mails[2].subject);

console.log(fouten ? '\n' + fouten + ' FOUT(EN)' : '\nalles ok'); process.exit(fouten ? 1 : 0);
