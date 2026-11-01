# AI Tracker

An app for your tablet and phone that shows the whole AI industry in one place:

- **Today**: what's new this week, the best model for each job, the big labs, latest headlines
- **Best for**: the best AI for coding, writing, math, photos, images, video, web search, value, speed, free models and more
- **Rankings**: live leaderboards (people's votes and independent tests)
- **Prices**: every model's price, sortable by smartest, cheapest or best value
- **News**: headlines from the AI labs and tech news sites, plus trending free models
- **Timeline**: every new model from the big labs, newest first

It updates **everything by itself every day** (rankings, best picks, prices, timeline, news), runs for free on GitHub, and needs no keys, no paid services and no AI. If a source is down one day, that part keeps its last good copy and the rest still updates.

## Set it up (5 steps, about 10 minutes, free)

1. **Make a free GitHub account** at https://github.com/signup (skip this if you have one).
2. **Make a new repository**: press the **+** at the top right, then **New repository**. Name it `ai-tracker`, choose **Public**, press **Create repository**.
3. **Upload the files**: on the new repository page press **uploading an existing file**. Unzip `ai-tracker.zip` and drag **everything inside it** (all files and folders) into the box, then press **Commit changes**.
   - Check that a folder called `.github` appears in the list. Some computers hide it. If it is missing: press **Add file**, then **Create new file**, type the name `.github/workflows/update.yml`, paste in the text of that file, and press **Commit changes**.
4. **Turn on the website**: open **Settings**, then **Pages** (left side). Under **Source** choose **GitHub Actions**. Then open the **Actions** tab, press **Update AI Tracker**, then **Run workflow**. Wait about 2 minutes until it shows a green check.
5. **Install it on your tablet**: open `https://YOUR-GITHUB-NAME.github.io/ai-tracker/`
   - iPad / iPhone (Safari): press **Share**, then **Add to Home Screen**.
   - Android (Chrome): press the **⋮** menu, then **Install app** (or **Add to Home screen**).

That's it. Every day at 10:00 UTC (about 6 AM New York time) GitHub refreshes the data and the app shows "Updated X ago" at the top. It also works offline with the last copy.

## If something stops

- Open the **Actions** tab. A red ✗ means that day's update failed; the app keeps showing the last good data.
- GitHub pauses daily jobs in a repository nobody has touched for 60 days. If that happens, the Actions tab shows a yellow banner: press **Enable workflow**.
- To update right now, press **Run workflow** in the Actions tab.

## Where the data comes from (all free and public)

| Part | Source |
|---|---|
| Leaderboards (people's votes) | LMArena public leaderboard data on Hugging Face |
| Test scores, prices, speed | Artificial Analysis public leaderboard page |
| Model releases and listed prices | OpenRouter public model list |
| News | RSS feeds: OpenAI, Google AI, Google DeepMind, NVIDIA, Hugging Face, TechCrunch, The Verge, Ars Technica, MIT Technology Review, Wired |
| Trending free models | Hugging Face |

"Best for" picks and "What's new" are worked out automatically from those numbers every day. No numbers are typed in by hand.

## Files

- `index.html`, `app.css`, `app.js`: the app
- `sw.js`: offline support. Data always comes fresh from the internet when you are online
- `manifest.webmanifest`, `icons/`: install details
- `data/data.json`, `data/data.js`: the data (written by the update script)
- `data/history.json`: yesterday's leaders, used to spot "new #1" changes
- `scripts/update_data.py`: the update script (Python, uses `requests` and `pyarrow`)
- `.github/workflows/update.yml`: the daily job

To run the update on your own computer: `pip install -r requirements.txt` then `python scripts/update_data.py`.
