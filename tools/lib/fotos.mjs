import { readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const INVOER_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v']);

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
    .filter((f) => INVOER_EXT.has(extname(f).toLowerCase()) || VIDEO_EXT.has(extname(f).toLowerCase()))
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
    const isVideo = VIDEO_EXT.has(extname(bestanden[i]).toLowerCase());
    const basis = bestanden[i]
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const uitNaam = basis + (isVideo ? '.mp4' : '.webp');
    const uitPad = join(doel, uitNaam);
    const relatief = `photos/dag-${dagNr}/${uitNaam}`;

    if (existsSync(uitPad) && !forceer) {
      paden.push(relatief);
      overgeslagen++;
      continue;
    }

    if (isVideo) {
      await verwerkVideo(join(bron, bestanden[i]), uitPad, join(doel, basis + '.webp'), sharp);
      paden.push(relatief);
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

/**
 * Een telefoonvideo verkleinen tot iets wat op mobiel vlot laadt.
 *
 * ffmpeg komt uit het npm-pakket `ffmpeg-static`, net als sharp een binary
 * die met `npm install` meekomt; er hoeft niets op het systeem te staan.
 *
 *  - Hoogstens 720 pixels aan de korte kant. Op de pagina is de video nooit
 *    groter dan een telefoonscherm, dus meer is alleen maar bytes.
 *  - H.264 + AAC in mp4 met `faststart`: speelt overal, en de browser kan
 *    beginnen voordat het hele bestand binnen is.
 *  - `-map_metadata -1`: alle metadata weg (GPS, tijdstip, toestel), om
 *    dezelfde reden als bij de foto's. De rotatie past ffmpeg eerst toe, dus
 *    een staande video blijft staand.
 *  - Naast de mp4 komt een poster (.webp, zelfde naam): het beeld dat de site
 *    laat zien voordat je op afspelen drukt. De pagina leidt de naam af, hij
 *    staat niet apart in camino-log.json.
 */
async function verwerkVideo(bronPad, uitPad, posterPad, sharp) {
  let ffmpeg;
  try {
    ({ default: ffmpeg } = await import('ffmpeg-static'));
  } catch {
    throw new Error('ffmpeg-static is niet geinstalleerd. Draai eenmalig:  cd tools && npm install');
  }
  if (!ffmpeg || !existsSync(ffmpeg)) {
    throw new Error('de ffmpeg-binary ontbreekt; draai  cd tools && npm rebuild ffmpeg-static');
  }

  execFileSync(ffmpeg, [
    '-y', '-v', 'error',
    '-i', bronPad,
    '-vf', "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'",
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-ac', '1',
    '-movflags', '+faststart',
    '-map_metadata', '-1',
    uitPad,
  ]);

  // Poster: een frame van net na het begin (het eerste frame is vaak nog
  // bewogen of zwart), via sharp naar webp zodat hij net als de foto's
  // gestript is.
  const frame = execFileSync(ffmpeg, [
    '-v', 'error',
    '-ss', '1',
    '-i', uitPad,
    '-frames:v', '1',
    '-f', 'image2pipe', '-vcodec', 'png', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  await sharp(frame).webp({ quality: 78 }).toFile(posterPad);
}
