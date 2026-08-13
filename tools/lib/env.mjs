import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HIER = dirname(fileURLToPath(import.meta.url));
export const ENV_PAD = join(HIER, '..', '.env');

/**
 * Minimale .env-lezer. Bewust geen dotenv-dependency en bewust geen
 * `node --env-file`, zodat het script niet afhangt van de Node-versie op de
 * laptop die meegaat.
 *
 * Ontbreekt het bestand, dan is dat geen fout: sinds de routegegevens uit een
 * GPX komen staat er alleen nog de optionele ANTHROPIC_API_KEY in. Wie geen
 * Engelse vertaling wil heeft helemaal geen .env nodig, en dan moet het
 * dagelijkse script gewoon doorlopen.
 */
export function leesEnv() {
  if (!existsSync(ENV_PAD)) return {};

  const env = {};
  for (const regel of readFileSync(ENV_PAD, 'utf8').split(/\r?\n/)) {
    const schoon = regel.trim();
    if (!schoon || schoon.startsWith('#')) continue;
    const i = schoon.indexOf('=');
    if (i === -1) continue;
    const sleutel = schoon.slice(0, i).trim();
    let waarde = schoon.slice(i + 1).trim();
    if (
      (waarde.startsWith('"') && waarde.endsWith('"')) ||
      (waarde.startsWith("'") && waarde.endsWith("'"))
    ) {
      waarde = waarde.slice(1, -1);
    }
    if (waarde) env[sleutel] = waarde;
  }
  return env;
}
