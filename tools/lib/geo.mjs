/**
 * Ramer-Douglas-Peucker. Een wandeldag levert via Strava duizenden GPS-punten
 * op; op het zoomniveau van de kaart is dat niet te onderscheiden van een paar
 * honderd. Zonder vereenvoudiging downloadt elke bezoeker honderden KB JSON.
 *
 * Iteratief met een eigen stack, niet recursief: bij een lange track met veel
 * detail kan de recursiediepte anders oplopen.
 */

/** Loodrechte afstand van p tot het segment a-b, in graden (lokaal vlak). */
function afstandTotSegment(p, a, b) {
  // Op deze breedtegraad is een lengtegraad korter dan een breedtegraad.
  // Corrigeren houdt de epsilon in beide richtingen ongeveer even streng.
  const cos = Math.cos((a[1] * Math.PI) / 180);
  const px = (p[0] - a[0]) * cos;
  const py = p[1] - a[1];
  const bx = (b[0] - a[0]) * cos;
  const by = b[1] - a[1];

  const lengte2 = bx * bx + by * by;
  let t = lengte2 === 0 ? 0 : (px * bx + py * by) / lengte2;
  t = Math.max(0, Math.min(1, t));

  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy);
}

export function simplify(punten, epsilon = 0.00008) {
  if (!Array.isArray(punten) || punten.length < 3) return punten || [];

  const houden = new Uint8Array(punten.length);
  houden[0] = 1;
  houden[punten.length - 1] = 1;

  const stack = [[0, punten.length - 1]];
  while (stack.length) {
    const [start, eind] = stack.pop();
    let maxAfstand = 0;
    let index = -1;
    for (let i = start + 1; i < eind; i++) {
      const d = afstandTotSegment(punten[i], punten[start], punten[eind]);
      if (d > maxAfstand) {
        maxAfstand = d;
        index = i;
      }
    }
    if (index !== -1 && maxAfstand > epsilon) {
      houden[index] = 1;
      stack.push([start, index], [index, eind]);
    }
  }

  const uit = [];
  for (let i = 0; i < punten.length; i++) if (houden[i]) uit.push(punten[i]);
  return uit;
}

/** Afronden op 5 decimalen (~1 meter). Scheelt fors in bestandsgrootte. */
export function afronden(punten, decimalen = 5) {
  const f = Math.pow(10, decimalen);
  return punten.map(([lng, lat]) => [
    Math.round(lng * f) / f,
    Math.round(lat * f) / f,
  ]);
}

/**
 * Vereenvoudig tot ongeveer `doel` punten door de epsilon op te schroeven.
 * Zo krijgt elke dag een voorspelbare bestandsgrootte, ongeacht hoe lang de
 * etappe was of hoe fijn de Garmin heeft gesampled.
 */
export function verklein(punten, doel = 600) {
  if (punten.length <= doel) return afronden(punten);
  let epsilon = 0.00003;
  let uit = punten;
  for (let poging = 0; poging < 24 && uit.length > doel; poging++) {
    uit = simplify(punten, epsilon);
    epsilon *= 1.6;
  }
  return afronden(uit);
}
