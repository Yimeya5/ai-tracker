#!/usr/bin/env python3
"""Rebuild data/data.json (+ data/data.js) for the AI Tracker app.

The app answers 4 questions: which model is best for what, what each one costs,
what was released lately, and the big news. No AI calls anywhere: every pick is a fixed rule.

Sources (only these):
  lmarena    LMArena official Hugging Face dataset (parquet, CC-BY-4.0): people's blind votes
  aa         Artificial Analysis official free API: independent tests, prices, image arena.
             OFF by default. Only used when AA_ENABLED is "1" or "true" (needs AA_API_KEY too).
             AA's Data Platform Terms don't allow its data in a public product, so keep it off for the public app.
             When off: no AA requests, and no AA data in data.json, data.js or raw.json.
  livebench  LiveBench latest release CSV: fresh, contamination-free tasks
  epoch      Epoch AI Capabilities Index (CC-BY): many benchmarks combined, with error bars
  openrouter OpenRouter models API: developer prices, release dates, what each model outputs (text/image/...)
  official   each company's own news page/blog (OpenAI, Google DeepMind, Google AI, Anthropic, Mistral, xAI, Meta,
             DeepSeek): new model announcements (for New releases and Big news)
  prices     each app's official pricing page, or the company's own App Store listing (US) when the web page blocks
             servers (ChatGPT, Perplexity; Meta AI = free; Grok backup). Simple regex rules, polite fetching.
  news       RSS feeds from AI labs and tech news sites; Big news keeps only launches, big price changes,
             product launches/shutdowns, $1B+ funding, acquisitions and IPO filings (fixed word rules)

Keep-last-good: every source is fetched and checked on its own. If it fails or looks wrong, the last good
copy (saved in data/raw.json) is used and the app shows "using last good copy from <date>".
The script never writes the AA key anywhere.
"""
import csv, html, io, json, os, re, socket, sys, time, zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urljoin

import requests

socket.setdefaulttimeout(60)
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUT_JSON = DATA_DIR / "data.json"
OUT_JS = DATA_DIR / "data.js"
RAW_JSON = DATA_DIR / "raw.json"          # last good copy of every source (keep-last-good)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}
NOW = datetime.now(timezone.utc)
NOW_ISO = NOW.isoformat(timespec="seconds")
TODAY = NOW.date().isoformat()
VERSION = 3


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(url, timeout=40, headers=None, **kw):
    h = dict(UA)
    if headers:
        h.update(headers)
    r = requests.get(url, headers=h, timeout=timeout, **kw)
    r.raise_for_status()
    return r


def scrub(text):
    """Remove the AA key from any text before it is logged or saved."""
    s = str(text)
    k = os.environ.get("AA_API_KEY") or ""
    return s.replace(k, "***") if k else s


# ======================================================================= names
# Every source spells model names differently. normalize() turns them into one id:
#   "Claude Opus 5.5 (Max, Default Fallback)", "claude-opus-5-5", "anthropic/claude-opus-5.5",
#   "Anthropic: Claude Opus 5.5", "claude-opus-5-5-20260922-thinking-32k"  ->  "claude-opus-5-5"
# ALIASES fixes the odd cases the rules can't (left = normalized form, right = canonical id).
ALIASES = {
    "chatgpt-4o": "gpt-4o",                     # "chatgpt-4o-latest" ("latest" is stripped first)
    "gpt-4o-chatgpt": "gpt-4o",
    "gemini-4-carbon-preview": "gemini-4-carbon",
    "gemini-4-argon-preview": "gemini-4-argon",
    "claude-4-5-opus": "claude-opus-4-5",       # old word order
    "claude-4-5-sonnet": "claude-sonnet-4-5",
    "claude-4-opus": "claude-opus-4",
    "kimi-k3-1-pro-preview": "kimi-k3-1-pro",
    "grok-4-7-beta": "grok-4-7",
    "gpt-image-2-5-sunburst-image": "gpt-image-2-5-sunburst",
}
# words that describe how hard a model "thinks" or how it was run, not which model it is
EFFORT = {"high", "xhigh", "x-high", "low", "medium", "med", "minimal", "max", "thinking", "think", "reasoning",
          "nonreasoning", "non-reasoning", "default", "fallback", "adaptive", "budget", "latest", "with", "effort", "none"}
KEEP_MAX = ("qwen", "kimi", "minimax")    # families where "max" is part of the model name
VENDORS = {"anthropic", "openai", "google", "x-ai", "xai", "meta", "meta-llama", "deepseek", "deepseek-ai", "qwen",
           "alibaba", "moonshotai", "moonshot", "mistralai", "mistral", "nvidia", "minimax", "z-ai", "zai", "amazon",
           "microsoft", "cohere", "bytedance", "bytedance-seed", "tencent", "baidu", "stepfun", "spacexai"}


def _is_date_token(t):
    if re.fullmatch(r"20\d{6}", t):
        return True
    if re.fullmatch(r"\d{4}", t):            # mmdd like 1017, or a year like 2026
        mm, dd = int(t[:2]), int(t[2:])
        return t.startswith("20") or (1 <= mm <= 12 and 1 <= dd <= 31)
    return False


