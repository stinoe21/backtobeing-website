/**
 * Leest een GPX-bestand en rekent er de cijfers uit die Strava vroeger gaf.
 *
 * Waarom GPX en niet de Strava API: sinds 1 juni 2026 vereist de Strava API
 * een betaald abonnement, ook om je eigen activiteiten te lezen. Garmin
 * Connect laat elke activiteit wel gratis als GPX exporteren (tandwiel op de
 * activiteit -> Export to GPX). Datzelfde bestand bevat alles wat we nodig
 * hebben, dus we rekenen het zelf uit.
 *
 * Zelftest:  node lib/gpx.mjs --test
 */
import { readFileSync } from 'node:fs';

/* Garmin en Strava schrijven allebei nette, machinaal gegenereerde GPX met
   <trkpt lat=".." lon=".."> en daarin <ele> en <time>. Daar is een gerichte
   regex genoeg voor; een XML-parser als dependency erbij halen is voor dit
   ene, strak gevormde bestandstype niet de moeite. Wel expliciet controleren
   dat er uberhaupt trackpunten in zitten, zodat een verkeerd bestand een
   duidelijke fout geeft in plaats van nul kilometer. */
const TRKPT = /<trkpt[^>]*\blat="(-?[\d.]+)"[^>]*\blon="(-?[\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>|<trkpt[^>]*\blat="(-?[\d.]+)"[^>]*\blon="(-?[\d.]+)"[^>]*\/>/g;
const ELE = /<ele>\s*(-?[\d.]+)\s*<\/ele>/;
const TIME = /<time>\s*([^<]+?)\s*<\/time>/;

const R = 6371008.8; // gemiddelde straal van de aarde in meter

/** Afstand tussen twee punten in meter. */
export function haversine(lon1, lat1, lon2, lat2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Haalt de trackpunten uit een GPX-string. */
export function parseGpx(xml) {
  const punten = [];
  let m;
  TRKPT.lastIndex = 0;
  while ((m = TRKPT.exec(xml)) !== null) {
    // Twee alternatieven in de regex: met inhoud, of self-closing.
    const lat = Number(m[1] !== undefined ? m[1] : m[4]);
    const lon = Number(m[2] !== undefined ? m[2] : m[5]);
    const body = m[3] || '';
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const ele = ELE.exec(body);
    const tijd = TIME.exec(body);
    punten.push({
      lon,
      lat,
      ele: ele ? Number(ele[1]) : null,
      t: tijd ? Date.parse(tijd[1]) : null,
    });
  }
  return punten;
}

/** Voortschrijdend gemiddelde over een oneven venster. */
export function glad(waarden, venster = 9) {
  if (waarden.length < venster || venster < 3) return waarden.slice();
  const half = Math.floor(venster / 2);
  const uit = new Array(waarden.length);
  for (let i = 0; i < waarden.length; i++) {
    const van = Math.max(0, i - half);
    const tot = Math.min(waarden.length - 1, i + half);
    let som = 0;
    for (let j = van; j <= tot; j++) som += waarden[j];
    uit[i] = som / (tot - van + 1);
  }
  return uit;
}

/**
 * Hoogtemeters. Elke stijging optellen levert een veel te hoog getal op: een
 * GPS-hoogte schommelt een paar meter per meting, en over duizenden punten
 * telt die ruis enorm op. Bij een test met ruis van +/- 2 m gaf een simpele
 * drempel 404 hm waar het werkelijke antwoord 60 was.
 *
 * Daarom twee filters achter elkaar:
 *  1. de reeks eerst glad strijken, wat het meten-op-meten-geruis wegneemt;
 *  2. daarna pas tellen, en dan alleen als je meer dan `drempel` boven het
 *     laatste referentiepunt uitkomt.
 */
export function hoogteWinst(punten, { drempel = 3, venster = 9 } = {}) {
  const hoogtes = punten.filter((p) => p.ele != null).map((p) => p.ele);
  if (hoogtes.length < 2) return 0;

  const glans = glad(hoogtes, venster);
  let winst = 0;
  let ref = glans[0];
  for (let i = 1; i < glans.length; i++) {
    const h = glans[i];
    if (h > ref + drempel) {
      winst += h - ref;
      ref = h;
    } else if (h < ref) {
      ref = h;
    }
  }
  return winst;
}

/**
 * Tijd in beweging. Pauzes staan in een GPX niet gemarkeerd; je ziet ze als
 * een gat in de tijdstempels of als een reeks punten die niet verplaatsen.
 * Segmenten langer dan `maxGat` seconden of trager dan `minSnelheid` tellen
 * daarom niet mee.
 */
export function bewegingsTijd(punten, { maxGat = 30, minSnelheid = 0.14 } = {}) {
  let sec = 0;
  for (let i = 1; i < punten.length; i++) {
    const a = punten[i - 1];
    const b = punten[i];
    if (a.t == null || b.t == null) continue;
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0 || dt > maxGat) continue;
    const d = haversine(a.lon, a.lat, b.lon, b.lat);
    if (d / dt < minSnelheid) continue; // stilstand
    sec += dt;
  }
  return Math.round(sec);
}

