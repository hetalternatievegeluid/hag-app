# App van Het Alternatieve Geluid

## Wat zit erin
- `public/` – de app zelf (dit zet Netlify online)
  - `index.html` – de app
  - `data/articles.json` – alle artikelen (wordt automatisch bijgewerkt)
  - `icons/` – logo en app-iconen
  - `manifest.webmanifest`, `sw.js` – maken de app installeerbaar op telefoons
- `scripts/update.mjs` – leest je Substack-feed en (eenmalig) het archief van je website
- `config/dossiers.json` – welke dossiers er zijn en welke trefwoorden erbij horen
- `config/overrides.json` – titels of reeksen per artikel handmatig vastzetten
- `.github/workflows/update.yml` – laat GitHub het script elk uur draaien
- `github-workflow-update.yml` – zichtbare kopie van dat bestand, om te plakken

## Zelf aanpassen
- Een dossier toevoegen of trefwoorden wijzigen: bewerk `config/dossiers.json` op GitHub.
- Een titel klopt niet: zet hem in `config/overrides.json` onder het ID (het nummer in de link op je site).
- Na een wijziging: Actions → Artikelen bijwerken → Run workflow.

## Iets werkt niet
Open op GitHub het tabblad Actions, klik op de mislukte run en kopieer de foutmelding.
