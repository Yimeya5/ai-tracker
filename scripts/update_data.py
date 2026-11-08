#!/usr/bin/env python3
"""Rebuild data/data.json (+ data/data.js) for the AI Tracker app.

The app answers 5 questions: which model is best for what, what each one costs, what was released lately,
the big news, and AI agents (the best model inside an agent, agent apps and their prices, agent news).
No AI calls anywhere: every pick is a fixed rule.

Sources (only these):
  lmarena    LMArena official Hugging Face dataset (parquet, CC-BY-4.0): people's blind votes
             (text, coding, writing, math, webdev, text-to-image, and the Agent Arena)
  aa         Artificial Analysis official free API: independent tests, prices, image arena.
             OFF by default. Only used when AA_ENABLED is "1" or "true" (needs AA_API_KEY too).
             AA's Data Platform Terms don't allow its data in a public product, so keep it off for the public app.
             When off: no AA requests, and no AA data in data.json, data.js or raw.json.
  livebench  LiveBench latest release CSV: fresh, contamination-free tasks (incl. Long Agentic and Browser)
  epoch      Epoch AI benchmark zip (CC-BY): Capabilities Index with error bars, plus agent tests run by others:
             APEX-Agents (Mercor), Vending-Bench 2 (Andon Labs), Remote Labor Index (Scale AI / CAIS)
  openrouter OpenRouter models API: developer prices, release dates, what each model outputs (text/image/...)
  official   each company's own news page/blog (OpenAI, Google DeepMind, Google AI, Anthropic, Mistral, xAI, Meta,
             DeepSeek): new model announcements (for New releases and Big news)
  prices     each app's official pricing page, or the company's own App Store listing (US) when the web page blocks
             servers (ChatGPT, Perplexity; Meta AI = free; Grok backup). Simple regex rules, polite fetching.
  news       RSS feeds from AI labs and tech news sites; Big news keeps only launches, big price changes,
             product launches/shutdowns, $1B+ funding, acquisitions and IPO filings (fixed word rules)
  agentapps  agent apps (ChatGPT Work, Gemini Agent, Claude in Chrome, Comet, Manus, Codex, Claude Code, Jules,
             GitHub Copilot, Cursor, Devin, Replit): prices from their own pricing pages / App Store listings, or a
             line on the company's own page proving which Cost-tab plans include the agent

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


# xAI was renamed SpaceX Super Intelligence (SpaceXSI) in Oct 2026 (x.ai: "© 2026 SpaceX Super Intelligence LLC", @SpaceXSI).
# One name everywhere in the app (Cost, Agents, Find your AI, New releases, rankings):
XAI_NAME = "SpaceXSI (formerly xAI)"
ORG = {"google": "Google", "anthropic": "Anthropic", "openai": "OpenAI", "xai": XAI_NAME, "x-ai": XAI_NAME, "spacexai": XAI_NAME,
       "spacexsi": XAI_NAME, "spacex super intelligence": XAI_NAME,
       "meta": "Meta", "meta-llama": "Meta", "meta ai": "Meta", "meta-ai": "Meta", "deepseek": "DeepSeek", "deepseek-ai": "DeepSeek", "alibaba": "Alibaba",
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
    ("agent", "agent", "overall", "Agent Arena", "https://lmarena.ai/leaderboard/agent"),
    # v16g, Find your AI extra tasks (see FINDER_TASKS)
    ("search", "search", "overall", "Search Arena", "https://lmarena.ai/leaderboard/search"),
    ("text_to_video", "text_to_video", "overall", "Text-to-video", "https://lmarena.ai/leaderboard/text-to-video"),
    ("image_to_video", "image_to_video", "overall", "Image-to-video", "https://lmarena.ai/leaderboard/image-to-video"),
    ("text_non_english", "text", "non_english", "Non-English questions", "https://lmarena.ai/leaderboard/text"),
]
# The Agent Arena uses other column names: score (IPS, higher = better), score_ci_lower/upper, observation_count.
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
    agent = "rating" not in rows[0] and "score" in rows[0]           # Agent Arena columns
    sc, lo_c, hi_c = ("score", "score_ci_lower", "score_ci_upper") if agent else ("rating", "rating_lower", "rating_upper")
    rnd = (lambda v: round(v, 4)) if agent else round                  # agent scores are small numbers like 0.184
    rows.sort(key=lambda r: -(num(r.get(sc)) or 0))
    seen, out = set(), []
    for r in rows:
        k = normalize(r.get("model_name"))
        s = num(r.get(sc))
        if not k or k in seen or s is None:
            continue
        seen.add(k)                                                    # several run settings: the best one counts
        lo, hi = num(r.get(lo_c)), num(r.get(hi_c))
        row = {"k": k, "n": display_name(r.get("model_name")), "o": org_name(r.get("organization")),
               "s": rnd(s), "lo": rnd(lo if lo is not None else s), "hi": rnd(hi if hi is not None else s)}
        if agent:
            row["obs"] = int(num(r.get("observation_count")) or 0)
        else:
            row["votes"] = int(num(r.get("vote_count")) or 0)
        out.append(row)
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


# Agent tests that Epoch AI collects in the same zip (each one is read and kept on its own).
#   (id, file in the zip, score column, minimum rows)
EPOCH_AGENT = [
    ("apex", "apex_agents_external.csv", "Pass@1 score", 10),
    ("vending", "vending_bench_2_external.csv", "Score", 10),
    ("rli", "rli_external.csv", "Score", 5),
]


def bench_key(version):
    """'claude-opus-5-5_max' -> 'claude-opus-5-5': the part after '_' is the effort setting it was run with."""
    return normalize(str(version or "").split("_")[0])


def parse_epoch_bench(text, score_col):
    """One Epoch benchmark CSV -> [{k, n, o, s, d}] best run per model, best first. d = the model's release date."""
    reader = csv.DictReader(io.StringIO(text))
    cols = {c.lower().strip(): c for c in (reader.fieldnames or []) if c}
    c_model, c_score = cols.get("model version") or cols.get("model"), cols.get(score_col.lower())
    c_date, c_org = cols.get("release date"), cols.get("organization")
    if not (c_model and c_score):
        raise ValueError(f"columns not found ({score_col})")
    best = {}
    for r in reader:
        k, v = bench_key(r.get(c_model)), num(r.get(c_score))
        if not k or v is None:
            continue
        rec = {"k": k, "n": display_name(str(r.get(c_model)).split("_")[0]), "o": org_name(r.get(c_org)) if c_org else "",
               "s": round(v, 4), "d": (r.get(c_date) or "")[:10] if c_date else ""}
        if k not in best or rec["s"] > best[k]["s"]:
            best[k] = rec
    return sorted(best.values(), key=lambda x: -x["s"])


def fetch_epoch(prev=None):
    z = zipfile.ZipFile(io.BytesIO(get(EPOCH_ZIP, timeout=120).content))
    name = next((n for n in z.namelist() if n.endswith("eci_scores.csv")), None)
    if not name:
        raise ValueError("eci_scores.csv not in the zip")
    rows = parse_epoch_csv(z.read(name).decode("utf-8", "replace"))
    if len(rows) < 20:
        raise ValueError(f"Epoch ECI looks too short ({len(rows)} rows)")
    old = (prev or {}).get("agent") or {}
    agent = {}
    for bid, fname, col, min_rows in EPOCH_AGENT:
        try:
            f = next((n for n in z.namelist() if n.endswith(fname)), None)
            if not f:
                raise ValueError(fname + " not in the zip")
            brows = parse_epoch_bench(z.read(f).decode("utf-8", "replace"), col)
            if len(brows) < min_rows:
                raise ValueError(f"{fname} looks too short ({len(brows)} rows)")
            agent[bid] = {"ok": True, "updated": NOW_ISO, "rows": brows, "newest": max(r["d"] for r in brows)}
        except Exception as e:
            log(f"epoch: {bid} failed: {e}")
            agent[bid] = dict(old[bid], ok=False, err=str(e)[:160]) if old.get(bid) else {"ok": False, "updated": None, "rows": [], "err": str(e)[:160]}
    return {"rows": rows, "agent": agent}


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
POLITE_UA = {"User-Agent": f"Mozilla/5.0 (compatible; ai-tracker/6; +{PROJECT_URL})"}
PRICE_PAUSE = 2                 # seconds between price pages
PRICE_RETRY_WAITS = (4, 10)     # 3 tries in all
STALE_DAYS = 30
SEED_CHECKED = "2026-11-01"
PRICES_CFG = 5                  # bump when the plan list changes in a way old saved values would be wrong (a new plan is fine)
APPSTORE = "https://apps.apple.com/us/app/"
LOOKUP = "https://itunes.apple.com/lookup?id={}&country=us"
P = r"\$\s?(\d[\d,]*(?:\.\d\d)?)"   # a dollar price
sleep = time.sleep              # kept as a name so tests can skip the waits

