# Google Sheets MCP — setup

Doel: Claude kan straks direct in je Google Sheets lezen/schrijven (geen Apps Script-plakwerk meer).

Server: `freema/mcp-gsheets` via npx. Auth via een Google **service account** (geen OAuth-flow, geen browser-redirect — je deelt simpelweg de sheet met een robot-e-mailadres).

Wat al klaarstaat (door Claude gedaan):
- `.mcp.json` in de projectroot met de servved-config (gitignored)
- credentials-map: `C:\Users\stijn\.google-credentials\`
- `.gitignore` aangevuld zodat credentials nooit in git komen

---

## Stap 1 — Google Cloud project + Sheets API
1. Ga naar https://console.cloud.google.com
2. Linksboven: **Select a project → New Project** → naam `camino-paklijst` → **Create**
3. Selecteer dat project (linksboven)
4. Menu → **APIs & Services → Library** → zoek **"Google Sheets API"** → **Enable**

## Stap 2 — Service account + sleutel
1. Menu → **IAM & Admin → Service Accounts**
2. **+ Create Service Account** → naam `camino-sheets-writer` → **Create and Continue**
3. Role: **overslaan** (Continue zonder rol) → **Done**
4. Klik op de nieuwe service account → tab **Keys** → **Add Key → Create new key → JSON → Create**
5. Er downloadt een `.json`-bestand. Hernoem/verplaats het naar exact:
   ```
   C:\Users\stijn\.google-credentials\camino-sheets.json
   ```

## Stap 3 — Sheet delen met de service account
1. Open het JSON-bestand, kopieer de waarde van `"client_email"`
   (iets als `camino-sheets-writer@camino-paklijst.iam.gserviceaccount.com`)
2. Open de paklijst-spreadsheet → **Share** → plak dat e-mailadres → rol **Editor** → **Send**

## Stap 4 — project_id invullen
Open `.mcp.json` in de projectroot en vervang `VERVANG_MET_PROJECT_ID` door de
`"project_id"` uit het JSON-bestand. (Of geef hem aan Claude in de chat, dan vult hij hem in.)

## Stap 5 — herstart + goedkeuren
1. Herstart Claude Code (zodat `.mcp.json` geladen wordt)
2. Bij de start vraagt Claude Code of de **gsheets**-server vertrouwd mag worden → **Approve**
3. Zeg in de chat: "test de sheets-mcp" → Claude leest de paklijst om te bevestigen dat het werkt

---

### Wat je aan Claude moet teruggeven
- `project_id` (uit het JSON-bestand) — tenzij je het zelf in `.mcp.json` zet
- bevestiging dat het JSON-bestand op het juiste pad staat
- bevestiging dat de sheet gedeeld is met het service-account-adres

Het private key zelf hoef je NOOIT te delen — dat blijft in het JSON-bestand op je schijf.