def normalize(name):
    s = html.unescape(str(name or "")).strip().lower()
    if not s:
        return ""
    if ": " in s:                                    # "Anthropic: Claude Opus 5.5"
        head, tail = s.split(": ", 1)
        if head.replace(" ", "-") in VENDORS or len(head.split()) <= 2:
            s = tail
    if "/" in s:                                     # "anthropic/claude-opus-5.5"
        s = s.split("/")[-1]
    s = re.sub(r"\(.*?\)|\[.*?\]", " ", s)          # "(Max, Default Fallback)"
    s = re.sub(r"(?<=\d)\.(?=\d)", "-", s)           # 5.5 -> 5-5
    s = re.sub(r"\b(20\d\d)-(\d\d)-(\d\d)\b", r"\1\2\3", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    toks = [t for t in s.split("-") if t]
    toks = [t for t in toks if not re.fullmatch(r"\d+k", t)]          # thinking budgets like 32k
    out = []
    for i, t in enumerate(toks):
        if i > 0 and _is_date_token(t):
            continue
        out.append(t)
    toks = out
    fam = toks[0] if toks else ""
    while len(toks) > 1 and toks[-1] in EFFORT and not (toks[-1] == "max" and fam.startswith(KEEP_MAX)):
        toks.pop()
    toks = [t for i, t in enumerate(toks) if not (i > 0 and t in ("thinking", "reasoning", "nonreasoning") )]
    if len(toks) > 1 and toks[-1] == "non":
        toks.pop()
    k = "-".join(toks)
    return ALIASES.get(k, k)


def display_name(name):
    """Readable name without run settings: 'Claude Opus 5.5 (Max)' -> 'Claude Opus 5.5'."""
    s = html.unescape(str(name or "")).strip()
    if ": " in s:
        head, tail = s.split(": ", 1)
        if len(head.split()) <= 2:
            s = tail
    s = re.sub(r"\s*[\(\[].*?[\)\]]\s*", " ", s).strip()
    if " " not in s and "-" in s:                    # slug like claude-opus-5-5-thinking
        s = re.sub(r"-20\d\d-\d\d-\d\d$", "", s.split("/")[-1])
        parts = s.split("-")
        keep_max = parts[0].lower().startswith(KEEP_MAX)
        while len(parts) > 1 and ((parts[-1].lower() in EFFORT and not (keep_max and parts[-1].lower() == "max"))
                                  or _is_date_token(parts[-1]) or re.fullmatch(r"\d+k", parts[-1].lower())):
            parts.pop()
        words = []
        for p in parts:
            if words and p.isdigit() and len(p) <= 2 and words[-1][-1:].isdigit():
                words[-1] += "." + p
            elif p.lower() == "gpt":
                words.append("GPT")
            elif p[:1].isalpha():
                words.append(p[:1].upper() + p[1:])
            else:
                words.append(p)
        s = " ".join(words)
    return re.sub(r"\s+", " ", s)


ORG = {"google": "Google", "anthropic": "Anthropic", "openai": "OpenAI", "xai": "xAI", "x-ai": "xAI", "spacexai": "xAI",
       "meta": "Meta", "meta-llama": "Meta", "deepseek": "DeepSeek", "deepseek-ai": "DeepSeek", "alibaba": "Alibaba",
       "qwen": "Alibaba", "moonshot": "Moonshot", "moonshotai": "Moonshot", "moonshot ai": "Moonshot", "kimi": "Moonshot",
       "mistral": "Mistral", "mistralai": "Mistral", "nvidia": "NVIDIA", "minimax": "MiniMax", "zhipu": "Z.ai", "z-ai": "Z.ai",
       "zai": "Z.ai", "z ai": "Z.ai", "z.ai": "Z.ai", "bfl": "Black Forest Labs", "black forest labs": "Black Forest Labs",
       "bytedance": "ByteDance", "bytedance-seed": "ByteDance", "bytedance seed": "ByteDance", "microsoft": "Microsoft",
       "microsoft-ai": "Microsoft", "amazon": "Amazon", "tencent": "Tencent", "baidu": "Baidu", "stepfun": "StepFun",
       "cohere": "Cohere", "ideogram": "Ideogram", "recraft": "Recraft", "midjourney": "Midjourney", "kuaishou": "Kuaishou",
       "inclusionai": "inclusionAI", "liquid": "Liquid AI", "ibm": "IBM", "ibm-granite": "IBM", "perplexity": "Perplexity",
       "xiaomi": "Xiaomi", "allenai": "Ai2", "ai2": "Ai2", "inception": "Inception"}


def org_name(o):
    if not o:
        return ""
    k = str(o).strip().lower()
    return ORG.get(k, str(o).strip())


def num(v):
    try:
        if v is None or v == "":
            return None
        f = float(v)
        return None if f != f else f          # drop NaN
    except Exception:
        return None


# ======================================================================= LMArena
LM_URL = "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/refs%2Fconvert%2Fparquet/{}/latest/0000.parquet"
LM_BOARDS = [  # (board id, dataset config, category, label, page link)
    ("text", "text", "overall", "Text, overall", "https://lmarena.ai/leaderboard/text"),
    ("text_coding", "text", "coding", "Coding questions", "https://lmarena.ai/leaderboard/text"),
    ("text_creative_writing", "text", "creative_writing", "Creative writing", "https://lmarena.ai/leaderboard/text"),
    ("text_math", "text", "math", "Math", "https://lmarena.ai/leaderboard/text"),
    ("webdev", "webdev", "overall", "Building websites and apps", "https://lmarena.ai/leaderboard/webdev"),
    ("text_to_image", "text_to_image", "overall", "Making pictures", "https://lmarena.ai/leaderboard/text-to-image"),
]
# Every row of every board is kept in raw.json: a model ranked #75 is still "covered" (with its votes),
# not "missing". Only the picks (top few + ranks of the models shown) go into the app file.


def read_parquet(raw):
    import pyarrow.parquet as pq
    return pq.read_table(io.BytesIO(raw)).to_pylist()


def lm_board(rows_all, category):
    rows = [r for r in rows_all if r.get("category") == category]
    if not rows:
        return None, []
    latest = max(str(r.get("leaderboard_publish_date") or "") for r in rows)
    rows = [r for r in rows if str(r.get("leaderboard_publish_date") or "") == latest]
    rows.sort(key=lambda r: -(num(r.get("rating")) or 0))
    seen, out = set(), []
    for r in rows:
        k = normalize(r.get("model_name"))
        s = num(r.get("rating"))
        if not k or k in seen or s is None:
            continue
        seen.add(k)
        lo, hi = num(r.get("rating_lower")), num(r.get("rating_upper"))
        out.append({"k": k, "n": display_name(r.get("model_name")), "o": org_name(r.get("organization")),
                    "s": round(s), "lo": round(lo if lo is not None else s), "hi": round(hi if hi is not None else s),
                    "votes": int(num(r.get("vote_count")) or 0)})
    return latest[:10], out


def fetch_lmarena(prev=None):
    cache, boards = {}, {}
    for bid, cfg, cat, label, page in LM_BOARDS:
        try:
            if cfg not in cache:
                cache[cfg] = read_parquet(get(LM_URL.format(cfg), timeout=120).content)
            date, rows = lm_board(cache[cfg], cat)
        except Exception as e:
            log(f"lmarena: {bid} failed: {e}")
            date, rows = None, []
        if rows:
            boards[bid] = {"label": label, "date": date, "url": page, "rows": rows}
        elif prev and (prev.get("boards") or {}).get(bid):
            boards[bid] = prev["boards"][bid]          # keep this one board's last good copy
            boards[bid]["stale"] = True
    if len((boards.get("text") or {}).get("rows", [])) < 10:
        raise ValueError(f"LMArena text board looks incomplete ({len(boards)} boards)")
    return {"boards": boards}


# ======================================================================= Artificial Analysis (free API only)
AA_BASE = "https://artificialanalysis.ai/api/v2"
AA_LLM = AA_BASE + "/language/models/free?page={}"
AA_IMG = AA_BASE + "/media/text-to-image/models/free"
AA_PAGE = "https://artificialanalysis.ai/leaderboards/models"
AA_IMG_PAGE = "https://artificialanalysis.ai/text-to-image/leaderboard"


def aa_get(url):
    key = os.environ.get("AA_API_KEY")
    if not key:
        raise RuntimeError("AA_API_KEY is not set")
    r = requests.get(url, headers={"x-api-key": key, "Accept": "application/json"}, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"Artificial Analysis API answered {r.status_code}")
    return r.json()


def parse_aa_llm(records):
    best = {}
    for x in records:
        name = x.get("name") or x.get("slug")
        k = normalize(name)
        if not k:
            continue
        ev = x.get("evaluations") or {}
        pr = x.get("pricing") or {}
        rec = {"k": k, "n": display_name(name), "o": org_name((x.get("model_creator") or {}).get("name")),
               "slug": x.get("slug") or "", "rel": (x.get("release_date") or "")[:10],
               "iq": num(ev.get("artificial_analysis_intelligence_index")),
               "code": num(ev.get("artificial_analysis_coding_index")),
               "pin": num(pr.get("price_1m_input_tokens")), "pout": num(pr.get("price_1m_output_tokens"))}
        cur = best.get(k)
        if cur is None:
            best[k] = rec
            continue
        # several run settings of one model: keep the best score, and any price we find
        if rec["iq"] is not None and (cur["iq"] is None or rec["iq"] > cur["iq"]):
            for f in ("iq", "n", "slug"):
                cur[f] = rec[f]
        if rec["code"] is not None and (cur["code"] is None or rec["code"] > cur["code"]):
            cur["code"] = rec["code"]
        for f in ("pin", "pout", "rel", "o"):
            if not cur[f] and rec[f]:
                cur[f] = rec[f]
    out = [m for m in best.values() if m["iq"] is not None or m["rel"] >= (NOW - timedelta(days=120)).date().isoformat()]
    out.sort(key=lambda m: -(m["iq"] if m["iq"] is not None else -1))
    return out


def parse_aa_image(records):
    best = {}
    for x in records:
        k = normalize(x.get("name") or x.get("slug"))
        elo = num(x.get("elo"))
        if not k or elo is None:
            continue
        ci = num(x.get("ci_95")) or 0
        rec = {"k": k, "n": display_name(x.get("name")), "o": org_name((x.get("model_creator") or {}).get("name")),
               "s": round(elo, 1), "lo": round(elo - ci, 1), "hi": round(elo + ci, 1)}
        if k not in best or rec["s"] > best[k]["s"]:
            best[k] = rec
    return sorted(best.values(), key=lambda r: -r["s"])


def fetch_aa(prev=None):
    records, page = [], 1
    while page <= 10:
        j = aa_get(AA_LLM.format(page))
        records += j.get("data") or []
        if not (j.get("pagination") or {}).get("has_more"):
            break
        page += 1
    llm = parse_aa_llm(records)
    if len([m for m in llm if m["iq"] is not None]) < 25:
        raise ValueError(f"AA list looks incomplete ({len(llm)} models)")
    sec = {"llm": llm, "image": [], "image_ok": True}
    try:
        img = aa_get(AA_IMG)
        sec["image"] = parse_aa_image(img.get("data") if isinstance(img, dict) else img)
        if len(sec["image"]) < 10:
            raise ValueError("AA image list too short")
    except Exception as e:
        log(f"aa image: {scrub(e)}")
        sec["image"] = (prev or {}).get("image") or []
        sec["image_ok"] = False
    return sec


# ======================================================================= LiveBench
LB_SITE = "https://livebench.ai/"
LB_DATA = "https://livebench.ai/data/{}/"
LB_FALLBACK_RELEASE = "20261025"
LB_WEIGHTS = {"long_agentic": 2.0, "coding": 1.5, "design": 1.5}   # overall weights published in categories.json


def livebench_release(prev):
    """Newest release id is listed in the site's JS bundle, e.g. Yt=["20261014","20261025"]."""
    try:
        page = get(LB_SITE, timeout=30).text
        # e.g. <script defer="defer" src="./static/js/main.1e1ce12d.js">  (also accepts "/static/..." or "static/...")
        m = re.search(r'src=["\']((?:\./|/)?static/js/main\.[^"\']+\.js)["\']', page)
        if m:
            js = get(urljoin(LB_SITE, m.group(1)), timeout=40).text
            lists = re.findall(r'\[((?:"20\d{6}",?\s*)+)\]', js)
            ids = sorted({i for l in lists for i in re.findall(r'"(20\d{6})"', l)})
            if ids:
                return ids[-1], True
    except Exception as e:
        log(f"livebench: release list failed: {e}")
    return ((prev or {}).get("release") or LB_FALLBACK_RELEASE), False


def parse_livebench(table_text, cats_json):
    """Return rows [{k, n, overall, cats:{cat: score}}]. Handles a table with category columns or task columns."""
    reader = csv.DictReader(io.StringIO(table_text))
    cols = [c for c in (reader.fieldnames or []) if c]
    name_col = next((c for c in cols if c.lower() in ("model", "model_name", "name")), cols[0] if cols else "model")
    cats, weights = {}, dict(LB_WEIGHTS)
    if isinstance(cats_json, dict):
        for cat, v in cats_json.items():
            if isinstance(v, list):
                cats[cat] = [t for t in v if isinstance(t, str)]
            elif isinstance(v, dict):
                tasks = v.get("tasks") or v.get("columns") or []
                cats[cat] = [t for t in tasks if isinstance(t, str)]
                if num(v.get("weight")) is not None:
                    weights[cat] = num(v.get("weight"))
    lower = {c.lower(): c for c in cols}
    rows = []
    for r in reader:
        name = r.get(name_col)
        k = normalize(name)
        if not k:
            continue
        sc = {}
        for cat, tasks in cats.items():
            if cat.lower() in lower:
                v = num(r.get(lower[cat.lower()]))
                if v is not None:
                    sc[cat] = v
                continue
            vals = [num(r.get(t)) for t in tasks if t in r]
            vals = [v for v in vals if v is not None]
            if vals:
                sc[cat] = sum(vals) / len(vals)
        if not cats:   # no categories file: treat every numeric column as a category
            for c in cols:
                if c != name_col and num(r.get(c)) is not None:
                    sc[c] = num(r.get(c))
        if not sc:
            continue
        ov = None
        for c in cols:
            if c.lower() in ("overall", "global average", "average", "livebench"):
                ov = num(r.get(c))
        if ov is None:
            w = sum(weights.get(c, 1.0) for c in sc)
            ov = sum(v * weights.get(c, 1.0) for c, v in sc.items()) / w
        rows.append({"k": k, "n": display_name(name), "overall": round(ov, 1),
                     "cats": {c.lower(): round(v, 1) for c, v in sc.items()}})
    best = {}
    for r in rows:
        if r["k"] not in best or r["overall"] > best[r["k"]]["overall"]:
            best[r["k"]] = r
    return sorted(best.values(), key=lambda r: -r["overall"])


def fetch_livebench(prev=None):
    rel, found = livebench_release(prev)
    base = LB_DATA.format(rel)
    table = get(base + "table.csv", timeout=40).text
    try:
        cats = get(base + "categories.json", timeout=40).json()
    except Exception:
        cats = {}
    rows = parse_livebench(table, cats)
    if len(rows) < 10:
        raise ValueError(f"LiveBench table looks too short ({len(rows)} rows)")
    d = f"{rel[:4]}-{rel[4:6]}-{rel[6:8]}"
    return {"release": rel, "date": d, "release_found": found, "rows": rows}


# ======================================================================= Epoch AI
EPOCH_ZIP = "https://epoch.ai/data/benchmark_data.zip"
EPOCH_PAGE = "https://epoch.ai/benchmarks"


def parse_epoch_csv(text):
    reader = csv.DictReader(io.StringIO(text))
    cols = {c.lower().strip(): c for c in (reader.fieldnames or []) if c}
    def col(*names):
        for n in names:
            if n in cols:
                return cols[n]
        return None
    c_model = col("model", "model version", "model_version", "name", "display name")
    c_eci, c_lo, c_hi = col("eci"), col("eci_ci_low", "ci_low"), col("eci_ci_high", "ci_high")
    c_date, c_org = col("date", "release date", "release_date"), col("organization", "org")
    if not (c_model and c_eci):
        raise ValueError("eci_scores.csv: columns not found")
    best = {}
    for r in reader:
        k = normalize(r.get(c_model))
        e = num(r.get(c_eci))
        if not k or e is None:
            continue
        lo, hi = num(r.get(c_lo)) if c_lo else None, num(r.get(c_hi)) if c_hi else None
        rec = {"k": k, "n": display_name(r.get(c_model)), "o": org_name(r.get(c_org)) if c_org else "",
               "s": round(e, 1), "lo": round(lo if lo is not None else e, 1), "hi": round(hi if hi is not None else e, 1),
               "rel": (r.get(c_date) or "")[:10] if c_date else ""}
        if k not in best or rec["s"] > best[k]["s"]:
            best[k] = rec
    return sorted(best.values(), key=lambda r: -r["s"])


def fetch_epoch(prev=None):
    z = zipfile.ZipFile(io.BytesIO(get(EPOCH_ZIP, timeout=120).content))
    name = next((n for n in z.namelist() if n.endswith("eci_scores.csv")), None)
    if not name:
        raise ValueError("eci_scores.csv not in the zip")
    rows = parse_epoch_csv(z.read(name).decode("utf-8", "replace"))
    if len(rows) < 20:
        raise ValueError(f"Epoch ECI looks too short ({len(rows)} rows)")
    return {"rows": rows}


# ======================================================================= OpenRouter
OR_URL = "https://openrouter.ai/api/v1/models"
BIG = {"openai", "anthropic", "google", "x-ai", "meta", "meta-llama", "deepseek", "mistralai", "qwen", "moonshotai",
       "nvidia", "minimax", "z-ai", "amazon", "microsoft", "cohere", "stepfun", "baidu", "bytedance", "bytedance-seed",
       "tencent", "liquid", "inception", "perplexity", "ibm-granite", "allenai", "xiaomi", "inclusionai"}


def parse_openrouter(data):
    out = []
    for m in data:
        mid = m.get("id", "")
        if ":" in mid or mid.startswith("~") or "/" not in mid:
            continue
        lab = mid.split("/")[0]
        if lab not in BIG or not m.get("created"):
            continue
        dt = datetime.fromtimestamp(m["created"], timezone.utc)
        if dt < NOW - timedelta(days=400):
            continue
        p = m.get("pricing") or {}
        def per_m(v):
            v = num(v)
            return None if v is None or v < 0 else round(v * 1e6, 4)
        name = m.get("name") or mid
        mods = (m.get("architecture") or {}).get("output_modalities")
        out.append({"id": mid, "k": normalize(mid), "n": display_name(name), "o": org_name(lab), "d": dt.date().isoformat(),
                    "pin": per_m(p.get("prompt")), "pout": per_m(p.get("completion")),
                    "mods": [str(x) for x in mods] if isinstance(mods, list) else None,
                    "u": "https://openrouter.ai/" + mid})
    out.sort(key=lambda r: r["d"], reverse=True)
    return out


def fetch_openrouter(prev=None):
    models = parse_openrouter(get(OR_URL, timeout=40).json().get("data") or [])
    if len(models) < 20:
        raise ValueError(f"OpenRouter list looks too short ({len(models)})")
    return {"models": models}


# ======================================================================= consumer app prices
# Each app has one or more official sources, tried in order:
#   web       the company's own pricing page
#   appstore  the company's own Apple App Store listing (US). Its "In-App Purchases" list has plan names + US prices.
#             Used for ChatGPT and Perplexity (their web pages block servers) and as Grok's backup.
#   lookup    Apple's public lookup API (JSON). Used to confirm Meta AI is free (it has no paid plan).
# Every page is fetched politely: a User-Agent that names this project, a short pause between pages, and up to 3 tries
# (waiting 4 s, then 10 s). A plan's price is only replaced when the regex finds a number close to the last good value
# (between a third and 3x); otherwise the last good value and the date it was last checked stay.
# A price whose last check is more than 30 days old is marked "stale" in the app and in the workflow log.
PROJECT_URL = "https://github.com/" + (os.environ.get("GITHUB_REPOSITORY") or "")
POLITE_UA = {"User-Agent": f"Mozilla/5.0 (compatible; ai-tracker/5; +{PROJECT_URL})"}
PRICE_PAUSE = 2                 # seconds between price pages
PRICE_RETRY_WAITS = (4, 10)     # 3 tries in all
STALE_DAYS = 30
SEED_CHECKED = "2026-11-01"
PRICES_CFG = 5                  # bump when the plan list changes, so old saved values aren't mixed in
APPSTORE = "https://apps.apple.com/us/app/"
LOOKUP = "https://itunes.apple.com/lookup?id={}&country=us"
P = r"\$\s?(\d[\d,]*(?:\.\d\d)?)"   # a dollar price
sleep = time.sleep              # kept as a name so tests can skip the waits

PRICE_APPS = [
    {"app": "ChatGPT", "maker": "OpenAI", "free": True, "sources": [
        {"kind": "appstore", "label": "App Store price (US)", "url": APPSTORE + "chatgpt/id6448311069", "seller": r"OpenAI",
         "plans": [("Go", 8, "ChatGPT Go"), ("Plus", 19.99, "ChatGPT Plus"), ("Pro 100", 100, "ChatGPT Pro 100"),
                   ("Pro 200", 200, "ChatGPT Pro 200")]}]},
    {"app": "Claude", "maker": "Anthropic", "free": True, "sources": [
        {"kind": "web", "label": "Pricing page", "url": "https://claude.com/pricing",
         "plans": [("Pro", 20, r"\$\s?(\d+(?:\.\d\d)?)\s*if billed monthly"), ("Max", 100, r"\bMax\b.{0,80}?" + P + r"\s*Per month"),
                   ("Ultra", 200, r"\bUltra\b.{0,80}?" + P + r"\s*Per month")]}]},
    {"app": "Gemini", "maker": "Google", "free": True, "sources": [
        {"kind": "web", "label": "Pricing page", "url": "https://gemini.google/subscriptions/",
         "plans": [("Google AI Plus", 4.99, r"Google AI Plus.{0,300}?" + P + r"\s*/\s*month"),
                   ("Google AI Pro", 19.99, r"Google AI Pro.{0,300}?" + P + r"\s*/\s*month"),
                   ("Google AI Ultra", 99.99, r"Starting at:?\s*" + P)],
         "notes": {"Google AI Ultra": "from; $99.99 or $199.99"}}]},
    {"app": "Grok", "maker": "xAI", "free": True, "sources": [
        # "Premium Most popular $30 /month": allow a short badge between the plan name and its price
        {"kind": "web", "label": "Pricing page", "url": "https://x.ai/pricing",
         "plans": [("Plus", 8, r"\bPlus\b[^$]{0,25}" + P + r"\s*/\s*month"), ("Premium", 30, r"\bPremium\b[^$]{0,25}" + P + r"\s*/\s*month"),
                   ("Super", 100, r"\bSuper\b[^$]{0,25}" + P + r"\s*/\s*month"), ("Ultra", 200, r"\bUltra\b[^$]{0,25}" + P + r"\s*/\s*month")]},
        {"kind": "appstore", "label": "App Store price (US)", "url": APPSTORE + "grok/id6670324846", "seller": r"X Corp",
         "plans": [("SuperGrok Lite", 10, "SuperGrok Lite"), ("SuperGrok", 30, "SuperGrok"), ("SuperGrok Plus", 100, "SuperGrok Plus"),
                   ("SuperGrok Heavy", 300, "SuperGrok Heavy")]}]},
    {"app": "Le Chat", "maker": "Mistral", "free": True, "sources": [
        {"kind": "web", "label": "Pricing page", "url": "https://mistral.ai/pricing",
         "plans": [("Pro", 14.99, r"\bPro\b.{0,200}?" + P + r"\s*/\s*mo\b"), ("Team", 24.99, P + r"\s*/\s*user\s*/\s*mo")],
         "notes": {"Team": "per user"}}]},
    {"app": "DeepSeek", "maker": "DeepSeek", "free": True, "note": "The app is free. No paid consumer plan.", "sources": [
        {"kind": "web", "label": "Official site", "url": "https://www.deepseek.com/en/", "plans": []}]},
    {"app": "Meta AI", "maker": "Meta", "free": True, "note": "Free. No paid plan.", "sources": [
        {"kind": "lookup", "label": "App Store listing (US)", "url": LOOKUP.format(1558240027), "id": 1558240027,
         "page": APPSTORE + "meta-ai/id1558240027", "seller": r"Meta Platforms", "plans": []}]},
    {"app": "Perplexity", "maker": "Perplexity", "free": True, "sources": [
        {"kind": "appstore", "label": "App Store price (US)", "url": APPSTORE + "perplexity-ask-anything/id1668000334", "seller": r"Perplexity AI",
         "plans": [("Pro", 20, "Perplexity Pro"), ("Max", 200, "Perplexity Max")]}]},
    {"app": "Copilot", "maker": "Microsoft", "free": True, "sources": [
        {"kind": "web", "label": "Pricing page", "url": "https://www.microsoft.com/en-us/microsoft-copilot/for-individuals",
         "plans": [("Microsoft 365 Personal", 9.99, r"Microsoft 365 Personal.{0,300}?\$\s?(\d+\.\d\d)"),
                   ("Microsoft 365 Premium", 19.99, r"Microsoft 365 Premium.{0,300}?\$\s?(\d+\.\d\d)")]}]},
]


MAX_PAGE = 2_500_000          # characters; bigger pages are cut (keeps every regex bounded)
OPEN_BLOCK = re.compile(r"<(script|style|noscript|svg)\b", re.I)
TAG_RE = re.compile(r"<[^<>]{0,3000}>")


def strip_blocks(raw):
    """Remove <script>/<style>/<noscript>/<svg> blocks with plain string scanning (linear, no backtracking)."""
    raw = raw[:MAX_PAGE]
    low = raw.lower()
    out, i = [], 0
    for m in OPEN_BLOCK.finditer(low):
        if m.start() < i:
            continue                              # inside a block we already removed
        out.append(raw[i:m.start()])
        end = low.find("</" + m.group(1), m.end())
        if end < 0:
            i = len(raw)                          # unclosed block: drop the rest
            break
        close = low.find(">", end)
        i = len(raw) if close < 0 else close + 1
    out.append(raw[i:])
    return " ".join(out)


def page_text(raw):
    t = TAG_RE.sub(" ", strip_blocks(raw))
    t = html.unescape(t).replace("‑", "-").replace(" ", " ")     # non-breaking hyphen/space
    return " ".join(t.split())


def appstore_iap(text):
    """The 'In-App Purchases' list of an App Store page (plan names + US prices), or '' if there is none."""
    i = text.find("In-App Purchases Yes")
    if i < 0:
        return ""
    s = text[i:i + 4000]
    end = min([j for j in (s.find("Learn More"), s.find("Copyright")) if j > 0] or [len(s)])
    return s[:end]


def appstore_price(iap, label):
    """FIRST '<label> $x.xx' in the list (later duplicates are yearly items). '<label> Lite $10' doesn't match '<label>'."""
    m = re.search(r"(?<![\w])" + re.escape(label) + r"\s+\$(\d[\d,]*\.\d\d)", iap)
    return num(m.group(1).replace(",", "")) if m else None


def polite_get(url):
    """Up to 3 tries, waiting 4 s then 10 s. Raises the last error."""
    err = None
    for i in range(len(PRICE_RETRY_WAITS) + 1):
        if i:
            log(f"prices: retry {i} for {url} in {PRICE_RETRY_WAITS[i - 1]}s ({err})")
            sleep(PRICE_RETRY_WAITS[i - 1])
        try:
            return get(url, timeout=30, headers=POLITE_UA)
        except Exception as e:
            err = e
    raise err


def sane(v, old):
    if v is None or v <= 0 or v > 1000:
        return None
    if old and not (old / 3 <= v <= old * 3):
        return None
    return v


def read_source(src, old_plans):
    """Read one source. Returns (plans, ok, err). ok = the page was read and is the right listing."""
    resp = polite_get(src["url"])
    if src["kind"] == "lookup":
        res = [r for r in (resp.json().get("results") or []) if str(r.get("trackId")) == str(src["id"])]
        if not res or not re.search(src["seller"], res[0].get("sellerName") or ""):
            return [], False, "listing not found or wrong seller"
        if (res[0].get("formattedPrice") or "").lower() != "free":
            return [], False, "app is no longer free"
        return [], True, ""
    text = page_text(resp.text)
    if len(text) < 200:
        return [], False, "page was empty"
    if src["kind"] == "appstore":
        if not re.search(r"Seller\s+" + src["seller"], text):
            return [], False, "not the company's own App Store listing"
        iap = appstore_iap(text)
        if not iap:
            return [], False, "no In-App Purchases list on the page"
    plans, found = [], 0
    for name, seed, pat in src["plans"]:
        op = old_plans.get(name) or {"usd_month": seed, "checked": SEED_CHECKED}
        if src["kind"] == "appstore":
            v = sane(appstore_price(iap, pat), op.get("usd_month"))
        else:
            m = re.search(pat, text, flags=re.I | re.S)
            v = sane(num(m.group(1).replace(",", "")) if m else None, op.get("usd_month"))
        if v is not None:
            found += 1
        p = {"name": name, "usd_month": v if v is not None else op.get("usd_month"),
             "checked": TODAY if v is not None else op.get("checked", SEED_CHECKED)}
        if (src.get("notes") or {}).get(name):
            p["note"] = src["notes"][name]
        plans.append(p)
    if src["plans"] and not found:
        return plans, False, "no prices found on the page"
    return plans, True, ""


def seed_record(cfg):
    src = cfg["sources"][0]
    plans = [{"name": n, "usd_month": s, "checked": SEED_CHECKED} for n, s, _ in src["plans"]]
    for p in plans:
        if (src.get("notes") or {}).get(p["name"]):
            p["note"] = src["notes"][p["name"]]
    return {"plans": plans, "src": {"kind": src["kind"], "label": src["label"], "url": src.get("page") or src["url"]},
            "checked": SEED_CHECKED}


def days_old(d):
    try:
        return (NOW.date() - datetime.fromisoformat(d[:10]).date()).days
    except Exception:
        return 9999


def fetch_prices(prev=None):
    """Always returns every app. An app that can't be read today keeps its last good plans, source and date."""
    old_apps = {a["app"]: a for a in ((prev or {}).get("apps") or []) if a.get("cfg") == PRICES_CFG}
    apps, read_ok, first = [], 0, True
    for cfg in PRICE_APPS:
        old = old_apps.get(cfg["app"])
        base = old or seed_record(cfg)
        tried, used = [], None
        for src in cfg["sources"]:
            if not first:
                sleep(PRICE_PAUSE)
            first = False
            same_src = base["src"]["url"] in (src["url"], src.get("page"))
            old_plans = {p["name"]: p for p in base["plans"]} if same_src else {}
            try:
                plans, ok, err = read_source(src, old_plans)
            except Exception as e:
                plans, ok, err = [], False, str(e)[:160]
            tried.append({"label": src["label"], "url": src.get("page") or src["url"], "ok": ok, "err": err})
            if ok:
                used = (src, plans)
                break
            log(f"prices: {cfg['app']} {src['label']} not read: {err}")
        if used:
            src, plans = used
            rec = {"plans": plans, "src": {"kind": src["kind"], "label": src["label"], "url": src.get("page") or src["url"]}}
            all_read = all(p["checked"] == TODAY for p in plans)
            rec["checked"] = TODAY if all_read else min(p["checked"] for p in plans)
            read_ok += 1
        else:
            rec = {"plans": base["plans"], "src": base["src"], "checked": base["checked"]}
            all_read = False
        age = days_old(rec["checked"])
        for p in rec["plans"]:
            p["stale"] = days_old(p["checked"]) > STALE_DAYS
        apps.append({"app": cfg["app"], "maker": cfg["maker"], "free": cfg["free"], "note": cfg.get("note", ""), "cfg": PRICES_CFG,
                     "plans": rec["plans"], "src": rec["src"], "page": rec["src"]["url"], "checked": rec["checked"],
                     "read_ok": bool(used) and all_read, "readToday": bool(used), "tried": tried,
                     "stale": age > STALE_DAYS, "ageDays": age})
    return {"apps": apps, "pages_read": read_ok, "apps_total": len(PRICE_APPS)}


def stale_prices(prices):
    out = []
    for a in (prices or {}).get("apps") or []:
        for p in a.get("plans") or []:
            if p.get("stale"):
                out.append({"app": a["app"], "plan": p["name"], "usd_month": p["usd_month"], "checked": p["checked"]})
        if not a.get("plans") and a.get("stale"):
            out.append({"app": a["app"], "plan": "", "usd_month": None, "checked": a["checked"]})
    return out


# ======================================================================= news (same feeds as before)
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
    s = TAG_RE.sub(" ", html.unescape((s or "")[:20000]))
    s = " ".join(s.split())
    return (s[: n - 1] + "…") if len(s) > n else s


def parse_feed(content, name, kind, per_feed=15):
    root = ET.fromstring(content)
    items = []
    for el in root.iter():
        if _local(el.tag) not in ("item", "entry"):
            continue
        title = link = date = desc = None
        for c in el:
            t = _local(c.tag)
            if t == "title" and c.text:
                title = " ".join(html.unescape(c.text).split())
            elif t == "link":
                link = c.get("href") or (c.text or "").strip() or link
            elif t in ("pubDate", "published", "updated", "date") and not date:
                date = _date(c.text)
            elif t in ("description", "summary") and not desc:
                desc = _clean(c.text)
        if not (title and link and link.startswith("http") and date):
            continue
        if PROMO.search(title) or date > NOW + timedelta(hours=6) or date < NOW - timedelta(days=30):
            continue
        items.append({"t": title, "u": link, "s": name, "k": kind, "d": date.isoformat(timespec="seconds"), "x": desc or ""})
        if len(items) >= per_feed:
            break
    return items


def fetch_news(prev=None):
    items, ok, status = [], 0, []
    for name, url, kind in FEEDS:
        try:
            got = parse_feed(get(url, timeout=20).content, name, kind)
            items += got
            ok += 1
            status.append([name, "ok", len(got)])
        except Exception as e:
            status.append([name, "failed", str(e)[:120]])
            log(f"news: {name} failed: {e}")
    if ok < 3:
        raise ValueError(f"only {ok} news feeds answered")
    items.sort(key=lambda x: x["d"], reverse=True)
    if len(items) < 8:
        raise ValueError(f"only {len(items)} news items")
    return {"items": items[:120], "feeds": status}


# ======================================================================= official release pages (company sources)
# New models straight from each company. Every page is read on its own; a page that fails keeps its last good copy.
#   rss      an RSS feed
#   html     a news/blog page: each link with a headline + the date next to it
#            (date_mode says where the date sits: "inside" the link, just "before" it, or just "after" it)
#   deepseek DeepSeek's API change log: "Date: YYYY-MM-DD" headings followed by "<Model> Release/Update" headings
OFFICIAL = [  # (id, company, label shown in the app, url, kind, date_mode)
    ("openai", "OpenAI", "OpenAI News", "https://openai.com/news/rss.xml", "rss", None),
    ("deepmind", "Google", "Google DeepMind blog", "https://deepmind.google/blog/rss.xml", "rss", None),
    ("google", "Google", "Google AI blog", "https://blog.google/technology/ai/rss/", "rss", None),
    ("mistral", "Mistral", "Mistral news", "https://mistral.ai/news/rss", "rss", None),
    ("anthropic", "Anthropic", "Anthropic news", "https://www.anthropic.com/news", "html", "before"),
    ("xai", "xAI", "xAI news", "https://x.ai/news", "html", "inside"),
    ("meta", "Meta", "Meta AI blog", "https://ai.meta.com/blog/", "html", "after"),
    ("deepseek", "DeepSeek", "DeepSeek API change log", "https://api-docs.deepseek.com/updates/", "deepseek", None),
]
OFFICIAL_DAYS = 120             # posts older than this are not kept
MON3 = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
DATE_RE = re.compile(r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|"
                     r"Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),\s+(20\d\d)\b")


def _iso(m):
    return f"{int(m.group(3)):04d}-{MON3[m.group(1)[:3].lower()]:02d}-{int(m.group(2)):02d}"


def _txt(s):
    return " ".join(html.unescape(TAG_RE.sub(" ", s[:5000])).split())


def _element_blocks(h, open_re, close_tag, window):
    """(start, end, inner) for each opening tag matched by open_re, closed by close_tag within `window` characters."""
    low = h.lower()
    for m in open_re.finditer(h):
        end = low.find(close_tag, m.end(), m.end() + window)
        if end >= 0:
            yield m, end + len(close_tag), h[m.end():end]


A_OPEN = re.compile(r"<a\b[^<>]{0,1500}>", re.I)
HREF_RE = re.compile(r'href="([^"#]{1,600})"', re.I)
H_OPEN = re.compile(r"<h[1-4]\b[^<>]{0,800}>", re.I)


def parse_rss_posts(raw):
    out = []
    for el in ET.fromstring(raw).iter():
        if _local(el.tag) not in ("item", "entry"):
            continue
        t = u = d = None
        for c in el:
            k = _local(c.tag)
            if k == "title" and c.text:
                t = " ".join(html.unescape(c.text).split())
            elif k == "link":
                u = c.get("href") or (c.text or "").strip() or u
            elif k in ("pubDate", "published", "updated", "date") and not d:
                dt = _date(c.text)
                d = dt.date().isoformat() if dt else None
        if t and u and d:
            out.append({"t": t, "u": u, "d": d})
    return out


def parse_html_posts(raw, base, date_mode="inside"):
    import bisect
    h = strip_blocks(raw)
    dates = [(m.start(), _iso(m)) for m in DATE_RE.finditer(h)]
    pos = [p for p, _ in dates]
    best = {}
    for a, a_end, inner in _element_blocks(h, A_OPEN, "</a>", 6000):
        hr = HREF_RE.search(a.group(0))
        if not hr:
            continue
        href = hr.group(1)
        hm = next(_element_blocks(inner, H_OPEN, "</h", 2000), None)
        title = _txt(hm[2] if hm else inner)
        if not hm:
            title = DATE_RE.sub("", title).strip()
        words = len(title.split())
        if words < 1 or words > 20 or len(title) < 4:
            continue
        lo = bisect.bisect_left(pos, a.start() - 900)
        hi = bisect.bisect_right(pos, a_end + 900)
        inside, before, after = [], [], []
        for p, d in dates[lo:hi]:
            if a.start() <= p <= a_end:
                inside.append(d)
            elif p < a.start():
                before.append((a.start() - p, d))
            else:
                after.append((p - a_end, d))
        # (distance, date): a date inside the link is best; the side the page normally uses comes next;
        # the other side only counts when nothing else is near (+300 penalty)
        cands = [(0, d) for d in inside[:1]]
        cands += [(dist + (0 if date_mode == "before" else 300), d) for dist, d in before]
        cands += [(dist + (0 if date_mode == "after" else 300), d) for dist, d in after]
        if not cands:
            continue
        near = min(cands)
        url = urljoin(base, html.unescape(href))
        score = (1 if hm else 0, words)          # prefer the link that holds a headline, then the longer text
        cur = best.get(url)
        if cur is None:
            best[url] = cur = {"score": score, "t": title, "near": near}
        else:
            if score > cur["score"]:
                cur.update(score=score, t=title)
            cur["near"] = min(cur["near"], near)   # a post is often linked several times: the closest date wins
    return [{"t": v["t"], "u": url, "d": v["near"][1]} for url, v in best.items()]


HASH_LINK = re.compile(r'<a\b[^<>]{0,500}class="hash-link"[^<>]{0,500}>[^<]{0,50}</a>', re.I)
H23_OPEN = re.compile(r"<h([23])\b[^<>]{0,800}>", re.I)


def parse_deepseek_log(raw, base):
    out, date = [], None
    h = strip_blocks(raw)
    for m, _, inner in _element_blocks(h, H23_OPEN, "</h", 3000):
        t = _txt(HASH_LINK.sub("", inner)).strip("\u200b ").strip()
        dm = re.match(r"Date:\s*(20\d\d-\d\d-\d\d)", t)
        if dm:
            date = dm.group(1)
            continue
        if date and m.group(1) == "3" and len(t) < 120:
            anchor = re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")
            out.append({"t": t, "u": base + "#" + anchor, "d": date})
    return out


def fetch_official(prev=None):
    old = (prev or {}).get("sources") or {}
    srcs, ok = {}, 0
    cut = (NOW - timedelta(days=OFFICIAL_DAYS)).date().isoformat()
    for sid, company, label, url, kind, mode in OFFICIAL:
        try:
            raw = polite_get(url).content   # Tab fix: polite UA + retries (ai.meta.com answers 400 to the browser UA)
            if kind == "rss":
                posts = parse_rss_posts(raw)
            elif kind == "html":
                posts = parse_html_posts(raw.decode("utf-8", "replace"), url, mode or "inside")
            else:
                posts = parse_deepseek_log(raw.decode("utf-8", "replace"), url)
            posts = [p for p in posts if cut <= p["d"] <= TODAY]
            if not posts:
                raise ValueError("no dated posts found on the page")
            posts.sort(key=lambda p: p["d"], reverse=True)
            srcs[sid] = {"ok": True, "updated": NOW_ISO, "posts": posts[:400]}   # 120 days of even a busy blog
            ok += 1
        except Exception as e:
            log(f"official: {label} failed: {e}")
            keep = old.get(sid)
            srcs[sid] = dict(keep, ok=False, err=str(e)[:160]) if keep else {"ok": False, "updated": None, "posts": [], "err": str(e)[:160]}
        srcs[sid].update({"company": company, "label": label, "url": url})
    if not ok and not any(s.get("posts") for s in srcs.values()):
        raise ValueError("no official release page could be read")
    return {"sources": srcs}


# A post is a model release when its title starts with a known model family + a version number
# ("Gemini 4 Carbon: Our next frontier model", "Voxtral 3") or with "Introducing <family name>" ("Introducing Timestral").
FAMILY = (r"(?:GPT|o\d+|Sora|Codex|Claude|Opus|Sonnet|Haiku|Gemini|Gemma|Genie|Veo|Imagen|Lyria|Nano Banana|Grok|Imagine|Llama|Muse|"
          r"Mistral|Magistral|Devstral|Codestral|Voxtral|Ministral|Pixtral|DeepSeek|Qwen|Kimi|GLM|MiniMax|Nemotron|Phi|Command|Aya)")
FAM_RE = re.compile(r"^(?:\w*(?:Gemma|stral)\b|" + FAMILY + r"\b)", re.I)
VERSION_RE = re.compile(r"(?<![A-Za-z])v?\d+(?:\.\d+)*\b")
LEAD_RE = re.compile(r"^(?:Introducing|Announcing|Meet|Say hello to|Welcome)\s+(?:the\s+)?", re.I)
NOT_RELEASE = re.compile(r"\b(responsibl\w*|safe(?:ly|ty)|for Robotics|customers?|helps?|uses|using|how|why|partner\w*|says|"
                         r"bringing|everywhere|bounty|challenge|grants?|hackathon|system card|Bot|Business|Enterprise|add-?ins?)\b|"
                         r"\b(?:on|in) (?:API|Microsoft|Amazon|GitHub|Google Workspace|Gemini Enterprise|Databricks|Excel|Outlook)\b", re.I)
SENTENCE_RE = re.compile(r"\b(is|are|was|were|has|have|will|can|lets|gets)\b", re.I)


def release_names(title):
    """Model names a post title announces, or [] when the post isn't a model release."""
    t = " ".join(str(title or "").split()).rstrip(".")
    lead = bool(LEAD_RE.match(t))
    core = re.split(r"\s*[:—–|]\s+|,\s+", LEAD_RE.sub("", t), maxsplit=1)[0].strip()
    core = re.sub(r"\s+(Release|Update|Launch)$", "", core, flags=re.I)
    if not core or NOT_RELEASE.search(t) or SENTENCE_RE.search(core) or len(core.split()) > 8:
        return []
    core = re.split(r"\s+with\s+", core, maxsplit=1)[0]                         # "... with References": a feature
    if not FAM_RE.match(core) or not (VERSION_RE.search(core) or lead):
        return []
    if not VERSION_RE.search(core) and re.search(r"\bfor\b", core, re.I):
        return []                                                                # "Grok for Outlook": an app add-in
    parts = [p.strip() for p in re.split(r"\s+and\s+|\s*&\s*", core) if p.strip()]
    first = parts[0]
    fam_prefix = re.split(r"\s(?=v?\d)", first, maxsplit=1)[0]                 # "Gemini 3.8 Flash" -> "Gemini"
    vm = re.match(r"^(.*?\d[\w.\-]*)", first)
    ver_prefix = vm.group(1) if vm else ""                                       # "GPT-6 Sol" -> "GPT-6"
    names = [first]
    for p in parts[1:]:
        if re.match(r"^v?\d", p):
            names.append(fam_prefix + " " + p)                                   # "... and 3.8 Flash Cyber"
        elif FAM_RE.match(p) and (VERSION_RE.search(p) or lead):
            names.append(p)                                                      # "Muse Image and Muse Video"
        elif ver_prefix and re.fullmatch(r"[A-Z][\w\-]*", p):
            names.append(ver_prefix + " " + p)                                   # "GPT-6 Sol and Luna"
        else:
            break
    return names


def rel_key(name):
    """Key for 'same release': keeps version and date suffixes ('DeepSeek V4.1 Flash 1017' != 'DeepSeek V4.1 Flash')."""
    s = str(name or "")
    if ": " in s and len(s.split(": ", 1)[0].split()) <= 2:
        s = s.split(": ", 1)[1]
    s = re.sub(r"\(.*?\)", "", s)
    return re.sub(r"[^a-z0-9]", "", s.lower())


def official_posts(raw):
    """Every kept post from every official page, with its company and page label."""
    out = []
    for sid, s in ((raw.get("official") or {}).get("sources") or {}).items():
        for p in s.get("posts") or []:
            out.append(dict(p, o=s.get("company", ""), s=s.get("label", ""), sid=sid))
    return out


def official_releases(raw):
    rel = {}
    for p in official_posts(raw):
        for n in release_names(p["t"]):
            k = rel_key(n)
            cur = rel.get(k)
            if cur is None or p["d"] < cur["d"]:          # first announcement wins
                rel[k] = {"n": n, "o": p["o"], "d": p["d"], "u": p["u"], "src": p["s"], "post": p["t"]}
    return list(rel.values())


# ======================================================================= big news (rule scoring, no AI)
# Only: new model launches, big price changes for AI apps/models, major product launches or shutdowns by AI labs,
# big funding rounds (about $1B or more), acquisitions of or by AI labs, IPO filings.
# Dropped first: opinion/interviews, lawsuits/regulation, rumors, partnerships, money/economy talk, safety essays,
# customer stories, how-tos. Posts from the official release pages feed in too (as "New model" when they announce one).
NEWS_DAYS = 30
LAB_RE = re.compile(r"\b(OpenAI|ChatGPT|Anthropic|Claude|Google|DeepMind|Gemini|Meta|xAI|Grok|Mistral|DeepSeek|Alibaba|Qwen|Moonshot|Kimi|"
                    r"Microsoft|Copilot|Amazon|Perplexity|Cohere|Zhipu|MiniMax|SpaceXAI)\b", re.I)
DROP_RULES = [
    ("opinion", re.compile(r"\b(says?|said|thinks?|warns?|argues?|wants?|calls? for|asks?|believes?|interview|opinion|op-ed|podcast|"
                           r"explains?|according to|sympathi\w+)\b|\?", re.I)),
    ("legal", re.compile(r"\b(lawsuits?|sues?|sued|judge|courts?|trial|regulat\w*|antitrust|legislat\w*|senate|congress|laws?|DOJ|FTC|"
                         r"bans?|banned|fined?)\b", re.I)),
    ("rumor", re.compile(r"\b(reportedly|report says|reports? that|sources|expected to|could|may|might|plans? to|in talks|considering|"
                         r"weighs|rumou?rs?|leak\w*)\b", re.I)),
    ("partnership", re.compile(r"\b(partner\w*|collaborat\w*|teams? up|alliance|joins forces|MOU)\b", re.I)),
    ("money talk", re.compile(r"\b(earnings|revenue|quarter\w*|stocks?|shares|economy|economic|GDP|market cap|spending)\b", re.I)),
    ("safety essay", re.compile(r"\b(safety|safely|responsib\w*|alignment|misalignment|our approach|principles|model spec|policy)\b", re.I)),
    ("customer story", re.compile(r"\b(helps?|uses|using|customers?|ROI|case study|achieves|powers?|powering)\b|\bhow \w+ (?:is|are)\b", re.I)),
    ("how-to", re.compile(r"\b(how to|tips|guide|newsletter|we tested|hands-on|reviews?|quiz|explained|what is|why)\b", re.I)),
]
LAUNCH_RE = re.compile(r"\b(launch(?:es|ed)?|releas(?:e|es|ed)|introduc(?:es|ed|ing)|unveil(?:s|ed)?|announc(?:es|ed)|debut(?:s|ed)?|"
                       r"rolls? out|now available|ships)\b", re.I)
MODEL_MENTION = re.compile(FAMILY + r"[\s\-]?[A-Za-z]?\d+(?:\.\d+)*", re.I)       # "GPT-6.1", "Kimi K3.1", "DeepSeek V4"
PRICE_RE = re.compile(r"\b(price[sd]?|pricing|costs?|subscriptions?|plans?|per month|a month)\b|\$\d", re.I)
PRICE_CHANGE = re.compile(r"\b(cuts?|lower(?:s|ed)?|raises?|raised|hikes?|hiked|increases?|increased|drops?|dropped|slash(?:es|ed)?|"
                          r"doubles?|halves|goes (?:up|down)|now costs|free for)\b", re.I)
SHUTDOWN_RE = re.compile(r"\b(shut(?:s|ting)? down|retir(?:es|ed|ing)|discontinu\w+|sunset\w*|deprecat\w+|kills?)\b", re.I)
FUNDING_RE = re.compile(r"\b(raises?|raised|funding|round|valuation)\b", re.I)
BIG_MONEY = re.compile(r"[\$€£]\s?(\d+(?:\.\d+)?)\s*(billion|bn|b|trillion|t)\b", re.I)
ACQUIRE_RE = re.compile(r"\b(acquir(?:es|ed|e|ing)|acquisition|buys|to buy|merg(?:er|es|ed))\b", re.I)
NOT_PRODUCT = re.compile(r"\b(mission|program(?:me)?|fund|initiative|foundation|office|team|academy|fellowship|council|institute|"
                         r"report|study|research|event|summit)\b", re.I)
IPO_RE = re.compile(r"\b(files?|filed|filing)\b.{0,40}\b(S-1|IPO|initial public offering)\b|\bgoes public\b|\bprices? (?:its )?IPO\b|"
                    r"\bbegins trading\b", re.I)


def classify_news(title, kind="news"):
    """Returns (tag, reason). tag '' = dropped; reason says which rule decided."""
    t = " ".join(str(title or "").split())
    official = kind in ("lab", "official")
    if official and release_names(t):
        return "New model", "official release post"
    for name, rx in DROP_RULES:
        if rx.search(t):
            return "", "dropped: " + name
    head = " ".join(t.split()[:4])
    if MODEL_MENTION.search(t) and LAUNCH_RE.search(t):
        return "New model", "model + launch word"
    m = BIG_MONEY.search(t)
    if m and FUNDING_RE.search(t):                 # checked before prices: "raises $30 billion" is funding
        amount = float(m.group(1)) * (1000 if m.group(2).lower() in ("trillion", "t") else 1)
        if amount >= 1:
            return "Funding", "funding of $1B or more"
    if FUNDING_RE.search(t) and re.search(r"[\$€£]\s?\d+(?:\.\d+)?\s*(?:million|m)\b", t, re.I):
        return "", "dropped: funding under $1B"
    if PRICE_RE.search(t) and PRICE_CHANGE.search(t) and (LAB_RE.search(head) or re.search(r"\bAPI\b", head)):
        return "Price change", "price change"
    if ACQUIRE_RE.search(t) and LAB_RE.search(t):
        return "Acquisition", "acquisition by/of an AI lab"
    if IPO_RE.search(t):
        return "IPO", "IPO filing"
    if LAB_RE.search(head) and (LAUNCH_RE.search(t) or SHUTDOWN_RE.search(t)) and not NOT_PRODUCT.search(t):
        return "Product", "AI lab product launch or shutdown"
    return "", "dropped: not a launch, price change, funding, acquisition or IPO"


def _words(t):
    return {w for w in re.findall(r"[a-z0-9]+", t.lower()) if len(w) > 2 and w not in {"the", "and", "for", "with", "its", "new", "has", "from"}}


def _names(t):
    """Model-like tokens (contain a digit, e.g. 'GPT-6.1') and capitalized names inside a headline."""
    words = re.findall(r"[A-Za-z][\w.\-]*", t)
    digits = {w.lower().strip(".-") for w in re.findall(r"\b[A-Za-z]*-?\d[\w.\-]*", t)}
    caps = {w.lower() for i, w in enumerate(words) if i > 0 and w[:1].isupper() and len(w) > 2}
    return digits, caps


MODEL_NAME_RE = re.compile(r"(?i:" + FAMILY + r")[\s\-]?[A-Za-z]?\d+(?:\.\d+)*(?:[ \-][A-Z][\w\-]*)?")


def _models(t):
    """'Gemini 4 Carbon' and 'Gemini 4 Argon' stay different; 'Genie 4 world model' and 'Genie 4: A new...' match."""
    return {re.sub(r"[^a-z0-9.]", "", m.group(0).lower()) for m in MODEL_NAME_RE.finditer(t)}


def same_story(a, b):
    if len(_words(a) & _words(b)) / max(1, len(_words(a) | _words(b))) >= 0.5:
        return True
    if _models(a) & _models(b):              # both about "Genie 4", "GPT-6.1 Terra", ...
        return True
    da, ca = _names(a)
    db, cb = _names(b)
    return bool(da & db) and bool((ca | da) & (cb | db) - (da & db))


SRC_RANK = {"official": 0, "lab": 1, "news": 2}


def big_news(items, official=None, limit=30):
    """items = news feed items {t,u,s,k,d}; official = official page posts {t,u,s,d}. Returns the kept list."""
    cut = (NOW - timedelta(days=NEWS_DAYS)).isoformat()
    pool = [dict(i) for i in items or []] + [dict(p, k="official", d=p["d"] + "T12:00:00+00:00") for p in official or []]
    kept = []
    for it in pool:
        if (it.get("d") or "") < cut[:10]:
            continue
        tag, why = classify_news(it["t"], it.get("k", "news"))
        if tag:
            kept.append(dict(it, tag=tag, why=why))
    kept.sort(key=lambda x: (SRC_RANK.get(x.get("k"), 3), x["d"]))      # official copy of a story first
    uniq = []
    for it in kept:
        if any(same_story(it["t"], k["t"]) for k in uniq):
            continue
        uniq.append(it)
    uniq.sort(key=lambda x: x["d"], reverse=True)
    return [{"t": k["t"], "u": k["u"], "s": k["s"], "d": k["d"], "tag": k["tag"], "x": k.get("x", ""), "official": k.get("k") == "official"}
            for k in uniq[:limit]]


def news_report(items, official=None):
    """(kept, dropped) titles with the rule that decided, for logs and tests."""
    kept, dropped = [], []
    for it in [dict(i) for i in items or []] + [dict(p, k="official") for p in official or []]:
        tag, why = classify_news(it["t"], it.get("k", "news"))
        (kept if tag else dropped).append((tag or why, it["t"]))
    return kept, dropped


# ======================================================================= Artificial Analysis switch
def aa_enabled():
    """AA is OFF unless AA_ENABLED is exactly "1" or "true" (any case). Default: off (public app)."""
    return (os.environ.get("AA_ENABLED") or "").strip().lower() in ("1", "true")


# ======================================================================= pick rule
# Text jobs use LMArena, LiveBench and Epoch AI, plus Artificial Analysis when it is switched on.
# Per source we take the matching board and its top 3.
#   Best         = in the top 3 of at least 3 sources: all 3 of 3 (AA off) or 3 of 4 (AA on).
#                  Pictures: 2 of 2 when AA is on. With AA off only LMArena covers pictures, so pictures are
#                  never called "best"; the app shows "Top on LMArena · 1 source only".
#   Tie          = two or more models pass, and their error bars overlap (LMArena / Epoch / AA image CIs).
#   Not sure yet = covered by fewer than 3 sources, or fewer than 5,000 votes on LMArena's TEXT OVERALL board
#                  (category boards always have few votes). Pictures use the text-to-image vote count.
#   No clear winner yet = nobody passes; the closest candidates are shown.
# Never a "best" from one source alone.
CC_BY = "https://creativecommons.org/licenses/by/4.0/"
SRC = {
    "lmarena": {"name": "LMArena", "credit": "LMArena (lmarena.ai)", "url": "https://lmarena.ai/leaderboard",
                "what": "People compare two anonymous answers and vote for the better one.",
                "license": "CC BY 4.0", "licenseUrl": CC_BY,
                "data": "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset"},
    "aa": {"name": "Artificial Analysis", "credit": "Artificial Analysis (artificialanalysis.ai)", "url": "https://artificialanalysis.ai/",
           "what": "Independent company that runs the same tests on every model, and measures prices.",
           "license": "Free API, attribution required. Private use only.", "licenseUrl": ""},
    "livebench": {"name": "LiveBench", "credit": "LiveBench (livebench.ai)", "url": "https://livebench.ai/",
                  "what": "New, hidden tasks every release, so models can't have seen the answers.", "license": "", "licenseUrl": ""},
    "epoch": {"name": "Epoch AI", "credit": "Epoch AI (epoch.ai)", "url": EPOCH_PAGE,
              "what": "Non-profit research group. Its Capabilities Index combines many benchmarks, with error bars.",
              "license": "CC BY 4.0", "licenseUrl": CC_BY, "data": EPOCH_ZIP},
    "openrouter": {"name": "OpenRouter", "credit": "OpenRouter (openrouter.ai)", "url": "https://openrouter.ai/models",
                   "what": "Developer prices per million tokens and the date each model became available.", "license": "Public API", "licenseUrl": ""},
    "official": {"name": "Official company pages", "credit": "Each company's own news page or blog", "url": "",
                 "what": "New model announcements from OpenAI, Google DeepMind, Google AI, Anthropic, Mistral, xAI, Meta and DeepSeek.",
                 "license": "", "licenseUrl": ""},
    "prices": {"name": "Official pricing pages", "credit": "Each company's pricing page or its own App Store listing", "url": "",
               "what": "Monthly plan prices for the apps, read every day from each company's own pricing page, or from the "
                       "company's own Apple App Store listing (US prices) when its web page blocks servers.", "license": "", "licenseUrl": ""},
    "news": {"name": "News feeds", "credit": "AI lab blogs and tech news sites", "url": "",
             "what": "Headlines from OpenAI, Google, DeepMind, NVIDIA, Hugging Face, TechCrunch, The Verge, Ars Technica, MIT Tech Review and Wired.",
             "license": "", "licenseUrl": ""},
}
NOT_SURE_VOTES = 5000

# "⚡ Fast" tag: a rough guide only. There is no allowed free source for measured speed right now, so a model is
# tagged when its NAME marks it as a small/fast tier. Whole words, any case ("Mini" matches "GPT-6 Mini", not "MiniMax").
# It is shown next to names (dev prices, releases, Best for what's See more) and never changes a pick.
FAST_WORDS = ("flash", "flash-lite", "lite", "mini", "nano", "haiku", "turbo", "instant", "small", "air", "bolt")
FAST_RE = re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(w) for w in sorted(FAST_WORDS, key=len, reverse=True)) + r")(?![a-z0-9])", re.I)
FAST_NOTE = "Fast = guessed from the model's name (Flash, Mini, Haiku…), not a speed test. Text models only."
# Fast is only for TEXT models. OpenRouter says what a model outputs ("output_modalities"): text models are exactly
# ["text"]; e.g. Nano Banana is ["image", "text"]. For models not on OpenRouter, these name words rule it out:
NOT_TEXT_WORDS = ("image", "images", "banana", "imagen", "imagine", "veo", "sora", "video", "voice", "audio", "tts", "speech",
                  "music", "lyria", "embed", "embedding", "transcribe", "transcription", "genie", "world model")
