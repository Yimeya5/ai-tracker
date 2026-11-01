#!/usr/bin/env python3
"""Rebuild data/data.json (+ data/data.js) for the AI Tracker app from free public sources.

Sections and sources (no keys, no paid APIs):
  arena    - LMArena public leaderboard dataset on Hugging Face (people's blind votes)
  aa       - Artificial Analysis public leaderboard page (independent test scores, prices, speed)
  releases - OpenRouter public model list (release/listing dates, prices)
  news     - RSS feeds from news sites and AI labs
  trending - Hugging Face trending models
Derived: best (best-for picks), labs, week (what's new), prices.

Each section is fetched and checked on its own. A section that fails or looks wrong keeps
its last good copy (and its old 'updated' time). If no section at all could be refreshed,
or the result fails the final check, the script exits non-zero and writes nothing.
"""
import io, json, os, re, sys, time, html, socket
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
import requests

socket.setdefaulttimeout(40)
ROOT = Path(__file__).resolve().parent.parent   # repo root
SITE = ROOT
OUT_JSON = SITE / "data" / "data.json"
OUT_JS = SITE / "data" / "data.js"
HIST = ROOT / "data" / "history.json"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}
NOW = datetime.now(timezone.utc)
NOW_ISO = NOW.isoformat(timespec="seconds")

def log(*a):
    print(*a, file=sys.stderr, flush=True)

def get(url, timeout=30, **kw):
    r = requests.get(url, headers=UA, timeout=timeout, **kw)
    r.raise_for_status()
    return r

# ---------------------------------------------------------------- names
ORG = {"google": "Google", "anthropic": "Anthropic", "openai": "OpenAI", "xai": "xAI", "x-ai": "xAI",
       "meta": "Meta", "meta-llama": "Meta", "deepseek": "DeepSeek", "deepseek-ai": "DeepSeek", "alibaba": "Alibaba",
       "qwen": "Alibaba", "moonshot": "Moonshot", "moonshotai": "Moonshot", "kimi": "Moonshot", "mistral": "Mistral",
       "mistralai": "Mistral", "nvidia": "NVIDIA", "minimax": "MiniMax", "zhipu": "Z.ai", "z-ai": "Z.ai", "zai": "Z.ai",
       "bfl": "Black Forest Labs", "bytedance": "ByteDance", "microsoft-ai": "Microsoft", "microsoft": "Microsoft",
       "amazon": "Amazon", "tencent": "Tencent", "baidu": "Baidu", "stepfun": "StepFun", "cohere": "Cohere",
       "ideogram": "Ideogram", "recraft": "Recraft", "kling": "Kuaishou", "kuaishou": "Kuaishou", "runway": "Runway",
       "luma": "Luma", "luma-ai": "Luma", "pika": "Pika", "lightricks": "Lightricks", "midjourney": "Midjourney",
       "spacexai": "xAI", "inclusionai": "inclusionAI", "z.ai": "Z.ai", "liquid": "Liquid AI", "ibm": "IBM", "ai2": "Ai2", "perplexity": "Perplexity"}

def org_name(o):
    if not o:
        return ""
    k = str(o).strip().lower()
    return ORG.get(k, str(o).strip()[:1].upper() + str(o).strip()[1:])

EFFORT = {"high", "xhigh", "low", "medium", "minimal", "thinking", "search", "reasoning", "nonreasoning"}

def pretty(name):
    name = str(name).strip()
    if " " not in name and "-" in name:          # slug style, e.g. gemini-omni-1.1-flash
        parts = name.split("-")
        while len(parts) > 1 and parts[-1].lower() in EFFORT:
            parts.pop()
        out = []
        for p in parts:
            if out and p.isdigit() and len(p) == 1 and out[-1][-1:].isdigit():
                out[-1] += "." + p                   # claude-opus-4-6 -> Claude Opus 4.6
            elif p.lower() == "gpt":
                out.append("GPT")
            elif p[:1].isalpha():
                out.append(p[:1].upper() + p[1:])
            else:
                out.append(p)
        name = " ".join(out)
    return name

