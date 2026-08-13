/**
 * Het dagelijkse commando.
 *
 * Avondritueel:
 *   1. schrijf je tekst in  data/teksten/dag-3.md
 *   2. zet je foto's in     photos-origineel/dag-3/
 *   3. draai                .\dag.cmd 3
 *   4. commit en push
 *
 * Elke stap staat op zichzelf. Geen Strava-activiteit, geen internet voor de
 * vertaling of geen foto's: het script waarschuwt en gaat door. De pagina
 * rendert altijd wat er wel is.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { leesEnv } from './lib/env.mjs';
import { leesGpx } from './lib/gpx.mjs';
import { leesTcx } from './lib/tcx.mjs';
import { verklein } from './lib/geo.mjs';
import { verwerkFotos } from './lib/fotos.mjs';
import { vertaal } from './lib/vertaal.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HIER, '..');
const LOG_PAD = join(ROOT, 'data', 'camino-log.json');
const ROUTE_PAD = join(ROOT, 'data', 'camino-route.json');

/* ---------- argumenten ---------- */
const argv = process.argv.slice(2);
const dagNr = Number(argv.find((a) => /^\d+$/.test(a)));
const heeft = (v) => argv.includes(v);
const waardeVan = (v) => {
  const i = argv.indexOf(v);
  return i !== -1 ? argv[i + 1] : null;
};

if (!Number.isInteger(dagNr)) {
  console.error(`
Gebruik:  .\\dag.cmd <dagnummer> [opties]

  .\\dag.cmd 3                     alles: route, foto's, vertaling
  .\\dag.cmd 3 --alleen-fotos      alleen foto's verwerken (werkt offline)
  .\\dag.cmd 3 --skip-route        tekst en foto's, geen routegegevens
  .\\dag.cmd 3 --skip-vertaling    geen Engelse vertaling
  .\\dag.cmd 3 --spoor <pad>       bestand ergens anders vandaan halen
  .\\dag.cmd 3 --forceer           verwerk foto's opnieuw, hervertaal

Het spoor komt standaard uit  data/sporen/dag-3.tcx  of  data/sporen/dag-3.gpx
Exporteren: Garmin Connect > activiteit > tandwiel > Export to TCX (of GPX)

TCX heeft de voorkeur: daar staan Garmin's eigen afstand en tijd in, zodat de
site precies dezelfde cijfers toont als je horloge. Een GPX bevat alleen
coordinaten, dus dan rekenen we het zelf uit en kan het een paar procent
schelen.
`);
  process.exit(1);
}

const skipRoute = heeft('--skip-route') || heeft('--alleen-fotos');
const skipVertaling = heeft('--skip-vertaling') || heeft('--alleen-fotos');
const forceer = heeft('--forceer');

/* ---------- helpers ---------- */
function leesJson(pad, standaard) {
  if (!existsSync(pad)) return standaard;
  try {
    return JSON.parse(readFileSync(pad, 'utf8'));
  } catch (err) {
    throw new Error(`${pad} is geen geldige JSON: ${err.message}`);
  }
}

function hash(tekst) {
  // Kleine, stabiele hash. Alleen bedoeld om te zien of de NL-tekst is
  // veranderd, zodat we niet elke run opnieuw laten vertalen.
  let h = 5381;
  for (let i = 0; i < tekst.length; i++) h = ((h * 33) ^ tekst.charCodeAt(i)) >>> 0;
  return String(h);
}

/** Leest data/teksten/dag-N.md. Eerste `# regel` is de titel. */
function leesTekst(nr) {
  const pad = join(ROOT, 'data', 'teksten', `dag-${nr}.md`);
  if (!existsSync(pad)) return { titel: null, tekst: null, pad };
  const ruw = readFileSync(pad, 'utf8').trim();
  if (!ruw) return { titel: null, tekst: null, pad };

  const regels = ruw.split(/\r?\n/);
  let titel = null;
  if (regels[0].startsWith('# ')) {
    titel = regels.shift().slice(2).trim();
  }
  return { titel, tekst: regels.join('\n').trim(), pad };
}

