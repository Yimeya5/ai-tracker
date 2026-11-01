(function (root) {
  "use strict";
  // AI Tracker, simple version: 3 tabs (Home, Best AI, More).
  // The data format is unchanged; this file only decides what to show and how.
  var hasDom = typeof document !== "undefined";
  var D = root.AI_DATA || null;

  var TABS = ["today", "best", "more"];
  // More tab sections: [id, title, one-line description]. Ids double as old #hash links.
  var SECTIONS = [
    ["news", "All news", "Latest AI headlines"],
    ["ranks", "Leaderboards", "Top 10 for each job"],
    ["prices", "Prices", "What each AI costs to use"],
    ["timeline", "New models", "Released lately, newest first"],
    ["trending", "Trending free models", "Most liked on Hugging Face right now"],
    ["labs", "The big AI companies", "Each one's best and newest model"],
    ["sources", "Sources and update status", "Where the data comes from"]
  ];
  var ALIAS = { "": "today", today: "today", home: "today", best: "best", more: "more" };

  var state = { tab: "today", open: {}, board: "chat", sort: "smart", all: {} };
  try {
    var saved = JSON.parse(root.localStorage.getItem("ait2") || "{}");
    if (saved.board) state.board = saved.board;
    if (saved.sort === "cheap" || saved.sort === "smart") state.sort = saved.sort;
  } catch (e) {}
  function save() { try { root.localStorage.setItem("ait2", JSON.stringify({ board: state.board, sort: state.sort })); } catch (e) {} }

  // ---------------------------------------------------------------- helpers
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https:\/\//.test(u || "") ? esc(u) : "#"; }
  function ext(u, text) { return '<a href="' + safeUrl(u) + '" target="_blank" rel="noopener">' + text + "</a>"; }
  function ago(iso) {
    if (!iso) return "";
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (isNaN(s)) return "";
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) { var h = Math.round(s / 3600); return h + (h === 1 ? " hour ago" : " hours ago"); }
    var d = Math.round(s / 86400);
    return d <= 1 ? "yesterday" : d + " days ago";
  }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function day(iso) { if (!iso) return ""; var p = String(iso).slice(0, 10).split("-"); return p.length < 3 ? "" : MON[+p[1] - 1] + " " + (+p[2]); }
  function money(v) { if (v == null) return ""; if (v === 0) return "$0"; return v >= 10 ? "$" + Math.round(v) : v >= 1 ? "$" + (+v.toFixed(2)) : "$" + (+v.toFixed(3)); }
  function price(m) {
    if (m.pin == null || m.pout == null) return "";
    if (m.pin === 0 && m.pout === 0) return "Free";
    return money(m.pin) + " / " + money(m.pout);
  }
  function list(x) { return Array.isArray(x) ? x : []; }
  function best() { return list(D && D.best); }
  function boards() { return list(D && D.arena && D.arena.boards).filter(function (b) { return list(b.rows).length; }); }
  function aaModels() { return list(D && D.aa && D.aa.models); }

  // ---------------------------------------------------------------- picks
  function bestById(ids) {
    for (var i = 0; i < ids.length; i++) {
      for (var j = 0; j < best().length; j++) if (best()[j].id === ids[i] && best()[j].pick) return best()[j];
    }
    return null;
  }
  function bestMatch(re, not) {
    return best().filter(function (b) { var t = b.id + " " + (b.label || ""); return b.pick && re.test(t) && !(not && not.test(t)); })[0] || null;
  }
  function boardMatch(re, not) { return boards().filter(function (b) { var t = b.id + " " + (b.label || ""); return re.test(t) && !(not && not.test(t)); })[0] || null; }

  function fromBest(b) {
    return { name: b.pick, maker: b.o || "", why: b.why || "", close: !!b.close,
      alts: list(b.ru).map(function (r) { return r && r[0]; }).filter(Boolean).slice(0, 3),
      src: b.src || "", srcU: b.srcU || "" };
  }
  function fromBoard(bd) {
    var r = bd.rows;
    return { name: r[0].n, maker: r[0].o || "",
      why: "It is #1 on LMArena's “" + bd.label + "” board, where people compare two answers and vote for the better one.",
      alts: r.slice(1, 4).map(function (x) { return x.n; }), src: bd.srcName || "LMArena", srcU: bd.src || "" };
  }
  function aaTop() {
    var ms = aaModels().filter(function (m) { return m.iq != null; }).sort(function (a, b) { return b.iq - a.iq; });
    if (!ms.length) return null;
    return { name: ms[0].n, maker: ms[0].o || "", why: "It has the highest score in Artificial Analysis's independent tests.",
      alts: ms.slice(1, 4).map(function (m) { return m.n; }), src: "Artificial Analysis", srcU: D.aa.src || "" };
  }
  function aaCode() {
    var ms = aaModels().filter(function (m) { return m.code != null; }).sort(function (a, b) { return b.code - a.code; });
    if (!ms.length) return null;
    return { name: ms[0].n, maker: ms[0].o || "", why: "It finishes the most real coding tasks on its own in Artificial Analysis's tests.",
      alts: ms.slice(1, 4).map(function (m) { return m.n; }), src: "Artificial Analysis", srcU: D.aa.src || "" };
  }
  function blend(m) { return (3 * m.pin + m.pout) / 4; }
  function aaCheap() {
    var ms = aaModels().filter(function (m) { return m.iq != null && m.pin != null && m.pout != null; });
    if (!ms.length) return null;
    var top = Math.max.apply(null, ms.map(function (m) { return m.iq; }));
    var good = ms.filter(function (m) { return m.iq >= top * 0.85; }).sort(function (a, b) { return blend(a) - blend(b) || b.iq - a.iq; });
    var m = good[0];
    return { name: m.n, maker: m.o || "",
      why: "Of the AIs that score close to the top in independent tests, this one costs the least: " + price(m) + " per million tokens (in / out).",
      alts: good.slice(1, 4).map(function (x) { return x.n; }), src: "Artificial Analysis", srcU: D.aa.src || "" };
  }

  var HOME = [
    { key: "chat", label: "Questions & chatting", icon: "💬", get: function () {
      var b = bestById(["overall", "chat", "smartest"]); if (b) return fromBest(b);
      var bd = boardMatch(/^(chat|text|overall)\b/); if (bd) return fromBoard(bd);
      return aaTop(); } },
    { key: "writing", label: "Writing", icon: "✍️", get: function () {
      var b = bestById(["writing", "creative", "creative_writing", "creative-writing"]) || bestMatch(/writ|creative/i); if (b) return fromBest(b);
      var bd = boardMatch(/writ|creative/i); return bd ? fromBoard(bd) : null; } },
    { key: "coding", label: "Coding", icon: "💻", get: function () {
      var b = bestById(["coding", "webdev", "code"]); if (b) return fromBest(b);
      var bd = boardMatch(/^(coding|webdev)\b/); if (bd) return fromBoard(bd);
      return aaCode(); } },
    { key: "pictures", label: "Pictures", icon: "🎨", get: function () {
      var b = bestById(["image", "images", "pictures", "text-to-image", "text2image"]) || bestMatch(/image|picture/i, /video|edit/i); if (b) return fromBest(b);
      var bd = boardMatch(/image/i, /video|edit/i); return bd ? fromBoard(bd) : null; } },
    { key: "cheap", label: "Cheapest good one", icon: "💰", get: function () {
      var b = bestById(["value", "cheap", "cheapest", "budget"]) || bestMatch(/cheap|value|budget/i); if (b) return fromBest(b);
      return aaCheap(); } }
  ];

  function homePicks() {
    if (!D) return [];
    var out = [];
    HOME.forEach(function (h) {
      var p = null;
      try { p = h.get(); } catch (e) { p = null; }
      if (p && p.name) { p.key = h.key; p.label = h.label; p.icon = h.icon; out.push(p); }
    });
    return out;
  }

  function shortNew(t) { return String(t || "").replace(/\s*\([^)]*\)\s*$/, "").replace(/^New model:\s*/i, "New AI: "); }
  function whatsNew() {
    if (!D) return [];
    var rel = list(D.week && D.week.lines).filter(function (l) { return l.k === "new" && l.t; })
      .map(function (l) { return { t: shortNew(l.t), m: ago(l.d), u: l.u }; });
    if (!rel.length) rel = list(D.releases && D.releases.items).map(function (r) { return { t: "New AI: " + r.n + (r.o ? " from " + r.o : ""), m: ago(r.d), u: r.u }; });
    var news = list(D.news && D.news.items).filter(function (n) { return n.t; })
      .map(function (n) { return { t: n.t, m: [n.s, ago(n.d)].filter(Boolean).join(" · "), u: n.u }; });
    var out = rel.slice(0, 2).concat(news.slice(0, 3));
    var extra = rel.slice(2).concat(news.slice(3));
    while (out.length < 5 && extra.length) out.push(extra.shift());
    return out.slice(0, 5);
  }

  // ---------------------------------------------------------------- pieces
  function card(id, p) {
    var h = '<details class="pick" id="' + esc(id) + '"' + (state.open[id] ? " open" : "") + "><summary>" +
      '<span class="ico" aria-hidden="true">' + esc(p.icon || "•") + "</span>" +
      '<span class="pt"><span class="lab">' + esc(p.label) + '</span><span class="name">' + esc(p.name) + "</span>" +
      (p.maker ? '<span class="who">by ' + esc(p.maker) + "</span>" : "") + "</span>" +
      '<span class="chev" aria-hidden="true"></span></summary><div class="body">';
    if (p.why) h += "<p>" + esc(p.why) + "</p>";
    if (p.close) h += "<p>It's a close race. The next ones are almost as good.</p>";
    if (p.alts && p.alts.length) h += "<p><b>Also good:</b> " + esc(p.alts.join(", ")) + "</p>";
    if (p.src) h += '<p class="src">Source: ' + (p.srcU ? ext(p.srcU, esc(p.src)) : esc(p.src)) + "</p>";
    return h + "</div></details>";
  }

  function rows(items) { return items.length ? '<ul class="rows">' + items.join("") + "</ul>" : '<p class="note">Nothing here yet.</p>'; }
  function row(rank, name, small, right, rightCls) {
    return "<li>" + (rank ? '<span class="rk">' + rank + "</span>" : "") +
      '<span class="rn">' + name + (small ? "<small>" + small + "</small>" : "") + "</span>" +
      (right ? '<span class="rv' + (rightCls ? " " + rightCls : "") + '">' + right + "</span>" : "") + "</li>";
  }
  function moreBtn(key, total, shown) {
    return total > shown ? '<button type="button" class="morebtn" data-all="' + key + '">Show all ' + total + "</button>" : "";
  }
  function failNote(name) {
    var st = D.status && D.status[name];
    return st && !st.ok ? '<p class="note bad">This source didn\'t answer at the last update, so this is the last good copy.</p>' : "";
  }

  // ---------------------------------------------------------------- More sections
  function sNews() {
    var items = list(D.news && D.news.items);
    var shown = state.all.news ? items : items.slice(0, 12);
    return failNote("news") + rows(shown.map(function (n) {
      return row("", ext(n.u, esc(n.t)), esc([n.s, ago(n.d)].filter(Boolean).join(" · ")));
    })) + moreBtn("news", items.length, shown.length);
  }

  function boardList() {
    var bl = boards().map(function (b) { return { id: b.id, label: b.label, b: b }; });
    if (aaModels().length) bl.push({ id: "tests", label: "Independent test scores" });
    return bl;
  }
  function sRanks() {
    var bl = boardList();
    if (!bl.length) return '<p class="note">No leaderboards yet.</p>';
    var cur = bl.filter(function (x) { return x.id === state.board; })[0] || bl[0];
    var h = '<div class="chips" role="group" aria-label="Choose a leaderboard">';
    bl.forEach(function (x) { h += '<button type="button" class="chip" data-board="' + esc(x.id) + '" aria-pressed="' + (x.id === cur.id) + '">' + esc(x.label) + "</button>"; });
    h += "</div>";
    var top, note;
    if (cur.b) {
      top = cur.b.rows.slice(0, 10);
      note = (cur.b.what ? cur.b.what + " " : "") + "Source: " + ext(cur.b.src, esc(cur.b.srcName || "LMArena")) + (cur.b.date ? ", " + esc(day(cur.b.date)) : "") + ".";
      h += failNote("arena");
    } else {
      top = aaModels().filter(function (m) { return m.iq != null; }).sort(function (a, b) { return b.iq - a.iq; }).slice(0, 10);
      note = "The same hard tests run on every model. Source: " + ext(D.aa.src, "Artificial Analysis") + ".";
      h += failNote("aa");
    }
    h += '<p class="note">' + note + "</p>";
    return h + rows(top.map(function (r, i) { return row(String(i + 1), "<b>" + esc(r.n) + "</b>", esc(r.o)); }));
  }

  function sPrices() {
    var ms = aaModels().filter(function (m) { return m.pin != null && m.pout != null; });
    if (state.sort === "cheap") ms.sort(function (a, b) { return blend(a) - blend(b) || (b.iq || 0) - (a.iq || 0); });
    else ms.sort(function (a, b) { return (b.iq == null ? -1 : b.iq) - (a.iq == null ? -1 : a.iq); });
    var shown = state.all.prices ? ms : ms.slice(0, 15);
    var h = '<div class="chips" role="group" aria-label="Order">' +
      '<button type="button" class="chip" data-sort="smart" aria-pressed="' + (state.sort === "smart") + '">Smartest first</button>' +
      '<button type="button" class="chip" data-sort="cheap" aria-pressed="' + (state.sort === "cheap") + '">Cheapest first</button></div>';
    h += '<p class="note">Dollars per million tokens, to send / to get back. A million tokens is about 750,000 words.</p>' + failNote("aa");
    h += rows(shown.map(function (m) { return row("", "<b>" + esc(m.n) + "</b>", esc(m.o), esc(price(m))); }));
    return h + moreBtn("prices", ms.length, shown.length) + '<p class="note" style="margin-top:14px">Source: ' + ext(D.aa && D.aa.src, "Artificial Analysis") + "</p>";
  }

  function sTimeline() {
    var items = list(D.releases && D.releases.items);
    var shown = state.all.timeline ? items : items.slice(0, 15);
    return failNote("releases") + rows(shown.map(function (r) {
      return row("", ext(r.u, esc(r.n)), esc([r.o, day(r.d)].filter(Boolean).join(" · ")));
    })) + moreBtn("timeline", items.length, shown.length) +
      '<p class="note" style="margin-top:14px">Date each one appeared on ' + ext((D.releases && D.releases.src) || "https://openrouter.ai/models", "OpenRouter") + ".</p>";
  }

  var KIND = { "text-generation": "Chat and text", "image-text-to-text": "Text and images", "text-to-image": "Makes pictures", "text-to-video": "Makes video",
    "image-to-video": "Photo to video", "text-to-speech": "Voice", "automatic-speech-recognition": "Speech to text", "any-to-any": "All-in-one",
    "image-to-image": "Edits pictures", "feature-extraction": "Search", "sentence-similarity": "Search" };
  function sTrending() {
    var tr = list(D.trending && D.trending.models).slice(0, 10);
    return failNote("trending") + rows(tr.map(function (m, i) {
      var p = String(m.id).split("/");
      return row(String(i + 1), ext(m.u, esc(p[1] || m.id)), esc([p[1] ? p[0] : "", KIND[m.pipe] || ""].filter(Boolean).join(" · ")));
    })) + '<p class="note" style="margin-top:14px">Free models you can download, from ' + ext((D.trending && D.trending.src) || "https://huggingface.co/models?sort=trending", "Hugging Face") + ".</p>";
  }

  function sLabs() {
    return rows(list(D.labs).slice(0, 10).map(function (l) {
      var bits = [];
      if (l.top) bits.push("Best: " + esc(l.top));
      if (l.newest) bits.push("Newest: " + esc(l.newest) + (l.newestD ? " (" + esc(day(l.newestD)) + ")" : ""));
      return row("", "<b>" + esc(l.lab) + "</b>", bits.join("<br>"));
    }));
  }

  function sSources() {
    var names = { arena: ["People's votes", "LMArena", "https://lmarena.ai/leaderboard"],
      aa: ["Test scores and prices", "Artificial Analysis", "https://artificialanalysis.ai/leaderboards/models"],
      releases: ["New models", "OpenRouter", "https://openrouter.ai/models"],
      news: ["News", "News feeds", ""],
      trending: ["Trending models", "Hugging Face", "https://huggingface.co/models?sort=trending"] };
    var items = Object.keys(names).map(function (k) {
      var st = (D.status && D.status[k]) || {};
      var when = ago((D[k] && D[k].updated) || st.updated);
      return row("", "<b>" + esc(names[k][0]) + "</b>", names[k][2] ? ext(names[k][2], esc(names[k][1])) : esc(names[k][1]),
        st.ok ? "✓ " + esc(when) : "⚠ " + (when ? esc(when) : "no answer"), st.ok ? "ok" : "bad");
    });
    var feeds = list(D.news && D.news.feeds);
    var okFeeds = feeds.filter(function (f) { return f[1] === "ok"; }).length;
    var h = '<p class="note">Rebuilt every day from free public sites. If a site doesn\'t answer, that part keeps its last good copy.</p>' + rows(items);
    if (feeds.length) h += '<p class="note" style="margin-top:14px">' + okFeeds + " of " + feeds.length + " news feeds answered last time.</p>";
    h += '<div class="help"><p><b>People\'s votes:</b> people chat with two hidden AIs and pick the better answer.</p>' +
      "<p><b>Test scores:</b> the same hard tests run on every AI. The two can disagree.</p>" +
      "<p>Data built " + esc(new Date(D.built).toLocaleString()) + ". No sign-in, no tracking.</p></div>";
    return h;
  }

  var SECTION_FN = { news: sNews, ranks: sRanks, prices: sPrices, timeline: sTimeline, trending: sTrending, labs: sLabs, sources: sSources };

  // ---------------------------------------------------------------- views
  function vToday() {
    var picks = homePicks();
    var h = "<h2>Best AI right now</h2><p class=\"sub\">Tap one to see why.</p><div class=\"stack\">";
    h += picks.map(function (p) { return card("h-" + p.key, p); }).join("") || '<p class="note">No picks yet.</p>';
    h += "</div><h2>What's new</h2>";
    var lines = whatsNew();
    h += lines.length ? '<ul class="lines">' + lines.map(function (l) {
      var inner = '<span class="lt">' + esc(l.t) + "</span>" + (l.m ? '<span class="lm">' + esc(l.m) + "</span>" : "");
      return "<li>" + (l.u ? '<a href="' + safeUrl(l.u) + '" target="_blank" rel="noopener">' + inner + "</a>" : '<span class="nolink">' + inner + "</span>") + "</li>";
    }).join("") + "</ul>" : '<p class="note">Nothing new yet.</p>';
    h += '<a class="golink" href="#news">See all news ›</a>';
    return h;
  }

  function vBest() {
    var h = "<h2>Best AI for each job</h2><p class=\"sub\">Tap one to see why. Picked from public leaderboards every day.</p><div class=\"stack\">";
    h += best().filter(function (b) { return b.pick; }).map(function (b) {
      var p = fromBest(b); p.label = b.label; p.icon = b.icon;
      return card("b-" + b.id, p);
    }).join("") || '<p class="note">No picks yet.</p>';
    return h + "</div>";
  }

  function vMore() {
    var h = "<h2>More</h2><p class=\"sub\">Tap a topic to open it.</p><div class=\"stack\">";
    SECTIONS.forEach(function (s) {
      var id = "sec-" + s[0], body = "";
      try { body = SECTION_FN[s[0]](); } catch (e) { body = '<p class="note">This part could not be shown.</p>'; }
      h += '<details class="sec" id="' + id + '"' + (state.open[id] ? " open" : "") + "><summary><span><b>" + esc(s[1]) + "</b><small>" + esc(s[2]) + "</small></span>" +
        '<span class="chev" aria-hidden="true"></span></summary><div class="body">' + body + "</div></details>";
    });
    return h + "</div>";
  }

  var VIEWS = { today: vToday, best: vBest, more: vMore };

  // #today, #best, #more, plus old links (#ranks, #prices, #news, #timeline, #sources) and the other section ids.
  function routeFor(hash) {
    var h = String(hash || "").replace(/^#/, "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(ALIAS, h)) return { tab: ALIAS[h] };
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i][0] === h) return { tab: "more", open: h };
    return null;
  }

  root.AITracker = { routeFor: routeFor, homePicks: homePicks, whatsNew: whatsNew, views: VIEWS, sections: SECTIONS,
    setData: function (d) { D = d; } };

  if (!hasDom) return;

  // ---------------------------------------------------------------- page wiring
  var view = document.getElementById("view");
  var stamp = document.getElementById("stamp");

  function setStamp() {
    if (!D) { stamp.textContent = "No data yet"; return; }
    var hrs = (Date.now() - new Date(D.built).getTime()) / 3600000;
    stamp.innerHTML = '<span class="dot' + (hrs > 36 ? " old" : "") + '"></span>Updated ' + esc(ago(D.built) || "recently") + (hrs > 36 ? ", may be out of date" : "");
    stamp.title = "Data built " + new Date(D.built).toLocaleString();
  }

  function render() {
    setStamp();
    if (!D) { view.innerHTML = '<h2>No data yet</h2><p class="sub">Connect to the internet once and reopen the app.</p>'; return; }
    view.innerHTML = VIEWS[state.tab]();
    document.querySelectorAll("#tabs button").forEach(function (b) {
      if (b.getAttribute("data-tab") === state.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
  }

  function setHash(h) { if (location.hash !== h) { try { history.replaceState(null, "", h); } catch (e) {} } }

  function go(tab, openSec, scroll) {
    if (TABS.indexOf(tab) < 0) tab = "today";
    state.tab = tab;
    if (openSec) state.open["sec-" + openSec] = true;
    setHash("#" + (openSec || tab));
    render();
    var el = openSec && document.getElementById("sec-" + openSec);
    if (el) el.scrollIntoView({ block: "start" });
    else if (scroll !== false) window.scrollTo(0, 0);
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-tab],[data-board],[data-sort],[data-all],summary");
    if (!t) return;
    if (t.tagName === "SUMMARY") {
      var d = t.parentNode;
      if (d && d.id && d.id.indexOf("sec-") === 0) setHash(d.open ? "#more" : "#" + d.id.slice(4));
      return;
    }
    var a = t.getAttribute.bind(t);
    if (a("data-tab")) go(a("data-tab"));
    else if (a("data-board")) { state.board = a("data-board"); save(); render(); }
    else if (a("data-sort")) { state.sort = a("data-sort"); save(); render(); }
    else if (a("data-all")) { state.all[a("data-all")] = true; render(); }
  });
  // remember which cards and sections are open, so a refresh keeps them open
  document.addEventListener("toggle", function (e) {
    var d = e.target;
    if (d && d.tagName === "DETAILS" && d.id) state.open[d.id] = d.open;
  }, true);
  window.addEventListener("hashchange", function () {
    var r = routeFor(location.hash);
    if (r) go(r.tab, r.open);
  });

  // theme: follows the system until the button is used
  var rootEl = document.documentElement;
  function applyTheme(t) { if (t === "light" || t === "dark") rootEl.setAttribute("data-theme", t); else rootEl.removeAttribute("data-theme"); }
  try { applyTheme(localStorage.getItem("ait-theme")); } catch (e) {}
  document.getElementById("theme").addEventListener("click", function () {
    var cur = rootEl.getAttribute("data-theme");
    var dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    var t = dark ? "light" : "dark";
    try { localStorage.setItem("ait-theme", t); } catch (e) {}
    applyTheme(t);
  });

  // fresh data from the network (the service worker falls back to the saved copy when offline)
  var btn = document.getElementById("refresh");
  var offline = document.getElementById("offline");
  function pull(manual) {
    if (!window.fetch) return;
    if (manual) btn.classList.add("spin");
    fetch("data/data.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (nd) {
        offline.hidden = true;
        if (nd && nd.built && (!D || nd.built !== D.built)) { D = nd; render(); } else setStamp();
      })
      .catch(function () { if (!navigator.onLine) offline.hidden = false; })
      .then(function () { btn.classList.remove("spin"); });
  }
  btn.addEventListener("click", function () { pull(true); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { setStamp(); pull(false); } });
  window.addEventListener("online", function () { offline.hidden = true; pull(false); });
  window.addEventListener("offline", function () { offline.hidden = false; });

  var start = routeFor(location.hash) || { tab: "today" };
  go(start.tab, start.open, false);
  pull(false);
  setInterval(setStamp, 60000);

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})(typeof window !== "undefined" ? window : this);
