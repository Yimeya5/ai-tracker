"""v17f: real release dates for OpenRouter-only models (no network)."""
import importlib.util, unittest
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("ud_rd", REPO / "scripts" / "update_data.py")
ud = importlib.util.module_from_spec(spec); spec.loader.exec_module(ud)

GEMINI_LOG = """<p>## November 5, 2026 {% id="11-05-2026" %}</p><p>* Gemini Omni 1.2 Flash GA. Effective **December 3, 2026**, `gemini-omni-1.1-flash` routes to 1.2.</p>
<p>## August 27, 2026 {% id="08-27-2026" %}</p><p>* Gemini Omni Flash GA: Released `gemini-omni-1.1-flash`.</p>
<p>## June 30, 2026 {% id="06-30-2026" %}</p><p>* Released `gemini-omni-flash-preview`.</p>"""


def model(n, mid, d, cs=""):
    return {"n": n, "id": mid, "d": d, "u": "https://openrouter.ai/" + mid, "cs": cs, "k": ud.normalize(mid)}


def post(d, t, s="Gemini API changelog", official=True):
    return {"d": d, "t": t, "u": "https://example.test/" + d, "s": s, "official": official, "tok": ud.name_tokens(t)}


class ReleaseDates(unittest.TestCase):
    def test_dated_page_sections(self):
        ps = ud.parse_dated_page(GEMINI_LOG, "u", "Gemini API changelog")
        self.assertEqual([p["d"] for p in ps], ["2026-11-05", "2026-08-27", "2026-06-30"])   # a date inside a sentence is not a heading

    def test_earliest_changelog_date_wins(self):
        posts = [dict(p, official=True, tok=ud.name_tokens(p["t"])) for p in ud.parse_dated_page(GEMINI_LOG, "u", "Gemini API changelog")]
        d, src, _, how, off = ud.earliest_date(model("Gemini Omni 1.1 Flash", "google/gemini-omni-1.1-flash", "2026-11-04"), posts)
        self.assertEqual((d, src, off), ("2026-08-27", "Gemini API changelog", True))

    def test_variant_word_does_not_match(self):
        self.assertFalse(ud.mentions(ud.name_tokens("Released GLM-5.3-FlashX-Legal"), ud.name_tokens("GLM-5.3")))
        self.assertFalse(ud.mentions(ud.name_tokens("Gemini Omni 1.1 Flash Lite is here"), ud.name_tokens("Gemini Omni 1.1 Flash")))
        self.assertFalse(ud.mentions(ud.name_tokens("Command A is out"), ud.name_tokens("Command A+")))
        self.assertTrue(ud.mentions(ud.name_tokens("Announcing Cohere's Command A+ today"), ud.name_tokens("Command A+")))

    def test_family_post_only_close_to_listing(self):
        m = model("LFM3 1.7B", "liquid/lfm-3-1.7b", "2026-11-06")
        self.assertEqual(ud.earliest_date(m, [post("2026-10-27", "Build specialized multimodal models with LFM3", "Hugging Face blog", False)])[0], "2026-10-27")
        m2 = model("LFM2.5 24B A2B", "liquid/lfm-2.5-24b-a2b", "2026-10-13")
        self.assertEqual(ud.earliest_date(m2, [post("2026-08-20", "Up to 3.2x Faster Inference with LFM2.5-DSpark", "Hugging Face blog", False)])[0], "2026-10-13")

    def test_slug_version_date(self):
        self.assertEqual(ud.slug_date("cohere/command-a-plus-05-2026"), "2026-05-01")
        self.assertEqual(ud.slug_date("google/gemini-omni-1.1-flash-20260911"), "2026-09-11")
        m = model("Command A+", "cohere/command-a-plus", "2026-09-22", "cohere/command-a-plus-05-2026")
        self.assertEqual(ud.earliest_date(m, [])[0], "2026-05-01")
        m = model("Qwen3.8 Omni Flash", "qwen/qwen3.8-omni-flash", "2026-09-21", "qwen/qwen3.8-omni-flash-20260918")
        self.assertEqual(ud.earliest_date(m, [])[0], "2026-09-21")      # 3 days: a snapshot date, not an old model

    def test_no_match_keeps_openrouter(self):
        m = model("Hy4", "tencent/hy4", "2026-11-04")
        self.assertEqual(ud.earliest_date(m, [post("2026-10-01", "Hy4 preview")]), ("2026-11-04", "OpenRouter", m["u"], "date it became available on OpenRouter", False))


if __name__ == "__main__":
    unittest.main()
