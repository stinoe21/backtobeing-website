/**
 * Demo-schakelaar: laat zien hoe de pagina er onderweg uit gaat zien.
 *
 *   node demo.mjs aan      dag 1
 *   node demo.mjs aan 3    dag 1 tot en met 3
 *   node demo.mjs uit      alles terugdraaien
 *
 * Belangrijk: dit script maakt alleen *invoer* aan (een TCX, een tekst, wat
 * foto's) en schrijft niets rechtstreeks in camino-log.json. Daarna draai je
 * gewoon  .\dag.cmd 1  zoals je onderweg ook zou doen. Zo test de demo de
 * echte keten en niet een namaakversie ernaast.
 *
 * `uit` verwijdert precies de bestanden die `aan` heeft aangemaakt; die lijst
 * staat in data/.demo.json. Bestanden die jij zelf hebt neergezet blijven dus
 * staan, ook als ze dezelfde naam hebben.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { haversine } from './lib/gpx.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HIER, '..');
const MERK = join(ROOT, 'data', '.demo.json');

/* Foto's die al in de repo staan. Echte foto's van jullie drieen, dus je ziet
   meteen of het fotogrid klopt met portret en landschap door elkaar. */
const FOTOS = ['founders-group.jpg', 'caesar-schoorl.jpg', 'stijn-smit.jpg', 'Max.jpeg'];

const TEKSTEN = {
  1: `# De brug over de Minho

Om kwart voor zeven stonden we op de brug bij Valença, nog in Portugal, met
de mist zo laag over het water dat je de overkant niet zag. Twintig meter
verderop hing het bordje dat zei dat we in Spanje waren. Zo simpel is dat
blijkbaar.

Caesar had zijn schoenen te strak gestrikt en kwam daar na acht kilometer
achter. Max liep de hele ochtend te vertellen over een podcast die niemand had
geluisterd. Ik zei niet zo veel. Dat was precies de bedoeling.

In O Porrino aangekomen met drie blaren en een hoofd dat voor het eerst in
maanden even stil was.`,
  2: `# Regen tot aan Redondela

Het begon te regenen voordat we de deur uit waren en het is niet meer
opgehouden. Achttien kilometer met natte sokken. Je gaat er anders van denken.`,
  3: `# Over de brug van Ponte Sampaio

Vandaag de mooiste dag tot nu toe. Bos, een oude Romeinse brug, en aan het
eind Pontevedra waar het terras al klaarstond.`,
  4: `# De lange dag

Drieentwintig kilometer, de langste tot nu toe. Om vier uur waren we er.`,
  5: `# Padron

Kortere dag. We hebben de peperkes gegeten waar iedereen het over heeft.`,
  6: `# Santiago

We staan op het plein. Meer valt er even niet over te zeggen.`,
};

/* ---------- TCX genereren ---------- */

/**
 * Een wandelpad is geen rechte lijn tussen twee dorpen. Zonder slingering
 * komt de GPS-afstand ver onder de geplande kilometers uit en ziet de lijn op
 * de kaart eruit als een liniaal. We leggen daarom een golving loodrecht op
 * de route, en schalen die tot de afstand ongeveer klopt met de etappe.
 */
function padVan(punten, slinger) {
  const uit = [];
  const perSegment = 220;

  for (let s = 0; s < punten.length - 1; s++) {
    const [lon1, lat1] = punten[s];
    const [lon2, lat2] = punten[s + 1];
    // Loodrecht op dit segment, ruwweg (op deze breedtegraad is dat genoeg).
    const dx = lon2 - lon1;
    const dy = lat2 - lat1;
    const lengte = Math.hypot(dx, dy) || 1;
    const nx = -dy / lengte;
    const ny = dx / lengte;

    for (let i = 0; i < perSegment; i++) {
      const f = i / perSegment;
      const globaal = (s + f) / (punten.length - 1);
      // Drie sinussen met oplopende frequentie: grote bochten met kleinere
      // kronkels erin, in plaats van een regelmatige slang.
      const golf =
        Math.sin(globaal * Math.PI * 7) * 1.0 +
        Math.sin(globaal * Math.PI * 19 + 1.3) * 0.45 +
        Math.sin(globaal * Math.PI * 43 + 2.7) * 0.18;
      const d = golf * slinger;
      uit.push([lon1 + dx * f + nx * d, lat1 + dy * f + ny * d]);
    }
  }
  uit.push(punten[punten.length - 1]);
  return uit;
}

function padLengte(pad) {
  let m = 0;
  for (let i = 1; i < pad.length; i++) {
    m += haversine(pad[i - 1][0], pad[i - 1][1], pad[i][0], pad[i][1]);
  }
  return m;
}

