# AI Tracker

A free web app (installable on a phone or tablet) that answers four questions about AI models, in plain English:

1. **Best for what**: which model is best for chat, writing, coding, math and pictures, and the cheapest good one
2. **Cost**: can you use each AI app for free, what the paid plans cost, and developer prices per million tokens
3. **New releases**: the newest models, from the companies' own announcements
4. **Big news**: only the big stories (launches, price changes, big funding, acquisitions, IPO filings)

Each tab shows a short simple view first. **See more** opens the full details. The **Sources** link (top of the page) lists every source, what it measures, its link and license, and whether it updated today.

Every number shows where it came from (source name, link and date). No AI is used anywhere: every pick and filter is a fixed rule written in `scripts/update_data.py`. It costs nothing to run.

---

## Sources and what is read from each

| Source | What the app reads | How |
|---|---|---|
| **LMArena** (lmarena.ai) | People's blind votes: text overall + coding, creative writing and math, building websites and apps, text-to-image. Score, error bars, vote count. | Official Hugging Face dataset (parquet), license CC BY 4.0 |
| **LiveBench** (livebench.ai) | Scores on new, hidden tasks: overall + categories (coding, reasoning, ...). Newest release found in the site's script bundle. | `table.csv` + `categories.json` |
| **Epoch AI** (epoch.ai) | Epoch Capabilities Index with error bars (many benchmarks in one score). | `benchmark_data.zip`, license CC BY 4.0 |
| **OpenRouter** | Developer prices per million tokens, the date each model appeared, and what each model outputs (text, image, ...). | Public API `api/v1/models` |
| **Official company pages** | New model announcements: OpenAI News, Google DeepMind blog, Google AI blog, Mistral news (RSS); Anthropic news, xAI news, Meta AI blog (web pages); DeepSeek API change log. | One request per page per day |
| **Official pricing pages** | Monthly plan prices for ChatGPT, Claude, Gemini, Grok, Le Chat, DeepSeek, Meta AI, Perplexity, Copilot. | Each company's own pricing page; for ChatGPT and Perplexity (their web pages block servers) the company's own **Apple App Store listing** (US prices); Meta AI's App Store listing confirms it is free; Grok's App Store listing is the backup when x.ai/pricing fails |
| **News feeds** | Headlines from OpenAI, Google AI, Google DeepMind, NVIDIA, Hugging Face, TechCrunch, The Verge, Ars Technica, MIT Tech Review, Wired. | RSS |
| **Artificial Analysis** (optional, OFF by default) | Intelligence index, prices, release dates, text-to-image arena. | Free API with a key. See below. |

Credits are shown in the app: "LMArena (lmarena.ai)" and "Epoch AI (epoch.ai)" with a link to the CC BY 4.0 license, and "LiveBench (livebench.ai)" with a link (LiveBench states no data license).

## How the picks work

- Each job uses a matching board from each ranking source and takes that source's **top 3**.
- **Best** = in the top 3 of **all 3** sources (LMArena, LiveBench, Epoch AI). With Artificial Analysis switched on: top 3 of at least **3 of 4**.
- **Pictures**: only LMArena covers pictures when Artificial Analysis is off, so the app never says "Best" there. It shows LMArena's #1 marked **"1 source only"**. With AA on, both picture sources must agree (2 of 2).
- **Tie** = two models both pass and their error bars overlap. Both are shown.
- **New, not sure yet** = fewer than 3 sources have tested the model, or it has fewer than 5,000 votes on LMArena's main text board (the text-to-image board for pictures).
- **No clear winner yet** = nobody passes; the closest candidates are shown.
- **Cheapest good one** = cheapest developer price among models that are top 10 in at least 2 general sources.
- Model names are matched across sources with `normalize()` plus a small `ALIASES` table (`Claude Opus 5.5 (Max)`, `claude-opus-5-5`, `anthropic/claude-opus-5.5` are one model).

## New releases

- Taken first from each company's own page: the date and link of its announcement. The rule: a post title that starts with a known model family and a version ("Gemini 4 Carbon: …", "Voxtral 3"), or "Introducing <family name>" ("Introducing Timestral"). Posts about safety, customers, partners, add-ins and bounties are skipped.
- Then OpenRouter adds models the companies didn't post about (with the date they appeared on OpenRouter).
- Each model is listed once (matched by name; "DeepSeek V4.1 Flash" and "DeepSeek V4.1 Flash 1017" stay separate).

## Big news

