# GameDay Info Hub — GitHub-only (no Cloudflare)

This version uses **GitHub Pages** + a **GitHub Actions cron** to auto-generate `slate.json` (mock data for now). No Cloudflare needed.

## Files
- `index.html` — your read-only website (fetches `slate.json` from the same repo)
- `scripts/build.js` — generates `slate.json` (mock now; later wire free APIs here)
- `.github/workflows/update-slate.yml` — runs hourly to rebuild `slate.json`
- `package.json` — allows `npm run build:slate`

## One-time setup
1. Create a **free GitHub account** (if you don’t have one).
2. Create a new repository (Public), e.g., `gameday-info-hub`.
3. Upload these files (or push via git).
4. Enable **GitHub Pages**: Settings → Pages → *Deploy from a branch* → Branch: `main` (root) → Save.
5. Enable **Actions** (it’s on by default).
6. Ensure **Settings → Actions → General → Workflow permissions → Read and write** is checked.

## What happens
- On a schedule (hourly), Actions runs `node scripts/build.js` to write `slate.json`, commits it, and pushes.
- Any push to the Pages branch triggers a rebuild, so your site serves the new `slate.json` automatically.
- Open your Pages URL: `https://<username>.github.io/<repo>/` — it will load and render the slate.

## Later: plug in real data
Edit `scripts/build.js`:
- Fetch odds/results from a free API and map to the shape used now.
- Compute probabilities and labels, then write `slate.json`.

You can also add W-L-P grading by writing a second job that pulls yesterday’s results, updates counters in the `headers` object, and commits.
