# v9 test site (Cloudflare Pages)

These are the v9 app files for the test site https://ai-tracker-3x2.pages.dev .
GitHub Pages (https://yimeya5.github.io/ai-tracker/) does NOT use this folder; it still serves the files in the repo root.

Every day, after "Update AI Tracker" refreshes data/, the workflow
.github/workflows/v9-cloudflare.yml copies these files + icons/ + the fresh data/
and uploads them to the Cloudflare Pages project "ai-tracker".
It needs the repository secret CLOUDFLARE_API_TOKEN (a Cloudflare token that can only edit Pages).