def base(name):
    """'Claude Opus 5.5 (Max, Default Fallback)' -> 'Claude Opus 5.5'"""
    n = pretty(name)
    n = re.sub(r"\s*\(.*?\)\s*", " ", n).strip()
    return re.sub(r"\s+", " ", n)

def key(name):
    return re.sub(r"[^a-z0-9]", "", base(name).lower())

# ---------------------------------------------------------------- LMArena
ARENA_URL = "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/refs%2Fconvert%2Fparquet/{}/latest/0000.parquet"
ARENA_BOARDS = [  # (id, config, category, plain label, what it measures)
    ("chat", "text", "overall", "Best chatbot overall", "People compare two anonymous answers and vote for the better one."),
    ("coding", "text", "coding", "Coding questions", "Votes on coding questions only."),
    ("webdev", "webdev", "overall", "Building websites and apps", "Votes on apps and web pages the models build."),
    ("math", "text", "math", "Math", "Votes on math questions only."),
    ("writing", "text", "creative_writing", "Creative writing", "Votes on stories, poems and other writing."),
    ("hard", "text", "hard_prompts", "Hard questions", "Votes on the hardest prompts."),
    ("vision", "vision", "overall", "Understanding photos", "Votes on questions about images and documents."),
    ("search", "search", "overall", "Answers with web search", "Votes on answers that use live web search."),
    ("image", "text_to_image", "overall", "Making images", "Votes between two images made from the same prompt."),
    ("imgedit", "image_edit", "overall", "Editing photos", "Votes on photo edits."),
    ("video", "text_to_video", "overall", "Making videos", "Votes between two videos made from the same prompt."),
    ("img2vid", "image_to_video", "overall", "Turning a photo into video", "Votes on videos made from a still photo."),
]

def fetch_arena():
    import pyarrow.parquet as pq
    cache = {}
    boards = []
    for bid, cfg, cat, label, what in ARENA_BOARDS:
        if cfg not in cache:
            raw = get(ARENA_URL.format(cfg), timeout=90).content
            cache[cfg] = pq.read_table(io.BytesIO(raw)).to_pylist()
        rows = [r for r in cache[cfg] if r.get("category") == cat]
        if not rows:
            log(f"arena: no rows for {cfg}/{cat}")
            continue
        latest = max(r.get("leaderboard_publish_date") or "" for r in rows)
        rows = [r for r in rows if (r.get("leaderboard_publish_date") or "") == latest]
        rows.sort(key=lambda r: (-(r.get("rating") or 0)))
        seen, out = set(), []
        for r in rows:
            k = key(r["model_name"])
            if k in seen:
                continue
            seen.add(k)
            lic = (r.get("license") or "")
            out.append({"n": base(r["model_name"]), "v": pretty(r["model_name"]), "o": org_name(r.get("organization")),
                        "s": round(r["rating"]), "lo": round(r.get("rating_lower") or r["rating"]),
                        "hi": round(r.get("rating_upper") or r["rating"]), "votes": int(r.get("vote_count") or 0),
                        "open": bool(lic) and lic.lower() != "proprietary"})
            if len(out) >= 15:
                break
        boards.append({"id": bid, "label": label, "what": what, "date": latest, "rows": out,
                       "src": "https://lmarena.ai/leaderboard", "srcName": "LMArena"})
    by = {b["id"]: b for b in boards}
    if "chat" not in by or len(by["chat"]["rows"]) < 10 or len(boards) < 8:
        raise ValueError(f"arena looks incomplete ({len(boards)} boards)")
    return {"boards": boards}

# ---------------------------------------------------------------- Artificial Analysis
AA_URL = "https://artificialanalysis.ai/leaderboards/models"

def _match_bracket(s, i):
    depth = 0; ins = False; esc = False
    for p in range(i, len(s)):
        ch = s[p]
        if ins:
            if esc: esc = False
            elif ch == "\\": esc = True
            elif ch == '"': ins = False
        else:
            if ch == '"': ins = True
            elif ch in "[{": depth += 1
            elif ch in "]}":
                depth -= 1
                if depth == 0:
                    return p + 1
    raise ValueError("unbalanced")