Kept only: new model launches, major price changes for AI apps/models, major product launches or shutdowns by AI labs, funding of about $1B or more, acquisitions of or by AI labs, and IPO filings.
Dropped first: opinion and interviews ("says", "warns"), lawsuits and regulation, rumors ("reportedly", "expected to", "could", "plans to", "in talks"), partnerships, earnings and economy stats, safety essays, customer stories, how-tos.
The same story from several sites is shown once, from the company's own page when there is one. Up to 30 items from the last 30 days; the simple view shows 5.

## Prices and the stale rule

- Every price shows its source ("Pricing page" or "App Store price (US)"), a link, and the date it was last confirmed.
- App Store prices can differ from web prices by a few cents (for example ChatGPT Plus is $19.99 in the App Store).
- Pages are fetched politely: a User-Agent naming this project (`ai-tracker/5 (+your repo URL)`), a 2-second pause between price pages, and up to 3 tries (waiting 4 s, then 10 s).
- A plan's price is only replaced when the number found is believable (between a third and 3 times the last good value).
- If a page can't be read, the **last good price stays** and the app says "price last checked <date>".
- A price not confirmed for more than **30 days** is marked **⚠ stale** next to the price and in the Sources view. The daily workflow log lists stale prices as warnings.

## ⚡ Fast label

A rough guide only, and it never changes a pick: a model gets "⚡ Fast" when its name marks a small/fast tier (Flash, Flash-Lite, Lite, Mini, Nano, Haiku, Turbo, Instant, Small, Air, Bolt; list `FAST_WORDS` in the script). Only for **text** models: OpenRouter's `output_modalities` must be exactly `["text"]`; for models not on OpenRouter, names with image, video, voice, audio, speech, music, embedding, transcribe, world-model words (Nano Banana, Veo, Sora, Imagen, Lyria, Genie, ...) are never tagged. The app says "Fast = guessed from the model's name, not a speed test".

## Artificial Analysis switch (default OFF)

Artificial Analysis's Data Platform Terms (v1.1, Aug 19 2026) don't allow its free-API data in a public product (2.4(c), 2.4(d), 2.5). So it is **off by default** and must stay off while the app is public.

- **Off** (default): no request goes to Artificial Analysis, and no AA data is in `data.json`, `data.js` or `raw.json`. Turning it off removes any old AA data on the next run.
- **On** (private use only): set the repository variable `AA_ENABLED` to `true` (Settings → Secrets and variables → Actions → Variables) and add the secret `AA_API_KEY`. The app then uses 4 text sources and 2 picture sources, and shows "Source: Artificial Analysis (artificialanalysis.ai)" and "These picks are made by this app and are not endorsed by Artificial Analysis".
- The key is never written to any file (the workflow checks this).

## The daily GitHub Action (`.github/workflows/update.yml`)

Runs every day at 10:00 UTC, when you press "Run workflow", and when you change a file:

1. Installs `requests` and `pyarrow`.
2. Runs `scripts/update_data.py`. Each source is fetched and checked on its own; if one fails, its last good copy (kept in `data/raw.json`) is used and the app shows "using last good copy from <date>".
3. Checks the new `data/data.json` (format, picks never from one source, every price and release has a source, no AA data when AA is off).
4. Prints stale prices and failed pages as warnings.
5. Makes sure the AA key is in no file.
6. Commits `data/` only when something changed, then publishes the site to GitHub Pages (`raw.json` is not published).

## Run the tests

```bash
pip install -r requirements.txt
python -m unittest discover -s tests -v     # data pipeline (uses real pages saved in tests/fixtures, no network)
node --test                                  # app + data file (needs data/data.json; on Node 22 don't pass "tests")
```

The Python tests run "on" 2026-11-01 (a fixed clock), so the saved pages stay valid. They include a speed test so a page can never make the daily run hang.

To build the data by hand: `python scripts/update_data.py` (add `AA_ENABLED=true AA_API_KEY=...` only for private use).

## Publish on GitHub Pages

1. Put this folder in a GitHub repository (keep `.github`, `.nojekyll`, `icons/`).
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → "Update AI Tracker" → **Run workflow** once. The site appears at `https://<you>.github.io/<repo>/`.
4. On a phone or tablet: open the site, then "Add to Home Screen" (iPad/iPhone Safari) or "Install app" (Android Chrome).

## Files

- `index.html`, `app.js`, `app.css`: the app (4 tabs + Sources view)
- `sw.js`: offline support; app files cached, data always fetched fresh first. Change `VERSION` when the app changes.
- `manifest.webmanifest`, `icons/`: install details
- `scripts/update_data.py`: fetches every source and builds `data/data.json` + `data/data.js`
- `data/raw.json`: last good copy of every source (not published)
- `tests/`: `test_update.py` (Python), `site.test.js` (Node), `fixtures/` (real pages saved on 2026-11-01)
