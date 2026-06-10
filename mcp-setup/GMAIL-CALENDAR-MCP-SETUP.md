# Gmail + Google Calendar MCP — setup

Doel: Claude kan straks direct je mail lezen/opstellen/sturen en je agenda beheren — handig voor
sponsor-outreach + follow-ups + gesprekken inplannen, in álle Claude-projecten (user scope).

Server: `taylorwilsdon/google_workspace_mcp` (PyPI: `workspace-mcp`). Dekt Gmail, Calendar, Drive,
Docs, Sheets, Slides, Tasks, Contacts. Auth: **OAuth** (jouw persoonlijke Gmail kan géén
service-account gebruiken zoals Sheets — daarom een eenmalige browser-toestemming).

We hergebruiken je bestaande Google Cloud-project (`camino-paklijst` / `starry-center-498919-m6`).

---

## Stap 1 — API's aanzetten
In https://console.cloud.google.com (project `camino-paklijst`):
- **APIs & Services → Library** → zoek **Gmail API** → **Enable**
- idem **Google Calendar API** → **Enable**
- (optioneel later: Drive API, Docs API)

## Stap 2 — OAuth consent screen
- **APIs & Services → OAuth consent screen**
- User type: **External** → **Create**
- App name: `Claude Workspace` · support email: je eigen mail · developer email: je eigen mail
- **Audience / Test users** → **+ Add users** → voeg `stijnysmit@gmail.com` toe
  (in test-modus mag alleen jij inloggen — precies wat we willen)
- Opslaan. (Publishing status mag op "Testing" blijven.)

## Stap 3 — OAuth client aanmaken
- **APIs & Services → Credentials → + Create credentials → OAuth client ID**
- Application type: **Web application**
- Name: `claude-workspace-mcp`
- **Authorized redirect URIs → + Add URI**:
  ```
  http://localhost:8000/oauth2callback
  ```
- **Create** → er verschijnt een **Client ID** en **Client secret**. Kopieer allebei.

## Stap 4 — aan Claude doorgeven
Geef me terug (of zet ze zelf in het commando hieronder):
- `Client ID`  (eindigt op `...apps.googleusercontent.com`)
- `Client secret`

Dan voeg ik de server globaal toe, ongeveer zo:
```
claude mcp add google-workspace --scope user `
  --env GOOGLE_OAUTH_CLIENT_ID=<client-id> `
  --env GOOGLE_OAUTH_CLIENT_SECRET=<client-secret> `
  --env USER_GOOGLE_EMAIL=stijnysmit@gmail.com `
  --env OAUTHLIB_INSECURE_TRANSPORT=1 `
  -- uvx workspace-mcp --single-user --tools gmail calendar
```

## Stap 5 — eerste keer inloggen
1. Herstart Claude Code.
2. Vraag iets als: "lees mijn laatste 3 mails". De eerste keer opent een **browser** met een
   Google-toestemmingsscherm → kies je account → **Allow**. Token wordt versleuteld lokaal bewaard;
   daarna nooit meer nodig.

---

### Vereiste op je machine
- **uv** (voor `uvx`). Check: `uv --version`. Niet aanwezig? Installeer met:
  `winget install astral-sh.uv`  (of `pip install uv`)
- Python heb je al (`py`).

### Veilig?
- Het draait lokaal op jouw machine; alleen jij geeft toestemming via je eigen Google-login.
- Het Client secret blijft in je lokale `~/.claude.json` — net als bij je andere MCP's.
- Test-modus betekent dat enkel toegevoegde test-users (jij) kunnen inloggen.