NOT_TEXT_RE = re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(w) for w in sorted(NOT_TEXT_WORDS, key=len, reverse=True)) +
                         r")(?![a-z0-9])|embedding\w*", re.I)


def is_fast(name, mods=None):
    """Label only, never changes a pick. mods = OpenRouter output_modalities when known."""
    if mods is not None and list(mods) != ["text"]:
        return False
    n = str(name or "")
    if NOT_TEXT_RE.search(n):
        return False
    return bool(FAST_RE.search(n))


def mods_index(raw):
    """Output modalities per model id and per release name, from OpenRouter."""
    by_k, by_rel = {}, {}
    for m in (raw.get("openrouter") or {}).get("models") or []:
        if m.get("mods") is not None:
            by_k.setdefault(m["k"], m["mods"])
            by_rel.setdefault(rel_key(m["n"]), m["mods"])
    return by_k, by_rel


def board_lm(raw, bid):
    b = ((raw.get("lmarena") or {}).get("boards") or {}).get(bid)
    if not b or not b.get("rows"):
        return None
    return {"src": "lmarena", "board": b["label"], "date": b.get("date"), "url": b.get("url"),
            "rows": [dict(r) for r in b["rows"]], "ci": True, "votes": True}


def board_aa(raw, field, label):
    aa = raw.get("aa") or {}
    ms = [m for m in aa.get("llm") or [] if m.get(field) is not None]
    if not ms:
        return None
    ms = sorted(ms, key=lambda m: -m[field])
    upd = (aa.get("_updated") or "")[:10]
    return {"src": "aa", "board": label, "date": upd, "url": AA_PAGE,
            "rows": [{"k": m["k"], "n": m["n"], "o": m["o"], "s": m[field]} for m in ms]}


