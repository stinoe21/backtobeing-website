# Camino — projectinstructies

B2B-landingpage voor Camino + paklijst-tooling. Taal & commits: **Nederlands** (volg de bestaande git-history).

## Structuur — let op: er zijn twee fronten
- **Live statische site = de project-root.** `index.html` + assets (logo's, `hero-video.mp4`, Lottie `b2b_loading_animation_*.json`). Vercel deployt de root (`vercel.json`: `framework: null`, `outputDirectory: "."`).
- **`next-app/` = nieuwere herbouw** in **Next.js 16 · React 19 · Tailwind 4 · TypeScript**. Eigen `package.json`.
  - Dev: `npm run dev` (turbopack) · Build: `npm run build` · Check: `npm run typecheck` + `npm run lint` · Format: `npm run format` (Prettier).
- Wijzig de juiste van de twee: vraag/controleer of een aanpassing naar de **live root** of naar **`next-app/`** moet.

## Map van betekenis
- `paklijst-update/` — Google Sheets / Apps Script setup voor de paklijst.
- `mcp-setup/` — MCP-setupdocumenten (Gmail/Calendar e.d.).
- `animations/` — Lottie/animatiebronnen.

## Paklijst (Google Sheets via gsheets MCP)
- Structuur & ID: zie memory `paklijst-spreadsheet-structuur`.
- ⚠️ Sheet is **nl-locale**: formules met **puntkomma's** en **WAAR/ONWAAR** — zie memory `gsheets-mcp-nl-locale-formulas`.

## Deploy & security
- Vercel met security-headers in `vercel.json` (X-Frame-Options DENY, CSP-Report-Only, Permissions-Policy). CSP staat nu op **Report-Only** — niet stilzwijgend afdwingen zonder te checken dat alle bronnen passen.
- `.vercelignore` aanwezig.