def fetch_aa():
    raw = get(AA_URL, timeout=60).text
    chunks = re.findall(r'self\.__next_f\.push\(\[1,(".*?")\]\)</script>', raw, flags=re.S)
    full = "".join(json.loads(c) for c in chunks)
    m = re.search(r'"initialModels":\[\{', full)
    if not m:
        raise ValueError("AA: model list not found on page")
    k = m.end() - 2
    arr = json.loads(full[k:_match_bracket(full, k)])
    models = {}
    for x in arr:
        if x.get("deprecated"):
            continue
        ii = x.get("intelligenceIndex")
        if ii is None:
            continue
        b = base(x.get("shortName") or x.get("name"))
        kk = key(b)
        sc = x.get("scores") or {}
        cur = models.get(kk)
        rec = {
            "n": b, "v": x.get("shortName") or x.get("name"), "slug": x.get("slug"),
            "o": org_name(x.get("modelCreatorName")), "open": bool(x.get("isOpenWeights")),
            "iq": round(ii, 1), "est": bool(x.get("intelligenceIndexIsEstimated")),
            "pin": x.get("price1mInputTokens"), "pout": x.get("price1mOutputTokens"),
            "task": round(x["intelligenceIndexCostPerTask"], 2) if x.get("intelligenceIndexCostPerTask") else None,
            "tps": round(x["medianOutputTokensPerSecond"]) if x.get("medianOutputTokensPerSecond") else None,
            "ctx": x.get("contextWindowTokens"),
            "code": sc.get("terminalbench-4-0"), "facts": sc.get("omniscience-non-hallucination"),
            "longdoc": sc.get("artificial-analysis-long-context-reasoning"), "hle": sc.get("humanitys-last-exam"),
            "health": sc.get("healthbench"), "see": sc.get("mmmu-pro"),
        }
        if cur is None:
            models[kk] = rec
            rec["variants"] = 1
        else:
            cur["variants"] += 1
            # keep the best score for each measure, and the headline variant = highest iq
            for f in ("code", "facts", "longdoc", "hle", "health", "see", "tps"):
                if rec[f] is not None and (cur[f] is None or rec[f] > cur[f]):
                    cur[f] = rec[f]
            if rec["iq"] > cur["iq"]:
                for f in ("v", "slug", "iq", "est", "task"):
                    cur[f] = rec[f]
            for f in ("pin", "pout", "ctx"):
                if cur[f] is None and rec[f] is not None:
                    cur[f] = rec[f]
    out = sorted(models.values(), key=lambda r: -r["iq"])
    for r in out:
        for f in ("code", "facts", "longdoc", "hle", "health", "see"):
            if r[f] is not None:
                r[f] = round(r[f] * 100, 1)
    if len(out) < 25 or out[0]["iq"] < 20:
        raise ValueError(f"AA looks incomplete ({len(out)} models)")
    return {"models": out, "src": AA_URL, "srcName": "Artificial Analysis"}

# ---------------------------------------------------------------- OpenRouter releases
OR_URL = "https://openrouter.ai/api/v1/models"
BIG = {"openai", "anthropic", "google", "x-ai", "meta", "meta-llama", "deepseek", "mistralai", "qwen", "moonshotai",
       "nvidia", "minimax", "z-ai", "amazon", "microsoft", "cohere", "stepfun", "baidu", "bytedance", "bytedance-seed",
       "tencent", "liquid", "inception", "ai21", "perplexity", "ibm-granite", "allenai", "xiaomi", "inclusionai"}

