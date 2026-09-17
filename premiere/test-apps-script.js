// Draait apps-script.gs lokaal met nagebootste Google-diensten: node premiere/test-apps-script.js
const fs = require('fs'), vm = require('vm');
const bron = fs.readFileSync(process.argv[2] || require('path').join(__dirname, 'apps-script.gs'), 'utf8');

function maakWereld(opts = {}) {
  const rijen = [['Voornaam','Achternaam','Mailadress','Aantal personen ','Naam persoon (extra 1)','Naam persoon (extra 2)','Naam persoon (extra 3)','Naam persoon (extra 4)']];
  const mails = []; const cache = {};
  const sheet = {
    getLastColumn: () => rijen[0].length,
    getLastRow: () => rijen.length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => rijen.slice(r - 1, r - 1 + nr).map(x => Array.from({ length: nc }, (_, i) => x[c - 1 + i] ?? '')),
      setValue: v => { rijen[r - 1][c - 1] = v; },
    }),
    appendRow: w => rijen.push(w),
  };
  const ctx = {
    console: { log() {}, error() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => [sheet], getSheetByName: () => sheet }), openById: () => null },
    LockService: { getScriptLock: () => ({ tryLock: () => !opts.slotBezet, waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    MailApp: { sendEmail: m => mails.push(m) },
    Utilities: { formatDate: () => '17-09-2026 16:00' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType() { return this; }, getContent: () => t }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'ik@voorbeeld.nl' }) },
  };
  vm.createContext(ctx);
  let code = bron;
  if (opts.plafond) code = code.replace('const MAX_TOTAAL_PERSONEN = 0;', 'const MAX_TOTAAL_PERSONEN = ' + opts.plafond + ';');
  vm.runInContext(code, ctx);
  const post = d => JSON.parse(vm.runInContext('doPost', ctx)({ postData: { contents: JSON.stringify(d) } }).getContent());
  return { post, rijen, mails };
}
const basis = (mail, n = 1, extra = {}) => ({ Voornaam: 'A', Achternaam: 'B', Mailadress: mail, 'Aantal personen': String(n), Taal: 'nl', ...extra });
let fouten = 0;
function check(naam, cond, info) { console.log((cond ? 'OK  ' : 'FOUT') + '  ' + naam + (cond ? '' : '  -> ' + JSON.stringify(info))); if (!cond) fouten++; }

// 1. nieuw, dan dubbel (ook met andere hoofdletters en spaties)
let w = maakWereld();
let r = w.post(basis('Jan@Voorbeeld.nl', 2, { 'Naam persoon (extra 1)': 'Piet' }));
check('nieuwe aanmelding ok', r.ok === true && w.rijen.length === 2 && w.mails.length === 1, r);
check('mailadres in kleine letters opgeslagen', w.rijen[1][2] === 'jan@voorbeeld.nl', w.rijen[1]);
check('kolommen Taal en Ingeschreven op toegevoegd', w.rijen[0].includes('Taal') && w.rijen[0].includes('Ingeschreven op'), w.rijen[0]);
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

// 4. plafond 5 personen
w = maakWereld({ plafond: 5 });
check('plafond: 3 personen past', w.post(basis('a@v.nl', 3, { 'Naam persoon (extra 1)': 'x', 'Naam persoon (extra 2)': 'y' })).ok === true);
r = w.post(basis('b@v.nl', 3, { 'Naam persoon (extra 1)': 'x', 'Naam persoon (extra 2)': 'y' }));
check('plafond: 3 erbij gaat over 5 -> code vol', r.code === 'vol' && w.rijen.length === 2, r);
check('plafond: 2 erbij past precies', w.post(basis('c@v.nl', 2, { 'Naam persoon (extra 1)': 'x' })).ok === true);

// 5. ongeldig, honeypot, te groot
w = maakWereld();
check('ongeldig mailadres -> code ongeldig', w.post(basis('geen-mail')).code === 'ongeldig');
r = w.post({ ...basis('bot@v.nl'), website: 'http://spam' });
check('honeypot: ok maar niets geschreven', r.ok === true && w.rijen.length === 1 && w.mails.length === 0, r);
check('te grote body geweigerd', w.post({ ...basis('g@v.nl'), rommel: 'x'.repeat(5000) }).code === 'ongeldig');
// 6. extra namen boven het aantal worden gewist
w = maakWereld();
w.post(basis('n@v.nl', 1, { 'Naam persoon (extra 1)': 'mag niet' }));
check('naam van niet-meekomend persoon gewist', w.rijen[1][4] === '', w.rijen[1]);

console.log(fouten ? '\n' + fouten + ' FOUT(EN)' : '\nalles ok'); process.exit(fouten ? 1 : 0);
