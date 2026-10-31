# Ward Guide (PWA + backend)

1. Get an API key at console.anthropic.com (usage is billed per search).
2. Deploy this folder to any Node 20+ host with HTTPS (Render, Railway, Fly.io).
   Build: `npm install`  Start: `npm start`
   Environment variables: `ANTHROPIC_API_KEY`, `ACCESS_CODES` (comma-separated, one per colleague).
3. On the phone open the https URL, enter your access code once.
   iPhone (Safari): Share > Add to Home Screen. Android (Chrome): menu > Install app.

Notes: never enter patient identifiers. Doses must be checked against the BNF.
Before wider clinical use, check MHRA software rules and NHS DCB0129 / DTAC.
Edit prompts in `prompts.js`. Local test: `ANTHROPIC_API_KEY=... ACCESS_CODES=test npm start`.