def fetch_releases():
    data = get(OR_URL, timeout=40).json()["data"]
    out = []
    for m in data:
        mid = m.get("id", "")
        if ":" in mid or mid.startswith("~"):
            continue
        lab = mid.split("/")[0]
        if lab not in BIG:
            continue
        c = m.get("created")
        if not c:
            continue
        dt = datetime.fromtimestamp(c, timezone.utc)
        if dt < NOW - timedelta(days=150):
            continue
        p = m.get("pricing") or {}
        def per_m(v):
            try:
                v = float(v)
            except Exception:
                return None
            return None if v < 0 else round(v * 1e6, 3)
        name = m.get("name") or mid
        name = name.split(": ", 1)[1] if ": " in name else name
        out.append({"d": dt.date().isoformat(), "n": name, "o": org_name(lab), "id": mid,
                    "pin": per_m(p.get("prompt")), "pout": per_m(p.get("completion")),
                    "ctx": m.get("context_length"),
                    "u": "https://openrouter.ai/" + mid})
    out.sort(key=lambda r: r["d"], reverse=True)
    if len(out) < 10:
        raise ValueError(f"OpenRouter list looks too short ({len(out)})")
    return {"items": out[:80], "src": "https://openrouter.ai/models", "srcName": "OpenRouter"}

# ---------------------------------------------------------------- news
FEEDS = [
    ("OpenAI", "https://openai.com/news/rss.xml", "lab"),
    ("Google AI", "https://blog.google/technology/ai/rss/", "lab"),
    ("Google DeepMind", "https://deepmind.google/blog/rss.xml", "lab"),
    ("NVIDIA", "https://blogs.nvidia.com/feed/", "lab"),
    ("Hugging Face", "https://huggingface.co/blog/feed.xml", "lab"),
    ("TechCrunch", "https://techcrunch.com/category/artificial-intelligence/feed/", "news"),
    ("The Verge", "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", "news"),
    ("Ars Technica", "https://arstechnica.com/ai/feed/", "news"),
    ("MIT Tech Review", "https://www.technologyreview.com/topic/artificial-intelligence/feed", "news"),
    ("Wired", "https://www.wired.com/feed/tag/ai/latest/rss", "news"),
]
PROMO = re.compile(r"(days? left|last chance|save \$|register now|tickets?|founder summit|disrupt 20|webinar|sponsored|deal of|% off|best .* deals?|prime day|black friday)", re.I)

def _local(t):
    return t.rsplit("}", 1)[-1]

def _date(text):
    if not text:
        return None
    text = text.strip()
    try:
        dt = parsedate_to_datetime(text)
    except Exception:
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def _clean(s, n=220):
    s = re.sub(r"<[^>]+>", " ", html.unescape(s or ""))
    s = " ".join(s.split())
    return (s[: n - 1] + "…") if len(s) > n else s

def fetch_news():
    items, ok, status = [], 0, []
    for name, url, kind in FEEDS:
        try:
            root = ET.fromstring(get(url, timeout=20).content)
            got = 0
            for el in root.iter():
                if _local(el.tag) not in ("item", "entry"):
                    continue
                title = link = date = desc = None
                for c in el:
                    t = _local(c.tag)
                    if t == "title" and c.text:
                        title = " ".join(html.unescape(c.text).split())
                        if " " not in title and "-" in title:
                            title = title.replace("-", " ").capitalize()
                    elif t == "link":
                        link = c.get("href") or (c.text or "").strip() or link
                    elif t in ("pubDate", "published", "updated", "date") and not date:
                        date = _date(c.text)
                    elif t in ("description", "summary") and not desc:
                        desc = _clean(c.text)
                if not (title and link and link.startswith("http") and date):
                    continue
                if PROMO.search(title) or date > NOW + timedelta(hours=6) or date < NOW - timedelta(days=21):
                    continue
                items.append({"t": title, "u": link, "s": name, "k": kind, "d": date.isoformat(timespec="seconds"),
                              "x": desc or ""})
                got += 1
                if got >= 8:
                    break
            ok += 1
            status.append([name, "ok", got])
        except Exception as e:
            status.append([name, "failed", str(e)[:120]])
            log(f"news: {name} failed: {e}")
    if ok < 3:
        raise ValueError(f"only {ok} news feeds answered")
    seen, uniq = set(), []
    for i in sorted(items, key=lambda x: x["d"], reverse=True):
        k2 = re.sub(r"\W+", "", i["t"].lower())[:60]
        if i["u"] in seen or k2 in seen:
            continue
        seen.add(i["u"]); seen.add(k2)
        uniq.append(i)
    if len(uniq) < 8:
        raise ValueError(f"only {len(uniq)} news items")
    return {"items": uniq[:60], "feeds": status}