def board_aa_image(raw):
    aa = raw.get("aa") or {}
    if not aa.get("image"):
        return None
    return {"src": "aa", "board": "Text-to-image arena", "date": (aa.get("_updated") or "")[:10], "url": AA_IMG_PAGE,
            "rows": [dict(r) for r in aa["image"]], "ci": True}


def board_lb(raw, cat, label):
    lb = raw.get("livebench") or {}
    rows = lb.get("rows") or []
    if not rows:
        return None
    if cat == "overall":
        rs = [{"k": r["k"], "n": r["n"], "s": r["overall"]} for r in rows]
    else:
        rs = [{"k": r["k"], "n": r["n"], "s": r["cats"][cat]} for r in rows if r.get("cats", {}).get(cat) is not None]
    if not rs:
        return None
    rs.sort(key=lambda r: -r["s"])
    return {"src": "livebench", "board": label, "date": lb.get("date"), "url": LB_SITE, "rows": rs}


def lb_cat(raw, *wanted):
    """First LiveBench category whose name contains one of the words, e.g. 'language' for writing."""
    cats = set()
    for r in (raw.get("livebench") or {}).get("rows") or []:
        cats |= set((r.get("cats") or {}).keys())
    for w in wanted:
        for c in sorted(cats):
            if w in c:
                return c
    return None