/** Totale afstand in meter. */
export function afstandMeter(punten) {
  let m = 0;
  for (let i = 1; i < punten.length; i++) {
    m += haversine(punten[i - 1].lon, punten[i - 1].lat, punten[i].lon, punten[i].lat);
  }
  return m;
}

/**
 * Leest een GPX-bestand en geeft de gegevens terug in het formaat dat
 * camino-log.json verwacht. `coords` is nog niet vereenvoudigd; dat doet
 * sync-dag.mjs met verklein() uit geo.mjs.
 */
export function leesGpx(pad) {
  const xml = readFileSync(pad, 'utf8');
  const punten = parseGpx(xml);

  if (punten.length < 2) {
    throw new Error(
      `geen trackpunten gevonden in ${pad}. Is dit een GPX van een activiteit ` +
      `(en niet van een route of waypoint-bestand)?`
    );
  }

  const meters = afstandMeter(punten);
  const met = punten.filter((p) => p.t != null);
  const bewegend = bewegingsTijd(punten);
  const verstreken =
    met.length >= 2 ? Math.round((met[met.length - 1].t - met[0].t) / 1000) : 0;

  return {
    coords: punten.map((p) => [p.lon, p.lat]),
    afstandKm: Math.round((meters / 1000) * 10) / 10,
    hoogtemeters: Math.round(hoogteWinst(punten)),
    // Als er geen bruikbare bewegingstijd uitkomt (GPX zonder tijdstempels)
    // valt hij terug op de verstreken tijd, en anders op niets.
    tijdSeconden: bewegend || verstreken || null,
    ruwePunten: punten.length,
    heeftTijd: met.length > 0,
    heeftHoogte: punten.some((p) => p.ele != null),
  };
}

/* ---------- zelftest ---------- */
/* Alleen als dit bestand zelf is aangeroepen. Zonder die check draait de test
   ook wanneer tcx.mjs deze module importeert. */
const directAangeroepen = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/gpx.mjs');
if (directAangeroepen && process.argv.includes('--test')) {
  // Vier punten op een rechte lijn pal noord, 0,001 graad uit elkaar
  // (~111 m per stap), elk 100 seconden later, en 10 m klimmend.
  const xml = `<?xml version="1.0"?>
<gpx><trk><trkseg>
  <trkpt lat="42.0000" lon="-8.6000"><ele>100.0</ele><time>2026-08-24T07:00:00Z</time></trkpt>
  <trkpt lat="42.0010" lon="-8.6000"><ele>105.0</ele><time>2026-08-24T07:01:40Z</time></trkpt>
  <trkpt lat="42.0020" lon="-8.6000"><ele>110.0</ele><time>2026-08-24T07:03:20Z</time></trkpt>
  <trkpt lat="42.0030" lon="-8.6000"><ele>108.0</ele><time>2026-08-24T07:05:00Z</time></trkpt>
</trkseg></trk></gpx>`;

  const p = parseGpx(xml);
  const meters = afstandMeter(p);
  const fouten = [];

  if (p.length !== 4) fouten.push(`4 punten verwacht, kreeg ${p.length}`);
  // 3 stappen van 0,001 graad breedte = 3 x ~111,2 m
  if (Math.abs(meters - 333.6) > 2) fouten.push(`~333,6 m verwacht, kreeg ${meters.toFixed(1)}`);
  // Klim 100 -> 110, drempel 3 m: eerste stap (+5) telt, tweede (+5) telt, daling niet
  const hw = hoogteWinst(p);
  if (Math.abs(hw - 10) > 0.01) fouten.push(`10 hm verwacht, kreeg ${hw}`);
  // Snelheid ~1,1 m/s, gaten van 100 s > maxGat 30 s: geen bewegingstijd
  if (bewegingsTijd(p) !== 0) fouten.push(`0 s verwacht bij gaten van 100 s, kreeg ${bewegingsTijd(p)}`);
  // Met een ruimere drempel tellen ze wel mee: 3 x 100 s
  const ruim = bewegingsTijd(p, { maxGat: 200 });
  if (ruim !== 300) fouten.push(`300 s verwacht met maxGat 200, kreeg ${ruim}`);

  // Self-closing trkpt zonder inhoud moet ook werken
  const kaal = parseGpx('<gpx><trkseg><trkpt lat="1.0" lon="2.0"/><trkpt lat="1.1" lon="2.1"/></trkseg></gpx>');
  if (kaal.length !== 2) fouten.push(`self-closing: 2 punten verwacht, kreeg ${kaal.length}`);

  if (fouten.length) {
    console.error('gpx: FOUT\n  ' + fouten.join('\n  '));
    process.exit(1);
  }
  console.log('gpx: OK');
  console.log(`  ${p.length} punten, ${meters.toFixed(1)} m, ${hw} hm`);
}