const meldingen = [];
const ok = (m) => { meldingen.push('  v  ' + m); console.log('  v  ' + m); };
const let_op = (m) => { meldingen.push('  !  ' + m); console.log('  !  ' + m); };

/* ---------- main ---------- */
const route = leesJson(ROUTE_PAD, null);
if (!route) {
  console.error('data/camino-route.json ontbreekt.');
  process.exit(1);
}
const etappe = route.etappes.find((e) => e.dag === dagNr) || null;

const log = leesJson(LOG_PAD, { vertrekDatum: null, startDatum: null, dagen: [] });
if (!Array.isArray(log.dagen)) log.dagen = [];

let entry = log.dagen.find((d) => d.dag === dagNr);
if (!entry) {
  entry = { dag: dagNr };
  log.dagen.push(entry);
}

// Datum: uit de etappe, tenzij hij er al stond.
if (!entry.datum) {
  entry.datum = etappe ? etappe.datum : new Date().toISOString().slice(0, 10);
}
if (etappe) {
  entry.van = entry.van || etappe.van;
  entry.naar = entry.naar || etappe.naar;
}

console.log(`\nDag ${dagNr}  (${entry.datum}${etappe ? `, ${etappe.van} naar ${etappe.naar}` : ''})\n`);

/* --- 1. tekst --- */
const { titel, tekst, pad: tekstPad } = leesTekst(dagNr);
if (tekst) {
  entry.tekst_nl = tekst;
  if (titel) entry.titel = titel;
  ok(`tekst gelezen uit data/teksten/dag-${dagNr}.md (${tekst.length} tekens)`);
} else {
  mkdirSync(join(ROOT, 'data', 'teksten'), { recursive: true });
  if (!existsSync(tekstPad)) {
    writeFileSync(
      tekstPad,
      `# \n\nSchrijf hier je verhaal van dag ${dagNr}.\nLege regel tussen alinea's.\n`,
      'utf8'
    );
    let_op(`nog geen tekst; leeg sjabloon aangemaakt op data/teksten/dag-${dagNr}.md`);
  } else {
    let_op(`data/teksten/dag-${dagNr}.md is nog leeg`);
  }
}