def board_epoch(raw):
    ep = raw.get("epoch") or {}
    if not ep.get("rows"):
        return None
    return {"src": "epoch", "board": "Capabilities Index (general skill)", "date": (ep.get("_updated") or "")[:10],
            "url": EPOCH_PAGE, "rows": [dict(r) for r in ep["rows"]], "ci": True}


def job_boards(raw, job):
    """Which board each source contributes for each job (AA boards are None when AA is off).
    Documented in the app's See more too."""
    aa_code = board_aa(raw, "code", "Coding Index")
    if aa_code and len(aa_code["rows"]) < 10:
        aa_code = None                       # free tier often has no coding index; fall back to general
    general_aa = board_aa(raw, "iq", "Intelligence Index (general)")
    if job == "chat":
        return [board_lm(raw, "text"), general_aa, board_lb(raw, "overall", "Overall"), board_epoch(raw)]
    if job == "coding":
        return [board_lm(raw, "webdev") or board_lm(raw, "text_coding"),
                aa_code or general_aa, board_lb(raw, "coding", "Coding"), board_epoch(raw)]
    if job == "writing":
        c = lb_cat(raw, "language", "writ")
        return [board_lm(raw, "text_creative_writing"), general_aa,
                board_lb(raw, c, c.replace("_", " ").title()) if c else board_lb(raw, "overall", "Overall"), board_epoch(raw)]
    if job == "math":
        c = lb_cat(raw, "math", "reason")
        return [board_lm(raw, "text_math"), general_aa,
                board_lb(raw, c, c.replace("_", " ").title()) if c else None, board_epoch(raw)]
    if job == "pictures":
        return [board_lm(raw, "text_to_image"), board_aa_image(raw)]
    return []


