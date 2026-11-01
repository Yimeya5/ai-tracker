
import importlib.util, json, sys, shutil, tempfile, os, hashlib
from pathlib import Path
REPO=Path(sys.argv[1])
def load():
    spec=importlib.util.spec_from_file_location("ud", REPO/"scripts/update_data.py"); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
res={}
tmp=Path(tempfile.mkdtemp())
shutil.copytree(REPO/"data", tmp/"data")
def h(): return hashlib.sha256((REPO/"data/data.json").read_bytes()).hexdigest()
# 1) run again now: unchanged except timestamps -> file untouched
m=load(); before=h(); rc=m.main(); res["rerun_rc"]=rc; res["rerun_untouched"]= (h()==before)
# 2) AA + news fail -> keep last good copies, others fresh
m=load()
def boom(*a,**k): raise RuntimeError("simulated outage")
m.fetch_aa=boom; m.fetch_news=boom
m.SECTIONS=[("arena", m.fetch_arena), ("aa", m.fetch_aa), ("releases", m.fetch_releases), ("news", m.fetch_news), ("trending", m.fetch_trending)]
old=json.loads((REPO/"data/data.json").read_text())
(REPO/"data/data.json").write_text((REPO/"data/data.json").read_text().replace('"Gemini','"GeminiX',1))  # force a change so the file is rewritten
old=json.loads((REPO/"data/data.json").read_text())
rc=m.main(); new=json.loads((REPO/"data/data.json").read_text())
res["partial_rc"]=rc
res["partial_aa_kept"]= new["aa"]["models"]==old["aa"]["models"] and new["status"]["aa"]["ok"] is False
res["partial_news_kept"]= new["news"]["items"]==old["news"]["items"]
# 3) everything fails -> exit 2, data untouched
m=load(); before=h()
for n in ("fetch_arena","fetch_aa","fetch_releases","fetch_news","fetch_trending"): setattr(m,n,boom)
m.SECTIONS=[(n,boom) for n in ("arena","aa","releases","news","trending")]
rc=m.main(); res["allfail_rc"]=rc; res["allfail_untouched"]=(h()==before)
# 4) first-ever run with no old data and AA failing -> must not write
shutil.move(str(REPO/"data"), str(tmp/"data_bak")); (REPO/"data").mkdir()
m=load(); m.SECTIONS=[("arena", m.fetch_arena), ("aa", boom), ("releases", m.fetch_releases), ("news", m.fetch_news), ("trending", m.fetch_trending)]
rc=m.main(); res["fresh_noaa_rc"]=rc; res["fresh_noaa_nofile"]= not (REPO/"data/data.json").exists()
shutil.rmtree(REPO/"data"); shutil.copytree(tmp/"data", REPO/"data")   # restore the good data from before the tests
res["restored"]=(REPO/"data/data.json").exists()
print(json.dumps(res))
sys.stdout.flush(); os._exit(0)
