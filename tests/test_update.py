"""Tests for scripts/update_data.py. No network: every source is replaced by a small fake that has the
same shape as the real one (see sources_research.md and aa_api_notes.md).

Run:  python -m unittest discover -s tests -v      (or: python tests/test_update.py)
"""
import gzip, importlib.util, io, json, os, re, shutil, sys, tempfile, unittest, zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"    # real pages fetched on 2026-11-01 and 2026-11-02 (gzipped)
# The tests run "on" 2026-11-01 22:00 UTC so the real fixtures keep falling inside the 30/60/120-day windows.
FIXED_NOW = __import__("datetime").datetime(2026, 11, 1, 22, 0, tzinfo=__import__("datetime").timezone.utc)


def load(root):
    """Load a fresh copy of the script that reads and writes data/ under `root`."""
    spec = importlib.util.spec_from_file_location("ud_" + str(abs(hash(str(root)))), REPO / "scripts" / "update_data.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.DATA_DIR = Path(root) / "data"
    m.OUT_JSON = m.DATA_DIR / "data.json"
    m.OUT_JS = m.DATA_DIR / "data.js"
    m.RAW_JSON = m.DATA_DIR / "raw.json"
    m.NOW, m.NOW_ISO, m.TODAY = FIXED_NOW, FIXED_NOW.isoformat(timespec="seconds"), FIXED_NOW.date().isoformat()
    m.sleep = lambda s: None
    return m


def fx(name):
    return gzip.open(FIXTURES / (name + ".gz")).read()


# ------------------------------------------------------------------ fake sources
NOW = FIXED_NOW


def lm(name, org, s, half, votes, cat="overall", date="2026-10-28"):
    return {"model_name": name, "organization": org, "rating": s, "rating_lower": s - half, "rating_upper": s + half,
            "vote_count": votes, "category": cat, "leaderboard_publish_date": date}


FILLER = [("qwen3-max", "Alibaba"), ("deepseek-v4-1-flash", "DeepSeek"), ("grok-4-7", "xAI"), ("kimi-k3-1-pro", "Moonshot"),
          ("mistral-large-4", "Mistral"), ("glm-5-3", "Z.ai"), ("muse-spark", "Meta"), ("gpt-6-luna", "OpenAI"),
          ("claude-haiku-5-5", "Anthropic"), ("gemini-3-7-flash", "Google"), ("minimax-m3-1", "MiniMax"), ("llama-5-70b", "Meta")]


def lm_text_rows():
    rows = []
    def board(cat, top):
        for n, o, s, half, v in top:
            rows.append(lm(n, o, s, half, v, cat))
        base = top[-1][2] - 12
        for i, (n, o) in enumerate(FILLER):
            rows.append(lm(n, o, base - i * 4, 6, 20000, cat))
    board("overall", [("gemini-4-carbon-high", "Google", 1540, 9.3, 4403), ("gemini-4-argon", "Google", 1529, 6.5, 11889),
                      ("claude-opus-5-5-20260922", "Anthropic", 1516, 6.5, 11415), ("claude-fable-5-1", "Anthropic", 1514, 5, 17200),
                      ("gpt-6-1-sol", "OpenAI", 1488, 6, 9367), ("claude-sonnet-5-5", "Anthropic", 1480, 6, 10033),
                      ("gpt-6-1-terra", "OpenAI", 1470, 9, 3000)])
    # like the real board: GPT-6 Astra is #75 on text overall with 15,038 votes (must still count as covered)
    for i in range(60):
        rows.append(lm(f"long-tail-model-{i}", "Other", 1380 - i, 6, 6000))
    rows.append(lm("gpt-6-astra", "OpenAI", 1300, 5, 15038))
    board("coding", [("gemini-4-carbon-high", "Google", 1569, 18, 1106), ("claude-opus-5-5-20260922", "Anthropic", 1547, 12, 2555),
                     ("gemini-4-argon", "Google", 1538, 11, 2813), ("gpt-6-astra", "OpenAI", 1520, 10, 3000)])
    board("creative_writing", [("claude-fable-5-1", "Anthropic", 1530, 8, 3100), ("claude-opus-5-5-20260922", "Anthropic", 1522, 8, 2672),
                               ("gemini-4-argon", "Google", 1510, 8, 7000), ("gpt-6-astra", "OpenAI", 1490, 8, 6000)])
    board("math", [("gpt-6-astra", "OpenAI", 1540, 10, 6000), ("gemini-4-argon", "Google", 1532, 10, 7000),
                   ("claude-opus-5-5-20260922", "Anthropic", 1525, 10, 7000), ("gpt-6-1-sol", "OpenAI", 1520, 10, 5000)])
    # an older publish date that must be ignored
    rows.append(lm("old-model", "Old", 1700, 5, 99999, "overall", date="2026-09-01"))
    return rows


def lm_webdev_rows():
    top = [("claude-opus-5-5-max", "Anthropic", 1810, 6.5, 3473), ("gpt-6-astra-max", "OpenAI", 1773, 5, 7210),
           ("claude-sonnet-5-5-xhigh", "Anthropic", 1770, 6, 4469), ("gemini-4-argon", "Google", 1750, 6, 6000)]
    rows = [lm(n, o, s, h, v) for n, o, s, h, v in top]
    rows += [lm(n, o, 1700 - i * 5, 6, 9000) for i, (n, o) in enumerate(FILLER)]
    return rows


def lm_image_rows():
    top = [("gpt-image-2.5-sunburst", "OpenAI", 1427, 4, 40000), ("gpt-image-2.5-flare", "OpenAI", 1405, 5, 30000),
           ("nano-banana-pro", "Google", 1390, 5, 50000), ("gpt-image-2", "OpenAI", 1380, 5, 60000),
           ("flux-2-max", "Black Forest Labs", 1350, 5, 30000), ("seedream-5", "ByteDance", 1340, 5, 30000),
           ("imagen-5", "Google", 1330, 5, 30000), ("ideogram-4", "Ideogram", 1320, 5, 30000),
           ("midjourney-v8", "Midjourney", 1310, 5, 30000), ("recraft-v4", "Recraft", 1300, 5, 30000)]
    return [lm(n, o, s, h, v, date="2026-10-26") for n, o, s, h, v in top]


def lm_agent_rows():
    """The real Agent Arena board (lmarena_agent_latest.parquet, saved as JSON so the tests don't need pyarrow)."""
    return json.loads(fx("lmarena_agent_latest.json"))


LM_ROWS = {"text": lm_text_rows, "webdev": lm_webdev_rows, "text_to_image": lm_image_rows, "agent": lm_agent_rows}

AA_TOP = [("Gemini 4 Carbon (High)", "gemini-4-carbon", "Google", 59.4, 4, 20, "2026-10-28"),
          ("Claude Opus 5.5 (max with fallback)", "claude-opus-5-5", "Anthropic", 58.4, 4, 20, "2026-09-22"),
          ("Claude Opus 5.5 (High)", "claude-opus-5-5", "Anthropic", 56.0, 4, 20, "2026-09-22"),
          ("GPT-6 Astra (max)", "gpt-6-astra", "OpenAI", 56.9, 10, 50, "2026-09-04"),
          ("GPT-6.1 Sol (max)", "gpt-6-1-sol", "OpenAI", 54.5, 2, 10, "2026-09-29"),
          ("Claude Sonnet 5.5 (max)", "claude-sonnet-5-5", "Anthropic", 54.2, 2, 10, "2026-10-14"),
          ("GPT-6.1 Terra (max)", "gpt-6-1-terra", "OpenAI", 53.0, 1, 5, "2026-10-26"),
          ("Claude Fable 5.1", "claude-fable-5-1", "Anthropic", 52.8, 10, 50, "2026-07-01"),
          ("Gemini 4 Argon (High)", "gemini-4-argon", "Google", 52.5, 2, 12, "2026-10-08")]


def aa_records():
    recs = []
    for name, slug, org, iq, pin, pout, rel in AA_TOP:
        recs.append({"id": slug, "name": name, "slug": slug, "release_date": rel, "model_creator": {"id": org, "name": org},
                     "evaluations": {"artificial_analysis_intelligence_index": iq, "artificial_analysis_coding_index": None},
                     "pricing": {"price_1m_input_tokens": pin, "price_1m_output_tokens": pout}})
    for i in range(30):
        recs.append({"id": f"m{i}", "name": f"Filler Model {i} (High)", "slug": f"filler-model-{i}", "release_date": "2025-12-01",
                     "model_creator": {"name": "Other"}, "evaluations": {"artificial_analysis_intelligence_index": 40 - i * 0.5},
                     "pricing": {"price_1m_input_tokens": 0.5, "price_1m_output_tokens": 2}})
    recs.append({"id": "glm", "name": "GLM-4.5V (Non-reasoning)", "slug": "glm-4-5v", "release_date": "2025-08-11",
                 "model_creator": {"name": "Z AI"}, "evaluations": {"artificial_analysis_intelligence_index": None},
                 "pricing": {"price_1m_input_tokens": 0.6, "price_1m_output_tokens": 1.8}})
    return recs


def aa_pages():
    r = aa_records()
    return [{"tier": "free", "intelligence_index_version": 5, "pagination": {"page": 1, "page_size": 20, "total_pages": 2, "has_more": True}, "data": r[:20]},
            {"tier": "free", "intelligence_index_version": 5, "pagination": {"page": 2, "page_size": 20, "total_pages": 2, "has_more": False}, "data": r[20:]}]


def aa_image():
    top = [("GPT Image 2.5 Sunburst (max)", "gpt-image-2.5-sunburst-2026-09-08", 1222, 10), ("GPT Image 2.5 Flare (max)", "gpt-image-2.5-flare-2026-09-08", 1207, 10),
           ("GPT Image 2 (high)", "gpt-image-2", 1186, 11), ("Nano Banana Pro", "nano-banana-pro", 1180, 9), ("FLUX.2 [max]", "flux-2-max", 1150, 9),
           ("Seedream 5", "seedream-5", 1140, 9), ("Imagen 5", "imagen-5", 1130, 9), ("Ideogram 4", "ideogram-4", 1120, 9),
           ("Midjourney v8", "midjourney-v8", 1110, 9), ("Recraft V4", "recraft-v4", 1100, 9), ("Older Model", "older", 1000, 9)]
    return {"data": [{"id": s, "name": n, "slug": s, "model_creator": {"name": "OpenAI" if "GPT" in n else "Other"}, "elo": e, "ci_95": c} for n, s, e, c in top]}


LB_CATS = ["long_agentic", "reasoning", "coding", "browser", "data_analysis", "research", "design"]
LB_ROWS = [("claude-fable-5-1-thinking", [90, 88, 97.7, 80, 85, 84, 83]), ("gpt-6-astra-max", [89, 92, 95.0, 82, 86, 85, 80]),
           ("claude-opus-5-5-thinking-high", [88, 87, 96.3, 81, 84, 83, 85]), ("gpt-6-1-sol-xhigh", [87, 86, 96.0, 80, 83, 82, 81]),
           ("claude-sonnet-5-5", [82, 80, 92, 75, 80, 78, 79]), ("gemini-4-argon-high", [80, 85, 90, 74, 79, 77, 76])]
LB_ROWS += [(n, [70 - i] * 7) for i, (n, _) in enumerate(FILLER[:8])]


def lb_table():
    out = io.StringIO()
    w = io.StringIO()
    out.write("model," + ",".join(LB_CATS) + "\n")
    for n, vals in LB_ROWS:
        out.write(n + "," + ",".join(str(v) for v in vals) + "\n")
    return out.getvalue()


EPOCH = [("GPT-6 Astra", 169.1, 165.9, 174.3, "OpenAI"), ("Claude Opus 5.5", 168.4, 165.4, 173.0, "Anthropic"),
         ("GPT-6.1 Terra", 168.1, 165.0, 172.0, "OpenAI"), ("GPT-6.1 Sol", 167.8, 164.8, 171.5, "OpenAI"),
         ("Claude Sonnet 5.5", 166.7, 163.0, 170.0, "Anthropic"), ("Claude Fable 5.1", 166.4, 163.0, 170.0, "Anthropic"),
         ("Gemini 4 Argon", 166.1, 162.5, 169.8, "Google")]
EPOCH += [(n.replace("-", " ").title(), 160 - i, 157 - i, 163 - i, o) for i, (n, o) in enumerate(FILLER)]
EPOCH += [(f"Older Model {i}", 140 - i, 137 - i, 143 - i, "Other") for i in range(10)]


def epoch_zip():
    csvt = "Model,eci,eci_ci_low,eci_ci_high,date,Organization\n" + "".join(f"{n},{e},{lo},{hi},2026-10-01,{o}\n" for n, e, lo, hi, o in EPOCH)
    real = zipfile.ZipFile(io.BytesIO(fx("epoch_agent_subset.zip")))      # the real agent test CSVs
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("epoch_capabilities_index/eci_scores.csv", csvt)
        z.writestr("benchmarks/other.csv", "x\n1\n")
        for n in real.namelist():
            if n.endswith(".csv") and n != "benchmark_metadata.csv":
                z.writestr("benchmarks/" + n, real.read(n))
    return b.getvalue()


def openrouter():
    def m(mid, name, days, pin, pout):
        return {"id": mid, "name": name, "created": int((NOW - timedelta(days=days)).timestamp()),
                "pricing": {"prompt": str(pin / 1e6), "completion": str(pout / 1e6)}}
    data = [m("openai/gpt-6.1-terra", "OpenAI: GPT-6.1 Terra", 6, 1, 5), m("openai/gpt-6.1-terra-pro", "OpenAI: GPT-6.1 Terra Pro", 6, 1, 5),
            m("moonshotai/kimi-k3.1-pro", "MoonshotAI: Kimi K3.1 Pro", 9, 2, 10), m("deepseek/deepseek-v4.1-flash", "DeepSeek: DeepSeek V4.1 Flash", 15, 0.1, 0.4),
            m("anthropic/claude-sonnet-5.5", "Anthropic: Claude Sonnet 5.5", 18, 2, 10), m("google/gemini-4-argon", "Google: Gemini 4 Argon", 24, 2, 12),
            m("openai/gpt-6.1-sol", "OpenAI: GPT-6.1 Sol", 33, 2, 10), m("anthropic/claude-opus-5.5", "Anthropic: Claude Opus 5.5", 40, 4, 20),
            m("openai/gpt-6-astra", "OpenAI: GPT-6 Astra", 57, 10, 50), m("anthropic/claude-haiku-5.5", "Anthropic: Claude Haiku 5.5", 25, 0.8, 4),
            m("x-ai/grok-4.7", "xAI: Grok 4.7", 41, 2, 6), m("someone/unknown-lab-model", "Unknown", 3, 1, 1),
            m("openai/gpt-6.1-terra:free", "free variant", 6, 0, 0)]
    data += [m(f"qwen/qwen-filler-{i}", f"Qwen: Filler {i}", 100 + i, 0.3, 1.2) for i in range(20)]
    return {"data": data}


def rss(items):
    body = "".join(f"<item><title>{t}</title><link>{u}</link><pubDate>{(NOW - timedelta(hours=h)).strftime('%a, %d %b %Y %H:%M:%S +0000')}</pubDate>"
                   f"<description>{d}</description></item>" for t, u, h, d in items)
    return f'<?xml version="1.0"?><rss><channel>{body}</channel></rss>'.encode()


NEWS = {
    "TechCrunch": [("OpenAI launches GPT-6.1 Terra, cutting the price in half", "https://techcrunch.com/a1", 30, "New mid-size model."),
                   ("Anthropic raises $30 billion at a new valuation", "https://techcrunch.com/a2", 50, ""),
                   ("How to write better prompts: 10 tips", "https://techcrunch.com/a3", 20, ""),
                   ("Judge allows NAACP lawsuit over xAI data center pollution to move forward", "https://techcrunch.com/a4", 10, "")],
    "The Verge": [("OpenAI releases GPT-6.1 Terra with lower prices", "https://theverge.com/b1", 28, "Terra model."),
                  ("Google introduces Gemini 4 Carbon for security teams", "https://theverge.com/b2", 40, ""),
                  ("The best laptops for students", "https://theverge.com/b3", 5, "")],
    "OpenAI": [("Introducing GPT-6.1 Terra", "https://openai.com/c1", 31, "Our new model."), ("Our approach to the elections", "https://openai.com/c2", 60, "")],
    "Ars Technica": [("Moonshot unveils Kimi K3.1 Pro model", "https://arstechnica.com/d1", 200, ""),
                     ("ChatGPT Plus subscription price goes up to $25 per month", "https://arstechnica.com/d2", 90, ""),
                     ("A podcast about AI", "https://arstechnica.com/d3", 70, "")],
}

PRICE_HTML = {
    "https://x.ai/pricing": "<div>Free $0/month Get started Plus $8/month Get Plus Premium $30/month Get Premium Super $100/month Get Super Ultra $250/month</div>" + " filler" * 60,
    "https://gemini.google/subscriptions/": "<p>Free $0 / month with a Google Account</p><p>Google AI Plus $4.99 / month Get 2x higher usage</p><p>Google AI Pro $19.99 / month Get 4x higher usage</p><p>Google AI Ultra Starting at: $99.99 / month</p><p>Gemini in Chrome with auto browse</p>" + " filler" * 60,
    "https://mistral.ai/pricing": "<p>Free</p><p>Pro ... $14.99 /mo</p><p>Team ... $24.99 /user/mo</p>" + " filler" * 60,
    "https://www.deepseek.com/en/": "<p>DeepSeek free chat</p>" + " filler" * 60,
}


# v7b: the 35 hand-checked agents. Their makers' pages aren't saved here; each fake page holds the app name and the
# quote that was read on 2026-11-02, which is what the daily "page still up" check looks for (the proof word).
STATIC = json.loads((REPO / "scripts" / "agents_static.json").read_text(encoding="utf-8"))
STATIC_PAGES = {}
for _x in STATIC:
    STATIC_PAGES.setdefault(_x["check"]["url"], "<html><body>")
    STATIC_PAGES[_x["check"]["url"]] += f"<h1>{_x['app']}</h1><p>{_x['evidence']}</p>"


class Resp:
    def __init__(self, content=b"", status=200):
        self.content = content if isinstance(content, bytes) else content.encode()
        self.status_code = status

    @property
    def text(self):
        return self.content.decode("utf-8", "replace")

    def json(self):
        return json.loads(self.content)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


# real pages (fixtures) for the official release pages, the App Store listings and x.ai/pricing
FX_URLS = {
    "https://openai.com/news/rss.xml": "rel_openai_rss.xml",
    "https://deepmind.google/blog/rss.xml": "rel_deepmind_rss.xml",
    "https://blog.google/technology/ai/rss/": "rel_google_ai_rss.xml",
    "https://mistral.ai/news/rss": "rel_mistral_rss.xml",
    "https://www.anthropic.com/news": "rel_anthropic_news.html",
    "https://x.ai/news": "rel_xai_news.html",
    "https://ai.meta.com/blog/": "rel_meta_ai_blog.html",
    "https://api-docs.deepseek.com/updates/": "rel_deepseek_updates.html",
    "https://apps.apple.com/us/app/chatgpt/id6448311069": "appstore_chatgpt.html",
    "https://apps.apple.com/us/app/perplexity-ask-anything/id1668000334": "appstore_perplexity.html",
    "https://apps.apple.com/us/app/grok/id6670324846": "appstore_grok.html",
    "https://itunes.apple.com/lookup?id=1558240027&country=us": "itunes_lookup.json",
    "https://x.ai/pricing": "xai_pricing.html",
    "https://www.deepseek.com/en/": "deepseek_home.html",
    # v6: agent apps (saved 2026-11-02)
    "https://claude.com/pricing": "web_claude_pricing.html",
    "https://developers.openai.com/codex/pricing": "web_codex_pricing.html",
    "https://one.google.com/intl/en_us/about/google-ai-plans/": "web_google_ai_plans.html",
    "https://jules.google/": "web_jules.html",
    "https://github.com/features/copilot/plans": "web_copilot_plans.html",
    "https://cursor.com/pricing": "web_cursor_pricing.html",
    "https://devin.ai/pricing": "web_devin_pricing.html",
    "https://replit.com/pricing": "web_replit_pricing.html",
    "https://apps.apple.com/us/app/comet-ai-browser-assistant/id6748622471": "appstore_comet.html",
    "https://help.manus.im/en/articles/11711111-what-is-the-current-membership-pricing-for-manus": "web_manus_help.html",
    "https://instinct.com/": "web_instinct_home.html",
    "https://apps.apple.com/us/app/replit-vibe-code-with-ai-fast/id1614022293": "appstore_replit.html",
}


def fake_get(url, timeout=None, headers=None, **kw):
    if url in FX_URLS:
        return Resp(fx(FX_URLS[url]))
    if "lmarena-ai/leaderboard-dataset" in url:
        cfg = url.split("parquet/")[1].split("/")[0]
        if cfg not in LM_ROWS:
            raise RuntimeError("404")
        return Resp(cfg.encode())
    if url == "https://livebench.ai/":
        return Resp('<html><script defer="defer" src="./static/js/main.1e1ce12d.js"></script></html>')
    if url == "https://livebench.ai/static/js/main.1e1ce12d.js":
        return Resp('var x=1;const Yt=["20261014","20261025"];var z=["20250101"];')
    if url == "https://livebench.ai/data/20261025/table.csv":
        return Resp(lb_table())
    if url == "https://livebench.ai/data/20261025/categories.json":
        return Resp(json.dumps({c: [c] for c in LB_CATS}))
    if url.startswith("https://epoch.ai/data/benchmark_data.zip"):
        return Resp(epoch_zip())
    if url.startswith("https://openrouter.ai/api/v1/models"):
        return Resp(json.dumps(openrouter()))
    if url in STATIC_PAGES:
        return Resp(STATIC_PAGES[url])
    if url in PRICE_HTML:
        return Resp(PRICE_HTML[url])
    for name, items in NEWS.items():
        feed = {"TechCrunch": "techcrunch.com", "The Verge": "theverge.com", "OpenAI": "openai.com/news", "Ars Technica": "arstechnica.com"}[name]
        if feed in url:
            return Resp(rss(items))
    return Resp(b"", 403)


def fake_aa_get(url):
    if "/language/models/free" in url:
        page = int(url.split("page=")[1])
        return aa_pages()[page - 1]
    if "text-to-image" in url:
        return aa_image()
    raise RuntimeError("unknown AA url")


def install_fakes(m, aa=True):
    m.get = fake_get
    m.sleep = lambda s: None          # skip the pricing-page retry pause in tests
    m.read_parquet = lambda raw: LM_ROWS[raw.decode()]()
    if aa:
        m.aa_get = fake_aa_get
    m.SECTIONS = [(n, getattr(m, "fetch_" + n)) for n in ALL_SECTIONS]
    return m


ALL_SECTIONS = ("lmarena", "aa", "livebench", "epoch", "openrouter", "official", "prices", "news", "agentapps")


def boom(*a, **k):
    raise RuntimeError("simulated outage")


# ------------------------------------------------------------------ tests
class Names(unittest.TestCase):
    def setUp(self):
        self.m = load(tempfile.mkdtemp())

    def test_normalize_merges_spellings(self):
        n = self.m.normalize
        same = ["Claude Opus 5.5 (Max, Default Fallback)", "claude-opus-5-5", "anthropic/claude-opus-5.5",
                "Anthropic: Claude Opus 5.5", "claude-opus-5-5-20260922-thinking-32k", "Claude Opus 5.5", "claude-opus-5-5-max"]
        self.assertEqual({n(x) for x in same}, {"claude-opus-5-5"})
        self.assertEqual(n("Gemini 4 Carbon (High)"), n("gemini-4-carbon-high"))
        self.assertEqual(n("GPT Image 2.5 Sunburst (max)"), n("gpt-image-2.5-sunburst-2026-09-08"))
        self.assertEqual(n("GPT-6.1 Terra"), n("openai/gpt-6.1-terra"))
        self.assertEqual(n("DeepSeek-V4.1-Flash-1017"), n("deepseek/deepseek-v4.1-flash"))
        self.assertEqual(n("GLM-4.5V (Non-reasoning)"), "glm-4-5v")
        self.assertEqual(n("Grok 4.7 (Reasoning)"), "grok-4-7")

    def test_normalize_keeps_different_models_apart(self):
        n = self.m.normalize
        self.assertNotEqual(n("GPT-6.1 Terra"), n("GPT-6.1 Terra Pro"))
        self.assertNotEqual(n("Claude Opus 5.5"), n("Claude Opus 5"))
        self.assertNotEqual(n("Gemini 4 Carbon"), n("Gemini 4 Argon"))
        self.assertEqual(n("Qwen3 Max"), "qwen3-max")          # "max" is part of this model's name

    def test_aliases(self):
        n = self.m.normalize
        self.assertEqual(n("chatgpt-4o-latest"), "gpt-4o")
        self.assertEqual(n("claude-4-5-opus-20251101"), "claude-opus-4-5")
        self.assertEqual(n("gemini-4-carbon-preview"), "gemini-4-carbon")
        for k, v in self.m.ALIASES.items():
            self.assertEqual(self.m.ALIASES.get(v, v), v, "alias target must be final: " + v)

    def test_display_name(self):
        d = self.m.display_name
        self.assertEqual(d("Claude Opus 5.5 (Max, Default Fallback)"), "Claude Opus 5.5")
        self.assertEqual(d("claude-opus-5-5-20260922-thinking-32k"), "Claude Opus 5.5")
        self.assertEqual(d("Anthropic: Claude Opus 5.5"), "Claude Opus 5.5")
        self.assertEqual(d("gpt-image-2.5-sunburst-2026-09-08"), "GPT Image 2.5 Sunburst")


def bd(src, rows, ci=False, votes=False):
    return {"src": src, "board": "b", "date": "2026-10-28", "url": "https://x", "rows": rows, "ci": ci, "votes": votes}


def r(k, s, lo=None, hi=None, votes=None):
    d = {"k": k, "n": k.title(), "s": s}
    if lo is not None:
        d.update(lo=lo, hi=hi)
    if votes is not None:
        d["votes"] = votes
    return d


class FastTag(unittest.TestCase):
    def setUp(self):
        self.m = load(tempfile.mkdtemp())

    def test_name_words(self):
        f = self.m.is_fast
        for n in ("Gemini 3.7 Flash", "Gemini 3.7 Flash-Lite", "GPT-6 Mini", "gpt-4o-mini", "Claude Haiku 5.5", "GLM-4.5-Air",
                  "Nemotron 3.5 Bolt E4B", "Mistral Small 4", "gpt-3.5-turbo", "Kimi K3 Instant", "GPT-5 Nano", "Llama Lite"):
            self.assertTrue(f(n), n)
        for n in ("MiniMax M3.1", "Gemini 4 Carbon", "Airoboros", "Nanobanana", "Liteflow", "GPT-6.1 Terra", "Claude Opus 5.5", "", None):
            self.assertFalse(f(n), n)

    def test_word_list_is_a_constant(self):
        self.assertIn("haiku", self.m.FAST_WORDS)
        self.assertIn("not a speed test", self.m.FAST_NOTE)

    def test_label_never_changes_a_pick(self):
        root = Path(tempfile.mkdtemp())
        m = install_fakes(load(root))
        raw = {n: f(None) for n, f in m.SECTIONS if n != "aa"}
        with_tag = m.build_picks(raw)
        m.FAST_RE = re.compile(r"(?!x)x")              # tag nothing
        without = m.build_picks(raw)
        def clean(ps):
            ps = json.loads(json.dumps(ps))
            for p in ps:
                for b in p["boards"]:
                    b.pop("topFast", None)
                for c in p["winners"] + p["candidates"] + p["new"]:
                    c.pop("fast", None)
            return ps
        self.assertEqual(clean(with_tag), clean(without))
        self.assertTrue(any(c.get("fast") for p in with_tag for c in p["winners"] + p["candidates"]), "fixture should have a fast model")


class PickRule(unittest.TestCase):
    def setUp(self):
        self.m = load(tempfile.mkdtemp())

    def four(self, lm_rows):
        return [bd("lmarena", lm_rows, ci=True, votes=True),
                bd("aa", [r("a", 60), r("b", 59), r("c", 58), r("d", 50)]),
                bd("livebench", [r("b", 90), r("a", 89), r("e", 88), r("c", 80)]),
                bd("epoch", [r("a", 169, 166, 172), r("b", 168, 165, 171), r("f", 160, 158, 162)], ci=True)]

    def test_three_of_four_is_best(self):
        boards = self.four([r("a", 1510, 1505, 1515, 9000), r("c", 1490, 1485, 1495, 9000), r("g", 1480, 1475, 1485, 9000), r("b", 1400, 1395, 1405, 9000)])
        res = self.m.decide(boards, {}, 3)
        self.assertEqual(res["status"], "best")
        self.assertEqual(res["winners"][0]["k"], "a")          # top 3 in 4 of 4; "b" only 3 and no overlap on LMArena
        self.assertEqual(res["winners"][0]["top3"], 4)

    def test_tie_when_error_bars_overlap(self):
        boards = self.four([r("a", 1510, 1500, 1520, 9000), r("b", 1505, 1495, 1515, 9000), r("g", 1480, 1475, 1485, 9000)])
        res = self.m.decide(boards, {}, 3)
        self.assertEqual(res["status"], "tie")
        self.assertEqual({w["k"] for w in res["winners"]}, {"a", "b"})

    def test_not_sure_yet_by_votes(self):
        boards = self.four([r("a", 1510, 1505, 1515, 4000), r("c", 1490, 1485, 1495, 9000), r("g", 1480, 1475, 1485, 9000), r("b", 1400, 1395, 1405, 9000)])
        res = self.m.decide(boards, {}, 3)
        # "a" qualifies on ranks but has only 4,000 votes -> not sure; "b" (3 of 4, 9,000 votes) is the pick
        self.assertEqual(res["winners"][0]["k"], "b")
        a = self.m.describe("a", [x for x in boards], {})
        self.assertTrue(a["notSure"])
        self.assertIn("4,000 LMArena votes", " ".join(a["why"]))

    def test_not_sure_yet_by_coverage(self):
        boards = self.four([r("z", 1600, 1590, 1610, 20000), r("a", 1510, 1505, 1515, 9000), r("b", 1500, 1490, 1505, 9000)])
        res = self.m.decide(boards, {}, 3)
        new = [c["k"] for c in res["new"]]
        self.assertIn("z", new)                                  # #1 on one source, covered by only 1 of 4
        z = self.m.describe("z", boards, {})
        self.assertEqual(z["covered"], 1)

    def test_no_clear_winner(self):
        boards = [bd("lmarena", [r("a", 3, 2, 4, 9000), r("b", 2, 1, 3, 9000), r("c", 1, 0, 2, 9000)], True, True),
                  bd("aa", [r("d", 3), r("e", 2), r("f", 1)]),
                  bd("livebench", [r("g", 3), r("h", 2), r("a", 1)]),
                  bd("epoch", [r("i", 3), r("j", 2), r("k", 1)])]
        res = self.m.decide(boards, {}, 3)
        self.assertEqual(res["status"], "none")
        self.assertTrue(res["candidates"])
        self.assertIn("No clear winner yet", self.m.plain_sentence("chat", res))

    def test_never_from_one_source(self):
        res = self.m.decide([bd("lmarena", [r("a", 3, 2, 4, 9000)], True, True), None, None, None], {}, 3)
        self.assertEqual(res["status"], "none")
        self.assertEqual(res["n"], 1)

    def test_pictures_two_of_two(self):
        boards = [bd("lmarena", [r("p", 1427, 1423, 1431, 40000), r("q", 1405, 1400, 1410, 30000), r("s", 1390, 1385, 1395, 9000)], True, True),
                  bd("aa", [r("p", 1222, 1212, 1232), r("q", 1207, 1197, 1217), r("t", 1186, 1175, 1197)], ci=True)]
        res = self.m.decide(boards, {}, 2)
        self.assertEqual(res["status"], "best")                  # q also 2 of 2 but LMArena bars don't overlap
        self.assertEqual(res["winners"][0]["k"], "p")


class Parsers(unittest.TestCase):
    def setUp(self):
        self.m = load(tempfile.mkdtemp())

    def test_livebench_category_columns_and_task_columns(self):
        rows = self.m.parse_livebench(lb_table(), {c: [c] for c in LB_CATS})
        self.assertEqual(rows[0]["k"], "claude-fable-5-1")
        self.assertIn("coding", rows[0]["cats"])
        table = "model,t1,t2,t3\nm-one,90,80,70\nm-two,50,60,70\n"
        rows = self.m.parse_livebench(table, {"Coding": {"tasks": ["t1", "t2"], "weight": 1.5}, "Reasoning": ["t3"]})
        self.assertEqual(rows[0]["cats"]["coding"], 85.0)
        self.assertEqual(rows[0]["cats"]["reasoning"], 70.0)

    def test_livebench_release_falls_back_to_last_good(self):
        self.m.get = boom
        rel, found = self.m.livebench_release({"release": "20261014"})
        self.assertEqual((rel, found), ("20261014", False))

    def test_epoch_csv(self):
        z = zipfile.ZipFile(io.BytesIO(epoch_zip()))
        rows = self.m.parse_epoch_csv(z.read("epoch_capabilities_index/eci_scores.csv").decode())
        self.assertEqual(rows[0]["k"], "gpt-6-astra")
        self.assertEqual((rows[0]["lo"], rows[0]["hi"]), (165.9, 174.3))

    def test_aa_merges_run_settings(self):
        llm = self.m.parse_aa_llm(aa_records())
        opus = [x for x in llm if x["k"] == "claude-opus-5-5"]
        self.assertEqual(len(opus), 1)
        self.assertEqual(opus[0]["iq"], 58.4)
        img = self.m.parse_aa_image(aa_image()["data"])
        self.assertEqual(img[0]["k"], "gpt-image-2-5-sunburst")
        self.assertEqual((img[0]["lo"], img[0]["hi"]), (1212, 1232))

    def test_big_news_rules(self):
        items = []
        for name, its in NEWS.items():
            items += self.m.parse_feed(rss(its), name, "lab" if name == "OpenAI" else "news")
        big = self.m.big_news(items)
        titles = [b["t"] for b in big]
        self.assertFalse(any("tips" in t or "laptops" in t or "podcast" in t for t in titles))
        terra = [t for t in titles if "Terra" in t]
        self.assertLessEqual(len(terra), 2, "same story from several sites should be merged")
        self.assertTrue(any("Plus subscription" in t for t in titles))
        self.assertTrue(all(b["s"] and b["u"] and b["d"] and b["tag"] for b in big))
        self.assertLessEqual(len(big), 30)


def strict_get(url, **k):
    """Like the real get(): an error status raises."""
    r = fake_get(url, **k)
    r.raise_for_status()
    return r


class Prices(unittest.TestCase):
    """Consumer app prices, read from the real pages saved on 2026-11-01 (tests/fixtures)."""
    def setUp(self):
        self.m = load(tempfile.mkdtemp())
        self.calls, self.waits = [], []
        def get(url, **k):
            self.calls.append((url, k.get("headers")))
            return strict_get(url, **k)
        self.m.get, self.m.sleep = get, self.waits.append

    def apps(self, prev=None):
        return {a["app"]: a for a in self.m.fetch_prices(prev)["apps"]}

    def plans(self, app):
        return {p["name"]: p["usd_month"] for p in app["plans"]}

    def test_app_store_listings(self):
        apps = self.apps()
        self.assertEqual(len(apps), 9)
        gpt = apps["ChatGPT"]
        self.assertEqual(self.plans(gpt), {"Go": 8, "Plus": 19.99, "Pro 100": 100, "Pro 200": 200, "Pro 500": 500})   # first match, not the yearly $200 "Plus"
        self.assertEqual(gpt["src"]["label"], "App Store price (US)")
        self.assertIn("apps.apple.com/us/app/chatgpt", gpt["src"]["url"])
        self.assertTrue(gpt["readToday"] and gpt["read_ok"])
        self.assertEqual(self.plans(apps["Perplexity"]), {"Pro": 20, "Max": 200})                 # not the yearly $200 "Pro"
        meta = apps["Meta AI"]
        self.assertTrue(meta["free"] and meta["readToday"] and not meta["plans"])                 # Apple lookup says Free

    def test_claude_real_page(self):
        claude = self.apps()["Claude"]                    # the real claude.com/pricing page (saved 2026-11-02)
        self.assertEqual(self.plans(claude), {"Pro": 20, "Max": 100, "Ultra": 200})
        self.assertTrue(claude["read_ok"])

    def test_grok_web_page_with_badge(self):
        grok = self.apps()["Grok"]
        self.assertEqual(grok["src"]["url"], "https://x.ai/pricing")
        self.assertEqual(self.plans(grok), {"Plus": 8, "Premium": 30, "Super": 100, "Ultra": 200})   # "Premium Most popular $30"

    def test_grok_app_store_backup(self):
        def get(url, **k):
            self.calls.append((url, k.get("headers")))
            if url == "https://x.ai/pricing":
                raise RuntimeError("403 Client Error: Forbidden")
            return strict_get(url, **k)
        self.m.get = get
        grok = self.apps()["Grok"]
        self.assertEqual(grok["src"]["label"], "App Store price (US)")
        self.assertEqual(self.plans(grok), {"SuperGrok Lite": 10, "SuperGrok": 30, "SuperGrok Plus": 100, "SuperGrok Heavy": 300})
        self.assertEqual([t["ok"] for t in grok["tried"]], [False, True])

    def test_polite_fetching(self):
        self.apps()
        uas = {h["User-Agent"] for _, h in self.calls}
        self.assertTrue(all("ai-tracker/6" in u for u in uas))
        # 3 tries for a page that keeps failing (the Copilot page isn't in the fixtures -> 403), waiting 4 s then 10 s
        self.assertEqual(sum(1 for u, _ in self.calls if "microsoft.com" in u), 3)
        self.assertIn(4, self.waits)
        self.assertIn(10, self.waits)
        self.assertIn(self.m.PRICE_PAUSE, self.waits)            # a short pause between pages

    def test_retry_then_success(self):
        seen = []
        def flaky(url, **k):
            seen.append(url)
            if url == "https://x.ai/pricing" and seen.count(url) < 3:
                raise RuntimeError("403 Client Error: Forbidden")
            return strict_get(url, **k)
        self.m.get = flaky
        grok = self.apps()["Grok"]
        self.assertEqual(grok["src"]["url"], "https://x.ai/pricing")
        self.assertTrue(grok["read_ok"])

    def test_keeps_last_good_and_marks_stale(self):
        first = self.m.fetch_prices(None)
        for a in first["apps"]:                          # pretend the last good check was 40 days ago
            a["checked"] = "2026-09-22"
            for p in a["plans"]:
                p["checked"] = "2026-09-22"
        self.m.get = lambda url, **k: (_ for _ in ()).throw(RuntimeError("down"))
        sec = self.m.fetch_prices(first)
        gpt = [a for a in sec["apps"] if a["app"] == "ChatGPT"][0]
        self.assertEqual(self.plans(gpt)["Plus"], 19.99)                 # last good value kept
        self.assertEqual(gpt["checked"], "2026-09-22")
        self.assertFalse(gpt["readToday"])
        self.assertTrue(gpt["stale"] and all(p["stale"] for p in gpt["plans"]))
        stale = self.m.stale_prices(sec)
        self.assertIn(("ChatGPT", "Plus"), [(x["app"], x["plan"]) for x in stale])

    def test_odd_number_is_ignored(self):
        first = self.m.fetch_prices(None)
        for a in first["apps"]:
            for p in a["plans"]:
                p["checked"] = "2026-10-01"
        real = self.m.appstore_price
        self.m.appstore_price = lambda iap, label: 1.99 if label == "ChatGPT Plus" else real(iap, label)
        gpt = [a for a in self.m.fetch_prices(first)["apps"] if a["app"] == "ChatGPT"][0]
        plus = [p for p in gpt["plans"] if p["name"] == "Plus"][0]
        self.assertEqual((plus["usd_month"], plus["checked"]), (19.99, "2026-10-01"))   # $1.99 is not believable

    def test_wrong_listing_is_rejected(self):
        def get(url, **k):
            r = strict_get(url, **k)
            if "perplexity" in url:
                r = Resp(r.content.replace(b"Perplexity AI Inc.", b"Some Other Dev"))
            return r
        self.m.get = get
        ppl = self.apps()["Perplexity"]
        self.assertFalse(ppl["readToday"])
        self.assertIn("not the company", ppl["tried"][0]["err"])


class OfficialReleases(unittest.TestCase):
    """Official company pages (real fixtures) -> New releases."""
    def setUp(self):
        self.m = load(tempfile.mkdtemp())
        self.m.get = strict_get
        self.raw = {"official": self.m.fetch_official(None), "openrouter": {"models": self.m.parse_openrouter(
            json.loads(fx("openrouter_sample.json")))}}

    def test_every_page_is_read(self):
        for sid, s in self.raw["official"]["sources"].items():
            self.assertTrue(s["ok"] and s["posts"], sid)

    def test_finds_the_releases(self):
        rel = {r["n"]: r for r in self.m.official_releases(self.raw)}
        want = {"Gemini 4 Carbon": ("2026-10-28", "Google DeepMind blog"), "Mistral Large 4": ("2026-10-06", "Mistral news"),
                "GPT-6.1 Terra": ("2026-10-26", "OpenAI News"), "Claude Opus 5.5": ("2026-09-22", "Anthropic news"),
                "Claude Haiku 5.5": ("2026-10-07", "Anthropic news"), "Grok 4.7": ("2026-09-21", "xAI news"),
                "Grok Voice 3.0": ("2026-10-14", "xAI news"), "Muse Spark 1.1": ("2026-07-09", "Meta AI blog"),
                "DeepSeek-V4.1-Flash-1017": ("2026-10-17", "DeepSeek API change log"), "Voxtral 3": ("2026-10-20", "Mistral news"),
                "Genie 4": ("2026-10-27", "Google DeepMind blog"), "Gemini 4 Argon": ("2026-09-30", "Google DeepMind blog"),
                "GPT-6 Astra": ("2026-09-03", "OpenAI News")}       # OpenAI posts a lot: older posts must still be kept
        for n, (d, src) in want.items():
            self.assertIn(n, rel)
            self.assertEqual((rel[n]["d"], rel[n]["src"]), (d, src), n)
        for bad in ("GPT-5.5 Bio Bug Bounty", "Grok Bot", "Grok for Outlook", "Playground", "Anthropic Cyber Mission"):
            self.assertFalse(any(bad in n for n in rel), bad)

    def test_release_rule_on_titles(self):
        rn = self.m.release_names
        self.assertEqual(rn("Introducing GPT-6 Sol and Luna"), ["GPT-6 Sol", "GPT-6 Luna"])
        self.assertEqual(rn("Introducing Gemini 3.8 Flash and 3.8 Flash Cyber"), ["Gemini 3.8 Flash", "Gemini 3.8 Flash Cyber"])
        self.assertEqual(rn("Introducing Gemini 3.8 Live with Live Avatar"), ["Gemini 3.8 Live"])
        self.assertEqual(rn("Introducing Timestral"), ["Timestral"])
        for t in ("Developing Gemini 4 Argon responsibly and safely", "Gemini 4 Argon for Robotics",
                  "GPT-6.1 Sol helps CodeRabbit strengthen security", "Greptile takes bug detection beyond code review with GPT-6 Astra",
                  "Claude Haiku 5.5 is our fastest, most capable small model"):
            self.assertEqual(rn(t), [], t)

    def test_merged_with_openrouter_once(self):
        d = self.m.build_releases(self.raw)
        names = [r["n"] for r in d["items"]]
        self.assertIn("Gemini 4 Carbon", names)                         # not on OpenRouter
        keys = [self.m.rel_key(n) for n in names]
        self.assertEqual(len(keys), len(set(keys)), "a model is listed twice")
        ds = [r for r in d["items"] if self.m.rel_key(r["n"]) == "deepseekv41flash1017"][0]
        self.assertEqual(ds["src"], "DeepSeek API change log")         # official source wins over OpenRouter
        self.assertTrue(ds["official"])
        self.assertIn("deepseekv41flash", keys)                        # the September release stays its own line

    def test_failed_page_keeps_last_good(self):
        def get(url, **k):
            if "x.ai/news" in url:
                raise RuntimeError("HTTP 503")
            return strict_get(url, **k)
        self.m.get = get
        sec = self.m.fetch_official(self.raw["official"])
        self.assertFalse(sec["sources"]["xai"]["ok"])
        self.assertEqual(sec["sources"]["xai"]["posts"], self.raw["official"]["sources"]["xai"]["posts"])
        self.assertTrue(sec["sources"]["openai"]["ok"])


class BigNewsToday(unittest.TestCase):
    """The 118 real headlines from 2026-11-01 (tests/fixtures/news_today.json)."""
    def setUp(self):
        self.m = load(tempfile.mkdtemp())
        self.items = json.loads(fx("news_today.json"))["items"]

    def test_soft_items_are_dropped(self):
        kept, dropped = self.m.news_report(self.items)
        kept_t = [t for _, t in kept]
        for t in ("Apple CEO says", "Judge allows NAACP lawsuit", "OpenAI reportedly lowers", "Anthropic expected to receive",
                  "Anthropic IPO warns", "OpenAI and ServiceNow expand partnership", "OpenAI expands partnership with Oracle",
                  "Southeast Asia", "Greptile", "Ollie", "Apple Intelligence"):
            self.assertFalse(any(k.startswith(t) for k in kept_t), t)
        for t in ("Google announces Gemini 4 Carbon", "DeepMind unveils Genie 4", "Gemini 4 Carbon: Our next frontier model",
                  "Genie 4: A new generation of world simulation"):
            self.assertTrue(any(k.startswith(t) for k in kept_t), t)

    def test_list_with_official_posts(self):
        self.m.get = strict_get
        official = self.m.official_posts({"official": self.m.fetch_official(None)})
        big = self.m.big_news(self.items, official)
        titles = [b["t"] for b in big]
        self.assertLessEqual(len(big), 30)
        self.assertEqual(sum(1 for t in titles if "Gemini 4 Carbon" in t), 1, "one story, one line")
        self.assertEqual(sum(1 for t in titles if "Genie 4" in t), 1)
        self.assertIn("Anthropic files S-1 with the SEC for proposed initial public offering", titles)
        self.assertTrue(all(b["tag"] in ("New model", "Price change", "Product", "Funding", "Acquisition", "IPO") for b in big))
        self.assertTrue(all(b["s"] and b["u"] and b["d"] for b in big))

    def test_rules(self):
        c = self.m.classify_news
        self.assertEqual(c("Anthropic raises $30 billion at a new valuation")[0], "Funding")
        self.assertEqual(c("Startup raises $40 million for AI agents")[0], "")
        self.assertEqual(c("ChatGPT Plus subscription price goes up to $25 per month")[0], "Price change")
        self.assertEqual(c("Asana cuts model costs 76x in browser tests with GPT-6.1 Sol")[0], "")
        self.assertEqual(c("OpenAI acquires Orchestra Bio")[0], "Acquisition")
        self.assertEqual(c("Google shuts down Bard")[0], "Product")
        self.assertEqual(c("OpenAI might rebrand its data centers")[0], "")


class FastModalities(unittest.TestCase):
    def setUp(self):
        self.m = load(tempfile.mkdtemp())

    def test_only_text_models(self):
        ms = {m["n"]: m for m in self.m.parse_openrouter(json.loads(fx("openrouter_sample.json")))}
        self.assertEqual(ms["Nano Banana 2.1"]["mods"], ["image", "text"])
        self.assertFalse(self.m.is_fast("Nano Banana 2.1", ms["Nano Banana 2.1"]["mods"]))
        self.assertTrue(self.m.is_fast("Gemini 3.8 Flash", ms["Gemini 3.8 Flash"]["mods"]))
        for n in ("Gemini Nano Banana 2.1", "Grok Voice 3.0", "EmbeddingGemma 2", "Veo 4 Lite", "Gemini 3.5 Transcribe Mini", "Genie 4"):
            self.assertFalse(self.m.is_fast(n), n)          # not on OpenRouter: name words rule it out
        self.assertTrue(self.m.is_fast("Claude Haiku 5.5"))


# ------------------------------------------------------------------ v6: Agents tab
def agent_raw(m, apex_newest=None):
    """raw sections for the agent tests, built from the real files saved on 2026-11-02."""
    date, rows = m.lm_board(lm_agent_rows(), "overall")
    lb = m.parse_livebench(fx("livebench_table_20261025.csv").decode(), json.loads(fx("livebench_categories_20261025.json")))
    z = zipfile.ZipFile(io.BytesIO(fx("epoch_agent_subset.zip")))
    agent = {}
    for bid, fname, col, _ in m.EPOCH_AGENT:
        br = m.parse_epoch_bench(z.read(fname).decode(), col)
        agent[bid] = {"ok": True, "updated": m.NOW_ISO, "rows": br, "newest": max(x["d"] for x in br)}
    if apex_newest:
        agent["apex"]["newest"] = apex_newest
    return {"lmarena": {"boards": {"agent": {"label": "Agent Arena", "date": date, "url": "https://lmarena.ai/leaderboard/agent", "rows": rows}},
                        "_updated": m.NOW_ISO},
            "livebench": {"rows": lb, "date": "2026-10-25", "release": "20261025", "_updated": m.NOW_ISO},
            "epoch": {"rows": [], "agent": agent, "_updated": m.NOW_ISO}}


class AgentTests(unittest.TestCase):
    """Best AI for agents: LMArena Agent Arena, LiveBench Long Agentic, APEX-Agents (real data)."""
    def setUp(self):
        self.m = load(tempfile.mkdtemp())

    def test_agent_arena_board(self):
        date, rows = self.m.lm_board(lm_agent_rows(), "overall")
        self.assertEqual(date, "2026-10-28")
        self.assertEqual([x["n"] for x in rows[:3]], ["Claude Opus 5.5", "Gemini 4 Carbon", "Claude Sonnet 5.5"])
        self.assertTrue(0 < rows[0]["s"] < 1 and rows[0]["lo"] <= rows[0]["s"] <= rows[0]["hi"])   # IPS, not rounded to 0
        self.assertEqual(sum(1 for x in rows if x["k"] == "gpt-6-luna"), 1)          # Max / Medium / Low runs: best one only

    @unittest.skipUnless(importlib.util.find_spec("pyarrow"), "pyarrow not installed")
    def test_parquet_fixture_matches_json(self):
        rows = self.m.read_parquet(fx("lmarena_agent_latest.parquet"))
        self.assertEqual([x["model_name"] for x in rows], [x["model_name"] for x in lm_agent_rows()])
        self.assertAlmostEqual(rows[0]["score"], lm_agent_rows()[0]["score"])

    def test_livebench_long_agentic(self):
        lb = self.m.parse_livebench(fx("livebench_table_20261025.csv").decode(), json.loads(fx("livebench_categories_20261025.json")))
        top = sorted(lb, key=lambda x: -x["cats"]["long agentic"])[:3]
        self.assertEqual([x["k"] for x in top], ["claude-fable-5-1", "gpt-6-astra", "claude-opus-5-5"])
        self.assertIn("browser", lb[0]["cats"])

    def test_name_matching(self):
        n, bk = self.m.normalize, self.m.bench_key
        self.assertEqual({n("Claude Opus 5.5 (Max)"), bk("claude-opus-5-5_max"), n("claude-opus-5.5")}, {"claude-opus-5-5"})
        self.assertEqual({n("Gemini 4 Argon (High)"), bk("gemini-4-argon_unknown")}, {"gemini-4-argon"})
        self.assertEqual(bk("gpt-6.1-terra_xhigh"), n("GPT-6.1 Terra (Max)"))
        self.assertEqual(bk("qwen3.8-max_high"), "qwen3-8-max")                    # "max" is part of this model's name
        self.assertNotEqual(bk("claude-opus-5_max"), bk("claude-opus-5-5_max"))

    def test_epoch_bench_keeps_best_run(self):
        z = zipfile.ZipFile(io.BytesIO(fx("epoch_agent_subset.zip")))
        rows = self.m.parse_epoch_bench(z.read("apex_agents_external.csv").decode(), "Pass@1 score")
        self.assertEqual([x["k"] for x in rows[:3]], ["gemini-4-argon", "claude-sonnet-5-5", "claude-opus-5-5"])
        self.assertEqual(len({x["k"] for x in rows}), len(rows))
        self.assertEqual(rows[0]["s"], 0.824)

    def test_rule_today(self):
        res = self.m.agent_pick(agent_raw(self.m))
        self.assertEqual(res["status"], "best")
        self.assertEqual([(w["n"], w["top3"]) for w in res["winners"]], [("Claude Opus 5.5", 3), ("Claude Sonnet 5.5", 2)])
        self.assertEqual(res["n"], 3)
        cands = {c["n"]: c["top3"] for c in res["candidates"]}
        self.assertEqual(cands.get("Gemini 4 Carbon"), 1)                          # #2 on the Arena only: not best
        for w in res["winners"]:
            self.assertTrue(all(x["url"].startswith("https://") and x["date"] for x in w["ranks"]))

    def test_one_test_alone_never_names_best(self):
        raw = agent_raw(self.m)
        raw["livebench"]["rows"] = []
        raw["epoch"]["agent"] = {}
        res = self.m.agent_pick(raw)
        self.assertEqual((res["status"], res["n"], res["winners"]), ("none", 1, []))
        self.assertIn("no model is named best", res["why"])

    def test_old_test_is_skipped(self):
        raw = agent_raw(self.m, apex_newest="2026-06-01")                         # more than 120 days before Nov 1
        tests = {b["id"]: b for b in self.m.agent_boards(raw)}
        self.assertTrue(tests["apex"]["skipped"])
        self.assertIn("120 days", tests["apex"]["skipWhy"])
        res = self.m.agent_pick(raw)
        self.assertEqual(res["n"], 2)
        self.assertEqual([w["n"] for w in res["winners"]], ["Claude Opus 5.5"])     # Sonnet was top 3 only on APEX + Arena

    def test_info_tests_not_in_rule(self):
        out = self.m.build_agents(agent_raw(self.m), [], [])
        tests = {t["id"]: t for t in out["tests"]}
        self.assertEqual({k for k, t in tests.items() if t["inRule"]}, {"arena", "lb_agentic", "apex"})
        self.assertEqual(tests["vending"]["top"][0]["shown"], "$16,484")
        self.assertEqual(tests["apex"]["top"][0]["shown"], "82.4%")
        self.assertEqual(tests["rli"]["top"][0]["n"], "Claude Opus 5.5")
        self.assertEqual(out["best"]["testsUsed"], ["arena", "lb_agentic", "apex"])
        for t in out["tests"]:
            self.assertTrue(t["url"].startswith("https://") and t["credit"] and t["date"] and len(t["top"]) == 5)

    def test_epoch_agent_test_keeps_last_good(self):
        good = self.m.parse_epoch_bench(zipfile.ZipFile(io.BytesIO(fx("epoch_agent_subset.zip"))).read("rli_external.csv").decode(), "Score")
        prev = {"agent": {"rli": {"ok": True, "updated": "2026-10-20T10:00:00+00:00", "rows": good, "newest": "2026-09-30"}}}
        def zip_without_rli(url, **k):
            b = io.BytesIO()
            src = zipfile.ZipFile(io.BytesIO(epoch_zip()))
            with zipfile.ZipFile(b, "w") as z:
                for n in src.namelist():
                    if not n.endswith("rli_external.csv"):
                        z.writestr(n, src.read(n))
            return Resp(b.getvalue())
        self.m.get = zip_without_rli
        sec = self.m.fetch_epoch(prev)
        self.assertFalse(sec["agent"]["rli"]["ok"])
        self.assertEqual(sec["agent"]["rli"]["rows"], good)
        self.assertEqual(sec["agent"]["rli"]["updated"], "2026-10-20T10:00:00+00:00")
        self.assertTrue(sec["agent"]["apex"]["ok"])

    def test_agent_arena_keeps_last_good(self):
        m = install_fakes(self.m)
        first = m.fetch_lmarena(None)
        self.assertIn("agent", first["boards"])
        LM_ROWS.pop("agent")
        try:
            sec = m.fetch_lmarena(first)
        finally:
            LM_ROWS["agent"] = lm_agent_rows
        self.assertTrue(sec["boards"]["agent"]["stale"])
        tests = {b["id"]: b for b in m.agent_boards({"lmarena": sec})}
        self.assertFalse(tests["arena"]["ok"])                    # Sources view: "using the last good copy"


class AgentApps(unittest.TestCase):
    """Agent app prices from the real pages saved on 2026-11-02."""
    def setUp(self):
        self.m = load(tempfile.mkdtemp())
        self.calls = []
        def get(url, **k):
            self.calls.append(url)
            return strict_get(url, **k)
        self.m.get = get

    def apps(self, prev=None):
        return {a["id"]: a for a in self.m.fetch_agentapps(prev)["apps"]}

    def plans(self, a):
        return {p["name"]: p["usd_month"] for p in a["plans"]}

    def test_each_app(self):
        apps = self.apps()
        want = {"comet": {"Pro": 20, "Max": 200}, "manus": {"Pro (4,000 credits)": 20, "Pro (8,000 credits)": 40},   # help page, not old App Store plans
                "codex": {"Go": 8, "Plus": 20, "Pro": 100}, "copilot": {"Pro": 10, "Pro+": 39, "Max": 100},
                "cursor": {"Plus": 8, "Premium": 30, "Super": 100, "Ultra": 200}, "devin": {"Pro": 20, "Max": 200},
                "replit": {"Core": 20, "Pro": 100}}                                         # monthly, not "$18 / $90 billed annually"
        for aid, plans in want.items():
            self.assertEqual(self.plans(apps[aid]), plans, aid)
            self.assertTrue(apps[aid]["readToday"] and apps[aid]["read_ok"], aid)
        for aid in ("chatgpt-work", "gemini-agent", "claude-in-chrome", "claude-code", "jules"):
            self.assertTrue(apps[aid]["readToday"], aid)                                    # the proof line was found
            self.assertEqual(apps[aid]["plans"], [], aid)
        self.assertEqual(apps["jules"]["facts"]["freeTasks"], "Free: 15 tasks a day")
        self.assertEqual(len(apps), 49)
        self.assertEqual({a["group"] for a in apps.values()}, {"tasks", "code", "assistants", "research"})

    def test_plans_from_the_cost_tab(self):
        raw = {"prices": self.m.fetch_prices(None), "agentapps": self.m.fetch_agentapps(None)}
        out = {a["id"]: a for a in self.m.build_agent_apps(raw)}
        self.assertEqual(self.plans(out["chatgpt-work"]), {"Go": 8, "Plus": 19.99, "Pro 100": 100, "Pro 200": 200, "Pro 500": 500})
        self.assertEqual(out["chatgpt-work"]["src"]["label"], "App Store price (US)")
        self.assertEqual(out["chatgpt-work"]["proof"]["label"], "Codex pricing page")
        self.assertEqual(self.plans(out["gemini-agent"]), {"Google AI Ultra": 99.99})
        self.assertIn("US only", out["gemini-agent"]["note"])
        self.assertEqual(self.plans(out["claude-code"]), {"Pro": 20, "Max": 100, "Ultra": 200})
        self.assertEqual(self.plans(out["claude-in-chrome"]), {"Pro": 20, "Max": 100, "Ultra": 200})
        self.assertFalse(out["claude-code"]["free"])
        self.assertEqual(self.plans(out["jules"]), {"Google AI Pro": 19.99, "Google AI Ultra": 99.99})
        self.assertEqual(out["jules"]["freeNote"], "Free: 15 tasks a day")
        self.assertEqual(out["comet"]["cheapest"]["usd_month"], 20)
        for a in out.values():
            self.assertTrue(a["src"]["url"].startswith("https://") and a["checked"], a["id"])

    def test_each_page_read_once_per_run(self):
        self.m.PAGE_CACHE = {}
        self.m.fetch_prices(None)
        self.m.fetch_agentapps(None)
        self.assertEqual(self.calls.count("https://claude.com/pricing"), 1)
        self.assertEqual(self.calls.count("https://developers.openai.com/codex/pricing"), 1)

    def test_missing_proof_line_keeps_last_good(self):
        first = self.m.fetch_agentapps(None)
        def get(url, **k):
            r = strict_get(url, **k)
            if url == "https://claude.com/pricing":
                r = Resp(r.content.replace(b"Claude Code", b"Some Other Thing"))
            return r
        self.m.get = get
        cc = self.apps(first)["claude-code"]
        self.assertFalse(cc["readToday"])
        self.assertIn("not on the page", cc["tried"][0]["err"])
        self.assertEqual(cc["checked"], "2026-11-01")              # the last good check stays

    def test_stale_after_30_days(self):
        first = self.m.fetch_agentapps(None)
        for a in first["apps"]:
            a["checked"] = "2026-09-25"
            for p in a["plans"]:
                p["checked"] = "2026-09-25"
        self.m.get = boom
        apps = self.apps(first)
        self.assertTrue(apps["cursor"]["stale"] and all(p["stale"] for p in apps["cursor"]["plans"]))
        self.assertEqual(self.plans(apps["cursor"])["Premium"], 30)
        stale = self.m.stale_prices({"apps": list(apps.values())})
        self.assertIn(("Claude Code", ""), [(x["app"], x["plan"]) for x in stale])          # its proof page too

    def test_cursor_is_the_x_subscription(self):
        cur = self.apps()["cursor"]
        self.assertEqual(cur["maker"], "SpaceX")
        self.assertIn("The X Subscription", cur["note"])
        first = self.m.fetch_agentapps(None)
        def get(url, **k):
            r = strict_get(url, **k)
            return Resp(r.content.replace(b"Grok", b"Gxxk")) if url == "https://cursor.com/pricing" else r
        self.m.get = get
        cur = self.apps(first)["cursor"]
        self.assertFalse(cur["readToday"])                          # not the X Subscription page any more
        self.assertIn("not on the page", cur["tried"][0]["err"])
        self.assertEqual(self.plans(cur)["Premium"], 30)             # last good prices stay

    def test_manus_help_page(self):
        man = self.apps()["manus"]
        self.assertEqual(man["src"]["label"], "Manus help page")
        self.assertEqual(len(man["tried"]), 1)                       # no App Store backup: its plan list is out of date
        self.assertNotIn(19, self.plans(man).values())
        self.m.get = boom
        man = self.apps(None)["manus"]
        self.assertFalse(man["readToday"])
        self.assertEqual(self.plans(man), {"Pro (4,000 credits)": 20, "Pro (8,000 credits)": 40})   # seeds, marked "last checked"

    def test_replit_app_store_backup(self):
        def get(url, **k):
            if url == "https://replit.com/pricing":
                raise RuntimeError("HTTP 403")
            return strict_get(url, **k)
        self.m.get = get
        rp = self.apps()["replit"]
        self.assertEqual(rp["src"]["label"], "App Store price (US)")
        self.assertEqual(self.plans(rp), {"Core": 20})

    def test_copilot_reads_only_the_plans_block(self):
        cp = self.apps()["copilot"]
        self.assertNotIn(15, self.plans(cp).values())              # later "Pro plan $15 per month" credits line
        def get(url, **k):
            r = strict_get(url, **k)
            return Resp(r.content.replace(b"Pricing plans", b"Plans")) if "copilot" in url else r
        self.m.get = get
        self.assertFalse(self.apps()["copilot"]["readToday"])


class PersonalAssistants(unittest.TestCase):
    """v7: Instinct (home page read daily, no price) and Tab (hand-checked, fixed date)."""
    def setUp(self):
        self.m = load(tempfile.mkdtemp())
        self.m.get = strict_get
        self.logs = []
        self.m.log = lambda *a: self.logs.append(" ".join(str(x) for x in a))

    def apps(self, prev=None):
        return {a["id"]: a for a in self.m.fetch_agentapps(prev)["apps"]}

    def test_instinct_from_the_home_page(self):
        ins = self.apps()["instinct"]
        self.assertTrue(ins["readToday"])
        self.assertEqual((ins["access"], ins["priceText"]), ("Invite only (waitlist)", "Price not public"))
        self.assertEqual((ins["src"]["label"], ins["checked"]), ("Instinct home page", "2026-11-01"))
        self.assertEqual(ins["plans"], [])

    def test_tab_is_hand_checked(self):
        calls = []
        self.m.get = lambda url, **k: (calls.append(url), strict_get(url, **k))[1]
        tab = self.apps()["tab"]
        self.assertNotIn("https://tab.bot", calls)                     # never fetched
        self.assertEqual((tab["src"]["label"], tab["src"]["url"], tab["checked"]), ("tab.bot", "https://tab.bot", "2026-11-02"))
        self.assertEqual(tab["priceText"], "Free to use; paid plans for more speed")
        self.assertNotIn("$", json.dumps(tab))

    def test_a_dollar_price_keeps_last_good_and_logs(self):
        first = self.m.fetch_agentapps(None)
        for a in first["apps"]:
            if a["id"] == "instinct":
                a["checked"] = "2026-10-30"
        def get(url, **k):
            if url == "https://instinct.com/":
                return Resp(fx("web_instinct_home.html").replace(b"Try Instinct", b"Instinct Pro $29/month Try Instinct"))
            return strict_get(url, **k)
        self.m.get = get
        ins = self.apps(first)["instinct"]
        self.assertFalse(ins["readToday"])
        self.assertEqual((ins["checked"], ins["priceText"]), ("2026-10-30", "Price not public"))
        self.assertIn("Instinct: a price may be public now, check instinct.com", self.logs)

    def test_unreadable_page_keeps_last_good(self):
        first = self.m.fetch_agentapps(None)
        self.m.get = boom
        ins = self.apps(first)["instinct"]
        self.assertFalse(ins["readToday"])
        self.assertEqual(ins["checked"], "2026-11-01")
        for a in first["apps"]:
            a["checked"] = "2026-09-01"
        old = self.apps(first)["instinct"]
        self.assertTrue(old["stale"])                                    # 30-day rule still applies to the row

    def test_never_counted_as_prices(self):
        sec = self.m.fetch_agentapps(None)
        self.assertEqual(sec["apps_total"], 12)                           # price counts: priced apps only
        for a in sec["apps"]:
            a["checked"] = "2026-09-01"
            a["stale"] = True
        stale = self.m.stale_prices(sec)
        self.assertFalse({"Instinct", "Tab"} & {x["app"] for x in stale})
        out = {a["id"]: a for a in self.m.build_agent_apps({"agentapps": self.m.fetch_agentapps(None)})}
        self.assertIsNone(out["instinct"]["cheapest"])
        self.assertIsNone(out["tab"]["proof"])
        self.assertEqual(out["tab"]["src"]["checked"], "2026-11-02")
        res = self.m.agent_pick(agent_raw(self.m))
        self.assertEqual([w["n"] for w in res["winners"]], ["Claude Opus 5.5", "Claude Sonnet 5.5"])


class StaticAgents(unittest.TestCase):
    """v7b: all notable agents. 35 hand-checked rows (scripts/agents_static.json) + the 14 rows from v7."""
    def setUp(self):
        self.m = load(tempfile.mkdtemp())
        self.m.get = strict_get
        self.logs = []
        self.m.log = lambda *a: self.logs.append(" ".join(str(x) for x in a))

    def apps(self, prev=None):
        return self.m.fetch_agentapps(prev)["apps"]

    def test_49_rows_in_4_groups(self):
        out = self.m.build_agents({"agentapps": self.m.fetch_agentapps(None)}, [], [])
        self.assertEqual([g["id"] for g in out["groups"]], ["assistants", "tasks", "code", "research"])
        self.assertEqual([g["label"] for g in out["groups"]], ["Personal assistants (text or call them)", "Browser and computer agents",
                                                               "Coding agents", "Research and work agents"])
        apps = out["apps"]
        self.assertEqual(len(apps), 49)
        count = {g: sum(1 for a in apps if a["group"] == g) for g in ("assistants", "tasks", "code", "research")}
        self.assertEqual(count, {"assistants": 10, "tasks": 14, "code": 18, "research": 7})
        ids = [a["id"] for a in apps if a["group"] == "assistants"]
        self.assertEqual(ids[:3], ["instinct", "tab", "poke"])                  # existing rows first, then the file order
        code = [a["id"] for a in apps if a["group"] == "code"]
        self.assertEqual(code[:8], ["codex", "claude-code", "jules", "copilot", "cursor", "devin", "replit", "antigravity"])

    def test_data_used_exactly(self):
        apps = {a["id"]: a for a in self.apps()}
        for x in STATIC:
            a = apps[x["id"]]
            for k in ("app", "maker", "group", "free", "what", "access", "priceText"):
                self.assertEqual(a[k], x[k], x["id"] + " " + k)
            self.assertEqual([(p["name"], p["usd_month"]) for p in a["plans"]], [(p["name"], p["usd_month"]) for p in x["plans"]])
            self.assertEqual((a["src"]["label"], a["src"]["url"], a["checked"]), (x["source"]["label"], x["source"]["url"], "2026-11-02"))
            self.assertNotIn("evidence", a)

    def test_page_up_today(self):
        apps = {a["id"]: a for a in self.apps()}
        for x in STATIC:
            self.assertTrue(apps[x["id"]]["readToday"], x["id"])
            self.assertEqual(apps[x["id"]]["pageChecked"], "2026-11-01", x["id"])     # the test clock's today
        self.assertFalse(any("official page not read" in l for l in self.logs))

    def test_page_fails_keeps_last_good_and_logs(self):
        first = self.m.fetch_agentapps(None)
        self.m.get = boom
        poke = {a["id"]: a for a in self.apps(first)}["poke"]
        self.assertFalse(poke["readToday"])
        self.assertEqual((poke["pageChecked"], poke["priceText"]), ("2026-11-01", "Free \u00b7 Pro $19/month \u00b7 Ultra $199/month"))
        self.assertFalse(poke["stale"])
        self.assertIn("Poke: official page not read today (simulated outage)", self.logs)

    def test_proof_word_missing(self):
        first = self.m.fetch_agentapps(None)
        def get(url, **k):
            if url == "https://lovable.dev/pricing":
                return Resp("<html><body>Something else entirely</body></html>")
            return strict_get(url, **k)
        self.m.get = get
        lov = {a["id"]: a for a in self.apps(first)}["lovable"]
        self.assertFalse(lov["readToday"])
        self.assertIn("Lovable: official page not read today (the proof word is not on the page)", self.logs)

    def test_31_days_unread_is_stale_but_kept(self):
        first = self.m.fetch_agentapps(None)
        for a in first["apps"]:
            if a.get("static"):
                a["pageChecked"] = "2026-10-01"
        self.m.get = boom
        kiro = {a["id"]: a for a in self.apps(first)}["kiro"]
        self.assertTrue(kiro["stale"] and all(p["stale"] for p in kiro["plans"]))
        self.assertEqual(len(kiro["plans"]), 4)                                      # kept, with its plans
        self.assertEqual(kiro["pageChecked"], "2026-10-01")

    def test_never_counted_as_prices(self):
        sec = self.m.fetch_agentapps(None)
        self.assertEqual(sec["apps_total"], 12)
        for a in sec["apps"]:
            a["stale"] = True
            for p in a["plans"]:
                p["stale"] = True
        names = {x["app"] for x in self.m.stale_prices(sec)}
        self.assertFalse(names & {x["app"] for x in STATIC})
        self.assertFalse(names & {"Instinct", "Tab"})
        self.assertIn("Cursor", names)                                                # priced rows are still counted

    def test_best_for_agents_unchanged(self):
        raw = agent_raw(self.m)
        without = self.m.build_agents(dict(raw, agentapps={"apps": []}), [], [])
        withall = self.m.build_agents(dict(raw, agentapps=self.m.fetch_agentapps(None)), [], [])
        self.assertEqual(without["best"], withall["best"])
        self.assertEqual(without["tests"], withall["tests"])

    def test_devin_note(self):
        devin = {a["id"]: a for a in self.apps()}["devin"]
        self.assertEqual(devin["note"], "Windsurf is now part of Devin (windsurf.com opens Devin's pricing page).")


AGENT_FEEDS = [("feed_OpenAI.xml", "OpenAI", "lab"), ("feed_TechCrunch.xml", "TechCrunch", "news"),
               ("feed_ArsTechnica.xml", "Ars Technica", "news"), ("feed_Wired.xml", "Wired", "news")]


class AgentNews(unittest.TestCase):
    """The real feeds saved on 2026-11-02 and the official pages."""
    def setUp(self):
        self.m = load(tempfile.mkdtemp())
        self.m.get = strict_get
        self.items = []
        for f, name, kind in AGENT_FEEDS:
            self.items += self.m.parse_feed(fx(f), name, kind)
        self.official = self.m.official_posts({"official": self.m.fetch_official(None)})

    def test_kept_and_dropped_today(self):
        kept, dropped = self.m.agent_news_report(self.items, self.official)
        kept_t = {t for _, _, _, t in kept}
        self.assertEqual(kept_t, {
            "Zest’s new AI agent finds restaurants and books reservations over text",
            "An AI Agent Injected Drugs Into a Live Mouse’s Brain",
            "A Defense Contractor Gave Their Personal AI Agent Access to a Secure Pentagon System",
            "Patch the Planet: global response coordination as agents uncover critical vulnerabilities",
            "Donating Agent Skills to the Agentic AI Foundation"})
        why = {t: r for r, _, _, t in dropped}
        self.assertEqual(why["Uber brings ChatGPT Work to all employees with OpenAI"], "dropped: customer story")
        self.assertEqual(why["Franchisee reconciles cash in 94% less time with ChatGPT Work"], "dropped: customer story")
        self.assertEqual(why["Legora is building the agentic operating system for legal work"], "dropped: customer story")
        self.assertEqual(why["How a Contractor’s Claude Agent Got Into the Pentagon"], "dropped: explainer")
        self.assertTrue(why["DoorDash said it’s only received ‘several hundred’ orders from AI agents"].startswith("dropped: opinion"))
        self.assertIn("dropped", why['"No human at the helm": Delaware plan would let AI agents run entire businesses'])
        self.assertIn("dropped", why["I Put a Bunch of AI Agents in Charge of a Fantasy Soccer Team. They’re Not Better Than Humans—Yet"])

    def test_list(self):
        news = self.m.agent_news(self.items, self.official)
        self.assertLessEqual(len(news), 8)
        self.assertEqual([n["d"] for n in news], sorted((n["d"] for n in news), reverse=True))
        self.assertTrue(all(n["d"][:10] >= "2026-10-18" for n in news))           # last 14 days
        self.assertTrue(all(n["t"] and n["u"].startswith("https://") and n["s"] for n in news))
        patch = [n for n in news if n["t"].startswith("Patch the Planet")]
        self.assertEqual(len(patch), 1)                                           # feed copy + official copy = one line
        self.assertTrue(patch[0]["official"])

    def test_rules(self):
        c = lambda t: self.m.classify_agent_news(t)[0]
        for t in ("Benefit Street Partners answers questions faster with Codex", "How Oracle turns days of work into minutes with ChatGPT and Codex",
                  "Amp puts AI agents to work beyond code with OpenAI models", "The EU’s next chapter in AI is agentic",
                  "Accelerating the search for antimicrobial peptides with Google Antigravity", "OpenAI sued over agent mistakes",
                  "Google reportedly plans a new Gemini Agent", "Why AI agents keep failing", "Comet tail seen over Europe tonight?"):
            self.assertEqual(c(t), "", t)
        self.assertEqual(c("Advancing computer use with Ironclad"), "")                                      # customer story
        self.assertEqual(c("We urgently need to monitor AI agents\u2019 actions in real time"), "")                 # opinion
        self.assertEqual(c("Into the Omniverse: How Developers Turn Ideas Into Simulations With Frontier AI Agents"), "")
        cs = self.m.classify_agent_news
        self.assertEqual(cs("Things That Go Beep in the Night: Agentic AI Joins the Search for Extraterrestrial Signals", "NVIDIA")[0], "")
        self.assertEqual(cs("NVIDIA launches agent toolkit for robots", "NVIDIA")[0], "Launch")                 # vendor blog with a launch
        self.assertEqual(c("OpenAI launches a new Codex agent for teams"), "Launch")
        self.assertEqual(c("Anthropic adds computer use to Claude for Chrome users"), "News")
        self.assertEqual(c("Google releases Gemini 4 Carbon"), "")                # no agent word

    def test_max_eight(self):
        words = ["Alpha", "Bravo", "Delta", "Echo", "Foxtrot", "Hotel", "India", "Juliet", "Kilo", "Lima", "Mike", "Oscar"]
        jobs = ["taxes", "travel", "email", "recipes", "invoices", "music", "homework", "fitness", "shopping", "meetings", "photos", "bills"]
        many = [{"t": f"{w} ships an AI agent for {j}", "u": f"https://e.com/{i}", "s": "TechCrunch", "k": "news",
                 "d": (FIXED_NOW - timedelta(hours=i)).isoformat()} for i, (w, j) in enumerate(zip(words, jobs))]
        self.assertEqual(len(self.m.agent_news(many, [])), 8)


class Speed(unittest.TestCase):
    """The daily run must never hang: parsing the biggest real pages, and a hostile one, stays fast."""
    def test_parsers_are_bounded(self):
        import time
        m = load(tempfile.mkdtemp())
        t0 = time.time()
        for f in ("appstore_chatgpt.html", "appstore_grok.html", "appstore_perplexity.html", "xai_pricing.html",
                  "web_claude_pricing.html", "web_copilot_plans.html", "web_codex_pricing.html", "appstore_manus.html", "web_manus_help.html", "web_replit_pricing.html"):
            m.page_text(fx(f).decode())
        for f, base, mode in (("rel_anthropic_news.html", "https://www.anthropic.com/news", "before"),
                              ("rel_xai_news.html", "https://x.ai/news", "inside"), ("rel_meta_ai_blog.html", "https://ai.meta.com/blog/", "after")):
            m.parse_html_posts(fx(f).decode(), base, mode)
        m.parse_rss_posts(fx("rel_openai_rss.xml"))
        m.parse_feed(fx("feed_OpenAI.xml"), "OpenAI", "lab", per_feed=500)

        hostile = "<html>" + '<a href="/x">' * 20000 + "<h2>" * 5000 + "<script>" + "x" * 500000
        m.parse_html_posts(hostile, "https://e.com/")
        m.page_text(hostile)
        m.parse_deepseek_log(hostile, "https://e.com/")
        words = ("Pro Plus Max Go Premium Super Ultra Core From Google AI Ultra Claude Code Jules in Pro " * 8000)[:m.MAX_PAGE]
        for a in m.AGENT_APPS + m.PRICE_APPS:                 # every price / proof regex on a page with no prices at all
            for src in a["sources"]:
                if src.get("proof"):
                    re.search(src["proof"], words, re.I)
                for _, _, pat in src["plans"]:
                    if src["kind"] == "web":
                        re.search(pat, words, re.I | re.S)
        self.assertLess(time.time() - t0, 5)


class Pipeline(unittest.TestCase):
    """Artificial Analysis switched ON (private use) - the full 4-source behaviour."""
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        os.environ["AA_API_KEY"] = "TEST-KEY-123456"
        os.environ["AA_ENABLED"] = "1"

    def tearDown(self):
        os.environ.pop("AA_API_KEY", None)
        os.environ.pop("AA_ENABLED", None)
        shutil.rmtree(self.root, ignore_errors=True)

    def run_main(self, **fail):
        m = install_fakes(load(self.root))
        for name in fail:
            setattr(m, "fetch_" + name, boom)
        m.SECTIONS = [(n, getattr(m, "fetch_" + n)) for n in ALL_SECTIONS]
        return m, m.main()

    def data(self):
        return json.loads((self.root / "data" / "data.json").read_text())

    def test_full_run(self):
        m, rc = self.run_main()
        self.assertEqual(rc, 0)
        d = self.data()
        self.assertEqual(d["v"], 3)
        picks = {p["id"]: p for p in d["picks"]}
        self.assertEqual(set(picks), {"chat", "writing", "coding", "math", "pictures", "cheap"})
        self.assertEqual(picks["chat"]["status"], "best")
        self.assertEqual(picks["chat"]["winners"][0]["n"], "Claude Opus 5.5")
        self.assertIn("gemini-4-carbon", [c["k"] for c in picks["chat"]["new"]])     # #1 on LMArena but new
        self.assertEqual(picks["pictures"]["winners"][0]["k"], "gpt-image-2-5-sunburst")
        cheap = picks["cheap"]["winners"][0]
        blend = lambda c: 3 * c["price"]["pin"] + c["price"]["pout"]
        self.assertTrue(all(blend(cheap) <= blend(c) for c in picks["cheap"]["candidates"]))
        self.assertGreaterEqual(sum(1 for rk in cheap["ranks"] if rk.get("rank") and rk["rank"] <= 10), 2)
        for p in d["picks"]:
            self.assertGreaterEqual(p["n"], 2)
            self.assertTrue(p["why"] and p["boards"])
            for w in p["winners"]:
                for rk in w["ranks"]:
                    self.assertTrue(rk["url"].startswith("https://") and rk["name"])
        self.assertEqual(len(d["cost"]["apps"]), 9)
        self.assertTrue(d["cost"]["dev"])
        rel = d["releases"]["items"]
        self.assertTrue(rel and all(x["d"] and x["u"] and x["src"] for x in rel))
        self.assertNotIn("unknown-lab-model", json.dumps(rel))
        self.assertTrue(d["bignews"]["items"])
        self.assertTrue((self.root / "data" / "data.js").read_text().startswith("window.AI_DATA="))
        for f in ("data.json", "data.js", "raw.json"):
            self.assertNotIn("TEST-KEY-123456", (self.root / "data" / f).read_text())
        # AA on: 3 of 4 rule, 2 of 2 for pictures, AA credited, all 7 sources listed
        self.assertTrue(d["aaEnabled"])
        self.assertEqual((d["ruleInfo"]["textSources"], d["ruleInfo"]["picSources"]), (4, 2))
        self.assertIn("3 of 4", d["rule"])
        self.assertEqual(picks["chat"]["n"], 4)
        self.assertEqual(picks["pictures"]["status"], "best")
        self.assertTrue(picks["chat"]["usesAA"])
        self.assertIn("aa", [s["id"] for s in d["sources"]])
        self.check_agents(d)

    def check_agents(self, d):
        ag = d["agents"]
        self.assertEqual(ag["best"]["status"], "best")
        self.assertEqual([w["n"] for w in ag["best"]["winners"]], ["Claude Opus 5.5", "Claude Sonnet 5.5"])
        self.assertEqual(len(ag["apps"]), 49)
        self.assertTrue(all(a["src"]["url"].startswith("https://") and a["checked"] and a["group"] in ("tasks", "code", "assistants", "research") for a in ag["apps"]))
        self.assertEqual({t["id"] for t in ag["tests"]}, {"arena", "lb_agentic", "apex", "lb_browser", "vending", "rli"})
        self.assertTrue(all(n["u"] and n["s"] and n["d"] for n in ag["news"]["items"]))
        self.assertTrue(d["status"]["agentapps"]["ok"])
        self.assertIn("agentapps", [s["id"] for s in d["sources"]])
        self.assertNotIn("artificialanalysis", json.dumps(ag).lower())

    def test_coverage_and_votes_use_every_row_and_text_overall(self):
        self.run_main()
        picks = {p["id"]: p for p in self.data()["picks"]}
        astra = [c for c in picks["chat"]["candidates"] + picks["chat"]["winners"] if c["k"] == "gpt-6-astra"][0]
        lm = [r for r in astra["ranks"] if r["src"] == "lmarena"][0]
        self.assertGreater(lm["rank"], 60)               # past the old 60-row cut-off, but covered
        self.assertEqual(astra["covered"], 4)
        self.assertEqual(astra["votes"], 15038)
        # Opus 5.5 has only 2,672 creative-writing votes but 11,415 overall -> sure, and best for writing
        self.assertEqual(picks["writing"]["status"], "best")
        self.assertEqual(picks["writing"]["winners"][0]["k"], "claude-opus-5-5")
        self.assertFalse(picks["writing"]["winners"][0]["notSure"])
        self.assertEqual(picks["writing"]["winners"][0]["votes"], 11415)
        self.assertEqual(picks["coding"]["winners"][0]["k"], "claude-opus-5-5")   # 4 of 4, not flagged by webdev votes

    def test_board_tops_use_canonical_names(self):
        self.run_main()
        for p in self.data()["picks"]:
            for b in p["boards"]:
                self.assertNotIn("GPT 6 Astra", b["top"])
        lb = [b for b in {p["id"]: p for p in self.data()["picks"]}["chat"]["boards"] if b["src"] == "livebench"][0]
        self.assertIn("GPT-6 Astra", lb["top"])

    def test_livebench_finds_newest_release(self):
        self.run_main()
        raw = json.loads((self.root / "data" / "raw.json").read_text())
        self.assertEqual(raw["livebench"]["release"], "20261025")
        self.assertTrue(raw["livebench"]["release_found"])
        self.assertNotIn("note", self.data()["status"]["livebench"])

    def test_keep_last_good_per_source(self):
        self.run_main()
        old_raw = json.loads((self.root / "data" / "raw.json").read_text())
        m, rc = self.run_main(aa=True, news=True)
        self.assertEqual(rc, 1)
        d = self.data()
        raw = json.loads((self.root / "data" / "raw.json").read_text())
        self.assertEqual(raw["aa"]["llm"], old_raw["aa"]["llm"])
        self.assertEqual(raw["news"]["items"], old_raw["news"]["items"])
        self.assertFalse(d["status"]["aa"]["ok"])
        self.assertEqual(d["status"]["aa"]["updated"], old_raw["aa"]["_updated"])
        self.assertTrue(d["status"]["lmarena"]["ok"])

    def test_everything_fails_writes_nothing(self):
        self.run_main()
        before = (self.root / "data" / "data.json").read_bytes()
        m, rc = self.run_main(lmarena=1, aa=1, livebench=1, epoch=1, openrouter=1, official=1, prices=1, news=1, agentapps=1)
        self.assertEqual(rc, 2)
        self.assertEqual((self.root / "data" / "data.json").read_bytes(), before)

    def test_first_run_without_key(self):
        os.environ.pop("AA_API_KEY", None)
        m = install_fakes(load(self.root), aa=False)       # the real aa_get, which needs the key
        rc = m.main()
        self.assertEqual(rc, 1)
        d = self.data()
        self.assertFalse(d["status"]["aa"]["ok"])
        self.assertIn("AA_API_KEY", d["status"]["aa"]["err"])
        self.assertGreaterEqual(len(d["picks"]), 3)       # LMArena, LiveBench and Epoch are enough

    def test_too_few_sources_writes_nothing(self):
        m, rc = self.run_main(aa=1, livebench=1, epoch=1)
        self.assertEqual(rc, 3)
        self.assertFalse((self.root / "data" / "data.json").exists())

    def test_key_is_scrubbed_from_errors(self):
        m = install_fakes(load(self.root))
        def leaky(url):
            raise RuntimeError("bad request with key TEST-KEY-123456")
        m.aa_get = leaky
        m.SECTIONS = [(n, getattr(m, "fetch_" + n)) for n in ALL_SECTIONS]
        m.main()
        txt = (self.root / "data" / "data.json").read_text()
        self.assertNotIn("TEST-KEY-123456", txt)
        self.assertIn("***", txt)

    def test_unchanged_day_keeps_app_file(self):
        self.run_main()
        p = self.root / "data" / "data.json"
        before = p.read_bytes()
        self.run_main()
        self.assertEqual(p.read_bytes(), before)


class AAOff(unittest.TestCase):
    """Default: Artificial Analysis switched OFF (public app)."""
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        os.environ["AA_API_KEY"] = "TEST-KEY-123456"    # a key alone must not switch AA on
        os.environ.pop("AA_ENABLED", None)
        self.aa_calls = []

    def tearDown(self):
        os.environ.pop("AA_API_KEY", None)
        os.environ.pop("AA_ENABLED", None)
        shutil.rmtree(self.root, ignore_errors=True)

    def run_main(self, **fail):
        m = install_fakes(load(self.root))
        real_get = m.get
        def counting_aa(url):
            self.aa_calls.append(url)
            return fake_aa_get(url)
        def counting_get(url, **k):
            if "artificialanalysis" in url:
                self.aa_calls.append(url)
            return real_get(url, **k)
        m.aa_get, m.get = counting_aa, counting_get
        for name in fail:
            setattr(m, "fetch_" + name, boom)
        m.SECTIONS = [(n, getattr(m, "fetch_" + n)) for n in ALL_SECTIONS]
        return m, m.main()

    def files(self):
        return {f: (self.root / "data" / f).read_text() for f in ("data.json", "data.js", "raw.json")}

    def assert_no_aa(self):
        d = json.loads(self.files()["data.json"])
        raw = json.loads(self.files()["raw.json"])
        self.assertNotIn("aa", raw)
        self.assertNotIn("aa", d["status"])
        self.assertNotIn("aa", [s["id"] for s in d["sources"]])
        for f, txt in self.files().items():
            self.assertNotIn("artificialanalysis", txt.lower(), f)
            self.assertNotIn("Artificial Analysis", txt, f)
        return d

    def test_switch_values(self):
        m = load(self.root)
        for v, on in (("1", True), ("true", True), ("TRUE", True), (" True ", True), ("", False), ("0", False),
                      ("false", False), ("yes", False), ("on", False)):
            os.environ["AA_ENABLED"] = v
            self.assertEqual(m.aa_enabled(), on, repr(v))
        os.environ.pop("AA_ENABLED")
        self.assertFalse(m.aa_enabled())

    def test_off_by_default(self):
        m, rc = self.run_main()
        self.assertEqual(rc, 0)
        self.assertEqual(self.aa_calls, [], "no request to Artificial Analysis when it is off")
        d = self.assert_no_aa()
        self.assertFalse(d["aaEnabled"])
        self.assertEqual((d["ruleInfo"]["textSources"], d["ruleInfo"]["picSources"]), (3, 1))
        self.assertIn("all 3", d["rule"])
        picks = {p["id"]: p for p in d["picks"]}
        # text: 3 of 3
        self.assertEqual(picks["chat"]["n"], 3)
        self.assertEqual(picks["chat"]["status"], "best")
        self.assertEqual(picks["chat"]["winners"][0]["k"], "claude-opus-5-5")
        self.assertEqual(picks["chat"]["winners"][0]["top3"], 3)
        # pictures: one source, never "best"
        pic = picks["pictures"]
        self.assertEqual((pic["status"], pic["n"]), ("single", 1))
        self.assertEqual(pic["winners"][0]["k"], "gpt-image-2-5-sunburst")
        self.assertTrue(pic["candidates"])
        self.assertIn("1 source", pic["why"])
        self.assertNotIn("best", [p["status"] for p in d["picks"] if p["id"] == "pictures"])
        # prices and releases from OpenRouter only
        self.assertTrue(all(x["src"] == "openrouter" for x in d["cost"]["dev"]))
        self.assertTrue(all("artificialanalysis" not in x["u"] for x in d["releases"]["items"]))
        self.assertIn("Gemini 4 Carbon", [x["n"] for x in d["releases"]["items"]])     # from Google DeepMind's own blog
        Pipeline.check_agents(self, d)                                                  # Agents tab works with AA off

    def test_needs_all_three(self):
        m = load(self.root)
        boards = [bd("lmarena", [r("a", 3, 2, 4, 9000), r("b", 2, 1, 3, 9000), r("x", 1, 0, 2, 9000)], True, True),
                  bd("livebench", [r("a", 3), r("b", 2), r("y", 1)]),
                  bd("epoch", [r("a", 3, 2.9, 3.1), r("z", 2, 1.9, 2.1), r("w", 1, .9, 1.1)], ci=True)]
        res = m.decide(boards, {}, 3)
        self.assertEqual((res["status"], res["winners"][0]["k"]), ("best", "a"))   # 3 of 3
        boards[2]["rows"] = [r("z", 3, 2.9, 3.1), r("a", 2, 1.9, 2.1), r("w", 1, .9, 1.1)]
        self.assertEqual(m.decide(boards, {}, 3)["status"], "best")
        boards[2]["rows"] = [r("z", 3, 2.9, 3.1), r("w", 2, 1.9, 2.1), r("v", 1, .9, 1.1), r("a", .5, .4, .6)]
        res = m.decide(boards, {}, 3)
        self.assertEqual(res["status"], "none")                                     # only 2 of 3 -> no winner
        self.assertIn("all 3", m.plain_sentence("chat", res))

    def test_switching_off_removes_old_aa_data(self):
        os.environ["AA_ENABLED"] = "1"
        self.run_main()
        self.assertIn("aa", json.loads((self.root / "data" / "raw.json").read_text()))
        os.environ.pop("AA_ENABLED")
        self.aa_calls.clear()
        m, rc = self.run_main()
        self.assertEqual(self.aa_calls, [])
        self.assert_no_aa()

    def test_switching_off_purges_even_when_every_source_fails(self):
        os.environ["AA_ENABLED"] = "1"
        self.run_main()
        os.environ.pop("AA_ENABLED")
        m, rc = self.run_main(lmarena=1, aa=1, livebench=1, epoch=1, openrouter=1, official=1, prices=1, news=1, agentapps=1)
        self.assertEqual(rc, 1)
        d = self.assert_no_aa()
        self.assertFalse(d["status"]["lmarena"]["ok"])          # built from last good copies

    def test_aa_news_headline_is_not_a_leak(self):
        NEWS["TechCrunch"].append(("Artificial Analysis raises funding for its benchmark site", "https://techcrunch.com/a9", 15, ""))
        try:
            m, rc = self.run_main()
            self.assertEqual(rc, 0)
        finally:
            NEWS["TechCrunch"].pop()


if __name__ == "__main__":
    unittest.main(verbosity=2)
