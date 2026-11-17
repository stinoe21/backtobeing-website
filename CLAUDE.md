# Camino — projectinstructies

B2B-landingpage voor Camino + paklijst-tooling. Taal & commits: **Nederlands** (volg de bestaande git-history).

## Structuur — let op: er zijn twee fronten
- **Live statische site = de project-root.** `index.html` (SPA: home/verhaal/pers/contact) + losse pagina's `volg.html` (bereikbaar als `/reis` én `/volg`, het dagverslag; niet meer in de nav, wel via de knop onderaan Ons verhaal) en `premiere.html` (`/documentaire`, ook nog `/premiere`: trailer `premiere-trailer.mp4` bovenaan, daaronder terugblik op de première, de overdracht aan MIND, foto's van de avond (`photos/premiere/`, foto's: Choukri van der Slik) en hoe we de film verder willen vertonen; contact loopt via `/#contact`. Apps Script + README van de oude aanmeldingen staan nog in `premiere/`). Assets: logo's, `hero-video.mp4`, Lottie `b2b_loading_animation_*.json`. Vercel deployt de root (`vercel.json`: `framework: null`, `outputDirectory: "."`, rewrites voor `/reis`, `/volg`, `/premiere`, `/documentaire`).
- Sinds nov 2026 is alles **voorbij**: de reis is gelopen, de documentaire (± 40 min) ging op dinsdag 3 november 2026 in première in Het Vondelpark Paviljoen (Amsterdam) en de app Weertje is die avond kosteloos overgedragen aan stichting MIND (in ontvangst genomen door Dienke Bos, directeur-bestuurder, en Cisca Goedhart, manager Kennis, Innovatie en Onderzoek). Wat nu komt: de film vertonen bij bioscopen, filmtheaters, organisaties en omroepen/streamingdiensten.
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
