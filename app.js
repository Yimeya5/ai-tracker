(function () {
  "use strict";
  var D = window.AI_DATA || null;
  var view = document.getElementById("view");
  var stamp = document.getElementById("stamp");
  var TABS = ["today", "best", "ranks", "prices", "news", "timeline", "sources"];
  var state = { tab: "today", board: "chat", sort: "iq", openOnly: false, q: "", newsKind: "all", newsMore: false };
  try { Object.assign(state, JSON.parse(localStorage.getItem("ait-state") || "{}")); } catch (e) {}
  state.newsMore = false;

  function save() { try { localStorage.setItem("ait-state", JSON.stringify({ board: state.board, sort: state.sort, openOnly: state.openOnly, newsKind: state.newsKind })); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https:\/\//.test(u || "") ? esc(u) : "#"; }
  function ago(iso) {
    if (!iso) return "unknown";
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (isNaN(s)) return "unknown";
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    var d = Math.round(s / 86400);
    return d === 1 ? "yesterday" : d + " days ago";
  }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function day(iso) { if (!iso) return ""; var p = iso.slice(0, 10).split("-"); return MON[+p[1] - 1] + " " + (+p[2]); }
  function money(v) { if (v == null) return "–"; return v >= 10 ? "$" + Math.round(v) : v >= 1 ? "$" + (+v.toFixed(2)) : "$" + (+v.toFixed(3)); }
  function fmtNum(n) { if (n == null) return "–"; if (n >= 1e6) return (n / 1e6).toFixed(1) + "M"; if (n >= 1e3) return (n / 1e3).toFixed(1) + "K"; return String(n); }
  function ctx(n) { if (!n) return ""; return n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 2 : 0).replace(/\.?0+$/, "") + "M" : Math.round(n / 1e3) + "K"; }

  function setStamp() {
    if (!D) { stamp.textContent = "No data yet"; return; }
    var hrs = (Date.now() - new Date(D.built).getTime()) / 3600000;
    stamp.innerHTML = '<span class="dot' + (hrs > 36 ? " old" : "") + '"></span>Updated ' + esc(ago(D.built)) + (hrs > 36 ? " · may be out of date" : "");
    stamp.title = "Data built " + new Date(D.built).toLocaleString();
  }

  function sectionNote(name, extra) {
    var st = D.status && D.status[name];
    var t = (D[name] && D[name].updated) || (st && st.updated);
    var bad = st && !st.ok;
    return '<p class="sub">' + (extra ? extra + " · " : "") + "Checked " + esc(ago(t)) + (bad ? ' · <span class="bad">source did not answer last time, showing the last good copy</span>' : "") + "</p>";
  }

  // ---------------------------------------------------------------- views
  function vToday() {
    var w = D.week || { lines: [] };
    var tag = { "new": "New", rank: "Moved", lead: "Top", news: "News" };
    var h = '<h2>What\'s new in AI</h2><p class="sub">Built automatically from today\'s leaderboards, model lists and news.</p>';
    h += '<div class="grid two">';
    h += '<article class="card hero span2"><h3>' + (w.span === 14 ? "Last 2 weeks" : "This week") + '</h3><ul class="wk">';
    var lines = (w.lines || []).slice().sort(function (a, b) { var o = { lead: 0, rank: 1, "new": 2, news: 3 }; return (a.k in o ? o[a.k] : 9) - (b.k in o ? o[b.k] : 9); });
    lines.forEach(function (l) {
      var txt = l.u ? '<a href="' + safeUrl(l.u) + '" target="_blank" rel="noopener">' + esc(l.t) + "</a>" : esc(l.t);
      h += '<li><span class="tag ' + esc(l.k) + '">' + esc(tag[l.k] || l.k) + "</span><div>" + txt +
        (l.s || l.d ? ' <span class="d">' + esc([l.s, day(l.d)].filter(Boolean).join(" · ")) + "</span>" : "") + "</div></li>";
    });
    h += "</ul></article>";
    // quick best picks
    var quick = ["overall", "webdev", "writing", "value", "image", "video"];
    var bm = {}; (D.best || []).forEach(function (b) { bm[b.id] = b; });
    h += '<article class="card span2"><h3>Best right now</h3><div class="mini">';
    quick.forEach(function (id) {
      var b = bm[id]; if (!b) return;
      h += '<a href="#best" data-go="best"><span class="e">' + esc(b.icon) + '</span><span><span class="l">' + esc(b.label) + '</span><br><span class="n">' + esc(b.pick) + "</span></span></a>";
    });
    h += "</div></article>";
    // labs race
    h += '<article class="card"><h3>The big labs</h3><div class="labs">';
    (D.labs || []).slice(0, 8).forEach(function (l) {
      h += '<div class="row"><div><b>' + esc(l.lab) + (l.open ? ' <span class="pill open">open models</span>' : "") + "</b><small>Best: " + esc(l.top || "not tested yet") +
        (l.newest ? " · Newest: " + esc(l.newest) + " (" + esc(day(l.newestD)) + ")" : "") + '</small></div><div class="rk">' + (l.rank ? "#" + l.rank : "–") + "<small>" + (l.iq != null ? "score " + l.iq : "") + "</small></div></div>";
    });
    h += '</div><p class="meta">Rank = place of the lab\'s best model on Artificial Analysis\'s independent tests. Newest = latest model listed on OpenRouter.</p></article>';
    // headlines
    h += '<article class="card"><h3>Latest headlines</h3><ul class="news">';
    ((D.news && D.news.items) || []).slice(0, 6).forEach(function (n) { h += newsItem(n, true); });
    h += '</ul><button class="more" type="button" data-go="news">All news</button></article>';
    h += "</div>";
    return h;
  }

  function newsItem(n, short) {
    return '<li><a class="t" href="' + safeUrl(n.u) + '" target="_blank" rel="noopener">' + esc(n.t) + "</a>" +
      (!short && n.x ? '<p class="x">' + esc(n.x) + "</p>" : "") +
      '<div class="s"><span class="src">' + esc(n.s) + "</span> · " + esc(ago(n.d)) + "</div></li>";
  }

  function vBest() {
    var h = "<h2>Best AI for each job</h2>" + sectionNote("arena", "Picked automatically from leaderboards");
    h += '<div class="grid three">';
    (D.best || []).forEach(function (b) {
      h += '<article class="card pick"><div class="lab">' + esc(b.icon) + " " + esc(b.label) + "</div>" +
        '<div class="name">' + esc(b.pick) + (b.close ? '<span class="pill close">close race</span>' : "") + "</div>" +
        (b.o ? '<div class="who">' + esc(b.o) + "</div>" : "") +
        '<div class="why">' + esc(b.why) + "</div>";
      if (b.ru && b.ru.length) {
        h += '<ul class="ru">';
        b.ru.forEach(function (r) { h += "<li><span>" + esc(r[0]) + "</span><span>" + esc(r[1]) + "</span></li>"; });
        h += "</ul>";
      }
      h += '<div class="meta">Source: <a href="' + safeUrl(b.srcU) + '" target="_blank" rel="noopener">' + esc(b.src) + "</a>" + (b.date ? " · board from " + esc(day(b.date)) : "") + "</div></article>";
    });
    h += "</div>";
    return h;
  }

  function boards() {
    var list = ((D.arena && D.arena.boards) || []).map(function (b) { return { id: b.id, label: b.label, kind: "votes", b: b }; });
    if (D.aa) {
      list.splice(1, 0, { id: "tests", label: "Independent tests", kind: "tests" });
      list.splice(3, 0, { id: "agents", label: "Coding agents", kind: "agents" });
    }
    return list;
  }

  function vRanks() {
    var bl = boards();
    var cur = bl.filter(function (b) { return b.id === state.board; })[0] || bl[0];
    var h = "<h2>Leaderboards</h2>";
    var rows = [], note = "", src = "", srcU = "", unit = "";
    if (cur.kind === "votes") {
      var b = cur.b;
      rows = b.rows.map(function (r) { return { n: r.n, o: r.o, s: r.s, sub: fmtNum(r.votes) + " votes", open: r.open }; });
      note = b.what + " Higher points = people liked it more. Board from " + day(b.date) + ".";
      src = "LMArena"; srcU = b.src; unit = "points";
      h += sectionNote("arena", "People's votes");
    } else if (cur.kind === "tests") {
      rows = D.aa.models.slice(0, 15).map(function (m) { return { n: m.n, o: m.o, s: m.iq, sub: m.est ? "estimated" : "", open: m.open }; });
      note = "Artificial Analysis runs the same set of hard tests on every model (science, coding, agents, knowledge) and combines them into one score out of 100.";
      src = "Artificial Analysis"; srcU = D.aa.src; unit = "score";
      h += sectionNote("aa", "Independent tests");
    } else {
      rows = D.aa.models.filter(function (m) { return m.code != null; }).sort(function (a, b) { return b.code - a.code; }).slice(0, 15)
        .map(function (m) { return { n: m.n, o: m.o, s: m.code, sub: "% of tasks", open: m.open }; });
      note = "Terminal-Bench: share of real computer tasks (in a terminal) the model finishes on its own. Tested by Artificial Analysis.";
      src = "Artificial Analysis"; srcU = D.aa.src; unit = "%";
      h += sectionNote("aa", "Coding agents");
    }
    h += '<div class="chips" role="group" aria-label="Choose a leaderboard">';
    bl.forEach(function (x) { h += '<button type="button" class="chip" data-board="' + esc(x.id) + '" aria-pressed="' + (x.id === cur.id) + '">' + esc(x.label) + "</button>"; });
    h += "</div>";
    var max = rows.length ? rows[0].s : 1, min = rows.length ? rows[rows.length - 1].s : 0;
    h += '<article class="card"><h3>' + esc(cur.label) + '</h3><ol class="board">';
    rows.forEach(function (r, i) {
      var pct = max === min ? 100 : 25 + 75 * (r.s - min) / (max - min);
      h += '<li><span class="r">' + (i + 1) + '</span><div class="nm"><b>' + esc(r.n) + (r.open ? '<span class="pill open">open</span>' : "") + "</b><small>" + esc(r.o) + "</small>" +
        '<div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div></div><div class="sc">' + esc(r.s) + "<small>" + esc(r.sub || unit) + "</small></div></li>";
    });
    h += '</ol><p class="meta">' + esc(note) + ' Source: <a href="' + safeUrl(srcU) + '" target="_blank" rel="noopener">' + esc(src) + "</a></p></article>";
    return h;
  }

  function vPrices() {
    var h = "<h2>Prices</h2>" + sectionNote("aa", "Price to use each model through its API, per 1 million tokens (about 750,000 words)");
    var ms = ((D.aa && D.aa.models) || []).filter(function (m) { return m.pin != null && m.pout != null; });
    var q = state.q.toLowerCase();
    if (q) ms = ms.filter(function (m) { return (m.n + " " + m.o).toLowerCase().indexOf(q) >= 0; });
    if (state.openOnly) ms = ms.filter(function (m) { return m.open; });
    var key = state.sort;
    var cmp = {
      iq: function (a, b) { return b.iq - a.iq; },
      pout: function (a, b) { return a.pout - b.pout || b.iq - a.iq; },
      pin: function (a, b) { return a.pin - b.pin || b.iq - a.iq; },
      task: function (a, b) { return (a.task == null ? 1e9 : a.task) - (b.task == null ? 1e9 : b.task); },
      value: function (a, b) { return (b.task ? b.iq / b.task : 0) - (a.task ? a.iq / a.task : 0); }
    }[key] || function () { return 0; };
    ms = ms.slice().sort(cmp);
    h += '<div class="controls"><input class="search" id="q" type="search" placeholder="Search models or labs" value="' + esc(state.q) + '" aria-label="Search models">' +
      '<label class="toggle"><input type="checkbox" id="openOnly"' + (state.openOnly ? " checked" : "") + "> Open models only</label></div>";
    h += '<div class="chips" role="group" aria-label="Sort by">';
    [["iq", "Smartest"], ["pout", "Cheapest"], ["value", "Best value"], ["task", "Lowest cost per task"]].forEach(function (s) {
      h += '<button type="button" class="chip" data-sort="' + s[0] + '" aria-pressed="' + (key === s[0]) + '">' + s[1] + "</button>";
    });
    h += "</div>";
    h += '<article class="card"><div class="tablewrap"><table><thead><tr><th scope="col">Model</th><th scope="col" class="num">Score</th><th scope="col" class="num lg">Input</th><th scope="col" class="num lg">Output</th><th scope="col" class="num sm">In / Out</th><th scope="col" class="num">Per task</th></tr></thead><tbody>';
    ms.forEach(function (m) {
      h += "<tr><td><b>" + esc(m.n) + "</b><small>" + esc(m.o) + (m.open ? " · open" : "") + (m.ctx ? '<span class="lg"> · ' + ctx(m.ctx) + " context</span>" : "") + "</small></td>" +
        '<td class="num">' + esc(m.iq) + '</td><td class="num lg">' + money(m.pin) + '</td><td class="num lg">' + money(m.pout) + '</td><td class="num sm">' + money(m.pin) + " / " + money(m.pout) + '</td><td class="num">' + money(m.task) + "</td></tr>";
    });
    if (!ms.length) h += '<tr><td colspan="6" class="muted">No models match.</td></tr>';
    h += '</tbody></table></div><p class="meta">Score = Artificial Analysis test score (out of 100). Input/Output = dollars per 1M tokens. Per task = what it cost Artificial Analysis to run one of its test tasks, which shows the real cost including how much the model "thinks". Source: <a href="' + safeUrl(D.aa && D.aa.src) + '" target="_blank" rel="noopener">Artificial Analysis</a></p></article>';
    return h;
  }

  function vNews() {
    var items = (D.news && D.news.items) || [];
    if (state.newsKind !== "all") items = items.filter(function (n) { return n.k === state.newsKind; });
    var shown = state.newsMore ? items : items.slice(0, 25);
    var h = "<h2>News</h2>" + sectionNote("news", "From AI labs and tech news sites");
    h += '<div class="chips" role="group" aria-label="Filter news">';
    [["all", "All"], ["lab", "From the AI labs"], ["news", "Tech news"]].forEach(function (s) {
      h += '<button type="button" class="chip" data-news="' + s[0] + '" aria-pressed="' + (state.newsKind === s[0]) + '">' + s[1] + "</button>";
    });
    h += '</div><div class="grid two"><article class="card"><ul class="news">';
    shown.forEach(function (n) { h += newsItem(n, false); });
    h += "</ul>" + (items.length > shown.length ? '<button class="more" type="button" id="newsMore">Show ' + (items.length - shown.length) + " more</button>" : "") + "</article>";
    var tr = (D.trending && D.trending.models) || [];
    var PIPE = { "text-generation": "Chat / text", "image-text-to-text": "Text + images", "text-to-image": "Makes images", "text-to-video": "Makes video", "image-to-video": "Photo to video", "text-to-speech": "Voice", "automatic-speech-recognition": "Speech to text", "any-to-any": "All-in-one", "image-to-image": "Edits images", "feature-extraction": "Search", "sentence-similarity": "Search" };
    h += '<article class="card"><h3>Trending free models</h3><p class="sub" style="margin:0 0 6px">What people are downloading on Hugging Face right now. ' + "Checked " + esc(ago(D.trending && D.trending.updated)) + '.</p><ol class="board">';
    tr.slice(0, 15).forEach(function (m, i) {
      var parts = m.id.split("/");
      h += '<li><span class="r">' + (i + 1) + '</span><div class="nm"><b><a href="' + safeUrl(m.u) + '" target="_blank" rel="noopener">' + esc(parts[1] || m.id) + "</a></b><small>" + esc(parts[0]) + (m.pipe ? " · " + esc(PIPE[m.pipe] || m.pipe) : "") + '</small></div><div class="sc">' + fmtNum(m.likes) + "<small>likes</small></div></li>";
    });
    h += "</ol></article></div>";
    return h;
  }

  function vTimeline() {
    var items = (D.releases && D.releases.items) || [];
    var h = "<h2>Model releases</h2>" + sectionNote("releases", "New models from the big labs, newest first (date each became available on OpenRouter)");
    h += '<article class="card"><ul class="tl">';
    var lastMo = "";
    items.forEach(function (r) {
      var mo = r.d.slice(0, 7);
      if (mo !== lastMo) {
        var p = mo.split("-");
        h += '<li class="mo">' + ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][+p[1] - 1] + " " + p[0] + "</li>";
        lastMo = mo;
      }
      h += '<li class="it"><span class="d">' + esc(day(r.d)) + '</span><span><a href="' + safeUrl(r.u) + '" target="_blank" rel="noopener"><b>' + esc(r.n) + "</b></a> <small class=\"muted\">" + esc(r.o) + (r.ctx ? " · " + ctx(r.ctx) + " context" : "") + '</small></span><span class="p">' +
        (r.pin != null && r.pout != null ? (r.pin === 0 && r.pout === 0 ? "free" : money(r.pin) + " / " + money(r.pout)) : "") + "</span></li>";
    });
    h += '</ul><p class="meta">Price = dollars per 1M tokens in / out, as listed on <a href="https://openrouter.ai/models" target="_blank" rel="noopener">OpenRouter</a>. Some models reach OpenRouter a few days after the lab announces them, and a few (like Gemini 4 Carbon while access is limited) are not listed there yet.</p></article>';
    return h;
  }

  function vSources() {
    var names = { arena: ["Leaderboards (people's votes)", "LMArena", "https://lmarena.ai/leaderboard"], aa: ["Test scores, prices, speed", "Artificial Analysis", "https://artificialanalysis.ai/leaderboards/models"],
      releases: ["Model releases", "OpenRouter", "https://openrouter.ai/models"], news: ["News", "RSS feeds", ""], trending: ["Trending models", "Hugging Face", "https://huggingface.co/models?sort=trending"] };
    var h = "<h2>Sources and update status</h2><p class=\"sub\">The app rebuilds itself every day from free public sources. If one source fails, that part keeps its last good copy.</p>";
    h += '<div class="grid two"><article class="card"><h3>Status</h3><ul class="status">';
    Object.keys(names).forEach(function (k) {
      var st = (D.status && D.status[k]) || {};
      h += "<li><span><b>" + esc(names[k][0]) + "</b><br><small class=\"muted\">" + (names[k][2] ? '<a href="' + safeUrl(names[k][2]) + '" target="_blank" rel="noopener">' + esc(names[k][1]) + "</a>" : esc(names[k][1])) + "</small></span><span class=\"" + (st.ok ? "ok" : "bad") + '">' + (st.ok ? "✓ " : "⚠ ") + esc(ago((D[k] && D[k].updated) || st.updated)) + "</span></li>";
    });
    h += "</ul></article>";
    h += '<article class="card"><h3>News feeds</h3><ul class="status">';
    ((D.news && D.news.feeds) || []).forEach(function (f) { h += "<li><span>" + esc(f[0]) + '</span><span class="' + (f[1] === "ok" ? "ok" : "bad") + '">' + (f[1] === "ok" ? "✓ " + esc(f[2]) + " stories" : "⚠ didn't answer") + "</span></li>"; });
    h += "</ul></article>";
    h += '<article class="card span2"><h3>How to read the numbers</h3><p><b>Points</b> (LMArena): people chat with two hidden models and vote for the better answer. More points = more wins. A gap of a few points is a tie.</p><p><b>Score</b> (Artificial Analysis): one number out of 100 from the same hard tests run on every model. It measures skill on tests, not how nice a model is to talk to, so the two boards can disagree.</p><p><b>Prices</b> are per 1 million tokens. A token is about ¾ of a word. "Per task" is the real cost of one test task, including the model\'s thinking.</p><p class="meta">Data built ' + esc(new Date(D.built).toLocaleString()) + ". No sign-in, no tracking, no paid services.</p></article></div>";
    return h;
  }

  var VIEWS = { today: vToday, best: vBest, ranks: vRanks, prices: vPrices, news: vNews, timeline: vTimeline, sources: vSources };

  function render(focus) {
    setStamp();
    if (!D) { view.innerHTML = '<div class="card"><h3>No data yet</h3><p>Connect to the internet once and reopen the app.</p></div>'; return; }
    view.innerHTML = VIEWS[state.tab]();
    document.querySelectorAll("#tabs button").forEach(function (b) {
      if (b.dataset.tab === state.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    var q = document.getElementById("q");
    if (q && focus === "q") { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  function go(tab) {
    if (TABS.indexOf(tab) < 0) tab = "today";
    state.tab = tab;
    if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
    render();
    window.scrollTo(0, 0);
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-tab],[data-go],[data-board],[data-sort],[data-news],#newsMore");
    if (!t) return;
    if (t.dataset.tab) { go(t.dataset.tab); }
    else if (t.dataset.go) { e.preventDefault(); go(t.dataset.go); }
    else if (t.dataset.board) { state.board = t.dataset.board; save(); render(); }
    else if (t.dataset.sort) { state.sort = t.dataset.sort; save(); render(); }
    else if (t.dataset.news) { state.newsKind = t.dataset.news; state.newsMore = false; save(); render(); }
    else if (t.id === "newsMore") { state.newsMore = true; render(); }
  });
  document.addEventListener("input", function (e) {
    if (e.target.id === "q") { state.q = e.target.value; render("q"); }
  });
  document.addEventListener("change", function (e) {
    if (e.target.id === "openOnly") { state.openOnly = e.target.checked; save(); render(); }
  });
  window.addEventListener("hashchange", function () { var t = location.hash.slice(1); if (t && t !== state.tab) go(t); });

  // theme
  var root = document.documentElement;
  function applyTheme(t) { if (t) root.setAttribute("data-theme", t); else root.removeAttribute("data-theme"); }
  applyTheme(localStorage.getItem("ait-theme"));
  document.getElementById("theme").addEventListener("click", function () {
    var dark = root.getAttribute("data-theme") ? root.getAttribute("data-theme") === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    var t = dark ? "light" : "dark";
    localStorage.setItem("ait-theme", t); applyTheme(t);
  });

  // fresh data: ask the network for the newest data.json (falls back silently when offline)
  var btn = document.getElementById("refresh");
  function pull(manual) {
    if (!window.fetch) return;
    if (manual) btn.classList.add("spin");
    fetch("data/data.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (nd) {
        document.getElementById("offline").hidden = true;
        if (nd && nd.built && (!D || nd.built !== D.built)) { D = nd; render(); } else setStamp();
      })
      .catch(function () { if (!navigator.onLine) document.getElementById("offline").hidden = false; })
      .then(function () { btn.classList.remove("spin"); });
  }
  btn.addEventListener("click", function () { pull(true); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { setStamp(); pull(false); } });
  window.addEventListener("online", function () { document.getElementById("offline").hidden = true; pull(false); });
  window.addEventListener("offline", function () { document.getElementById("offline").hidden = false; });

  state.tab = TABS.indexOf(location.hash.slice(1)) >= 0 ? location.hash.slice(1) : "today";
  render();
  pull(false);
  setInterval(setStamp, 60000);

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