/** Zoekt de slingering waarbij het pad ongeveer de geplande lengte krijgt. */
function padOpMaat(punten, doelMeter) {
  let laag = 0;
  let hoog = 0.02;
  let pad = padVan(punten, hoog);
  for (let i = 0; i < 40; i++) {
    const mid = (laag + hoog) / 2;
    pad = padVan(punten, mid);
    if (padLengte(pad) < doelMeter) laag = mid;
    else hoog = mid;
  }
  return pad;
}

/**
 * Hoogteprofiel: een basis met vier golven eroverheen. Vier keer op en neer
 * met een amplitude van 35 m geeft ongeveer 280 hoogtemeters, wat voor deze
 * etappes een geloofwaardig getal is.
 */
function hoogte(f) {
  return 30 + Math.sin(f * Math.PI * 8 - Math.PI / 2) * 35 + 35 + f * 10;
}

function tcxVoor(etappe, route) {
  const punten = route.punten
    .slice(etappe.vanIndex, etappe.totIndex)
    .map((p) => p.lngLat);
  const pad = padOpMaat(punten, etappe.km * 1000);
  const meters = padLengte(pad);

  // Vertrek om 06:40 UTC, ongeveer 4,1 km/u, met een pauze van 45 minuten
  // ergens over de helft. De pauze zit wel in de tijdstempels maar niet in de
  // laptijden, precies zoals een echte Garmin dat doet.
  const start = Date.parse(etappe.datum + 'T06:40:00.000Z');
  const loopSeconden = Math.round((meters / 1000) * 880);
  const pauzeNa = Math.floor(pad.length * 0.55);
  const pauzeSeconden = 45 * 60;

  const perPunt = loopSeconden / (pad.length - 1);
  const rijen = pad.map((c, i) => ({
    lon: c[0],
    lat: c[1],
    ele: hoogte(i / (pad.length - 1)),
    t: start + Math.round(i * perPunt + (i > pauzeNa ? pauzeSeconden : 0)) * 1000,
  }));

  /* Laps per kilometer, zoals de auto-lap van een Garmin. De laatste lap is
     de restafstand. Dit is waar de site zijn afstand en tijd vandaan haalt. */
  const laps = [];
  let lapMeter = 0;
  let lapStart = 0;
  let gelopen = 0;
  for (let i = 1; i < rijen.length; i++) {
    lapMeter += haversine(rijen[i - 1].lon, rijen[i - 1].lat, rijen[i].lon, rijen[i].lat);
    gelopen += 1;
    if (lapMeter >= 1000 || i === rijen.length - 1) {
      const seconden = (i - lapStart) * perPunt;
      laps.push({ van: lapStart, tot: i, meters: lapMeter, seconden });
      lapMeter = 0;
      lapStart = i;
    }
  }
  void gelopen;

  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '.000Z');

  const lapXml = laps
    .map((lap) => {
      const punten = rijen
        .slice(lap.van, lap.tot + 1)
        .map(
          (r) =>
            `        <Trackpoint>\n` +
            `          <Time>${iso(r.t)}</Time>\n` +
            `          <Position>\n` +
            `            <LatitudeDegrees>${r.lat.toFixed(7)}</LatitudeDegrees>\n` +
            `            <LongitudeDegrees>${r.lon.toFixed(7)}</LongitudeDegrees>\n` +
            `          </Position>\n` +
            `          <AltitudeMeters>${r.ele.toFixed(1)}</AltitudeMeters>\n` +
            `        </Trackpoint>`
        )
        .join('\n');
      return (
        `    <Lap StartTime="${iso(rijen[lap.van].t)}">\n` +
        `      <TotalTimeSeconds>${lap.seconden.toFixed(2)}</TotalTimeSeconds>\n` +
        `      <DistanceMeters>${lap.meters.toFixed(1)}</DistanceMeters>\n` +
        `      <Calories>${Math.round(lap.meters / 16)}</Calories>\n` +
        `      <Intensity>Active</Intensity>\n` +
        `      <TriggerMethod>Distance</TriggerMethod>\n` +
        `      <Track>\n${punten}\n      </Track>\n` +
        `    </Lap>`
      );
    })
    .join('\n');

  return {
    xml:
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">\n` +
      `  <Activities>\n    <Activity Sport="Other">\n` +
      `      <Id>${iso(start)}</Id>\n` +
      lapXml +
      `\n      <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
      `        <Name>DEMO (niet van een echt horloge)</Name>\n      </Creator>\n` +
      `    </Activity>\n  </Activities>\n</TrainingCenterDatabase>\n`,
    km: Math.round((meters / 1000) * 10) / 10,
    punten: rijen.length,
    laps: laps.length,
  };
}

/* ---------- aan / uit ---------- */

const argv = process.argv.slice(2);
const modus = argv[0];
const totDag = Number(argv[1]) || 1;

function leesMerk() {
  if (!existsSync(MERK)) return { bestanden: [], mappen: [], dagen: [] };
  return JSON.parse(readFileSync(MERK, 'utf8'));
}

if (modus === 'uit') {
  const merk = leesMerk();
  let weg = 0;
  for (const p of merk.bestanden) {
    if (existsSync(join(ROOT, p))) {
      rmSync(join(ROOT, p));
      weg++;
    }
  }
  for (const p of merk.mappen) {
    if (existsSync(join(ROOT, p))) {
      rmSync(join(ROOT, p), { recursive: true });
      weg++;
    }
  }

  // Alleen de dagen die de demo heeft aangemaakt uit het logboek halen.
  const logPad = join(ROOT, 'data', 'camino-log.json');
  if (existsSync(logPad)) {
    const log = JSON.parse(readFileSync(logPad, 'utf8'));
    const voor = (log.dagen || []).length;
    log.dagen = (log.dagen || []).filter((d) => !merk.dagen.includes(d.dag));
    delete log.laatsteUpdate;
    writeFileSync(logPad, JSON.stringify(log, null, 2) + '\n', 'utf8');
    console.log(`  camino-log.json: ${voor - log.dagen.length} demo-dag(en) verwijderd`);
  }

  if (existsSync(MERK)) rmSync(MERK);
  console.log(`  ${weg} bestand(en) en map(pen) opgeruimd`);
  console.log('\nDe demo staat uit.\n');
  process.exit(0);
}

if (modus !== 'aan') {
  console.error(`
Gebruik:

  node demo.mjs aan       zet demo-invoer klaar voor dag 1
  node demo.mjs aan 3     voor dag 1 tot en met 3
  node demo.mjs uit       ruim alles weer op

Daarna draai je per dag het gewone commando, bijvoorbeeld:

  .\\dag.cmd 1 --skip-vertaling
`);
  process.exit(1);
}

const route = JSON.parse(readFileSync(join(ROOT, 'data', 'camino-route.json'), 'utf8'));
const merk = { bestanden: [], mappen: [], dagen: [] };

mkdirSync(join(ROOT, 'data', 'sporen'), { recursive: true });
mkdirSync(join(ROOT, 'data', 'teksten'), { recursive: true });

console.log('');
for (let dag = 1; dag <= totDag; dag++) {
  const etappe = route.etappes.find((e) => e.dag === dag);
  if (!etappe) continue;

  const { xml, km, punten, laps } = tcxVoor(etappe, route);
  const tcxRel = `data/sporen/dag-${dag}.tcx`;
  writeFileSync(join(ROOT, tcxRel), xml, 'utf8');
  merk.bestanden.push(tcxRel);

  const tekstRel = `data/teksten/dag-${dag}.md`;
  writeFileSync(join(ROOT, tekstRel), (TEKSTEN[dag] || TEKSTEN[6]) + '\n', 'utf8');
  merk.bestanden.push(tekstRel);

  // Dag 1 krijgt vier foto's, de rest twee: dan zie je meteen hoe het grid
  // zich met een oneven en een even aantal gedraagt.
  const fotoMapRel = `photos-origineel/dag-${dag}`;
  mkdirSync(join(ROOT, fotoMapRel), { recursive: true });
  const aantal = dag === 1 ? 4 : 2;
  for (let i = 0; i < aantal; i++) {
    const bron = FOTOS[(dag + i) % FOTOS.length];
    const ext = bron.slice(bron.lastIndexOf('.'));
    copyFileSync(join(ROOT, bron), join(ROOT, fotoMapRel, `demo-${i + 1}${ext}`));
  }
  merk.mappen.push(fotoMapRel);
  merk.mappen.push(`photos/dag-${dag}`);
  merk.dagen.push(dag);

  console.log(
    `  dag ${dag}: ${etappe.van} naar ${etappe.naar}, ${km} km, ${punten} punten, ${laps} laps, ${aantal} foto's`
  );
}

writeFileSync(MERK, JSON.stringify(merk, null, 2) + '\n', 'utf8');

console.log('\nDemo-invoer staat klaar. Draai nu per dag het gewone commando:\n');
for (let dag = 1; dag <= totDag; dag++) console.log(`  .\\dag.cmd ${dag} --skip-vertaling`);
console.log('\nDaarna bekijken met:  npx serve .   en dan  http://localhost:3000/volg');
console.log('Opruimen met:         node tools/demo.mjs uit\n');