def lm_votes(raw, bid):
    """Votes per model on one LMArena board (all rows), used for the 'not sure yet' check."""
    b = ((raw.get("lmarena") or {}).get("boards") or {}).get(bid) or {}
    return {r["k"]: r.get("votes") for r in b.get("rows") or []}


def overlap(a, b):
    return a.get("lo") is not None and b.get("lo") is not None and a["lo"] <= b["hi"] and b["lo"] <= a["hi"]


def rank_info(boards, k):
    out = []
    for b in boards:
        idx = next((i for i, r in enumerate(b["rows"]) if r["k"] == k), None)
        info = {"src": b["src"], "name": SRC[b["src"]]["name"], "board": b["board"], "date": b.get("date") or "", "url": b.get("url") or ""}
        if idx is None:
            info.update({"rank": None})
        else:
            r = b["rows"][idx]
            info.update({"rank": idx + 1, "score": r.get("s"), "top3": idx < 3})
            if b.get("ci") and r.get("lo") is not None:
                info.update({"lo": r["lo"], "hi": r["hi"]})
            if b.get("votes"):
                info["votes"] = r.get("votes")
        out.append(info)
    return out


def describe(k, boards, names, votes_map=None, votes_label="text overall"):
    """One model's standing for one job. votes_map = LMArena votes on the text-overall board (or text-to-image
    for pictures). Without a map, the job's own LMArena board is used."""
    ranks = rank_info(boards, k)
    covered = sum(1 for r in ranks if r["rank"])
    top3 = sum(1 for r in ranks if r.get("top3"))
    if votes_map is not None:
        votes = votes_map.get(k)
    else:
        lm = next((r for r in ranks if r["src"] == "lmarena" and r["rank"]), None)
        votes = lm.get("votes") if lm else None
    need_cover = 3 if len(boards) >= 3 else len(boards)
    reasons = []
    if covered < need_cover:
        reasons.append(f"only {covered} of {len(boards)} sources have tested it")
    if votes is not None and votes < NOT_SURE_VOTES:
        reasons.append(f"only {votes:,} LMArena votes so far ({votes_label})")
    ranked = [r["rank"] for r in ranks if r["rank"]]
    return {"k": k, "n": names.get(k, {}).get("n", k), "o": names.get(k, {}).get("o", ""), "top3": top3, "covered": covered,
            "votes": votes, "notSure": bool(reasons), "why": reasons, "avg": round(sum(ranked) / len(ranked), 2) if ranked else 99,
            "ranks": ranks}