# ---------------------------------------------------------------- HF trending
def fetch_trending():
    data = get("https://huggingface.co/api/models?sort=trendingScore&limit=20", timeout=30).json()
    out = []
    for m in data:
        mid = m.get("id") or m.get("modelId")
        if mid:
            out.append({"id": mid, "likes": m.get("likes"), "dl": m.get("downloads"), "pipe": m.get("pipeline_tag"),
                        "u": "https://huggingface.co/" + mid})
    if len(out) < 5:
        raise ValueError("trending list too short")
    return {"models": out, "src": "https://huggingface.co/models?sort=trending", "srcName": "Hugging Face"}

# ---------------------------------------------------------------- derived
PIPE = {"text-generation": "Chat / text", "image-text-to-text": "Text + images", "text-to-image": "Makes images",
        "text-to-video": "Makes video", "image-to-video": "Photo to video", "text-to-speech": "Voice",
        "automatic-speech-recognition": "Speech to text", "any-to-any": "All-in-one", "image-to-image": "Edits images",
        "feature-extraction": "Search embeddings", "sentence-similarity": "Search embeddings"}

def fmt_price(i, o):
    if i is None or o is None:
        return "price n/a"
    f = lambda v: ("$%g" % v) if v >= 0.1 else ("$%.2f" % v if v >= 0.01 else "$%.3f" % v)
    return f"{f(i)} in / {f(o)} out per 1M words-pieces".replace("words-pieces", "tokens")

