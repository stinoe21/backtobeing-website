import { readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const INVOER_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp']);

/**
 * Verkleint de telefoonfoto's van een dag naar webp.
 *
 * Drie dingen die sharp doet en die geen gemak maar correctheid zijn:
 *  1. `.rotate()` zonder argument leest de EXIF-orientation-tag. Zonder dit
 *     komen portretfoto's van de telefoon zijwaarts op de site.
 *  2. sharp gooit standaard alle metadata weg bij het schrijven. Dat strippen
 *     is hier een privacykwestie: anders publiceer je de exacte GPS-coordinaten
 *     en tijdstippen van elke overnachtingsplek in een publieke repo.
 *  3. Resize, rotate en encode in een pass, deterministisch.
 */
export async function verwerkFotos(dagNr, projectRoot, { forceer = false } = {}) {
  const bron = join(projectRoot, 'photos-origineel', `dag-${dagNr}`);
  const doel = join(projectRoot, 'photos', `dag-${dagNr}`);

  if (!existsSync(bron)) {
    return { paden: [], overgeslagen: 0, reden: `geen map photos-origineel/dag-${dagNr}` };
  }

  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch {
    throw new Error(
      'sharp is niet geinstalleerd. Draai eenmalig:  cd tools && npm install'
    );
  }

  mkdirSync(doel, { recursive: true });

  // Sorteren op wijzigingstijd van het origineel, zodat opnieuw draaien
  // exact dezelfde nummering oplevert.
  const bestanden = readdirSync(bron)
    .filter((f) => INVOER_EXT.has(extname(f).toLowerCase()))
    .map((f) => ({ f, t: statSync(join(bron, f)).mtimeMs }))
    .sort((a, b) => a.t - b.t)
    .map((x) => x.f);

  const paden = [];
  let overgeslagen = 0;

  for (let i = 0; i < bestanden.length; i++) {
    // De naam volgt het origineel en niet de plek in de rij. Een volgnummer
    // gaat mis zodra er een foto tussenuit valt: 03.webp wijst dan naar een
    // andere foto, terwijl browsers hem een dag lang gecachet houden
    // (vercel.json: max-age=86400 op afbeeldingen). Dan blijft de oude foto
    // staan. Met deze naam hoort een URL voor altijd bij een foto; de
    // volgorde staat in de lijst in camino-log.json.
    const uitNaam = bestanden[i]
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') + '.webp';
    const uitPad = join(doel, uitNaam);
    const relatief = `photos/dag-${dagNr}/${uitNaam}`;

    if (existsSync(uitPad) && !forceer) {
      paden.push(relatief);
      overgeslagen++;
      continue;
    }

    await sharp(join(bron, bestanden[i]))
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(uitPad);

    paden.push(relatief);
  }

  return { paden, overgeslagen };
}
