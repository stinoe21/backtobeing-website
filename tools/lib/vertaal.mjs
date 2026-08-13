const SYSTEM = `Je vertaalt dagverslagen van een Nederlandse Camino-tocht naar Engels voor de website van Back to Being.

Regels:
- Vertaal naar natuurlijk, nuchter Engels. Geen marketingtaal, geen Amerikaanse superlatieven, geen uitroeptekens die er in het Nederlands niet stonden.
- Behoud de toon en het ritme van het origineel. Als de schrijver kort en droog is, blijf kort en droog.
- Behoud alineascheidingen exact (lege regel tussen alinea's).
- Laat eigennamen, plaatsnamen en merknamen ongewijzigd: Tui, O Porrino, Redondela, Pontevedra, Caldas de Reis, Padron, Santiago de Compostela, Camino, Back to Being, MIND.
- Gebruik NOOIT een em-dash (het lange streepje). Gebruik een gewoon koppelteken, een dubbele punt, of herformuleer.
- Vertaal alleen. Voeg niets toe en laat niets weg.`;

/**
 * Vertaalt titel en tekst naar het Engels.
 *
 * Faalt bewust zacht: geen key, geen internet of een refusal levert null op,
 * en het sync-script gaat gewoon door. De site valt dan terug op de
 * Nederlandse tekst. Vertalen mag nooit een dag blokkeren.
 */
export async function vertaal({ titel, tekst, apiKey }) {
  if (!apiKey) return { ok: false, reden: 'geen ANTHROPIC_API_KEY in tools/.env' };
  if (!tekst || !tekst.trim()) return { ok: false, reden: 'geen tekst om te vertalen' };

  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    return { ok: false, reden: 'sdk ontbreekt, draai: cd tools && npm install' };
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      // Ruim bemeten: op Claude Opus 5 staat thinking standaard aan en telt
      // max_tokens voor denken en tekst samen.
      max_tokens: 8000,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              titel_en: { type: 'string' },
              tekst_en: { type: 'string' },
            },
            required: ['titel_en', 'tekst_en'],
            additionalProperties: false,
          },
        },
      },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ titel_nl: titel || '', tekst_nl: tekst }),
        },
      ],
    });

    // stop_reason checken voordat we content lezen: bij een refusal is
    // content leeg en zou content[0] crashen.
    if (response.stop_reason === 'refusal') {
      return { ok: false, reden: 'model weigerde de vertaling' };
    }

    const blok = response.content.find((b) => b.type === 'text');
    if (!blok) return { ok: false, reden: 'geen tekst in het antwoord' };

    const data = JSON.parse(blok.text);
    return { ok: true, titel_en: data.titel_en, tekst_en: data.tekst_en };
  } catch (err) {
    return { ok: false, reden: err.message };
  }
}