PRICE_APPS = [
    {"app": "ChatGPT", "maker": "OpenAI", "free": True, "sources": [
        # "web": OpenAI's own price (chatgpt.com/pricing, checked by hand 2026-11-07: Plus $20/month) is shown when the App
        # Store reads one cent under it (Apple's $19.99 tier). Any other App Store price is a real change and is shown as read.
        {"kind": "appstore", "label": "App Store price (US)", "url": APPSTORE + "chatgpt/id6448311069", "seller": r"OpenAI",
         "web": {"Plus": 20},
         "plans": [("Go", 8, "ChatGPT Go"), ("Plus", 20, "ChatGPT Plus"), ("Pro 100", 100, "ChatGPT Pro 100"),
                   ("Pro 200", 200, "ChatGPT Pro 200"), ("Pro 500", 500, "ChatGPT Pro 500")]}]},
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
    {"app": "Grok", "maker": XAI_NAME, "free": True, "sources": [
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


PAGE_CACHE = None   # main() sets a dict: a page read once in a run (e.g. claude.com/pricing) isn't fetched again


def web_price(v, web):
    """The company's own web price when the App Store reads one cent under it ($19.99 in the App Store, $20 on the web)."""
    if v is not None and web and abs(v - (web - 0.01)) < 0.005:
        return float(web)
    return v


def polite_get(url, label="prices"):
    """Up to 3 tries, waiting 4 s then 10 s. Raises the last error. `label` = the part of the run, for the log."""
    if PAGE_CACHE is not None and url in PAGE_CACHE:
        return PAGE_CACHE[url]
    err = None
    for i in range(len(PRICE_RETRY_WAITS) + 1):
        if i:
            log(f"{label}: retry {i} for {url} in {PRICE_RETRY_WAITS[i - 1]}s ({err})")
            sleep(PRICE_RETRY_WAITS[i - 1])
        try:
            r = get(url, timeout=30, headers=POLITE_UA)
            if PAGE_CACHE is not None:
                PAGE_CACHE[url] = r
            return r
        except Exception as e:
            err = e
    raise err


def sane(v, old):
    if v is None or v <= 0 or v > 1000:
        return None
    if old and not (old / 3 <= v <= old * 3):
        return None
    return v


def read_source(src, old_plans, label="prices", extra=None):
    """Read one source. Returns (plans, ok, err). ok = the page was read and is the right listing.
    Optional source keys: "section" (marker, length) = only read that part of the page;
    "proof" = a regex that must be on the page (e.g. "Claude Code No Yes Yes Yes");
    "facts" = {name: (regex, template)} small facts read from the page into extra["facts"]."""
    resp = polite_get(src["url"], label)
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
    if src.get("section"):
        marker, length = src["section"]
        i = text.find(marker)
        if i < 0:
            return [], False, f"'{marker}' not found on the page"
        text = text[i:i + length]
    if src.get("proof") and not re.search(src["proof"], text, flags=re.I):
        return [], False, "the line that shows this is included is not on the page any more"
    if src.get("noPrice") and re.search(r"\$\s?\d", text):
        log(src["noPrice"])                    # e.g. "Instinct: a price may be public now, check instinct.com"
        return [], False, "a $ price is on the page now (not guessed; last good kept)"
    if src.get("facts") and extra is not None:
        for fname, (fre, tmpl) in src["facts"].items():
            fm = re.search(fre, text, flags=re.I)
            if fm:
                extra.setdefault("facts", {})[fname] = tmpl.format(*fm.groups())
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
            v = web_price(sane(appstore_price(iap, pat), op.get("usd_month")), (src.get("web") or {}).get(name))
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


def read_apps(cfgs, prev_apps, cfg_ver, label="prices", key="app"):
    """Read every app in `cfgs` (each source in order until one works). An app that can't be read today keeps
    its last good plans, source, facts and date. Returns (records, number of apps read today)."""
    old_apps = {a[key]: a for a in (prev_apps or []) if a.get("cfg") == cfg_ver}
    apps, read_ok, first = [], 0, True
    for cfg in cfgs:
        old = old_apps.get(cfg[key])
        base = old or seed_record(cfg)
        tried, used, extra = [], None, {}
        for src in cfg["sources"]:
            if src["kind"] == "static":            # hand-checked entry: not fetched, keeps its own check date
                tried.append({"label": src["label"], "url": src["url"], "ok": True, "err": ""})
                used = (src, [])
                break
            if not first:
                sleep(PRICE_PAUSE)
            first = False
            same_src = base["src"]["url"] in (src["url"], src.get("page"))
            old_plans = {p["name"]: p for p in base["plans"]} if same_src else {}
            extra = {}
            try:
                plans, ok, err = read_source(src, old_plans, label, extra)
            except Exception as e:
                plans, ok, err = [], False, str(e)[:160]
            tried.append({"label": src["label"], "url": src.get("page") or src["url"], "ok": ok, "err": err})
            if ok:
                used = (src, plans)
                break
            log(f"{label}: {cfg[key]} {src['label']} not read: {err}")
        if used:
            src, plans = used
            rec = {"plans": plans, "src": {"kind": src["kind"], "label": src["label"], "url": src.get("page") or src["url"]},
                   "facts": dict((base.get("facts") or {}), **(extra.get("facts") or {}))}
            all_read = all(p["checked"] == TODAY for p in plans)
            rec["checked"] = TODAY if all_read else min(p["checked"] for p in plans)
            if src["kind"] == "static":
                rec["checked"] = src["checked"]
            read_ok += 1
        else:
            rec = {"plans": base["plans"], "src": base["src"], "checked": base["checked"], "facts": base.get("facts") or {}}
            all_read = False
        age = days_old(rec["checked"])
        for p in rec["plans"]:
            p["stale"] = days_old(p["checked"]) > STALE_DAYS
        apps.append(dict({k: cfg[k] for k in cfg if k not in ("sources",)}, note=cfg.get("note", ""), cfg=cfg_ver,
                         plans=rec["plans"], src=rec["src"], page=rec["src"]["url"], checked=rec["checked"], facts=rec["facts"],
                         read_ok=bool(used) and all_read, readToday=bool(used), tried=tried,
                         stale=age > STALE_DAYS, ageDays=age))
    return apps, read_ok


def fetch_prices(prev=None):
    """Always returns every app. An app that can't be read today keeps its last good plans, source and date."""
    apps, read_ok = read_apps(PRICE_APPS, (prev or {}).get("apps"), PRICES_CFG)
    return {"apps": apps, "pages_read": read_ok, "apps_total": len(PRICE_APPS)}


def stale_prices(prices):
    """Stale prices of priced apps (personal assistants have no price, so they are never counted here)."""
    out = []
    for a in (prices or {}).get("apps") or []:
        if a.get("group") == "assistants" or a.get("static"):
            continue
        for p in a.get("plans") or []:
            if p.get("stale"):
                out.append({"app": a["app"], "plan": p["name"], "usd_month": p["usd_month"], "checked": p["checked"]})
        if not a.get("plans") and a.get("stale"):
            out.append({"app": a["app"], "plan": "", "usd_month": None, "checked": a["checked"]})
    return out


# ======================================================================= agent apps (Agents tab)
# Same reader as the Cost tab (polite fetching, 3 tries, believable-number check, keep last good, stale after 30 days).
# Apps whose agent comes with a plan already on the Cost tab ("plansFrom") don't repeat those prices: the app reads a
# line on the company's own page that proves which plans include the agent ("proof"), and shows the Cost-tab prices.
AGENTS_CFG = 4                  # bump when the list below changes, so old saved values aren't mixed in (4: all agents, 4 groups)
AGENT_GROUPS = [("assistants", "Personal assistants (text or call them)"), ("tasks", "Browser and computer agents"),
                ("code", "Coding agents"), ("research", "Research and work agents")]
AGENT_APPS = [
    # ---- does tasks for you
    {"id": "chatgpt-work", "app": "ChatGPT Work", "maker": "OpenAI", "group": "tasks", "free": True,
     "what": "An agent inside ChatGPT that does multi-step tasks across your files and apps.",
     "plansFrom": "ChatGPT", "only": None,
     "proofText": "“ChatGPT Work and Codex are included in your ChatGPT Free, Go, Plus, Pro…”",
     "sources": [{"kind": "web", "label": "Codex pricing page", "url": "https://developers.openai.com/codex/pricing",
                  "proof": r"ChatGPT Work and Codex are included in your ChatGPT Free", "plans": []}]},
    {"id": "gemini-agent", "app": "Gemini Agent", "maker": "Google", "group": "tasks", "free": False,
     "what": "Does tasks for you in the Gemini app.", "note": "Only in Google AI Ultra. US only, English only.",
     "plansFrom": "Gemini", "only": ["Google AI Ultra"],
     "proofText": "Google AI Ultra: “Gemini Agent (US only, English only)”",
     "sources": [{"kind": "web", "label": "Google AI plans page", "url": "https://one.google.com/intl/en_us/about/google-ai-plans/",
                  "proof": r"Google AI Ultra.{0,1500}?Gemini Agent \(US only, English only\)", "plans": []}]},
    {"id": "claude-in-chrome", "app": "Claude in Chrome", "maker": "Anthropic", "group": "tasks", "free": False,
     "what": "Reads the page you're on, then clicks, types and fills in forms for you.", "note": "Not on the Free plan.",
     "plansFrom": "Claude", "only": ["Pro", "Max", "Ultra"],
     "proofText": "Plan table: “Claude in Chrome: No (Free), Yes (Pro, Max, Ultra)”",
     "sources": [{"kind": "web", "label": "Claude pricing page", "url": "https://claude.com/pricing",
                  "proof": r"Claude in Chrome No Yes Yes Yes", "plans": []}]},
    {"id": "comet", "app": "Comet", "maker": "Perplexity", "group": "tasks", "free": True,
     "what": "An AI web browser that does tasks for you.",
     "sources": [{"kind": "appstore", "label": "App Store price (US)", "url": APPSTORE + "comet-ai-browser-assistant/id6748622471",
                  "seller": r"Perplexity AI", "plans": [("Pro", 20, "Perplexity Pro"), ("Max", 200, "Perplexity Max")]}]},
    # Manus's own help article lists the current plans. manus.im/pricing has no prices in its HTML, and the App Store
    # still lists old plans (Basic / Plus) next to many "Manus Pro $x" items, so it is not used.
    {"id": "manus", "app": "Manus", "maker": "Manus (Meta)", "group": "tasks", "free": True,
     "what": "A general agent: research, slides, websites and more.", "note": "Free plan with daily credits.",
     "sources": [{"kind": "web", "label": "Manus help page",
                  "url": "https://help.manus.im/en/articles/11711111-what-is-the-current-membership-pricing-for-manus",
                  "plans": [("Pro (4,000 credits)", 20, r"Pro Plan Price 1:\s*Starting from\s*" + P + r"\s*/\s*month"),
                            ("Pro (8,000 credits)", 40, r"Pro Plan Price 2:\s*Starting from\s*" + P + r"\s*/\s*month")],
                  "notes": {"Pro (4,000 credits)": "from", "Pro (8,000 credits)": "from; 7-day free trial"}}]},
    # ---- writes code for you
    {"id": "codex", "app": "Codex", "maker": "OpenAI", "group": "code", "free": True,
     "what": "OpenAI's coding agent, in the app, the terminal, your editor and the cloud.",
     "sources": [{"kind": "web", "label": "Pricing page", "url": "https://developers.openai.com/codex/pricing",
                  "plans": [("Go", 8, r"\bGo\b[^$]{0,60}" + P + r"\s*/\s*month"), ("Plus", 20, r"\bPlus\b[^$]{0,60}" + P + r"\s*/\s*month"),
                            ("Pro", 100, r"\bPro\b[^$]{0,60}From\s*" + P + r"\s*/\s*month")],
                  "notes": {"Pro": "from; $100, $200 or $500"}}]},
    {"id": "claude-code", "app": "Claude Code", "maker": "Anthropic", "group": "code", "free": False,
     "what": "Anthropic's coding agent, in the terminal, your editor, the desktop app and the web.", "note": "Not on the Free plan.",
     "plansFrom": "Claude", "only": ["Pro", "Max", "Ultra"],
     "proofText": "Plan table: “Claude Code: No (Free), Yes (Pro, Max, Ultra)”",
     "sources": [{"kind": "web", "label": "Claude pricing page", "url": "https://claude.com/pricing",
                  "proof": r"Claude Code No Yes Yes Yes", "plans": []}]},
    {"id": "jules", "app": "Jules", "maker": "Google", "group": "code", "free": True,
     "what": "Google's coding agent: works on your GitHub code and opens a pull request.",
     "plansFrom": "Gemini", "only": ["Google AI Pro", "Google AI Ultra"],
     "proofText": "A free plan with a daily task limit; more tasks with Google AI Pro or Ultra",
     "sources": [{"kind": "web", "label": "Jules plans", "url": "https://jules.google/",
                  "proof": r"Jules in Pro.{0,400}?Jules in Ultra", "facts": {"freeTasks": (r"(\d+) tasks per day", "Free: {} tasks a day")},
                  "plans": []}]},
    {"id": "copilot", "app": "GitHub Copilot", "maker": "GitHub (Microsoft)", "group": "code", "free": True,
     "what": "Coding agent in your editor, the terminal and on GitHub.",
     "sources": [{"kind": "web", "label": "Plans page", "url": "https://github.com/features/copilot/plans", "section": ("Pricing plans", 400),
                  "plans": [("Pro", 10, r"\bPro\s+" + P + r"\s*per month"), ("Pro+", 39, r"\bPro\+\s*" + P + r"\s*per month"),
                            ("Max", 100, r"\bMax\s+" + P + r"\s*per month")]}]},
    # Cursor is part of SpaceX and sold as "The X Subscription" (one plan for Grok, Cursor and X). The proof check
    # notices when the pricing page stops being that page (no "Grok" on it): last good prices stay, and the log says so.
    {"id": "cursor", "app": "Cursor", "maker": "SpaceX", "group": "code", "free": True,
     "what": "A code editor with a built-in coding agent.",
     "note": "Sold as The X Subscription: one plan with Grok and X. Claude or GPT inside Cursor cost extra.",
     "sources": [{"kind": "web", "label": "Pricing page", "url": "https://cursor.com/pricing", "proof": r"\bGrok\b",
                  "plans": [("Plus", 8, r"\bPlus\b[^$]{0,25}" + P + r"\s*/\s*month"), ("Premium", 30, r"\bPremium\b[^$]{0,25}" + P + r"\s*/\s*month"),
                            ("Super", 100, r"\bSuper\b[^$]{0,25}" + P + r"\s*/\s*month"), ("Ultra", 200, r"\bUltra\b[^$]{0,25}" + P + r"\s*/\s*month")]}]},
    {"id": "devin", "app": "Devin", "maker": "Cognition", "group": "code", "free": True,
     "what": "A coding agent that works on its own, on your computer or in the cloud.",
     "note": "Windsurf is now part of Devin (windsurf.com opens Devin's pricing page).",
     "sources": [{"kind": "web", "label": "Pricing page", "url": "https://devin.ai/pricing",
                  "plans": [("Pro", 20, r"\bPro\b[^$]{0,25}" + P + r"\s*per month"), ("Max", 200, r"\bMax\b[^$]{0,25}" + P + r"\s*per month")]}]},
    {"id": "replit", "app": "Replit Agent", "maker": "Replit", "group": "code", "free": None,
     "what": "Builds apps and websites from a plain description.", "note": "Monthly prices (less if billed yearly).",
     "sources": [{"kind": "web", "label": "Pricing page", "url": "https://replit.com/pricing",
                  "plans": [("Core", 20, r"\bCore\s+" + P), ("Pro", 100, r"\bPro\s+" + P)]},
                 {"kind": "appstore", "label": "App Store price (US)", "url": APPSTORE + "replit-vibe-code-with-ai-fast/id1614022293",
                  "seller": r"Replit", "plans": [("Core", 20, "Replit Core")]}]},
    # ---- personal assistants (text or call them). No public prices: these rows never count as prices anywhere.
    {"id": "instinct", "app": "Instinct", "maker": "Instinct", "group": "assistants", "free": None,
     "what": "A personal assistant you text or call. Connects to your apps, and can order, book and send things for you.",
     "access": "Invite only (waitlist)", "priceText": "Price not public",
     "sources": [{"kind": "web", "label": "Instinct home page", "url": "https://instinct.com/", "proof": r"text or call",
                  "noPrice": "Instinct: a price may be public now, check instinct.com", "plans": []}]},
    {"id": "tab", "app": "Tab", "maker": "Tab", "group": "assistants", "free": None,
     "what": "A personal assistant you text on iMessage or WhatsApp. Does errands, research, phone calls, email and calendar.",
     "access": "Invite or waitlist (private beta)", "priceText": "Free to use; paid plans for more speed",
     "sources": [{"kind": "static", "label": "tab.bot", "url": "https://tab.bot", "checked": "2026-11-02", "plans": []}]},
]


# ---- every other notable agent: hand-checked entries in scripts/agents_static.json (checked by hand on the date in
# "source.checked"). Their prices are never parsed. Every day the app only checks that the maker's page is still up:
# check.url loads (polite reader, 3 tries) and the proof word is on it. If not, the row stays as it is and the log says
# so; after 30 days without a good check the row is marked stale (but kept). Never counted as prices anywhere.
STATIC_AGENTS_FILE = Path(__file__).resolve().parent / "agents_static.json"


def static_agent_cfgs(path=None):
    out = []
    for x in json.loads(Path(path or STATIC_AGENTS_FILE).read_text(encoding="utf-8")):
        out.append({"id": x["id"], "app": x["app"], "maker": x["maker"], "group": x["group"], "free": x.get("free"),
                    "what": x["what"], "access": x.get("access", ""), "priceText": x.get("priceText", ""), "static": True,
                    "sources": [{"kind": "checked", "label": x["source"]["label"], "url": x["source"]["url"],
                                 "checked": x["source"]["checked"], "checkUrl": x["check"]["url"], "proof": x["check"]["proof"],
                                 "plans": [(p["name"], p["usd_month"], None) for p in x.get("plans") or []]}]})
    return out


AGENT_APPS = AGENT_APPS + static_agent_cfgs()


def check_static(cfg, old):
    """Daily 'page still up' check of a hand-checked agent. Returns the app record."""
    src = cfg["sources"][0]
    err = ""
    try:
        text = page_text(polite_get(src["checkUrl"], "agent apps").text)
        ok = bool(re.search(src["proof"], text, flags=re.I))
        if not ok:
            err = "the proof word is not on the page"
    except Exception as e:
        ok, err = False, str(e)[:160]
    page_checked = TODAY if ok else ((old or {}).get("pageChecked") or src["checked"])
    if not ok:
        log(f"{cfg['app']}: official page not read today ({err})")
    stale = days_old(page_checked) > STALE_DAYS
    plans = [{"name": n, "usd_month": v, "checked": src["checked"], "stale": stale} for n, v, _ in src["plans"]]
    return dict({k: cfg[k] for k in cfg if k != "sources"}, note=cfg.get("note", ""), cfg=AGENTS_CFG, plans=plans,
                src={"kind": "checked", "label": src["label"], "url": src["url"]}, page=src["url"], checked=src["checked"],
                pageChecked=page_checked, checkUrl=src["checkUrl"], facts={}, read_ok=ok, readToday=ok,
                tried=[{"label": "Official page", "url": src["checkUrl"], "ok": ok, "err": err}],
                stale=stale, ageDays=days_old(page_checked))


def fetch_agentapps(prev=None):
    """Agent apps: own prices, or the proof line for apps whose agent comes with a Cost-tab plan."""
    old = {a["id"]: a for a in ((prev or {}).get("apps") or []) if a.get("cfg") == AGENTS_CFG}
    read, _ = read_apps([c for c in AGENT_APPS if not c.get("static")], (prev or {}).get("apps"), AGENTS_CFG, label="agent apps", key="id")
    by_id = {a["id"]: a for a in read}
    apps = []
    for c in AGENT_APPS:
        if c.get("static"):
            sleep(PRICE_PAUSE)
            apps.append(check_static(c, old.get(c["id"])))
        else:
            apps.append(by_id[c["id"]])
    priced = [a for a in apps if a["group"] != "assistants" and not a.get("static")]      # counts are about prices only
    return {"apps": apps, "pages_read": sum(1 for a in priced if a["readToday"]), "apps_total": len(priced)}


def build_agent_apps(raw):
    cost = {a["app"]: a for a in (raw.get("prices") or {}).get("apps") or []}
    out = []
    for a in (raw.get("agentapps") or {}).get("apps") or []:
        rec = {k: a.get(k) for k in ("id", "app", "maker", "group", "what", "free", "note", "access", "priceText", "static")}
        rec["freeNote"] = (a.get("facts") or {}).get("freeTasks", "")
        own = {"label": a["src"]["label"], "url": a["src"]["url"], "checked": a["checked"], "readToday": a["readToday"],
               "stale": a["stale"], "tried": a.get("tried") or []}
        if a.get("static"):
            rec["plans"] = [dict(p) for p in a.get("plans") or []]
            rec["src"] = dict(own, checked=a["checked"])
            rec["check"] = {"label": "Official page", "url": a.get("checkUrl") or a["src"]["url"], "checked": a.get("pageChecked"),
                            "readToday": a["readToday"], "stale": a["stale"], "tried": a.get("tried") or []}
            rec["proof"] = None
        elif a.get("plansFrom"):
            ca = cost.get(a["plansFrom"]) or {}
            only = a.get("only")
            rec["plans"] = [dict(p) for p in ca.get("plans") or [] if not only or p["name"] in only]
            rec["src"] = dict(ca.get("src") or {}, checked=ca.get("checked"), readToday=ca.get("readToday"), stale=ca.get("stale"))
            rec["plansFrom"] = a["plansFrom"]
            rec["proof"] = dict(own, text=a.get("proofText", ""))
        else:
            rec["plans"] = [dict(p) for p in a.get("plans") or []]
            rec["src"] = own
            rec["proof"] = None
        paid = [p for p in rec["plans"] if p.get("usd_month")]
        rec["cheapest"] = min(paid, key=lambda p: p["usd_month"]) if paid else None
        rec["checked"] = rec["src"].get("checked") or a["checked"]
        out.append(rec)
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


def summary_text(s, n=400):
    """v16h: an article's own short summary as plain text: tags stripped, entities decoded, at most ~n characters,
    cut at the end of a sentence (else at a word, with '…'). No AI."""
    s = html.unescape(TAG_RE.sub(" ", html.unescape(str(s or "")[:20000])))
    s = re.sub(r"\s+([.,;:!?])", r"\1", " ".join(s.split()))
    if len(s) <= n:
        return s
    cut = max(s.rfind(". ", 0, n), s.rfind("! ", 0, n), s.rfind("? ", 0, n))
    if cut >= n // 3:
        return s[:cut + 1]
    return s[: s.rfind(" ", 0, n - 1)].rstrip(",;:") + "…"


META_DESC_RE = [re.compile(p, re.I) for p in (
    r'<meta[^>]+property=["\']og:description["\'][^>]*content=["\']([^"\']{20,2000})["\']',
    r'<meta[^>]+content=["\']([^"\']{20,2000})["\'][^>]*property=["\']og:description["\']',
    r'<meta[^>]+name=["\']description["\'][^>]*content=["\']([^"\']{20,2000})["\']',
    r'<meta[^>]+content=["\']([^"\']{20,2000})["\'][^>]*name=["\']description["\']',
    r'<meta[^>]+name=["\']twitter:description["\'][^>]*content=["\']([^"\']{20,2000})["\']')]
SUMMARY_FETCH_MAX = 40           # page fetches per run for summaries (each page once; the answer is kept in raw.json)


def page_summary(raw_html):
    """og:description, else meta description, else twitter:description of a page, as plain text."""
    h = raw_html[:300000] if isinstance(raw_html, str) else raw_html[:300000].decode("utf-8", "replace")
    for rx in META_DESC_RE:
        m = rx.search(h)
        if m:
            return summary_text(m.group(1))
    return ""


def fill_summaries(items, cache, fetch_max=SUMMARY_FETCH_MAX):
    """Give every item without an 'x' the summary of its own page (10 s timeout, one try). `cache` = {url: text} kept
    between runs, so a page is fetched once. A link to a spot on a page (#...) is skipped: the page's summary would
    describe the whole page, not this item. Nothing found -> x stays '' (the app shows 'No summary from the source yet.')."""
    fetched = 0
    for it in items:
        if it.get("x"):
            continue
        u = it.get("u") or ""
        if u in cache:
            it["x"] = cache[u]
            continue
        if "#" in u or not u.startswith("http") or fetched >= fetch_max:
            continue
        fetched += 1
        try:
            r = get(u, timeout=10, headers=POLITE_UA)
            r.raise_for_status()
            text = page_summary(r.text if hasattr(r, "text") else r.content)
        except Exception as e:
            log(f"summary: {u} not read ({str(e)[:80]})")
            continue
        if text and text == site_summary(u, cache):
            text = ""                       # the site's generic description ("X is an AI company..."), not this article's
        cache[u] = text
        it["x"] = text
    return items


def site_summary(u, cache):
    """The home page's own description for u's site (fetched once per run, kept in `cache` under 'home:<host>')."""
    m = re.match(r"(https?://[^/]+)", u)
    if not m:
        return ""
    key = "home:" + m.group(1)
    if key not in cache:
        try:
            r = get(m.group(1) + "/", timeout=10, headers=POLITE_UA)
            r.raise_for_status()
            cache[key] = page_summary(r.text if hasattr(r, "text") else r.content)
        except Exception:
            cache[key] = ""
    return cache[key]


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
                desc = summary_text(c.text)
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
    ("xai", XAI_NAME, "SpaceXSI news", "https://x.ai/news", "html", "inside"),
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
        x = ""
        for c in el:
            k = _local(c.tag)
            if k in ("description", "summary") and c.text and not x:
                x = summary_text(c.text)                                     # v16h: the post's own summary
            if k == "title" and c.text:
                t = " ".join(html.unescape(c.text).split())
            elif k == "link":
                u = c.get("href") or (c.text or "").strip() or u
            elif k in ("pubDate", "published", "updated", "date") and not d:
                dt = _date(c.text)
                d = dt.date().isoformat() if dt else None
        if t and u and d:
            out.append({"t": t, "u": u, "d": d, "x": x})
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


def deepseek_name(t):
    """'DeepSeek-V4.1-Flash-1017 Update' -> 'DeepSeek V4.1 Flash 1017 Update': one spelling for DeepSeek models everywhere."""
    return re.sub(r"\bDeepSeek-([\w.]+(?:-[\w.]+)*)", lambda m: "DeepSeek " + m.group(1).replace("-", " "), str(t or ""))


def parse_deepseek_log(raw, base):
    out, date = [], None
    h = strip_blocks(raw)
    for m, end, inner in _element_blocks(h, H23_OPEN, "</h", 3000):
        t = _txt(HASH_LINK.sub("", inner)).strip("\u200b ").strip()
        dm = re.match(r"Date:\s*(20\d\d-\d\d-\d\d)", t)
        if dm:
            date = dm.group(1)
            continue
        if date and m.group(1) == "3" and len(t) < 120:
            anchor = re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")
            start = h.find(">", end) + 1                                          # past the rest of "</h3>"
            nxt = re.search(r"<h[1-3]\b", h[start:start + 8000], re.I)            # v16h: the entry's own text = summary
            body = h[start:start + (nxt.start() if nxt else 3000)]
            out.append({"t": deepseek_name(t), "u": base + "#" + anchor, "d": date, "x": deepseek_name(summary_text(body))})
    return out


def fetch_official(prev=None):
    old = (prev or {}).get("sources") or {}
    srcs, ok = {}, 0
    cut = (NOW - timedelta(days=OFFICIAL_DAYS)).date().isoformat()
    for sid, company, label, url, kind, mode in OFFICIAL:
        try:
            raw = polite_get(url, "official").content   # polite UA + retries (ai.meta.com answers 400 to the browser UA)
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
            out.append(dict(p, t=deepseek_name(p.get("t")), o=s.get("company", ""), s=s.get("label", ""), sid=sid))
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
                 "what": "New model announcements from OpenAI, Google DeepMind, Google AI, Anthropic, Mistral, SpaceXSI (formerly xAI), Meta and DeepSeek.",
                 "license": "", "licenseUrl": ""},
    "prices": {"name": "Official pricing pages", "credit": "Each company's pricing page or its own App Store listing", "url": "",
               "what": "Monthly plan prices for the apps, read every day from each company's own pricing page, or from the "
                       "company's own Apple App Store listing (US prices) when its web page blocks servers.", "license": "", "licenseUrl": ""},
    "news": {"name": "News feeds", "credit": "AI lab blogs and tech news sites", "url": "",
             "what": "Headlines from OpenAI, Google, DeepMind, NVIDIA, Hugging Face, TechCrunch, The Verge, Ars Technica, MIT Tech Review and Wired.",
             "license": "", "licenseUrl": ""},
    "agentapps": {"name": "Agent app pricing pages", "credit": "Each agent app's own pricing page or App Store listing", "url": "",
                  "what": "What each agent app costs (Agents tab), read every day from its own pricing page or App Store listing. "
                          "For agents that come with a ChatGPT, Claude or Gemini plan, a line on the company's own page shows "
                          "which plans include it.", "license": "", "licenseUrl": ""},
    "taubench": {"name": "τ³-Voice (Sierra)", "credit": "τ-bench by Sierra (taubench.com)", "url": "https://taubench.com/leaderboard/?benchmark=voice",
                 "what": "Live voice modes must finish real customer-service tasks by talking, with noise and interruptions, "
                         "in six languages. Used for Voice & talking in Find your AI.",
                 "license": "Public leaderboard (τ-bench code is MIT licensed)", "licenseUrl": "https://github.com/sierra-research/tau2-bench"},
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
        # v16h "always a winner": nobody passes -> the model in the top 3 of the MOST sources leads (status "lead")
        lead = lead_order(desc)
        if not lead:
            return {"status": "none", "winners": [], "candidates": [], "new": new, "n": n, "need": need}
        return {"status": "lead", "winners": lead[:1], "candidates": lead[1:6], "new": new, "n": n, "need": need,
                "leadWhy": lead_why(lead, n)}
    win = [sure[0]] + [c for c in sure[1:] if tied(sure[0]["k"], c["k"], boards)]
    if len(win) > 1:
        # a tie is broken the same way: best average rank, then the biggest source -> one winner (status "lead")
        win = lead_order(win)
        return {"status": "lead", "winners": win[:1],
                "candidates": [c for c in desc if c["k"] != win[0]["k"]][:5], "new": new, "n": n, "need": need,
                "leadWhy": lead_why(win, n)}
    return {"status": "best", "winners": win,
            "candidates": [c for c in desc if c["k"] not in {w["k"] for w in win}][:5], "new": new, "n": n, "need": need}


def big_source_key(c):
    """Third tie-break: the biggest source (LMArena, most votes): its rank first, then its score. Missing = last."""
    lm = next((r for r in c.get("ranks") or [] if r.get("src") == "lmarena" and r.get("rank")), None)
    return (lm["rank"] if lm else 9999, -(lm.get("score") or 0) if lm else 0, -(c.get("votes") or 0))


def lead_order(cands):
    """'Always a winner' order: top 3 in the most sources, then best average rank (over the sources that rank it),
    then the biggest source (LMArena rank / score / votes), then the name (so the result never flips at random)."""
    return sorted(cands, key=lambda c: (-c.get("top3", 0), c.get("avg", 99), big_source_key(c), str(c.get("n", ""))))


def lead_why(order, n):
    """Short plain line for a 'lead' pick, e.g. 'Top 3 in 2 of 3 tests, best average rank.'"""
    w = order[0]
    where = f"all {n}" if w.get("top3", 0) >= n else f"{w.get('top3', 0)} of {n}"
    same = [c for c in order[1:] if c.get("top3", 0) == w.get("top3", 0)]
    if not same:
        return f"Top 3 in {where} tests, more than any other model."
    if all(c.get("avg", 99) > w.get("avg", 99) for c in same):
        return f"Top 3 in {where} tests, best average rank."
    return f"Top 3 in {where} tests, best on {SRC['lmarena']['name']}."


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
    for bid in ("text", "text_to_image", "webdev", "text_creative_writing", "text_coding", "text_math", "agent"):
        for m in (((raw.get("lmarena") or {}).get("boards") or {}).get(bid) or {}).get("rows") or []:
            add(m["k"], m["n"], m.get("o"))
    for m in (raw.get("openrouter") or {}).get("models") or []:
        add(m["k"], m["n"], m.get("o"))
    for m in (raw.get("livebench") or {}).get("rows") or []:
        add(m["k"], m["n"], "")
    for b in ((raw.get("epoch") or {}).get("agent") or {}).values():
        for m in b.get("rows") or []:
            add(m["k"], m["n"], m.get("o"))
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
    least = 2 if any(cnt >= 2 for cnt in good.values()) else 1        # v16h "always a winner": relax to 1 source
    for k, cnt in good.items():
        if cnt < least:
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
    if least < 2:
        return {"status": "lead", "winners": rows[:1], "candidates": rows[1:5], "new": [], "n": len(boards), "need": 2,
                "leadWhy": f"The cheapest model in the top 10 of 1 of {len(boards)} quality sources: "
                           f"${rows[0]['price']['pin']:g} in / ${rows[0]['price']['pout']:g} out per million tokens."}
    return {"status": "best", "winners": rows[:1], "candidates": rows[1:5], "new": [], "n": len(boards), "need": 2}


def plain_sentence(job, res, boards=None):
    w = res["winners"]
    if res["status"] == "lead":
        return res.get("leadWhy") or f"Top 3 in {w[0].get('top3', 0)} of {res['n']} tests."
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


# ======================================================================= Find your AI: extra tasks + Privacy (v16g)
# Four more tasks for the Find your AI finder. They live in data.json "finder" (NOT in "picks"), so the Top Picks
# cards, their 'best' rule and the Action's checks for picks stay exactly as they are. Each new task has only one
# independent source today, so (like pictures with AA off) it is never called "best": the app shows the source's
# order and says "1 source only".
#   research  = LMArena Search Arena (people vote between two answers that searched the web)
#   video     = LMArena text-to-video (image-to-video ranks shown beside it; same source, so still 1 source)
#   voice     = Sierra's tau3-Voice leaderboard (real-time voice agents finishing real tasks by talking), only the
#               voice models of apps the app lists (ChatGPT, Gemini, Grok...): developer-only voice agents are left out
#   translate = LMArena questions in languages other than English (+ hand-checked Hebrew / Yiddish note, Intento 2026)
# Privacy is a choice under "Most important": a score per app from scripts/privacy_static.json (hand-checked).
TAU_VOICE = "https://taubench.com/voice-leaderboard.json"
TAU_PAGE = "https://taubench.com/leaderboard/?benchmark=voice"
PRIVACY_FILE = Path(__file__).resolve().parent / "privacy_static.json"
TRANSLATION_FILE = Path(__file__).resolve().parent / "translation_static.json"
PRIVACY_STALE_DAYS = 120          # hand-checked facts older than this are flagged (the Action prints a warning)
FINDER_TASKS = [  # (id, label, icon, boards: (source, board id) - the first one decides the order)
    ("research", "Research", "🔎", [("lmarena", "search")]),
    ("video", "Video", "🎬", [("lmarena", "text_to_video"), ("lmarena", "image_to_video")]),
    ("voice", "Voice & talking", "🎙️", [("taubench", "voice")]),
    ("translate", "Translation", "🌐", [("lmarena", "text_non_english")]),
]


def parse_tau_voice(data):
    """tau3-Voice leaderboard JSON -> rows sorted by score (pass rate, %). Only complete, standard submissions."""
    rows, seen = [], set()
    for r in (data or {}).get("rows") or []:
        m, s = r.get("metadata") or {}, (r.get("submission") or {}).get("summary") or {}
        if m.get("submission_type", "standard") != "standard" or not s.get("complete") or num(s.get("score")) is None:
            continue
        k = normalize(m.get("model_name"))
        if not k or k in seen:
            continue
        seen.add(k)
        rows.append({"k": k, "n": display_name(m.get("model_name")), "o": org_name(m.get("model_organization")),
                     "s": round(num(s["score"]) * 100, 1), "date": str(m.get("submission_date") or "")[:10]})
    rows.sort(key=lambda r: -r["s"])
    return rows


def fetch_taubench(prev=None):
    rows = parse_tau_voice(get(TAU_VOICE, timeout=40).json())
    if len(rows) < 3:
        raise ValueError(f"tau3-Voice leaderboard looks incomplete ({len(rows)} rows)")
    return {"voice": rows, "date": max(r["date"] for r in rows)}


def board_tau_voice(raw):
    t = raw.get("taubench") or {}
    if not t.get("voice"):
        return None
    return {"src": "taubench", "board": "τ³-Voice (real tasks by voice)", "date": t.get("date") or "", "url": TAU_PAGE,
            "rows": [dict(r) for r in t["voice"]]}


def consumer_makers():
    """Makers that have an app in the Cost data (ChatGPT, Claude, Gemini, Grok, ...)."""
    return {org_name(a.get("maker") or "").lower().split()[0] for a in PRICE_APPS if a.get("maker")} | \
           {str(a.get("maker") or "").lower().split()[0] for a in PRICE_APPS if a.get("maker")}


SEARCH_SUFFIX = re.compile(r"[\s\-]+(search|grounding)$", re.I)   # "claude-opus-4-6-search" = Claude Opus 4.6 with search


def finder_board(raw, src, bid):
    if src == "lmarena":
        b = board_lm(raw, bid)
        if b and bid == "search":
            rows, seen = [], set()
            for r in b["rows"]:
                k, n = SEARCH_SUFFIX.sub("", r["k"]), SEARCH_SUFFIX.sub("", str(r.get("n") or ""))
                if k in seen:
                    continue                          # the better-ranked run of the same model counts
                seen.add(k)
                rows.append(dict(r, k=k, n=n or k))
            b["rows"] = rows
        return b
    if src == "taubench":
        b = board_tau_voice(raw)
        if b:
            makers = consumer_makers()
            b["rows"] = [r for r in b["rows"] if str(r.get("o") or "").lower().split()[:1] and
                         str(r["o"]).lower().split()[0] in makers]
        return b
    return None


def finder_how(tid):
    return {
        "research": "LMArena Search Arena: people ask a question, two anonymous AIs search the web and answer, people vote "
                    "for the better answer. 1 source only, so nothing is called best.",
        "video": "LMArena video arenas: people vote between two anonymous videos made from the same prompt (text-to-video "
                 "decides the order; image-to-video is shown beside it). 1 source only.",
        "voice": "Sierra's τ³-Voice test: each AI's live voice mode has to finish real customer-service tasks by talking, "
                 "with noise and interruptions, in six languages. Only voice modes of apps listed here. 1 source only.",
        "translate": "LMArena, questions asked in languages other than English (people's votes). Hebrew and Yiddish are "
                     "not tested there; see the note from Intento's 2026 translation test. 1 source only.",
    }.get(tid, "")


def load_static(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as e:
        log(f"could not read {Path(path).name}: {e}")
        return None


def translation_note(path=None):
    t = load_static(path or TRANSLATION_FILE)
    if not t:
        return None
    return {"checked": t.get("checked"), "credit": (t.get("source") or {}).get("credit", ""), "unit": t.get("unit", ""),
            "langs": [{"lang": x["lang"], "line": x["line"], "url": x["url"], "app": x.get("app", "")} for x in t.get("langs") or []]}


def build_finder_tasks(raw, mods=None):
    names = names_index(raw)
    mods = mods if mods is not None else mods_index(raw)[0]
    text_votes = lm_votes(raw, "text")
    out = []
    for tid, label, icon, spec in FINDER_TASKS:
        boards = [b for b in (finder_board(raw, s, bid) for s, bid in spec) if b and b.get("rows")]
        if not boards or not boards[0]["rows"]:
            log(f"finder: no data for {tid}; left out today")
            continue
        nm = dict(names)
        for b in boards:                          # video / voice models are not in the text sources: use the board's names
            for r in b["rows"]:
                nm.setdefault(r["k"], {"n": r.get("n") or r["k"], "o": r.get("o") or ""})
        own_votes = lm_votes(raw, spec[0][1]) if spec[0][0] == "lmarena" else {}
        votes = text_votes if tid == "translate" else own_votes      # category boards use text-overall votes, arenas their own
        label_v = "text overall" if tid == "translate" else spec[0][1].replace("_", "-")
        first = boards[0]["rows"]
        ws = [describe(first[0]["k"], boards, nm, votes, label_v)]
        cs = [describe(r["k"], boards, nm, votes, label_v) for r in first[1:6]]
        for c in ws + cs:                          # 1 source: "covered by 1 of 2 boards" is not a reason to doubt
            c["why"] = [w for w in c["why"] if "sources have tested it" not in w]
            c["notSure"] = bool(c["why"])
        b0 = boards[0]
        task = {
            "id": tid, "label": label, "icon": icon, "status": "single", "need": 2, "n": 1, "finder": True,
            "winners": [slim(c, mods) for c in ws], "candidates": [slim(c, mods) for c in cs], "new": [],
            "why": (f"Top on {SRC[b0['src']]['name']} {b0['board']}. Only 1 source covers {label.lower()} right now, "
                    f"so nothing is called best."),
            "how": finder_how(tid), "usesAA": False,
            "boards": [{"src": b["src"], "name": SRC[b["src"]]["name"], "board": b["board"], "date": b.get("date") or "",
                        "url": b.get("url") or "", "top": [r.get("n") or r["k"] for r in b["rows"][:3]]} for b in boards],
        }
        if tid == "translate":
            note = translation_note()
            if note:
                task["note"] = note
        out.append(task)
    return out


def privacy_score(app, inc):
    """50% Incogni 2026 privacy-risk score (lower risk = better, scaled best..worst to 1..0) + 50% the 5 hand-checked
    facts (1 each; a fact only a news or third-party page supports counts half)."""
    span = (inc["worst"] - inc["best"]) or 1
    i = max(0.0, min(1.0, (inc["worst"] - app["incogni"]) / span))
    f = sum((0.5 if x.get("unverified") else 1.0) * (1 if x.get("v") else 0) for x in (app.get("facts") or {}).values())
    return round(0.5 * i + 0.5 * f / 5, 3), round(i, 3), round(f, 1)


def shared_ranks(values, higher_better):
    """Rank 1 = most private. Tied values share the average of their ranks (e.g. two apps at 3.5 -> 2.5 each)."""
    order = sorted(values, key=lambda k: -values[k] if higher_better else values[k])
    out, i = {}, 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in order[i:j + 1]:
            out[k] = (i + 1 + j + 1) / 2
        i = j + 1
    return out


def privacy_ranking(apps_raw):
    """v16h (owner, Nov 7 2026): the score is ONLY the 2 outside rankings - the average of each app's rank in Incogni 2026
    (risk points, lower = better) and ObscureIQ 2025 (score out of 5, higher = better); ties broken by the Incogni score.
    Returns {key: (avg_rank, incogni_rank, obscureiq_rank)} and the keys in order (most private first)."""
    inc = shared_ranks({k: a["incogni"] for k, a in apps_raw.items()}, higher_better=False)
    obs = shared_ranks({k: a["obscureiq"] for k, a in apps_raw.items()}, higher_better=True)
    avg = {k: (inc[k] + obs[k]) / 2 for k in apps_raw}
    order = sorted(apps_raw, key=lambda k: (avg[k], apps_raw[k]["incogni"], k))
    return {k: (avg[k], inc[k], obs[k]) for k in apps_raw}, order


def build_privacy(path=None):
    p = load_static(path or PRIVACY_FILE)
    if not p:
        return None
    inc, labels = p["incogni"], dict(p["facts"])
    ranks, order_keys = privacy_ranking(p["apps"])
    n_apps = len(order_keys)
    apps = {}
    for key, a in p["apps"].items():
        name = app_display(key)                               # "Le Chat" in the file -> "Vibe" in the app (v16h)
        _, inc_part, facts = privacy_score(a, inc)            # the 5 checks: information only, not in the score (v16h)
        avg_rank, inc_rank, obs_rank = ranks[key]
        score = round(1 - (avg_rank - 1) / ((n_apps - 1) or 1), 3)     # 1 = rank 1 in both rankings, 0 = last in both
        apps[name] = {"maker": a["maker"], "score": score, "avgRank": avg_rank, "ranks": {"incogni": inc_rank, "obscureiq": obs_rank},
                      "incogni": a["incogni"], "obscureiq": a["obscureiq"], "incogniPart": inc_part, "facts": facts,
                      "line": a["line"],
                      "checks": [{"id": fid, "label": labels.get(fid, fid), "ok": bool(x.get("v")),
                                  "unverified": bool(x.get("unverified")), "note": x.get("note", ""),
                                  "src": dict(a["sources"].get(x.get("src"), {}))} for fid, x in a["facts"].items()],
                      "sources": [dict(s, id=sid) for sid, s in a["sources"].items()]}
    order = [app_display(k) for k in order_keys]
    for i, n in enumerate(order):
        apps[n]["rank"] = i + 1
        if i and apps[n]["score"] >= apps[order[i - 1]]["score"]:          # a tie broken by Incogni: keep the score order
            apps[n]["score"] = round(apps[order[i - 1]]["score"] - 0.001, 3)
    stale = days_old(p.get("checked") or "2000-01-01") > PRIVACY_STALE_DAYS
    obs = p.get("obscureiq") or {}
    return {"checked": p.get("checked"), "stale": stale, "staleDays": PRIVACY_STALE_DAYS, "apps": apps, "order": order,
            "incogni": {k: inc[k] for k in ("name", "url", "published", "note")},
            "obscureiq": {k: obs.get(k) for k in ("name", "url", "published", "note")},
            "how": "Average of 2 independent privacy rankings: Incogni 2026 and ObscureIQ.",
            "checksNote": "The checks under each app are information from the companies' own pages; they don't count in the score."}


def build_finder(raw, mods=None):
    return {"tasks": build_finder_tasks(raw, mods), "privacy": build_privacy()}


# ======================================================================= cost, releases
# v16h: names the app SHOWS for an app whose maker renamed it. The saved data and scripts/privacy_static.json keep the old
# key, so nothing breaks; only data.json shows the new name (cost apps + Find your AI privacy rows), with "formerly".
# help.mistral.ai: "Le Chat is now Vibe" (renamed Aug 12, 2026); mistral.ai/pricing: plans are still "Pro" and "Team".
APP_DISPLAY = {"Le Chat": "Vibe"}


def app_display(name):
    return APP_DISPLAY.get(name, name)


def build_cost(raw, picks):
    apps = []
    for a in (raw.get("prices") or {}).get("apps") or []:
        paid = [p for p in a.get("plans") or [] if p.get("usd_month")]
        cheapest = min(paid, key=lambda p: p["usd_month"]) if paid else None
        shown = dict(a, cheapest=cheapest, app=app_display(a["app"]))
        if shown["app"] != a["app"]:
            shown["formerly"] = a["app"]
        apps.append(shown)
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


# ======================================================================= Agents tab
# "Best AI for agents" (the model inside an agent). Same idea as the Best tab, with 3 independent agent tests:
#   LMArena Agent Arena (people's votes), LiveBench Long Agentic (hidden tasks), APEX-Agents by Mercor (via Epoch AI).
#   Best = in the top 3 of at least 2 of the 3 tests. Every model that passes is shown (most tests first).
#   A test whose newest result is more than 120 days old is skipped (the Sources view says so).
#   Fewer than 2 usable tests = no model is named best.
# Extra tests shown under See more as information only (not in the rule): LiveBench Browser, Vending-Bench 2
# (Andon Labs, $ earned) and Remote Labor Index (Scale AI / CAIS), both via Epoch AI.
AGENT_NEED = 2
AGENT_MAX_AGE = 120
AGENT_TESTS = [  # id, name, credit, page, what it measures, license, license url, unit, in the rule
    ("arena", "LMArena Agent Arena", "LMArena (lmarena.ai)", "https://lmarena.ai/leaderboard/agent",
     "People give the same task to two hidden agents and vote for the one that did it better.", "CC BY 4.0", CC_BY, "num", True),
    ("lb_agentic", "LiveBench Long Agentic", "LiveBench (livebench.ai)", "https://livebench.ai/",
     "Long, many-step tasks done with tools. New, hidden tasks every release.", "", "", "num", True),
    ("apex", "APEX-Agents", "APEX-Agents by Mercor, via Epoch AI", "https://www.mercor.com/apex/",
     "Real work tasks from banking, consulting and law, done by an agent. Score = share solved on the first try.",
     "CC BY 4.0 (Epoch AI data)", CC_BY, "pct", True),
    ("lb_browser", "LiveBench Browser", "LiveBench (livebench.ai)", "https://livebench.ai/",
     "Tasks done in a web browser.", "", "", "num", False),
    ("vending", "Vending-Bench 2", "Vending-Bench 2 by Andon Labs, via Epoch AI", "https://andonlabs.com/evals/vending-bench-2",
     "An agent runs a pretend vending-machine business for a year. Score = money at the end.", "CC BY 4.0 (Epoch AI data)", CC_BY, "usd", False),
    ("rli", "Remote Labor Index", "Remote Labor Index by Scale AI and CAIS, via Epoch AI", "https://labs.scale.com/leaderboard/rli",
     "Real paid freelance projects. Score = share done well enough to be accepted.", "CC BY 4.0 (Epoch AI data)", CC_BY, "pct", False),
]


def agent_boards(raw):
    """Every agent test as a board {id, name, ..., rows, date, ok, updated, skipped, why}. Rows best first."""
    lm = (raw.get("lmarena") or {}).get("boards", {}).get("agent") or {}
    lb = raw.get("livebench") or {}
    ep = (raw.get("epoch") or {}).get("agent") or {}
    st_lm, st_lb = bool(raw.get("lmarena")) and not lm.get("stale"), bool(lb)
    def lbrows(cat):          # "Long Agentic" (categories.json name) or "long_agentic" (column name)
        out = []
        for r in lb.get("rows") or []:
            v = next((x for c, x in (r.get("cats") or {}).items() if c.replace("_", " ") == cat and x is not None), None)
            if v is not None:
                out.append({"k": r["k"], "n": r["n"], "s": v})
        return sorted(out, key=lambda x: -x["s"])
    data = {
        "arena": (lm.get("rows") or [], lm.get("date") or "", st_lm, (raw.get("lmarena") or {}).get("_updated")),
        "lb_agentic": (lbrows("long agentic"), lb.get("date") or "", st_lb, lb.get("_updated")),
        "lb_browser": (lbrows("browser"), lb.get("date") or "", st_lb, lb.get("_updated")),
    }
    for bid in ("apex", "vending", "rli"):
        b = ep.get(bid) or {}
        data[bid] = (b.get("rows") or [], b.get("newest") or "", bool(b.get("ok")), b.get("updated"))
    cut = (NOW - timedelta(days=AGENT_MAX_AGE)).date().isoformat()
    out = []
    for bid, name, credit, url, what, lic, lic_url, unit, in_rule in AGENT_TESTS:
        rows, date, ok, upd = data[bid]
        why = ""
        if not rows:
            why = "no data yet"
        elif not date or date < cut:
            why = f"newest result is from {date or 'an unknown date'}, more than {AGENT_MAX_AGE} days ago"
        out.append({"id": bid, "name": name, "credit": credit, "url": url, "what": what, "license": lic, "licenseUrl": lic_url,
                    "unit": unit, "inRule": in_rule, "date": date, "ok": ok, "updated": upd, "skipped": bool(why), "skipWhy": why,
                    "rows": rows})
    return out


def agent_rank(b, k):
    idx = next((i for i, r in enumerate(b["rows"]) if r["k"] == k), None)
    info = {"test": b["id"], "name": b["name"], "date": b["date"], "url": b["url"], "unit": b["unit"], "rank": None}
    if idx is not None:
        info.update(rank=idx + 1, score=b["rows"][idx]["s"], top3=idx < 3)
    return info


def agent_pick(raw, names=None):
    """The rule. Returns {status, need, n, winners, candidates, why, tests}."""
    names = names if names is not None else names_index(raw)
    boards = agent_boards(raw)
    use = [b for b in boards if b["inRule"] and not b["skipped"]]
    n = len(use)
    def who(k, b_rows):
        nm = names.get(k) or {}
        first = next((r for b in b_rows for r in b["rows"] if r["k"] == k), {})
        return nm.get("n") or first.get("n") or k, nm.get("o") or first.get("o") or ""
    cands = []
    for b in use:
        for r in b["rows"][:3]:
            if r["k"] not in cands:
                cands.append(r["k"])
    desc = []
    for k in cands:
        ranks = [agent_rank(b, k) for b in use]
        top3 = sum(1 for x in ranks if x.get("top3"))
        ranked = [x["rank"] for x in ranks if x["rank"]]
        nm, org = who(k, use)
        desc.append({"k": k, "n": nm, "o": org, "top3": top3, "covered": len(ranked), "ranks": ranks,
                     "avg": round(sum(ranked) / len(ranked), 2) if ranked else 99})
    desc.sort(key=lambda c: (-c["top3"], c["avg"], c["n"]))
    need = AGENT_NEED
    win = [c for c in desc if c["top3"] >= need] if n >= need else []
    if win:
        status = "best"
        why = (f"Named best because it is in the top 3 of at least {need} of the {n} independent agent tests "
               f"({', '.join(b['name'] for b in use)}).")
    elif desc:
        # v16h "always a winner": the model in the top 3 of the most agent tests (then best average rank) leads;
        # with only 1 test, that test's #1
        win, status = desc[:1], "lead"
        c = desc[0]
        where = f"the only agent test with fresh data ({use[0]['name']})" if n == 1 else f"{c['top3']} of {n} agent tests"
        why = f"Top 3 in {where}" + (", best average rank." if n > 1 and any(x["top3"] == c["top3"] for x in desc[1:]) else ".")
    else:
        win, status = [], "none"
        why = "No agent test has fresh data right now."
    for c in desc:
        c.pop("avg", None)
    return {"status": status, "need": need, "n": n, "winners": win, "candidates": [c for c in desc if c not in win][:5],
            "why": why, "testsUsed": [b["id"] for b in use]}


# ---------------------------------------------------------------- agent news
# From the feeds and company pages the app already reads. Kept: a title with an agent word, newer than 14 days,
# that isn't dropped by a rule below or by the Big news drop rules (opinion, lawsuits, rumors, partnerships,
# money talk, safety essays, customer stories, how-tos). Newest first, up to 8, the same story once.
AGENT_NEWS_DAYS = 14
AGENT_NEWS_MAX = 8
AGENT_WORDS = re.compile(r"\b(agents?|agentic|Codex|Claude Code|Cowork|computer use|ChatGPT Work|Gemini Agent|Antigravity|Jules|"
                         r"Manus|Comet|Devin|Copilot agent)\b", re.I)
PRODUCTS = r"(?:OpenAI|ChatGPT(?: Work| Enterprise| Edu)?|Codex|Claude(?: Code)?|Cowork|Gemini(?: Enterprise)?|(?:Google )?Antigravity|Jules|Copilot|GPT-[\d.]+[\w\- ]{0,12}|OpenAI models)"
AGENT_DROP = [
    ("customer story", re.compile(r"\bwith " + PRODUCTS + r"\b|\bbrings? (?:ChatGPT|Claude|Codex|Gemini|Copilot)\b|\bis building\b|"
                                  r"\bpowered by\b|\bputs .{0,30}\bto work\b|\d+% (?:less|more|faster)\b|\b(?:triples|doubles|halves)\b", re.I)),
    ("customer story", re.compile(r"\bwith [A-Z][\w&.\-]{1,30}$")),          # "Advancing computer use with Ironclad"
    ("explainer", re.compile(r"\bhow\b|^Why\b|^What\b|\bexplained\b", re.I)),
    ("first person / opinion", re.compile(r"^I\b|\bI (?:put|tried|let|gave|asked|tested|used)\b|\bmy\b|\bwe tested\b|"
                                          r"\b(?:we|you) (?:urgently )?(?:need|must|should)\b|\bshould\b", re.I)),
    ("policy", re.compile(r"\b(EU|EU’s|EU's|European|government|policy|plan would|bill)\b", re.I)),
    ("rumor", re.compile(r"\bwould\b|\bsoon\b", re.I)),
    ("essay", re.compile(r"\bnext chapter\b|\bfuture of\b|\bera of\b|\bthe case for\b|\bis agentic\b", re.I)),
]


VENDOR_BLOGS = ("NVIDIA", "Hugging Face")     # tutorials and marketing, unless the post launches something


def classify_agent_news(title, source=""):
    """(tag, reason). tag '' = dropped."""
    t = " ".join(str(title or "").split())
    if not AGENT_WORDS.search(t):
        return "", "dropped: no agent word"
    for name, rx in AGENT_DROP + DROP_RULES:
        if rx.search(t):
            return "", "dropped: " + name
    if source in VENDOR_BLOGS and not LAUNCH_RE.search(t):
        return "", "dropped: vendor blog post, not a launch"
    if LAUNCH_RE.search(t) or re.search(r"\b(new|introducing|now)\b", t, re.I):
        return "Launch", "agent word + launch word"
    return "News", "agent word"


def _agent_pool(items, official):
    """Official page posts first, so the company's own copy wins when a feed has the same link."""
    pool = [dict(p, k="official", d=p["d"] + "T12:00:00+00:00") for p in official or []] + [dict(i) for i in items or []]
    seen, out = set(), []
    for it in pool:
        if it["u"] in seen:
            continue
        seen.add(it["u"])
        out.append(it)
    return out


def agent_news(items, official=None, days=AGENT_NEWS_DAYS, limit=AGENT_NEWS_MAX):
    cut = (NOW - timedelta(days=days)).date().isoformat()
    kept = []
    for it in _agent_pool(items, official):
        if (it.get("d") or "")[:10] < cut or (it.get("d") or "")[:10] > TODAY:
            continue
        tag, why = classify_agent_news(it["t"], it.get("s", ""))
        if tag:
            kept.append(dict(it, tag=tag, why=why))
    kept.sort(key=lambda x: (SRC_RANK.get(x.get("k"), 3), x["d"]))      # the company's own copy of a story first
    uniq = []
    for it in kept:
        if not any(same_story(it["t"], k["t"]) for k in uniq):
            uniq.append(it)
    uniq.sort(key=lambda x: x["d"], reverse=True)
    return [{"t": k["t"], "u": k["u"], "s": k["s"], "d": k["d"], "tag": k["tag"], "x": k.get("x", ""), "official": k.get("k") == "official"}
            for k in uniq[:limit]]


def agent_news_report(items, official=None, days=AGENT_NEWS_DAYS):
    """(kept, dropped) [(reason, date, source, title)] for titles with an agent word in the window: for logs and tests."""
    cut = (NOW - timedelta(days=days)).date().isoformat()
    kept, dropped = [], []
    for it in _agent_pool(items, official):
        d = (it.get("d") or "")[:10]
        if d < cut or d > TODAY or not AGENT_WORDS.search(it["t"]):
            continue
        tag, why = classify_agent_news(it["t"], it.get("s", ""))
        (kept if tag else dropped).append((tag or why, d, it.get("s", ""), it["t"]))
    return kept, dropped


def fmt_score(v, unit):
    if v is None:
        return ""
    if unit == "pct":
        return f"{v * 100:.1f}%"
    if unit == "usd":
        return f"${v:,.0f}"
    return f"{v:g}" if abs(v) >= 1 else f"{v:.3f}"


def build_agents(raw, news_items, official, summaries=None):
    names = names_index(raw)
    pick = agent_pick(raw, names)
    mods, _ = mods_index(raw)
    for c in pick["winners"] + pick["candidates"]:
        c["fast"] = is_fast(c["n"], mods.get(c["k"]))
        for x in c["ranks"]:
            x["shown"] = fmt_score(x.get("score"), x["unit"])
    tests = []
    for b in agent_boards(raw):
        top = [{"k": r["k"], "n": (names.get(r["k"]) or {}).get("n") or r["n"], "o": (names.get(r["k"]) or {}).get("o") or r.get("o", ""),
                "s": r["s"], "shown": fmt_score(r["s"], b["unit"])} for r in b["rows"][:5]]
        tests.append({k: b[k] for k in b if k != "rows"} | {"top": top, "count": len(b["rows"])})
    return {"best": pick, "tests": tests, "rule": f"A model is named best for agents only when it is in the top 3 of at least "
                                                    f"{AGENT_NEED} of the 3 independent agent tests.",
            "apps": build_agent_apps(raw), "groups": [{"id": g, "label": l} for g, l in AGENT_GROUPS],
            "news": {"items": fill_summaries(agent_news(news_items, official), summaries if summaries is not None else {}, 0 if summaries is None else SUMMARY_FETCH_MAX), "days": AGENT_NEWS_DAYS, "max": AGENT_NEWS_MAX,
                     "rules": "Titles about AI agents from the last 14 days. Customer stories, opinion, lawsuits, policy, "
                              "rumors and how-tos are left out."},
            "maxAge": AGENT_MAX_AGE, "staleDays": STALE_DAYS}


# ======================================================================= main
SECTIONS = [("lmarena", fetch_lmarena), ("aa", fetch_aa), ("livebench", fetch_livebench), ("epoch", fetch_epoch),
            ("openrouter", fetch_openrouter), ("official", fetch_official), ("prices", fetch_prices), ("news", fetch_news),
            ("agentapps", fetch_agentapps), ("taubench", fetch_taubench)]
TEXT_SOURCES = ("lmarena", "aa", "livebench", "epoch")
SOURCE_ORDER = ("lmarena", "aa", "livebench", "epoch", "openrouter", "official", "prices", "news", "agentapps", "taubench")


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
    for x in (d.get("agents") or {}).get("tests") or []:
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
    global PAGE_CACHE
    PAGE_CACHE = {}                   # a page is read once per run, even when two parts of the app need it
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
    for sec in ("prices", "agentapps"):
        if raw.get(sec) and status.get(sec, {}).get("ok"):
            pr = raw[sec]
            status[sec]["note"] = f"{pr.get('pages_read', 0)} of {pr.get('apps_total', 0)} apps read today"
    if raw.get("epoch") and status.get("epoch", {}).get("ok"):
        bad = [b for b, v in (raw["epoch"].get("agent") or {}).items() if not v.get("ok")]
        if bad:
            status["epoch"]["note"] = "kept last good copy for: " + ", ".join(bad)
    stale = stale_prices(raw.get("prices")) + stale_prices(raw.get("agentapps"))
    for x in stale:
        what = f"{x['plan']} ${x['usd_month']}" if x["plan"] else "page"
        log(f"STALE price: {x['app']} {what} last checked {x['checked']} (more than {STALE_DAYS} days ago)")

    picks = build_picks(raw, aa_on)
    if len(picks) < 3:
        log(f"only {len(picks)} picks; not writing")
        return 4
    news_items = (raw.get("news") or {}).get("items") or []
    ri = rule_info(aa_on)
    summaries = dict(prev_raw.get("summaries") or {})             # v16h: {url: summary}, so each page is fetched once
    out = {
        "v": VERSION, "built": NOW_ISO, "aaEnabled": aa_on, "status": status,
        "sources": [dict(SRC[k], id=k) for k in SOURCE_ORDER if k != "aa" or aa_on],
        "picks": picks,
        "cost": build_cost(raw, picks),
        "releases": build_releases(raw),
        "bignews": {"items": fill_summaries(big_news(news_items, official_posts(raw)), summaries), "feeds": (raw.get("news") or {}).get("feeds") or [],
                    "rules": "Only new model launches, big price changes, major product launches or shutdowns by AI labs, "
                             "funding of about $1B or more, acquisitions of or by AI labs, and IPO filings."},
        "officialSources": official_status(raw),
        "agents": build_agents(raw, news_items, official_posts(raw), summaries),
        "finder": build_finder(raw),
        "stalePrices": stale, "staleDays": STALE_DAYS,
        "rule": ri["text"], "ruleInfo": ri, "fastNote": FAST_NOTE, "fastWords": list(FAST_WORDS),
    }
    shown = {it["u"] for it in out["bignews"]["items"] + out["agents"]["news"]["items"]}
    raw["summaries"] = {u: x for u, x in summaries.items() if u in shown}      # only what is still shown
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