def derive(data):
    arena = {b["id"]: b for b in (data.get("arena") or {}).get("boards", [])}
    aa = (data.get("aa") or {}).get("models", [])
    aa_by = {key(m["n"]): m for m in aa}
    best = []

    def arena_pick(bid, label, icon):
        b = arena.get(bid)
        if not b or not b["rows"]:
            return
        r = b["rows"]
        top = r[0]
        # tie when the #2 is inside the #1's error range
        tie = len(r) > 1 and r[1]["hi"] >= top["lo"]
        best.append({"id": bid, "label": label, "icon": icon, "pick": top["n"], "o": top["o"],
                     "why": f"#1 on LMArena's {b['label'].lower()} board with {top['s']} points from {top['votes']:,} votes."
                            + (f" {r[1]['n']} is within the margin of error." if tie else ""),
                     "close": tie, "ru": [[x["n"], f"{x['s']} points"] for x in r[1:3]],
                     "src": "LMArena", "srcU": b["src"], "date": b["date"]})

    # Smartest overall: tests (AA) + people's votes (arena chat)
    if aa and arena.get("chat"):
        t = aa[0]; v = arena["chat"]["rows"][0]
        same = key(t["n"]) == key(v["n"])
        best.append({"id": "overall", "label": "Smartest overall", "icon": "🧠",
                     "pick": t["n"] if same else f"{t['n']} / {v['n']}", "o": t["o"] if same else "",
                     "why": (f"Top on both: independent tests (Artificial Analysis score {t['iq']}) and people's votes on LMArena ({v['s']} points)."
                             if same else
                             f"{t['n']} tops independent tests (Artificial Analysis score {t['iq']}). {v['n']} tops people's votes on LMArena ({v['s']} points)."),
                     "close": not same,
                     "ru": [[x["n"], f"test score {x['iq']}"] for x in aa[1:4] if key(x["n"]) not in (key(t["n"]), key(v["n"]))][:2],
                     "src": "Artificial Analysis + LMArena", "srcU": AA_URL, "date": arena["chat"]["date"]})
    arena_pick("webdev", "Coding and building apps", "💻")
    if aa:
        c = sorted([m for m in aa if m["code"] is not None and m["iq"] >= aa[0]["iq"] * 0.6], key=lambda m: -m["code"])
        if c:
            best.append({"id": "agentcode", "label": "Coding agents (long tasks in a terminal)", "icon": "🛠️",
                         "pick": c[0]["n"], "o": c[0]["o"],
                         "why": f"Best Terminal-Bench score in Artificial Analysis's tests: {c[0]['code']}% of tasks done.",
                         "close": len(c) > 1 and c[0]["code"] - c[1]["code"] < 1.5,
                         "ru": [[x["n"], f"{x['code']}%"] for x in c[1:3]], "src": "Artificial Analysis", "srcU": AA_URL, "date": ""})
    arena_pick("writing", "Writing", "✍️")
    arena_pick("math", "Math", "➗")
    arena_pick("vision", "Reading photos and documents", "📄")
    arena_pick("search", "Answers with web search", "🔎")
    arena_pick("image", "Making images", "🎨")
    arena_pick("imgedit", "Editing photos", "🖌️")
    arena_pick("video", "Making videos", "🎬")
    if aa:
        top = aa[0]["iq"]
        good = [m for m in aa if m["iq"] >= top * 0.8 and m["task"]]
        if good:
            v = sorted(good, key=lambda m: m["task"])
            best.append({"id": "value", "label": "Best value (smart and cheap)", "icon": "💰", "pick": v[0]["n"], "o": v[0]["o"],
                         "why": f"Cheapest model within 20% of the top test score: {v[0]['iq']} vs {top}, at ${v[0]['task']} per test task.",
                         "close": False, "ru": [[x["n"], f"score {x['iq']}, ${x['task']}/task"] for x in v[1:3]],
                         "src": "Artificial Analysis", "srcU": AA_URL, "date": ""})
        fast = sorted([m for m in aa if m["iq"] >= top * 0.7 and m["tps"]], key=lambda m: -m["tps"])
        if fast:
            best.append({"id": "fast", "label": "Fastest smart model", "icon": "⚡", "pick": fast[0]["n"], "o": fast[0]["o"],
                         "why": f"Writes about {fast[0]['tps']} tokens a second, the fastest of the models within 30% of the top score.",
                         "close": False, "ru": [[x["n"], f"{x['tps']} tokens/s"] for x in fast[1:3]],
                         "src": "Artificial Analysis", "srcU": AA_URL, "date": ""})
        op = [m for m in aa if m["open"]]
        if op:
            best.append({"id": "open", "label": "Best free model you can run yourself", "icon": "🔓", "pick": op[0]["n"], "o": op[0]["o"],
                         "why": f"Highest test score among open-weight models ({op[0]['iq']}; the top closed model scores {top}).",
                         "close": len(op) > 1 and op[0]["iq"] - op[1]["iq"] < 1,
                         "ru": [[x["n"], f"score {x['iq']}"] for x in op[1:3]], "src": "Artificial Analysis", "srcU": AA_URL, "date": ""})
        fa = sorted([m for m in aa if m["facts"] is not None and m["iq"] >= top * 0.6], key=lambda m: -m["facts"])
        if fa:
            best.append({"id": "facts", "label": "Least likely to make things up", "icon": "✅", "pick": fa[0]["n"], "o": fa[0]["o"],
                         "why": f"On questions it can't answer, it says so instead of guessing {fa[0]['facts']}% of the time (Artificial Analysis Omniscience test).",
                         "close": len(fa) > 1 and fa[0]["facts"] - fa[1]["facts"] < 1,
                         "ru": [[x["n"], f"{x['facts']}%"] for x in fa[1:3]], "src": "Artificial Analysis", "srcU": AA_URL, "date": ""})
        ld = sorted([m for m in aa if m["longdoc"] is not None and m["iq"] >= top * 0.6], key=lambda m: -m["longdoc"])
        if ld:
            best.append({"id": "longdoc", "label": "Long documents", "icon": "📚", "pick": ld[0]["n"], "o": ld[0]["o"],
                         "why": f"Best long-document reasoning score: {ld[0]['longdoc']}%.",
                         "close": len(ld) > 1 and ld[0]["longdoc"] - ld[1]["longdoc"] < 1,
                         "ru": [[x["n"], f"{x['longdoc']}%"] for x in ld[1:3]], "src": "Artificial Analysis", "srcU": AA_URL, "date": ""})

    # labs: best model per big lab by test score + newest release
    labs = []
    rel = (data.get("releases") or {}).get("items", [])
    for lab in ["Google", "Anthropic", "OpenAI", "xAI", "Meta", "DeepSeek", "Alibaba", "Moonshot", "Mistral", "Z.ai", "NVIDIA", "MiniMax"]:
        ms = [m for m in aa if m["o"] == lab]
        newest = next((r for r in rel if r["o"] == lab), None)
        if not ms and not newest:
            continue
        rank = (aa.index(ms[0]) + 1) if ms else None
        labs.append({"lab": lab, "top": ms[0]["n"] if ms else None, "iq": ms[0]["iq"] if ms else None, "rank": rank,
                     "newest": newest["n"] if newest else None, "newestD": newest["d"] if newest else None,
                     "open": any(m["open"] for m in ms[:3])})
    labs.sort(key=lambda l: (l["rank"] or 999))
    return best, labs

