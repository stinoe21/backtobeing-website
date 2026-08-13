/**
 * Leest een TCX-bestand uit Garmin Connect.
 *
 * Waarom naast GPX ook dit: een GPX is puur een lijst coordinaten. Er staat
 * geen totale afstand of tijd in, dus die moeten we zelf uitrekenen en dan
 * wijken ze een paar procent af van wat je horloge zegt. Een TCX draagt wel
 * Garmin's eigen cijfers: elke <Lap> heeft een verplichte <TotalTimeSeconds>
 * en <DistanceMeters>. Die nemen we letterlijk over.
 *
 * Hoogtemeters zitten er niet als totaal in, alleen <AltitudeMeters> per punt,
 * dus die berekenen we hier wel zelf (met dezelfde filtering als bij GPX).
 *
 * Exporteren: Garmin Connect > activiteit > tandwiel > Export to TCX
 *
 * Zelftest:  node lib/tcx.mjs --test
 */
import { readFileSync } from 'node:fs';
import { haversine, hoogteWinst, afstandMeter } from './gpx.mjs';

const TRACKPOINT = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g;
const LAT = /<LatitudeDegrees>\s*(-?[\d.]+)\s*<\/LatitudeDegrees>/;
const LON = /<LongitudeDegrees>\s*(-?[\d.]+)\s*<\/LongitudeDegrees>/;
const ALT = /<AltitudeMeters>\s*(-?[\d.]+)\s*<\/AltitudeMeters>/;
const TIJD = /<Time>\s*([^<]+?)\s*<\/Time>/;

const LAP = /<Lap\b[^>]*>([\s\S]*?)<\/Lap>/g;
const LAP_TIJD = /<TotalTimeSeconds>\s*([\d.]+)\s*<\/TotalTimeSeconds>/;
const LAP_AFSTAND = /<DistanceMeters>\s*([\d.]+)\s*<\/DistanceMeters>/;

/** Trackpunten uit een TCX. Punten zonder GPS-fix worden overgeslagen. */
export function parseTcx(xml) {
  const punten = [];
  let m;
  TRACKPOINT.lastIndex = 0;
  while ((m = TRACKPOINT.exec(xml)) !== null) {
    const body = m[1];
    const lat = LAT.exec(body);
    const lon = LON.exec(body);
    // Binnen of zonder fix schrijft Garmin een Trackpoint zonder <Position>.
    // Die overslaan, anders krijg je een sprong naar null-eiland.
    if (!lat || !lon) continue;

    const alt = ALT.exec(body);
    const tijd = TIJD.exec(body);
    punten.push({
      lat: Number(lat[1]),
      lon: Number(lon[1]),
      ele: alt ? Number(alt[1]) : null,
      t: tijd ? Date.parse(tijd[1]) : null,
    });
  }
  return punten;
}

/**
 * De totalen die Garmin zelf heeft berekend. Een activiteit kan meerdere laps
 * hebben (ronderondje, of automatisch per kilometer), dus optellen.
 */
export function parseLaps(xml) {
  let seconden = 0;
  let meters = 0;
  let aantal = 0;
  let m;
  LAP.lastIndex = 0;
  while ((m = LAP.exec(xml)) !== null) {
    const body = m[1];
    const t = LAP_TIJD.exec(body);
    const d = LAP_AFSTAND.exec(body);
    if (t) seconden += Number(t[1]);
    if (d) meters += Number(d[1]);
    aantal++;
  }
  return { seconden, meters, aantal };
}

export function leesTcx(pad) {
  const xml = readFileSync(pad, 'utf8');
  const punten = parseTcx(xml);

  if (punten.length < 2) {
    throw new Error(
      `geen trackpunten met GPS-positie gevonden in ${pad}. Is dit een TCX van ` +
      `een buitenactiviteit?`
    );
  }

  const laps = parseLaps(xml);
  const zelfBerekend = afstandMeter(punten);

  // Garmin's eigen afstand als die er is; anders zelf uitrekenen.
  const meters = laps.meters > 0 ? laps.meters : zelfBerekend;
  const met = punten.filter((p) => p.t != null);
  const verstreken =
    met.length >= 2 ? Math.round((met[met.length - 1].t - met[0].t) / 1000) : 0;

  return {
    coords: punten.map((p) => [p.lon, p.lat]),
    afstandKm: Math.round((meters / 1000) * 10) / 10,
    hoogtemeters: Math.round(hoogteWinst(punten)),
    tijdSeconden: laps.seconden > 0 ? Math.round(laps.seconden) : verstreken || null,
    ruwePunten: punten.length,
    heeftTijd: laps.seconden > 0 || met.length > 0,
    heeftHoogte: punten.some((p) => p.ele != null),
    // Voor de melding in het script: komen de cijfers van Garmin of van ons?
    vanGarmin: laps.meters > 0 && laps.seconden > 0,
    laps: laps.aantal,
    // Verschil tussen Garmin's afstand en wat wij uit de punten zouden halen.
    // Loopt dat ver uiteen, dan is er iets raars met de track.
    afwijkingPct:
      laps.meters > 0 && zelfBerekend > 0
        ? Math.round(((laps.meters - zelfBerekend) / zelfBerekend) * 1000) / 10
        : null,
  };
}