/* --- 2. route uit de GPX --- */
if (skipRoute) {
  let_op('routegegevens overgeslagen');
} else {
  // TCX eerst: daar staan Garmin's eigen afstand en tijd in. Een GPX bevat
  // alleen coordinaten, dus dan moeten we het zelf uitrekenen.
  const opgegeven = waardeVan('--spoor');
  const kandidaten = opgegeven
    ? [opgegeven]
    : [
        join(ROOT, 'data', 'sporen', `dag-${dagNr}.tcx`),
        join(ROOT, 'data', 'sporen', `dag-${dagNr}.gpx`),
      ];
  const spoorPad = kandidaten.find((p) => existsSync(p));

  if (!spoorPad) {
    mkdirSync(join(ROOT, 'data', 'sporen'), { recursive: true });
    entry.track = entry.track || null;
    let_op(
      `geen spoor gevonden voor dag ${dagNr}\n` +
      `     Exporteer hem uit Garmin Connect (activiteit > tandwiel > Export to TCX)\n` +
      `     en zet hem neer als data/sporen/dag-${dagNr}.tcx, of wijs hem aan met --spoor <pad>.`
    );
  } else {
    try {
      const isTcx = spoorPad.toLowerCase().endsWith('.tcx');
      const g = isTcx ? leesTcx(spoorPad) : leesGpx(spoorPad);

      // Een wandeldag levert duizenden punten op. Op het zoomniveau van de
      // kaart is dat niet te onderscheiden van een paar honderd, en het
      // scheelt de bezoeker honderden KB.
      const coords = verklein(g.coords, 600);

      entry.track = {
        bron: isTcx ? 'tcx' : 'gpx',
        afstandKm: g.afstandKm,
        tijdSeconden: g.tijdSeconden,
        hoogtemeters: g.hoogtemeters,
        coords,
      };

      ok(
        `route: ${g.afstandKm} km` +
        (g.tijdSeconden ? `, ${Math.round(g.tijdSeconden / 60)} min` : '') +
        (g.heeftHoogte ? `, ${g.hoogtemeters} hm` : '') +
        `, ${coords.length} punten (van ${g.ruwePunten})`
      );

      if (isTcx && g.vanGarmin) {
        ok(`afstand en tijd komen uit de TCX zelf, dus gelijk aan je horloge (${g.laps} laps)`);
        if (g.afwijkingPct != null && Math.abs(g.afwijkingPct) > 8) {
          const pct = Math.abs(g.afwijkingPct);
          let_op(
            `Garmin meldt ${pct}% ${g.afwijkingPct > 0 ? 'meer' : 'minder'} afstand dan ` +
            `uit de GPS-punten volgt. Bij een tunnel of slecht bereik is dat normaal.`
          );
        }
      } else if (!isTcx) {
        let_op('GPX bevat geen totalen; afstand en tijd zijn door ons berekend uit de punten');
      }

      if (!g.heeftTijd) let_op('het bestand bevat geen tijd, dus geen looptijd');
      if (!g.heeftHoogte) let_op('het bestand bevat geen hoogte, dus geen hoogtemeters');
    } catch (err) {
      entry.track = entry.track || null;
      let_op(`spoor lezen mislukt: ${err.message}`);
    }
  }
}

/* --- 3. foto's --- */
try {
  const { paden, overgeslagen, reden } = await verwerkFotos(dagNr, ROOT, { forceer });
  if (reden) {
    let_op(`foto's: ${reden}`);
  } else if (paden.length) {
    entry.fotos = paden;
    ok(`foto's: ${paden.length} totaal (${paden.length - overgeslagen} nieuw verwerkt)`);
  } else {
    let_op(`geen foto's gevonden in photos-origineel/dag-${dagNr}/`);
  }
} catch (err) {
  let_op(`foto's mislukt: ${err.message}`);
}

/* --- 4. vertaling --- */
if (skipVertaling) {
  let_op('vertaling overgeslagen');
} else if (!entry.tekst_nl) {
  let_op('vertaling overgeslagen: er is nog geen Nederlandse tekst');
} else {
  const h = hash(entry.tekst_nl + '|' + (entry.titel || ''));
  if (entry.tekst_nl_hash === h && entry.tekst_en && !forceer) {
    ok('vertaling nog actueel, niet opnieuw opgevraagd');
  } else {
    const env = leesEnv();
    const res = await vertaal({
      titel: entry.titel,
      tekst: entry.tekst_nl,
      apiKey: env.ANTHROPIC_API_KEY,
    });
    if (res.ok) {
      entry.tekst_en = res.tekst_en;
      if (res.titel_en) entry.titel_en = res.titel_en;
      entry.tekst_nl_hash = h;
      ok('Engelse vertaling geschreven');
    } else {
      let_op(`vertaling mislukt: ${res.reden} (site valt terug op Nederlands)`);
    }
  }
}

/* --- 5. wegschrijven --- */
log.dagen.sort((a, b) => a.dag - b.dag);
log.laatsteUpdate = new Date().toISOString();
mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(LOG_PAD, JSON.stringify(log, null, 2) + '\n', 'utf8');

console.log(`\nGeschreven naar data/camino-log.json\n`);
console.log('Nu committen en pushen:\n');
console.log(`  git add data photos`);
console.log(`  git commit -m "Voeg dag ${dagNr} toe aan de Camino-blog"`);
console.log(`  git push\n`);