def week_card(data, prev):
    """Plain facts for 'What's new this week'. Every line comes from fetched data."""
    lines = []
    rel = (data.get("releases") or {}).get("items", [])
    def recent_models(days):
        cut = (NOW - timedelta(days=days)).date().isoformat()
        rs = sorted([r for r in rel if r["d"] >= cut], key=lambda r: (r["d"], -len(r["n"])), reverse=True)
        seen, out = set(), []
        for r in rs:
            k = key(re.sub(r"\b(pro|preview|mini|fast|turbo)\b", "", r["n"], flags=re.I))
            if k in seen:
                continue
            seen.add(k)
            out.append(r)
        return out
    span = 7
    new = recent_models(7)
    if len(new) < 2:
        span = 14
        new = recent_models(14)
    for r in new[:5]:
        p = f" (${r['pin']:g} / ${r['pout']:g} per 1M tokens)" if r.get("pin") is not None and r.get("pout") else ""
        lines.append({"k": "new", "t": f"New model: {r['n']} from {r['o']}{p}", "d": r["d"], "u": r["u"]})
    # leaderboard changes versus the last saved snapshot
    if prev:
        for b in (data.get("arena") or {}).get("boards", []):
            if not b["rows"]:
                continue
            old = prev.get("arena_top", {}).get(b["id"])
            now = b["rows"][0]["n"]
            if old and old != now:
                lines.insert(0, {"k": "rank", "t": f"New #1 for {b['label'].lower()}: {now} (was {old})", "d": b["date"], "u": b["src"]})
        old_aa = prev.get("aa_top")
        aa = (data.get("aa") or {}).get("models", [])
        if aa and old_aa and old_aa != aa[0]["n"]:
            lines.insert(0, {"k": "rank", "t": f"New #1 on independent tests: {aa[0]['n']} (was {old_aa})", "d": NOW.date().isoformat(), "u": AA_URL})
    # current leaders always shown
    ar = {b["id"]: b for b in (data.get("arena") or {}).get("boards", [])}
    aa = (data.get("aa") or {}).get("models", [])
    lead = []
    if ar.get("chat"):
        lead.append(f"People's votes: {ar['chat']['rows'][0]['n']}")
    if aa:
        lead.append(f"tests: {aa[0]['n']}")
    if ar.get("webdev"):
        lead.append(f"coding: {ar['webdev']['rows'][0]['n']}")
    if lead:
        lines.append({"k": "lead", "t": "#1 right now. " + "; ".join(lead) + ".", "d": "", "u": ""})
    # headlines: lab posts first, then news, last 7 days
    news = (data.get("news") or {}).get("items", [])
    recent = [n for n in news if n["d"] >= (NOW - timedelta(days=7)).isoformat()]
    picks = [n for n in recent if n["k"] == "lab"][:2] + [n for n in recent if n["k"] == "news"][:3]
    picks.sort(key=lambda n: n["d"], reverse=True)
    for n in picks:
        lines.append({"k": "news", "t": n["t"], "d": n["d"][:10], "u": n["u"], "s": n["s"]})
    return {"span": span, "lines": lines}

