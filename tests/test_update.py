"""Tests for scripts/update_data.py. No network: every source is replaced by a small fake that has the
same shape as the real one (see sources_research.md and aa_api_notes.md).

Run:  python -m unittest discover -s tests -v      (or: python tests/test_update.py)
"""
import importlib.util, io, json, os, re, shutil, sys, tempfile, unittest, zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def load(root):
    """Load a fresh copy of the script that reads and writes data/ under `root`."""
    spec = importlib.util.spec_from_file_location("ud_" + str(abs(hash(str(root)))), REPO / "scripts" / "update_data.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.DATA_DIR = Path(root) / "data"
    m.OUT_JSON = m.DATA_DIR / "data.json"
    m.OUT_JS = m.DATA_DIR / "data.js"
    m.RAW_JSON = m.DATA_DIR / "raw.json"
    return m


# ------------------------------------------------------------------ fake sources
NOW = datetime.now(timezone.utc)


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


LM_ROWS = {"text": lm_text_rows, "webdev": lm_webdev_rows, "text_to_image": lm_image_rows}

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
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("epoch_capabilities_index/eci_scores.csv", csvt)
        z.writestr("benchmarks/other.csv", "x\n1\n")
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
    "https://claude.com/pricing": "<html><body><h2>Free</h2> Try Claude $0 Free for everyone <h2>Pro</h2> For everyday work $17 Per month with annual subscription discount ( $200 billed up front). $20 if billed monthly. <h2>Max</h2> For all-day work $100 Per month <h2>Ultra</h2> For your longest tasks $200 Per month" + " filler" * 60 + "</body></html>",
    "https://x.ai/pricing": "<div>Free $0/month Get started Plus $8/month Get Plus Premium $30/month Get Premium Super $100/month Get Super Ultra $250/month</div>" + " filler" * 60,
    "https://gemini.google/subscriptions/": "<p>Free $0 / month with a Google Account</p><p>Google AI Plus $4.99 / month Get 2x higher usage</p><p>Google AI Pro $19.99 / month Get 4x higher usage</p><p>Google AI Ultra Starting at: $99.99 / month</p>" + " filler" * 60,
    "https://mistral.ai/pricing": "<p>Free</p><p>Pro ... $14.99 /mo</p><p>Team ... $24.99 /user/mo</p>" + " filler" * 60,
    "https://www.deepseek.com/en/": "<p>DeepSeek free chat</p>" + " filler" * 60,
}


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


def fake_get(url, timeout=None, headers=None, **kw):
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
    m.SECTIONS = [(n, getattr(m, "fetch_" + n)) for n in ("lmarena", "aa", "livebench", "epoch", "openrouter", "prices", "news")]
    return m


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


class Prices(unittest.TestCase):
    def setUp(self):
        self.m = load(tempfile.mkdtemp())
        self.m.get = fake_get
        self.m.sleep = lambda s: None

    def test_reads_pages_and_keeps_last_good(self):
        sec = self.m.fetch_prices(None)
        apps = {a["app"]: a for a in sec["apps"]}
        self.assertEqual(len(apps), 9)
        claude = {p["name"]: p for p in apps["Claude"]["plans"]}
        self.assertEqual(claude["Pro"]["usd_month"], 20)
        self.assertEqual(claude["Pro"]["checked"], self.m.TODAY)
        self.assertTrue(apps["Claude"]["read_ok"])
        grok = {p["name"]: p for p in apps["Grok"]["plans"]}
        self.assertEqual(grok["Ultra"]["usd_month"], 250)        # changed on the page -> updated
        # ChatGPT page answers 403 -> seed values with the seed date
        gpt = {p["name"]: p for p in apps["ChatGPT"]["plans"]}
        self.assertEqual((gpt["Plus"]["usd_month"], gpt["Plus"]["checked"]), (20, "2026-11-01"))
        self.assertFalse(apps["ChatGPT"]["read_ok"])
        self.assertTrue(all(a["free"] for a in sec["apps"]))

    def test_one_retry_after_a_pause(self):
        calls, waits = [], []
        def flaky(url, **k):
            calls.append(url)
            if url == "https://x.ai/pricing" and calls.count(url) == 1:
                raise RuntimeError("403 Client Error: Forbidden")
            r = fake_get(url, **k)
            r.raise_for_status()          # like the real get(): a 403 raises
            return r
        self.m.get, self.m.sleep = flaky, waits.append
        sec = self.m.fetch_prices(None)
        grok = [a for a in sec["apps"] if a["app"] == "Grok"][0]
        self.assertTrue(grok["read_ok"])
        self.assertEqual(calls.count("https://x.ai/pricing"), 2)
        self.assertTrue(waits and 3 <= waits[0] <= 5)
        self.assertEqual(calls.count("https://chatgpt.com/pricing/"), 2)   # still 403 after the retry -> last good
        gpt = [a for a in sec["apps"] if a["app"] == "ChatGPT"][0]
        self.assertFalse(gpt["read_ok"])

    def test_odd_number_is_ignored(self):
        old = {"apps": [{"app": "Claude", "plans": [{"name": "Max", "usd_month": 100, "checked": "2026-10-01"}]}]}
        PRICE_HTML_BAD = dict(PRICE_HTML)
        PRICE_HTML_BAD["https://claude.com/pricing"] = PRICE_HTML["https://claude.com/pricing"].replace("$100 Per month", "$1 Per month")
        self.m.get = lambda url, **k: Resp(PRICE_HTML_BAD[url]) if url in PRICE_HTML_BAD else Resp(b"", 403)
        sec = self.m.fetch_prices(old)
        mx = [p for p in [a for a in sec["apps"] if a["app"] == "Claude"][0]["plans"] if p["name"] == "Max"][0]
        self.assertEqual((mx["usd_month"], mx["checked"]), (100, "2026-10-01"))


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
        m.SECTIONS = [(n, getattr(m, "fetch_" + n)) for n in ("lmarena", "aa", "livebench", "epoch", "openrouter", "prices", "news")]
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
        m, rc = self.run_main(lmarena=1, aa=1, livebench=1, epoch=1, openrouter=1, prices=1, news=1)
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
        m.SECTIONS = [(n, getattr(m, "fetch_" + n)) for n in ("lmarena", "aa", "livebench", "epoch", "openrouter", "prices", "news")]
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
        m.SECTIONS = [(n, getattr(m, "fetch_" + n)) for n in ("lmarena", "aa", "livebench", "epoch", "openrouter", "prices", "news")]
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
        self.assertTrue(all(x["src"] == "OpenRouter" for x in d["releases"]["items"]))

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
        m, rc = self.run_main(lmarena=1, aa=1, livebench=1, epoch=1, openrouter=1, prices=1, news=1)
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