def tied(a, b, boards):
    """Error bars overlap on every source where both have one (and at least one such source)."""
    shared = 0
    for bd in boards:
        if not bd.get("ci"):
            continue
        ra = next((r for r in bd["rows"] if r["k"] == a), None)
        rb = next((r for r in bd["rows"] if r["k"] == b), None)
        if ra and rb and ra.get("lo") is not None and rb.get("lo") is not None:
            shared += 1
            if not overlap(ra, rb):
                return False
    return shared > 0


def decide(boards, names, need, votes_map=None, votes_label="text overall"):
    """The pick rule. Returns status ('best' | 'tie' | 'none'), winners, other candidates and new-model notes."""
    boards = [b for b in boards if b and b.get("rows")]
    n = len(boards)
    if n < 2:
        return {"status": "none", "winners": [], "candidates": [], "new": [], "n": n, "need": need}
    need = min(need, n)
    cands = []
    for b in boards:
        for r in b["rows"][:3]:
            if r["k"] not in cands:
                cands.append(r["k"])
    desc = [describe(k, boards, names, votes_map, votes_label) for k in cands]
    desc.sort(key=lambda c: (-c["top3"], c["avg"]))
    qual = [c for c in desc if c["top3"] >= need]
    sure = [c for c in qual if not c["notSure"]]
    new = [c for c in desc if c["notSure"] and c["top3"] >= 1 and any(r.get("rank") == 1 for r in c["ranks"])][:2]
    if not sure:
        return {"status": "none", "winners": [], "candidates": desc[:5], "new": new, "n": n, "need": need,
                "qualNotSure": qual}
    win = [sure[0]] + [c for c in sure[1:] if tied(sure[0]["k"], c["k"], boards)]
    return {"status": "tie" if len(win) > 1 else "best", "winners": win,
            "candidates": [c for c in desc if c["k"] not in {w["k"] for w in win}][:5], "new": new, "n": n, "need": need}


def single_source(board, names, votes_map):
    """Only one source covers this job (pictures with AA off): show its #1, never call it best."""
    first = describe(board["rows"][0]["k"], [board], names, votes_map, "text-to-image")
    others = [describe(r["k"], [board], names, votes_map, "text-to-image") for r in board["rows"][1:5]]
    return {"status": "single", "winners": [first], "candidates": others, "new": [], "n": 1, "need": 2}


JOBS = [  # (id, label, icon, need)
    ("chat", "Chat & questions", "💬", 3),
    ("writing", "Writing", "✍️", 3),
    ("coding", "Coding", "💻", 3),
    ("math", "Math & reasoning", "🧮", 3),
    ("pictures", "Pictures", "🎨", 2),
]


def job_how(jid, aa_on):
    """Which boards each job uses, in plain words (shown under See more)."""
    if jid == "chat":
        return ("LMArena text overall (people's votes), " + ("Artificial Analysis Intelligence Index, " if aa_on else "") +
                "LiveBench overall and Epoch Capabilities Index.")
    if jid == "writing":
        return ("LMArena creative writing (people's votes) is the only direct writing test. " +
                ("Artificial Analysis Intelligence Index, " if aa_on else "") +
                "LiveBench (its language category if it has one, else overall) and Epoch Capabilities Index add general skill.")
    if jid == "coding":
        return ("LMArena building websites and apps (or coding questions), " +
                ("Artificial Analysis Coding Index (Intelligence Index when the free API leaves coding empty), " if aa_on else "") +
                "LiveBench coding and Epoch Capabilities Index (general).")
    if jid == "math":
        return ("LMArena math (people's votes), LiveBench reasoning or math category, " +
                ("Artificial Analysis Intelligence Index " if aa_on else "") + ("and " if aa_on else "") +
                "Epoch Capabilities Index (general).")
    if jid == "pictures":
        if aa_on:
            return "LMArena text-to-image and the Artificial Analysis text-to-image arena. Both are blind votes between two pictures."
        return ("Only LMArena text-to-image (blind votes between two pictures). With just 1 source, no picture model is "
                "called best; the app shows LMArena's #1 and marks it '1 source only'.")
    n = 4 if aa_on else 3
    return (f"Models that are top 10 in at least 2 of the {n} general sources, ordered by developer price "
            f"(3 parts input to 1 part output). Price from OpenRouter" + (", Artificial Analysis if OpenRouter has none." if aa_on else "."))


def rule_info(aa_on):
    t = 4 if aa_on else 3
    p = 2 if aa_on else 1
    if aa_on:
        text = ("A model is called best only when at least 3 of 4 independent sources put it in their top 3 "
                "(2 of 2 for pictures).")
    else:
        text = ("A model is called best only when all 3 independent sources put it in their top 3. "
                "Pictures have only 1 source, so no picture model is called best.")
    return {"text": text, "textSources": t, "need": 3, "picSources": p, "picNeed": 2 if aa_on else None,
            "votes": NOT_SURE_VOTES}


def names_index(raw):
    """Display name and maker per model id. Priority: AA (when on), Epoch, LMArena, OpenRouter, LiveBench."""
    idx = {}
    def add(k, n, o):
        if not k:
            return
        cur = idx.setdefault(k, {"n": n, "o": o or ""})
        if not cur["o"] and o:
            cur["o"] = o
    for m in (raw.get("aa") or {}).get("llm") or []:
        add(m["k"], m["n"], m.get("o"))
    for m in (raw.get("aa") or {}).get("image") or []:
        add(m["k"], m["n"], m.get("o"))
    for m in (raw.get("epoch") or {}).get("rows") or []:
        add(m["k"], m["n"], m.get("o"))
    for bid in ("text", "text_to_image", "webdev", "text_creative_writing", "text_coding", "text_math"):
        for m in (((raw.get("lmarena") or {}).get("boards") or {}).get(bid) or {}).get("rows") or []:
            add(m["k"], m["n"], m.get("o"))
    for m in (raw.get("openrouter") or {}).get("models") or []:
        add(m["k"], m["n"], m.get("o"))
    for m in (raw.get("livebench") or {}).get("rows") or []:
        add(m["k"], m["n"], "")
    return idx


AA_CREDIT = "Artificial Analysis (artificialanalysis.ai)"


def dev_price(raw, k):
    """Developer price per 1M tokens: OpenRouter first, Artificial Analysis as fallback (only when AA is on)."""
    orm = [m for m in (raw.get("openrouter") or {}).get("models") or [] if m["k"] == k and m.get("pin") is not None]
    if orm:
        m = orm[0]
        return {"pin": m["pin"], "pout": m["pout"], "src": "openrouter", "srcName": "OpenRouter", "u": m["u"],
                "date": ((raw.get("openrouter") or {}).get("_updated") or "")[:10]}
    for m in (raw.get("aa") or {}).get("llm") or []:
        if m["k"] == k and m.get("pin") is not None and m.get("pout") is not None:
            return {"pin": m["pin"], "pout": m["pout"], "src": "aa", "srcName": AA_CREDIT,
                    "u": "https://artificialanalysis.ai/models/" + m["slug"] if m.get("slug") else AA_PAGE,
                    "date": ((raw.get("aa") or {}).get("_updated") or "")[:10]}
    return None


def cheap_pick(raw, names, votes_map):
    boards = [b for b in job_boards(raw, "chat") if b and b.get("rows")]
    if len(boards) < 2:
        return {"status": "none", "winners": [], "candidates": [], "new": [], "n": len(boards), "need": 2}
    good = {}
    for b in boards:
        for r in b["rows"][:10]:
            good[r["k"]] = good.get(r["k"], 0) + 1
    rows = []
    for k, cnt in good.items():
        if cnt < 2:
            continue
        p = dev_price(raw, k)
        if not p or (p["pin"] == 0 and p["pout"] == 0):
            continue
        c = describe(k, boards, names, votes_map)
        c["price"] = p
        c["blend"] = round((3 * p["pin"] + p["pout"]) / 4, 4)
        c["top10"] = cnt
        rows.append(c)
    rows.sort(key=lambda c: (c["blend"], -c["top10"]))
    if not rows:
        return {"status": "none", "winners": [], "candidates": [], "new": [], "n": len(boards), "need": 2}
    return {"status": "best", "winners": rows[:1], "candidates": rows[1:5], "new": [], "n": len(boards), "need": 2}


def plain_sentence(job, res, boards=None):
    w = res["winners"]
    if res["status"] == "single":
        b = (boards or [{}])[0]
        return (f"Top on LMArena's {str(b.get('board', 'picture')).lower()} board (people's blind votes). "
                f"Only 1 source covers pictures right now, so no picture model is called best.")
    if res["status"] == "none":
        if res.get("qualNotSure"):
            c = res["qualNotSure"][0]
            return (f"No clear winner yet: {c['n']} is in the top 3 of {c['top3']} of {res['n']} sources, but it is new "
                    f"({'; '.join(c['why'])}), so it isn't called best yet.")
        if res.get("candidates"):
            c = res["candidates"][0]
            need = "all " + str(res["n"]) if res["need"] >= res["n"] else f"at least {res['need']} of {res['n']}"
            return (f"No clear winner yet: no model is in the top 3 of {need} sources. "
                    f"Closest: {c['n']} (top 3 in {c['top3']}).")
        return "No clear winner yet: not enough sources have data for this job."
    if job == "cheap":
        p = w[0]["price"]
        return (f"The cheapest model that is top 10 in at least 2 of {res['n']} quality sources: "
                f"${p['pin']:g} in / ${p['pout']:g} out per million tokens.")
    srcs = [r["name"] for r in w[0]["ranks"] if r.get("top3")]
    if res["status"] == "tie":
        need = "all " + str(res["n"]) if res["need"] >= res["n"] else f"at least {res['need']} of {res['n']}"
        return (f"Tie: {' and '.join(c['n'] for c in w)} are each in the top 3 of {need} sources, "
                f"and their scores overlap within the margin of error.")
    if w[0]["top3"] >= res["n"]:
        return f"In the top 3 of all {res['n']} independent sources: {', '.join(srcs)}."
    return f"In the top 3 of {w[0]['top3']} of {res['n']} independent sources: {', '.join(srcs)}."


def slim(c, mods=None):
    out = {k: c[k] for k in ("k", "n", "o", "top3", "covered", "votes", "notSure", "why", "ranks") if k in c}
    out["fast"] = is_fast(c.get("n"), (mods or {}).get(c.get("k")))     # label only; added after the pick is made
    if c.get("price"):
        out["price"] = c["price"]
    return out


def build_picks(raw, aa_on=False):
    names = names_index(raw)
    mods, _ = mods_index(raw)
    text_votes = lm_votes(raw, "text")
    img_votes = lm_votes(raw, "text_to_image")
    picks = []
    for jid, label, icon, need in JOBS + [("cheap", "Cheapest good one", "💰", 2)]:
        boards = [b for b in job_boards(raw, "chat" if jid == "cheap" else jid) if b and b.get("rows")]
        if jid == "cheap":
            res = cheap_pick(raw, names, text_votes)
        elif jid == "pictures":
            if len(boards) == 1 and boards[0]["src"] == "lmarena":
                res = single_source(boards[0], names, img_votes)
            else:
                res = decide(boards, names, need, img_votes, "text-to-image")
        else:
            res = decide(boards, names, need, text_votes)
        if res["n"] < 2 and res["status"] != "single":
            continue
        uses_aa = any(b["src"] == "aa" for b in boards) or any(
            (c.get("price") or {}).get("src") == "aa" for c in res["winners"] + res["candidates"])
        picks.append({
            "id": jid, "label": label, "icon": icon, "status": res["status"], "need": res["need"], "n": res["n"],
            "winners": [slim(c, mods) for c in res["winners"]], "candidates": [slim(c, mods) for c in res["candidates"]],
            "new": [slim(c, mods) for c in res.get("new", []) if c["k"] not in {w["k"] for w in res["winners"]}],
            "why": plain_sentence(jid, res, boards), "how": job_how(jid, aa_on), "usesAA": bool(uses_aa),
            "boards": [{"src": b["src"], "name": SRC[b["src"]]["name"], "board": b["board"], "date": b.get("date") or "",
                        "url": b.get("url") or "",
                        "top": [names.get(r["k"], {}).get("n", r["n"]) for r in b["rows"][:3]],
                        "topFast": [is_fast(names.get(r["k"], {}).get("n", r["n"]), mods.get(r["k"])) for r in b["rows"][:3]]} for b in boards],
        })
    return picks


