"""v17l: New Releases = every release ever, of every type, newest first (no network)."""
import importlib.util, unittest
from datetime import timedelta
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("ud_v17l", REPO / "scripts" / "update_data.py")
ud = importlib.util.module_from_spec(spec); spec.loader.exec_module(ud)


def ago(days):
    return (ud.NOW - timedelta(days=days)).date().isoformat()


def orm(n, mid, d, mods=("text",), o="OpenAI"):
    return {"id": mid, "k": ud.normalize(mid), "n": n, "o": o, "d": d, "mods": list(mods) if mods is not None else None,
            "cs": "", "u": "https://openrouter.ai/" + mid}


def raw_with(models=(), older=(), posts=(), old_posts=()):
    return {"openrouter": {"models": list(models), "older": list(older)},
            "official": {"sources": {"openai": {"company": "OpenAI", "label": "OpenAI news", "url": "u", "ok": True,
                                                "posts": list(posts), "older": list(old_posts)}}}}


class Types(unittest.TestCase):
    def test_types_from_outputs_and_names(self):
        t = ud.rel_type
        self.assertEqual(t("GPT-6 Sol", ["text"]), "text")
        self.assertEqual(t("Nano Banana 3", ["image", "text"]), "image")
        self.assertEqual(t("Veo 4"), "video")
        self.assertEqual(t("Sora 3"), "video")
        self.assertEqual(t("Lyria 3"), "music")
        self.assertEqual(t("Genie 4"), "world")
        self.assertEqual(t("Voxtral 3"), "voice")
        self.assertEqual(t("GPT Realtime 2", ["audio", "text"]), "voice")
        self.assertEqual(t("Imagen 5"), "image")
        self.assertEqual(t("EmbeddingGemma 2"), "text")                 # one word, no separate "embedding" token
        self.assertEqual(t("Gemini Embedding 2"), "embeddings")
        self.assertEqual(t("Claude Opus 5.5"), "text")
        self.assertEqual(t("Some Model", None), "text")
        self.assertEqual(t("Gemini Robotics 2.5 accelerates real-world general dexterity"), "robotics")   # v17l2
        self.assertEqual(t("Gemini Robotics-ER 1.6", ["text"]), "robotics")
        self.assertEqual(t("Gemini Robotics ER 2"), "robotics")
        for x in ("Veo 4", "Lyria 3", "GPT-6", "Imagen 5", "Voxtral 3", "Genie 4", "Gemini Embedding 2", "Gemini Robotics 2.5"):
            self.assertIn(t(x), ud.REL_TYPES)

    def test_old_robotics_label_fixed_on_carry_over(self):   # v17l2
        prev = {"releases": {"items": [{"k": "geminirobotics25", "n": "Gemini Robotics 2.5", "o": "Google", "d": ago(30),
                                        "u": "", "src": "Google DeepMind blog", "official": True, "how": "x", "fast": False, "ty": "text"},
                                       {"k": "veo4", "n": "Veo 4", "o": "Google", "d": ago(31), "u": "", "src": "s",
                                        "official": True, "how": "x", "fast": False, "ty": "video"}]}}
        d = ud.build_releases(raw_with(), prev=prev)
        by = {x["n"]: x["ty"] for x in d["items"]}
        self.assertEqual(by["Gemini Robotics 2.5"], "robotics")
        self.assertEqual(by["Veo 4"], "video")

    def test_fast_only_text(self):
        d = ud.build_releases(raw_with(models=[orm("Veo 4 Flash", "google/veo-4-flash", ago(3), mods=["video"])]))
        it = d["items"][0]
        self.assertEqual(it["ty"], "video")
        self.assertFalse(it["fast"])