/* ---------- zelftest ---------- */
if (process.argv.includes('--test')) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
 <Activities><Activity Sport="Walking">
  <Id>2026-07-26T09:24:14.000Z</Id>
  <Lap StartTime="2026-07-26T09:24:14.000Z">
   <TotalTimeSeconds>600.0</TotalTimeSeconds>
   <DistanceMeters>1000.0</DistanceMeters>
   <Calories>50</Calories>
   <Track>
    <Trackpoint><Time>2026-07-26T09:24:14.000Z</Time>
     <Position><LatitudeDegrees>42.0000</LatitudeDegrees><LongitudeDegrees>-8.6000</LongitudeDegrees></Position>
     <AltitudeMeters>100.0</AltitudeMeters></Trackpoint>
    <Trackpoint><Time>2026-07-26T09:26:14.000Z</Time>
     <Position><LatitudeDegrees>42.0010</LatitudeDegrees><LongitudeDegrees>-8.6000</LongitudeDegrees></Position>
     <AltitudeMeters>110.0</AltitudeMeters></Trackpoint>
    <Trackpoint><Time>2026-07-26T09:28:14.000Z</Time>
     <AltitudeMeters>112.0</AltitudeMeters></Trackpoint>
   </Track>
  </Lap>
  <Lap StartTime="2026-07-26T09:34:14.000Z">
   <TotalTimeSeconds>300.0</TotalTimeSeconds>
   <DistanceMeters>500.0</DistanceMeters>
   <Track>
    <Trackpoint><Time>2026-07-26T09:34:14.000Z</Time>
     <Position><LatitudeDegrees>42.0020</LatitudeDegrees><LongitudeDegrees>-8.6000</LongitudeDegrees></Position>
     <AltitudeMeters>115.0</AltitudeMeters></Trackpoint>
   </Track>
  </Lap>
 </Activity></Activities>
</TrainingCenterDatabase>`;

  const fouten = [];
  const p = parseTcx(xml);
  // Het punt zonder <Position> moet zijn overgeslagen: 4 Trackpoints, 3 met positie
  if (p.length !== 3) fouten.push(`3 punten met positie verwacht, kreeg ${p.length}`);

  const laps = parseLaps(xml);
  if (laps.aantal !== 2) fouten.push(`2 laps verwacht, kreeg ${laps.aantal}`);
  if (laps.meters !== 1500) fouten.push(`1500 m verwacht, kreeg ${laps.meters}`);
  if (laps.seconden !== 900) fouten.push(`900 s verwacht, kreeg ${laps.seconden}`);

  // Garmin's 1500 m moet winnen van de ~222 m die uit de punten volgt
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const tmp = join(tmpdir(), 'b2b-tcx-test.tcx');
  writeFileSync(tmp, xml);
  const r = leesTcx(tmp);
  unlinkSync(tmp);

  if (r.afstandKm !== 1.5) fouten.push(`1,5 km verwacht (van Garmin), kreeg ${r.afstandKm}`);
  if (r.tijdSeconden !== 900) fouten.push(`900 s verwacht (van Garmin), kreeg ${r.tijdSeconden}`);
  if (!r.vanGarmin) fouten.push('vanGarmin had true moeten zijn');
  if (r.coords.length !== 3) fouten.push(`3 coords verwacht, kreeg ${r.coords.length}`);

  if (fouten.length) {
    console.error('tcx: FOUT\n  ' + fouten.join('\n  '));
    process.exit(1);
  }
  console.log('tcx: OK');
  console.log(`  ${r.coords.length} punten, ${r.afstandKm} km en ${r.tijdSeconden} s van Garmin, ${r.laps} laps`);
}