# ======================================================================= cost, releases
def build_cost(raw, picks):
    apps = []
    for a in (raw.get("prices") or {}).get("apps") or []:
        paid = [p for p in a.get("plans") or [] if p.get("usd_month")]
        cheapest = min(paid, key=lambda p: p["usd_month"]) if paid else None
        apps.append(dict(a, cheapest=cheapest))
    # developer prices: every model named in a pick, plus the top 10 of each general source
    keys = []
    for p in picks:
        for c in p["winners"] + p["candidates"] + p["new"]:
            if c["k"] not in keys:
                keys.append(c["k"])
    for b in job_boards(raw, "chat"):
        for r in (b or {}).get("rows", [])[:10]:
            if r["k"] not in keys:
                keys.append(r["k"])
    names = names_index(raw)
    mods, _ = mods_index(raw)
    dev = []
    for k in keys:
        p = dev_price(raw, k)
        if p:
            n = names.get(k, {}).get("n", k)
            dev.append(dict(p, k=k, n=n, o=names.get(k, {}).get("o", ""), fast=is_fast(n, mods.get(k))))
    dev.sort(key=lambda d: (d["pin"] * 3 + d["pout"]) / 4)
    return {"apps": apps, "dev": dev[:40]}


def build_releases(raw, days=60):
    """Official company pages first (their date and link), then OpenRouter for the rest, then AA when it is on.
    The same model is listed once (matched by name, keeping version and date suffixes apart)."""
    cut = (NOW - timedelta(days=days)).date().isoformat()
    _, mods_rel = mods_index(raw)
    seen_rel, seen_k, out = set(), set(), []
    for r in official_releases(raw):
        if r["d"] < cut or r["d"] > TODAY:
            continue
        rk = rel_key(r["n"])
        seen_rel.add(rk)
        seen_k.add(normalize(r["n"]))
        out.append({"k": normalize(r["n"]), "n": r["n"], "o": r["o"], "d": r["d"], "u": r["u"], "src": r["src"], "official": True,
                    "how": "date of the company's own announcement", "fast": is_fast(r["n"], mods_rel.get(rk))})
    for m in (raw.get("openrouter") or {}).get("models") or []:
        rk = rel_key(m["n"])
        if m["d"] < cut or rk in seen_rel:
            continue
        seen_rel.add(rk)
        seen_k.add(m["k"])
        out.append({"k": m["k"], "n": m["n"], "o": m["o"], "d": m["d"], "u": m["u"], "src": "OpenRouter", "official": False,
                    "how": "date it became available on OpenRouter", "fast": is_fast(m["n"], m.get("mods"))})
    for m in (raw.get("aa") or {}).get("llm") or []:          # empty when AA is off
        if not m.get("rel") or m["rel"] < cut or m["rel"] > TODAY or m["k"] in seen_k or rel_key(m["n"]) in seen_rel:
            continue
        seen_k.add(m["k"])
        out.append({"k": m["k"], "n": m["n"], "o": m["o"], "d": m["rel"], "official": False,
                    "u": "https://artificialanalysis.ai/models/" + m["slug"] if m.get("slug") else AA_PAGE,
                    "src": AA_CREDIT, "how": "release date listed by Artificial Analysis", "fast": is_fast(m["n"])})
    out.sort(key=lambda r: (r["d"], r["official"], r["n"]), reverse=True)
    return {"items": out[:100], "days": days}


def official_status(raw):
    out = []
    for sid, company, label, url, kind, mode in OFFICIAL:
        s = ((raw.get("official") or {}).get("sources") or {}).get(sid) or {}
        out.append({"id": sid, "company": company, "label": label, "url": url, "ok": bool(s.get("ok")),
                    "updated": s.get("updated"), "err": s.get("err", "") if not s.get("ok") else "",
                    "posts": len(s.get("posts") or [])})
    return out


# ======================================================================= main
SECTIONS = [("lmarena", fetch_lmarena), ("aa", fetch_aa), ("livebench", fetch_livebench), ("epoch", fetch_epoch),
            ("openrouter", fetch_openrouter), ("official", fetch_official), ("prices", fetch_prices), ("news", fetch_news)]
TEXT_SOURCES = ("lmarena", "aa", "livebench", "epoch")
SOURCE_ORDER = ("lmarena", "aa", "livebench", "epoch", "openrouter", "official", "prices", "news")


def load_json(p):
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def fingerprint(d):
    """Content of the app file without run times, so an unchanged day doesn't make a new commit."""
    d = json.loads(json.dumps(d))
    d.pop("built", None)
    d["status"] = {k: [v.get("ok"), v.get("err"), (v.get("updated") or "")[:10]] for k, v in (d.get("status") or {}).items()}
    for x in d.get("officialSources") or []:
        x["updated"] = (x.get("updated") or "")[:10]
    return json.dumps(d, sort_keys=True)


def has_aa(d):
    """True when an old file still holds Artificial Analysis data (must be removed when AA is off)."""
    s = json.dumps(d or {})
    return '"aa"' in s or "artificialanalysis" in s.lower()


def aa_leak(out, raw):
    """Structural check (not a text search, so a news headline about AA doesn't count)."""
    if "aa" in raw or "aa" in out.get("status", {}) or any(s["id"] == "aa" for s in out.get("sources", [])):
        return True
    for p in out.get("picks", []):
        if p.get("usesAA") or any(b["src"] == "aa" for b in p["boards"]):
            return True
        for c in p["winners"] + p["candidates"] + p["new"]:
            if any(r["src"] == "aa" for r in c["ranks"]) or (c.get("price") or {}).get("src") == "aa":
                return True
    if any(d.get("src") == "aa" for d in out.get("cost", {}).get("dev", [])):
        return True
    return any("artificialanalysis.ai" in (r.get("u") or "") for r in out.get("releases", {}).get("items", []))


def write_raw(raw):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = RAW_JSON.with_suffix(".tmp")
    tmp.write_text(json.dumps(raw, ensure_ascii=False, separators=(",", ":")))
    os.replace(tmp, RAW_JSON)


def main():
    aa_on = aa_enabled()
    prev_raw = load_json(RAW_JSON) or {}
    prev_out = load_json(OUT_JSON) or {}
    if not aa_on:
        prev_raw.pop("aa", None)          # AA off: never reuse or keep old AA data
    active = [(n, f) for n, f in SECTIONS if n != "aa" or aa_on]
    log(f"Artificial Analysis is {'ON (private use only)' if aa_on else 'OFF'}")
    raw, status, fresh = {}, {}, 0
    for name, fn in active:
        t0 = time.time()
        old = prev_raw.get(name)
        try:
            sec = fn(old)
            sec["_updated"] = NOW_ISO
            raw[name] = sec
            status[name] = {"ok": True, "updated": NOW_ISO, "checked": NOW_ISO, "secs": round(time.time() - t0, 1)}
            fresh += 1
            log(f"ok    {name} ({time.time() - t0:.1f}s)")
        except Exception as e:
            err = scrub(e)[:200]
            if old:
                raw[name] = old
                status[name] = {"ok": False, "updated": old.get("_updated"), "checked": NOW_ISO, "err": err}
            else:
                status[name] = {"ok": False, "updated": None, "checked": NOW_ISO, "err": err}
            log(f"FAIL  {name}: {err} -> {'kept last good copy' if old else 'no copy to keep'}")
    # AA was just switched off and the published files still hold AA data: rebuild them from the
    # last good copies even if nothing could be refreshed today.
    purge = not aa_on and (has_aa(load_json(RAW_JSON)) or has_aa(prev_out))
    if fresh == 0 and not purge:
        log("No source could be refreshed; leaving the published data as it is.")
        return 2
    have_text = [s for s in TEXT_SOURCES if raw.get(s)]
    if len(have_text) < 2:
        if purge and RAW_JSON.exists():
            write_raw(prev_raw)
            log("removed old Artificial Analysis data from raw.json")
        log(f"only {len(have_text)} ranking sources available; not writing")
        return 3
    if raw.get("aa") and not raw["aa"].get("image_ok", True) and status["aa"]["ok"]:
        status["aa"]["note"] = "image arena kept from the last good copy"
    lm_stale = [b for b, v in ((raw.get("lmarena") or {}).get("boards") or {}).items() if v.get("stale")]
    if lm_stale and status["lmarena"]["ok"]:
        status["lmarena"]["note"] = "kept last good copy for: " + ", ".join(lm_stale)
    if raw.get("livebench") and not raw["livebench"].get("release_found", True) and status["livebench"]["ok"]:
        status["livebench"]["note"] = "newest release id not found; used release " + raw["livebench"]["release"]
    if raw.get("official") and status.get("official", {}).get("ok"):
        bad = [s["label"] for s in official_status(raw) if not s["ok"]]
        if bad:
            status["official"]["note"] = "last good copy for: " + ", ".join(bad)
    if raw.get("prices") and status.get("prices", {}).get("ok"):
        pr = raw["prices"]
        status["prices"]["note"] = f"{pr.get('pages_read', 0)} of {pr.get('apps_total', 0)} apps read today"
    stale = stale_prices(raw.get("prices"))
    for x in stale:
        log(f"STALE price: {x['app']} {x['plan']} ${x['usd_month']} last checked {x['checked']} (more than {STALE_DAYS} days ago)")

    picks = build_picks(raw, aa_on)
    if len(picks) < 3:
        log(f"only {len(picks)} picks; not writing")
        return 4
    news_items = (raw.get("news") or {}).get("items") or []
    ri = rule_info(aa_on)
    out = {
        "v": VERSION, "built": NOW_ISO, "aaEnabled": aa_on, "status": status,
        "sources": [dict(SRC[k], id=k) for k in SOURCE_ORDER if k != "aa" or aa_on],
        "picks": picks,
        "cost": build_cost(raw, picks),
        "releases": build_releases(raw),
        "bignews": {"items": big_news(news_items, official_posts(raw)), "feeds": (raw.get("news") or {}).get("feeds") or [],
                    "rules": "Only new model launches, big price changes, major product launches or shutdowns by AI labs, "
                             "funding of about $1B or more, acquisitions of or by AI labs, and IPO filings."},
        "officialSources": official_status(raw),
        "stalePrices": stale, "staleDays": STALE_DAYS,
        "rule": ri["text"], "ruleInfo": ri, "fastNote": FAST_NOTE, "fastWords": list(FAST_WORDS),
    }
    blob = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    raw_blob = json.dumps(raw, ensure_ascii=False, separators=(",", ":"))
    key = os.environ.get("AA_API_KEY")
    if key and (key in blob or key in raw_blob):
        log("the AA key showed up in the output; not writing")
        return 6
    if not aa_on and aa_leak(out, raw):
        log("Artificial Analysis is off but AA data is in the output; not writing")
        return 7
    if "NaN" in blob or len(blob) < 3000:
        log("built data failed the final check; not writing")
        return 5
    write_raw(raw)
    n_active = len(active)
    if prev_out and fingerprint(prev_out) == fingerprint(out):
        log("Nothing changed since the last update; app files left as they are.")
        return 0 if fresh == n_active else 1
    tmp = OUT_JSON.with_suffix(".tmp")
    tmp.write_text(blob)
    os.replace(tmp, OUT_JSON)
    tmp = OUT_JS.with_suffix(".tmp")
    tmp.write_text("window.AI_DATA=" + blob + ";\n")
    os.replace(tmp, OUT_JS)
    log(f"wrote {OUT_JSON} ({len(blob) // 1024} KB), {fresh}/{n_active} sources fresh")
    return 0 if fresh == n_active else 1


if __name__ == "__main__":
    rc = main()
    sys.stdout.flush(); sys.stderr.flush()
    os._exit(rc)    # pyarrow can abort on normal interpreter shutdown; exit hard with our code