class AllHistory(unittest.TestCase):
    def test_no_window_and_newest_first(self):
        models = [orm("GPT-6 Sol", "openai/gpt-6-sol", ago(2)), orm("GPT-5 Old", "openai/gpt-5-old", ago(300))]
        older = [orm("GPT-4o", "openai/gpt-4o", "2024-05-13"), orm("GPT-4 Turbo", "openai/gpt-4-turbo", "2023-11-06")]
        d = ud.build_releases(raw_with(models, older))
        self.assertTrue(d["all"])
        self.assertIsNone(d["days"])
        names = [r["n"] for r in d["items"]]
        self.assertEqual(names, ["GPT-6 Sol", "GPT-5 Old", "GPT-4o", "GPT-4 Turbo"])
        dates = [r["d"] for r in d["items"]]
        self.assertEqual(dates, sorted(dates, reverse=True))

    def test_no_100_cap(self):
        models = [orm("Model %d" % i, "openai/model-%d" % i, ago(i)) for i in range(1, 160)]
        self.assertEqual(len(ud.build_releases(raw_with(models))["items"]), 159)

    def test_old_window_still_works(self):
        models = [orm("GPT-6 Sol", "openai/gpt-6-sol", ago(2)), orm("GPT-5 Old", "openai/gpt-5-old", ago(300))]
        d = ud.build_releases(raw_with(models, [orm("GPT-4o", "openai/gpt-4o", "2024-05-13")]), days=60)
        self.assertEqual([r["n"] for r in d["items"]], ["GPT-6 Sol"])
        self.assertEqual(d["days"], 60)

    def test_older_official_posts_count(self):
        old = [{"t": "Introducing Sora 2", "u": "https://openai.com/index/sora-2/", "d": "2025-09-30"}]
        d = ud.build_releases(raw_with(posts=[{"t": "GPT-6 Sol", "u": "https://openai.com/x", "d": ago(1)}], old_posts=old))
        sora = [r for r in d["items"] if r["n"] == "Sora 2"][0]
        self.assertTrue(sora["official"])
        self.assertEqual((sora["d"], sora["ty"]), ("2025-09-30", "video"))
        self.assertEqual(len(ud.official_posts(raw_with(old_posts=old))), 0)   # News never sees the old posts

    def test_history_kept_from_last_data(self):
        prev = {"releases": {"items": [
            {"k": "gpt-6-sol", "n": "GPT-6 Sol", "o": "OpenAI", "d": ago(2), "u": "x", "src": "OpenRouter", "official": False, "how": "h", "fast": False},
            {"k": "gone-model", "n": "Gone Model", "o": "OpenAI", "d": "2025-01-02", "u": "https://openrouter.ai/openai/gone",
             "src": "OpenRouter", "official": False, "how": "h", "fast": False},
            {"k": "aa-row", "n": "AA Row", "o": "X", "d": "2025-02-02", "u": "https://artificialanalysis.ai/models/aa-row",
             "src": "AA", "official": False, "how": "h", "fast": False},
            {"k": "future", "n": "Future", "o": "X", "d": "2099-01-01", "u": "x", "src": "s", "official": False, "how": "h"}]}}
        d = ud.build_releases(raw_with([orm("GPT-6 Sol", "openai/gpt-6-sol", ago(2))]), prev=prev)
        names = [r["n"] for r in d["items"]]
        self.assertEqual(names.count("GPT-6 Sol"), 1)             # listed once
        self.assertIn("Gone Model", names)                        # fell off the source, still in the history
        self.assertNotIn("AA Row", names)                         # AA is off: its rows are never carried forward
        self.assertNotIn("Future", names)
        gone = [r for r in d["items"] if r["n"] == "Gone Model"][0]
        self.assertEqual(gone["ty"], "text")

    def test_old_release_filter(self):
        self.assertTrue(ud.old_release("Introducing Sora 2"))
        self.assertTrue(ud.old_release("DeepSeek V2.5 Release"))
        self.assertFalse(ud.old_release("deepseek-chat Upgraded to DeepSeek V2.5 Model"))
        self.assertFalse(ud.old_release("How we built ChatGPT"))

    def test_openrouter_older_kept_apart(self):
        data = [{"id": "openai/gpt-6", "name": "OpenAI: GPT-6", "created": int(ud.NOW.timestamp()) - 86400,
                 "architecture": {"output_modalities": ["text"]}},
                {"id": "openai/gpt-4", "name": "OpenAI: GPT-4", "created": 1680000000,
                 "architecture": {"output_modalities": ["text"]}}]
        self.assertEqual([m["id"] for m in ud.parse_openrouter(data)], ["openai/gpt-6"])
        self.assertEqual([m["id"] for m in ud.parse_openrouter(data, keep_old=True)], ["openai/gpt-6", "openai/gpt-4"])


if __name__ == "__main__":
    unittest.main()