# ---------------------------------------------------------------- main
SECTIONS = [("arena", fetch_arena), ("aa", fetch_aa), ("releases", fetch_releases), ("news", fetch_news), ("trending", fetch_trending)]

def main():
    prev = {}
    if OUT_JSON.exists():
        try:
            prev = json.loads(OUT_JSON.read_text())
        except Exception as e:
            log(f"old data unreadable: {e}")
    hist = {}
    if HIST.exists():
        try:
            hist = json.loads(HIST.read_text())
        except Exception:
            hist = {}
    data = {"v": 2, "built": NOW_ISO, "status": {}}
    fresh = 0
    for name, fn in SECTIONS:
        t0 = time.time()
        try:
            sec = fn()
            sec["updated"] = NOW_ISO
            data[name] = sec
            data["status"][name] = {"ok": True, "updated": NOW_ISO, "secs": round(time.time() - t0, 1)}
            fresh += 1
            log(f"ok    {name} ({time.time() - t0:.1f}s)")
        except Exception as e:
            old = prev.get(name)
            if old:
                data[name] = old
                data["status"][name] = {"ok": False, "updated": old.get("updated"), "err": str(e)[:200]}
            else:
                data["status"][name] = {"ok": False, "updated": None, "err": str(e)[:200]}
            log(f"FAIL  {name}: {e} -> {'kept last good copy' if old else 'no copy to keep'}")
    if fresh == 0:
        log("No source could be refreshed; leaving the published data as it is.")
        return 2
    for need in ("arena", "aa"):
        if not data.get(need):
            log(f"missing section {need} and no old copy; not writing")
            return 3
    best, labs = derive(data)
    if len(best) < 8:
        log(f"only {len(best)} best-for picks; not writing")
        return 4
    data["best"] = best
    data["labs"] = labs
    # history: compare against the newest snapshot that is at least 20 hours old
    snaps = hist.get("snaps", [])
    older = [s for s in snaps if s["t"] <= (NOW - timedelta(hours=20)).isoformat()]
    base_snap = older[-1] if older else None
    data["week"] = week_card(data, base_snap)
    snap = {"t": NOW_ISO, "aa_top": data["aa"]["models"][0]["n"],
            "arena_top": {b["id"]: b["rows"][0]["n"] for b in data["arena"]["boards"] if b["rows"]}}
    snaps = (snaps + [snap])[-60:]
    # final sanity check on the whole file before replacing anything
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(blob) < 20000 or "NaN" in blob:
        log("built data failed the final check; not writing")
        return 5
    def fingerprint(d):
        d = {k: v for k, v in d.items() if k not in ("built", "status", "week")}
        d = json.loads(json.dumps(d))
        for v in d.values():
            if isinstance(v, dict):
                v.pop("updated", None)
        return json.dumps(d, sort_keys=True)
    if prev and fingerprint(prev) == fingerprint(data):
        log("Nothing changed since the last update; files left as they are.")
        return 0 if fresh == len(SECTIONS) else 1
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_JSON.with_suffix(".tmp")
    tmp.write_text(blob)
    os.replace(tmp, OUT_JSON)
    tmpjs = OUT_JS.with_suffix(".tmp")
    tmpjs.write_text("window.AI_DATA=" + blob + ";\n")
    os.replace(tmpjs, OUT_JS)
    HIST.parent.mkdir(parents=True, exist_ok=True)
    HIST.write_text(json.dumps({"snaps": snaps}, ensure_ascii=False))
    log(f"wrote {OUT_JSON} ({len(blob)//1024} KB), {fresh}/{len(SECTIONS)} sections fresh")
    return 0 if fresh == len(SECTIONS) else 1

if __name__ == "__main__":
    rc = main()
    sys.stdout.flush(); sys.stderr.flush()
    os._exit(rc)   # pyarrow can abort on normal interpreter shutdown; exit hard with our code
