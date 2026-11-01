(function (root) {
  "use strict";
  // AI Tracker: 4 tabs that answer 4 questions.
  //   Best for what · Cost · New releases · Big news   (+ a Sources view)
  // Each tab shows a short simple view first, and "See more" opens the full details.
  // All picks are made by fixed rules in scripts/update_data.py; this file only shows them.
  var hasDom = typeof document !== "undefined";
  var D = root.AI_DATA || null;

  var TABS = ["best", "cost", "releases", "news"];
  var VIEWS_ALL = TABS.concat(["sources"]);
  var state = { tab: "best", more: false, open: {} };

  // ---------------------------------------------------------------- helpers
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https:\/\//.test(u || "") ? esc(u) : ""; }
  function ext(u, text) { var s = safeUrl(u); return s ? '<a href="' + s + '" target="_blank" rel="noopener">' + text + "</a>" : text; }
  function list(x) { return Array.isArray(x) ? x : []; }
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
  function day(iso) {
    if (!iso) return "";
    var p = String(iso).slice(0, 10).split("-");
    if (p.length < 3 || !+p[1]) return "";
    var y = +p[0], thisYear = new Date().getFullYear();
    return MON[+p[1] - 1] + " " + (+p[2]) + (y && y !== thisYear ? ", " + y : "");
  }
  function money(v) {
    if (v == null) return "";
    if (v === 0) return "$0";
    return v >= 100 ? "$" + Math.round(v) : v >= 1 ? "$" + (+v.toFixed(2)) : "$" + (+v.toFixed(3));
  }
  function monthly(v) { return v == null ? "" : (v % 1 ? "$" + v.toFixed(2) : "$" + v) + "/mo"; }
  function n0(v) { return v == null ? "" : Number(v).toLocaleString("en-US"); }
  function src(id) { return list(D && D.sources).filter(function (s) { return s.id === id; })[0] || { name: id, url: "" }; }
  function stat(id) { return (D && D.status && D.status[id]) || {}; }
  function active(id) { return list(D && D.sources).some(function (s) { return s.id === id; }); }
  function staleNote(id) {
    if (!active(id) || !D.status || !D.status[id]) return "";
    var st = stat(id);
    if (st.ok) return "";
    return '<p class="note bad">' + esc(src(id).name) + (st.updated ? " didn't answer today. Using the last good copy from " + esc(day(st.updated)) + "." : " has no data yet.") + "</p>";
  }

  // ---------------------------------------------------------------- picks
  function pickTitle(p) {
    var w = list(p.winners);
    if (p.status === "single" && w.length) return w[0].n;
    if (p.status === "tie" && w.length > 1) return "Tie: " + w.map(function (c) { return c.n; }).join(" & ");
    if (p.status === "none" || !w.length) return "No clear winner yet";
    return w[0].n;
  }
  function pickMaker(p) {
    var w = list(p.winners);
    if (!w.length || p.status === "none") return "";
    var makers = [];
    w.forEach(function (c) { if (c.o && makers.indexOf(c.o) < 0) makers.push(c.o); });
    return makers.length ? "by " + makers.join(" and ") : "";
  }
  var AA_CREDIT = "Artificial Analysis (artificialanalysis.ai)";
  function rankLine(r) {
    var s = src(r.src);
    var head = r.src === "aa" ? "Source: " + ext(r.url || "https://artificialanalysis.ai/", AA_CREDIT) + " · " + esc(r.board)
      : ext(r.url || s.url, esc(r.name)) + " · " + esc(r.board);
    if (!r.rank) return "<li>" + head + ': <span class="muted">not listed</span></li>';
    var bits = ["#" + r.rank];
    if (r.score != null) bits.push(r.lo != null && r.hi != null && r.lo !== r.hi ? r.score + " (" + r.lo + " to " + r.hi + ")" : String(r.score));
    if (r.votes != null) bits.push(n0(r.votes) + " votes");
    if (r.date) bits.push(day(r.date));
    return "<li" + (r.top3 ? ' class="agree"' : "") + ">" + head + ": <b>" + esc(bits.join(" · ")) + "</b>" + (r.top3 ? ' <span class="tick" aria-label="top 3">✓ top 3</span>' : "") + "</li>";
  }
  // "⚡ Fast" is guessed from the model's name (see FAST_WORDS in scripts/update_data.py), not measured. Label only.
  function fastNote() { return (D && D.fastNote) || "Fast = guessed from the model's name (Flash, Mini, Haiku…), not a speed test."; }
  function fastTag(isFast) {
    return isFast ? ' <span class="fast" title="' + esc(fastNote()) + '">⚡ Fast</span>' : "";
  }
  function candDetail(c, showFast) {
    var h = '<div class="cand"><p class="cn"><b>' + esc(c.n) + "</b>" + (showFast ? fastTag(c.fast) : "") + (c.o ? " <span class=\"muted\">by " + esc(c.o) + "</span>" : "") +
      (c.notSure ? ' <span class="badge new">New, not sure yet</span>' : "") + "</p>";
    var agree = list(c.ranks).filter(function (r) { return r.top3; }).map(function (r) { return r.name; });
    var top10 = list(c.ranks).filter(function (r) { return r.rank && r.rank <= 10; }).map(function (r) { return r.name; });
    h += '<p class="note">' + (c.price ? "Top 10 in " + top10.length + " of " + list(c.ranks).length + " sources" + (top10.length ? " (" + esc(top10.join(", ")) + ")" : "")
      : "Top 3 in " + (c.top3 || 0) + " of " + list(c.ranks).length + " sources" + (agree.length ? " (" + esc(agree.join(", ")) + ")" : "")) + "." +
      (c.votes != null ? " " + n0(c.votes) + " LMArena votes on its main board." : "") +
      (c.notSure && list(c.why).length ? " Not sure yet: " + esc(c.why.join("; ")) + "." : "") + "</p>";
    if (c.price) h += '<p class="note">Developer price: <b>' + money(c.price.pin) + " in / " + money(c.price.pout) + " out</b> per million tokens · " +
      ext(c.price.u, esc(c.price.srcName)) + (c.price.date ? ", " + esc(day(c.price.date)) : "") + "</p>";
    h += '<ul class="ranks">' + list(c.ranks).map(rankLine).join("") + "</ul></div>";
    return h;
  }
  function pickCard(p, idPrefix) {
    var id = idPrefix + p.id;
    var w = list(p.winners);
    var badge = "";
    if (p.status === "single") badge = '<span class="badge one">Top on ' + esc((list(p.boards)[0] || {}).name || "LMArena") + " · 1 source only</span>";
    else if (p.status === "tie") badge = '<span class="badge tie">Tie</span>';
    else if (p.status === "none") badge = '<span class="badge none">Not decided</span>';
    else if (w[0] && w[0].notSure) badge = '<span class="badge new">New, not sure yet</span>';
    var h = '<details class="pick" id="' + esc(id) + '"' + (state.open[id] ? " open" : "") + "><summary>" +
      '<span class="ico" aria-hidden="true">' + esc(p.icon || "•") + "</span>" +
      '<span class="pt"><span class="lab">' + esc(p.label) + "</span>" +
      '<span class="name">' + esc(pickTitle(p)) + "</span>" +
      (pickMaker(p) ? '<span class="who">' + esc(pickMaker(p)) + "</span>" : "") + (badge ? '<span class="badges">' + badge + "</span>" : "") + "</span>" +
      '<span class="chev" aria-hidden="true"></span></summary><div class="body">';
    h += '<p class="why">' + esc(p.why) + "</p>";
    if (p.status === "none") {
      var close = list(p.candidates).slice(0, 3);
      if (close.length) h += "<p><b>Closest:</b> " + esc(close.map(function (c) { return c.n + " (top 3 in " + c.top3 + ")"; }).join(", ")) + "</p>";
    }
    w.forEach(function (c) { h += candDetail(c); });
    if (p.status === "single" && list(p.candidates).length) h += '<p class="note">Next on the same board: ' + esc(list(p.candidates).slice(0, 3).map(function (c) { return c.n; }).join(", ")) + '. <a href="#best-more">See more</a></p>';
    list(p["new"]).forEach(function (c) {
      var first = list(c.ranks).filter(function (r) { return r.rank === 1; })[0];
      h += '<p class="newnote"><span class="badge new">New, not sure yet</span> <b>' + esc(c.n) + "</b>" +
        (first ? " is #1 on " + esc(first.name) + " (" + esc(first.board) + ")" : " looks strong") +
        (list(c.why).length ? ", but " + esc(c.why.join("; ")) : "") + ".</p>";
    });
    if (p.usesAA) h += aaNote();
    h += '<p class="note">' + esc(D.rule || "") + ' <a href="#best-more">How picks work</a></p>';
    return h + "</div></details>";
  }

  // ---------------------------------------------------------------- views: Best for what
  function vBest() {
    var picks = list(D.picks);
    var h = "<h2>Best for what</h2><p class=\"sub\">" + esc(D.rule || "") + " Tap a card to see each source.</p>";
    h += staleList(["lmarena", "aa", "livebench", "epoch"]);
    if (list(D.picks).some(function (p) { return p.usesAA; })) h += aaNote();
    h += '<div class="stack">' + (picks.map(function (p) { return pickCard(p, "p-"); }).join("") || '<p class="note">No picks yet.</p>') + "</div>";
    h += moreButton("best") + credits(["lmarena", "aa", "livebench", "epoch", "openrouter"]);
    return h;
  }
  function vBestMore() {
    var h = backButton() + "<h2>Best for what: full details</h2>";
    h += howPicks();
    list(D.picks).forEach(function (p) {
      h += '<section class="job"><h3>' + esc(p.icon) + " " + esc(p.label) + ": " + esc(pickTitle(p)) + (p.status === "single" ? " (1 source only)" : "") + "</h3>";
      h += '<p class="why">' + esc(p.why) + "</p>";
      h += '<p class="note"><b>Sources used:</b> ' + esc(p.how) + "</p>";
      h += '<ul class="boards">' + list(p.boards).map(function (b) {
        return "<li>" + (b.src === "aa" ? "Source: " + ext(b.url, AA_CREDIT) : ext(b.url, esc(b.name))) + " · " + esc(b.board) + (b.date ? " · " + esc(day(b.date)) : "") +
          '<span class="top3">Top 3: ' + list(b.top).map(function (n, i) { return esc(n) + fastTag(list(b.topFast)[i]); }).join(", ") + "</span></li>";
      }).join("") + "</ul>";
      list(p.winners).forEach(function (c) { h += candDetail(c, true); });
      var others = list(p.candidates).concat(list(p["new"]));
      if (others.length) {
        h += '<details class="sub-more"><summary>Other candidates (' + others.length + ")</summary>" + others.map(function (c) { return candDetail(c, true); }).join("") + "</details>";
      }
      h += "</section>";
    });
    h += backButton() + credits(["lmarena", "aa", "livebench", "epoch", "openrouter"]);
    return h;
  }

  // ---------------------------------------------------------------- views: Cost
  function appRow(a, full) {
    var right = a.free ? '<span class="free">Free ✓</span>' : '<span class="muted">No free plan</span>';
    var paid = a.cheapest ? "Paid plans from " + monthly(a.cheapest.usd_month) : (a.note || "No paid plan");
    var h = "<li><span class=\"rn\"><b>" + esc(a.app) + "</b><small>" + esc(a.maker) + " · " + esc(paid) + "</small>";
    if (full && list(a.plans).length) {
      h += '<span class="plans">' + list(a.plans).map(function (p) {
        return '<span class="plan">' + esc(p.name) + ": <b>" + esc(monthly(p.usd_month)) + "</b>" + (p.note ? " (" + esc(p.note) + ")" : "") + "</span>";
      }).join("") + "</span>";
    }
    h += '<small class="checked">' + ext(a.page, "Pricing page") + " · checked " + esc(day(a.checked)) +
      (a.read_ok ? "" : ' · <span class="warn">couldn\'t read the page today, showing the last good price</span>') + "</small></span>" +
      '<span class="rv">' + right + "</span></li>";
    return h;
  }
  function vCost() {
    var apps = list(D.cost && D.cost.apps);
    var h = "<h2>Cost</h2><p class=\"sub\">Can you use it for free, and what does the paid plan cost?</p>" + staleNote("prices");
    h += '<ul class="rows card">' + apps.map(function (a) { return appRow(a, false); }).join("") + "</ul>";
    h += moreButton("cost") + credits(["prices", "openrouter", "aa"]);
    return h;
  }
  function vCostMore() {
    var apps = list(D.cost && D.cost.apps), dev = list(D.cost && D.cost.dev);
    var h = backButton() + "<h2>Cost: full details</h2><h3>Apps: every plan</h3>" +
      "<p class=\"sub\">Monthly prices in US dollars, read from each company's own pricing page every day. If a page can't be read, the last good price stays and you see the date it was checked.</p>" + staleNote("prices");
    h += '<ul class="rows card">' + apps.map(function (a) { return appRow(a, true); }).join("") + "</ul>";
    h += "<h3>For developers: price per million tokens</h3><p class=\"sub\">What it costs to use each model through its API: to send / to get back. A million tokens is about 750,000 words. Cheapest first.</p>" +
      '<p class="note">⚡ ' + esc(fastNote()) + "</p>";
    h += staleNote("openrouter");
    h += '<ul class="rows card">' + (dev.map(function (d) {
      return '<li><span class="rn"><b>' + esc(d.n) + "</b>" + fastTag(d.fast) + "<small>" + esc(d.o) + " · " + ext(d.u, esc(d.srcName)) + (d.date ? ", " + esc(day(d.date)) : "") +
        '</small></span><span class="rv">' + money(d.pin) + " / " + money(d.pout) + "</span></li>";
    }).join("") || '<li class="muted">No developer prices yet.</li>') + "</ul>";
    h += backButton() + credits(["prices", "openrouter", "aa"]);
    return h;
  }

  // ---------------------------------------------------------------- views: New releases
  function relRow(r) {
    return '<li><span class="rn">' + ext(r.u, "<b>" + esc(r.n) + "</b>") + fastTag(r.fast) + "<small>" + esc(r.o) + " · " + esc(day(r.d)) + " · " + esc(r.src) + "</small></span></li>";
  }
  function vReleases() {
    var items = list(D.releases && D.releases.items);
    var h = "<h2>New releases</h2><p class=\"sub\">The newest models from the big AI companies.</p>" + staleNote("openrouter");
    h += '<ul class="rows card">' + (items.slice(0, 5).map(relRow).join("") || '<li class="muted">Nothing new yet.</li>') + "</ul>";
    if (items.slice(0, 5).some(function (r) { return r.fast; })) h += '<p class="note">⚡ ' + esc(fastNote()) + "</p>";
    h += moreButton("releases", items.length > 5) + credits(["openrouter", "aa"]);
    return h;
  }
  function vReleasesMore() {
    var items = list(D.releases && D.releases.items);
    var h = backButton() + "<h2>New releases: last " + ((D.releases && D.releases.days) || 60) + " days</h2>" +
      "<p class=\"sub\">Date = when it became available on OpenRouter" + (D.aaEnabled ? ", or the release date listed by " + AA_CREDIT + " for models OpenRouter doesn't have" : "") + ". ⚡ " + esc(fastNote()) + "</p>" + staleNote("openrouter");
    var lastMo = "", body = "";
    items.forEach(function (r) {
      var mo = String(r.d).slice(0, 7);
      if (mo !== lastMo) { body += '<li class="mo">' + esc(MON[+mo.slice(5, 7) - 1] + " " + mo.slice(0, 4)) + "</li>"; lastMo = mo; }
      body += relRow(r);
    });
    h += '<ul class="rows card">' + (body || '<li class="muted">Nothing new yet.</li>') + "</ul>";
    return h + backButton() + credits(["openrouter", "aa"]);
  }

  // ---------------------------------------------------------------- views: Big news
  function newsRow(n) {
    return '<li><span class="rn">' + (n.tag ? '<span class="tag">' + esc(n.tag) + "</span>" : "") + ext(n.u, "<b>" + esc(n.t) + "</b>") +
      "<small>" + esc(n.s) + " · " + esc(day(n.d)) + "</small></span></li>";
  }
  function vNews() {
    var items = list(D.bignews && D.bignews.items);
    var h = "<h2>Big news</h2><p class=\"sub\">Only the big stories: new models, price changes and major company news.</p>" + staleNote("news");
    h += '<ul class="rows card">' + (items.slice(0, 5).map(newsRow).join("") || '<li class="muted">No big news right now.</li>') + "</ul>";
    return h + moreButton("news", items.length > 5) + credits(["news"]);
  }
  function vNewsMore() {
    var items = list(D.bignews && D.bignews.items);
    var h = backButton() + "<h2>Big news: last 30 days</h2><p class=\"sub\">Picked from AI lab blogs and tech news sites by simple word rules (launches, prices, deals, lawsuits). Repeats of the same story are removed.</p>" + staleNote("news");
    h += '<ul class="rows card">' + (items.slice(0, 30).map(newsRow).join("") || '<li class="muted">No big news right now.</li>') + "</ul>";
    return h + backButton() + credits(["news"]);
  }

  // ---------------------------------------------------------------- Sources view
  function vSources() {
    var h = "<h2>Sources</h2><p class=\"sub\">Where every number comes from. The app rebuilds itself every day. If a source doesn't answer, its last good copy is kept.</p>";
    h += '<ul class="rows card srcs">' + list(D.sources).map(function (s) {
      var st = stat(s.id);
      var line = st.ok ? '<span class="ok">✓ Updated OK ' + esc(ago(st.updated)) + "</span>"
        : st.updated ? '<span class="warn">⚠ Using last good copy from ' + esc(day(st.updated)) + "</span>" : '<span class="warn">⚠ No data yet</span>';
      return '<li><span class="rn"><b>' + (s.url ? ext(s.url, esc(s.credit || s.name)) : esc(s.credit || s.name)) + "</b>" +
        "<small>" + esc(s.what) + "</small>" +
        (s.license || s.data ? "<small>" + (s.license ? "License: " + (s.licenseUrl ? ext(s.licenseUrl, esc(s.license)) : esc(s.license)) : "") +
          (s.data ? (s.license ? " · " : "") + ext(s.data, "the data") : "") + "</small>" : "") +
        "<small>" + line + (st.note ? " · " + esc(st.note) : "") + (!st.ok && st.err ? ' · <span class="muted">' + esc(st.err) + "</span>" : "") + "</small></span></li>";
    }).join("") + "</ul>";
    var feeds = list(D.bignews && D.bignews.feeds);
    if (feeds.length) {
      h += "<h3>News feeds</h3><ul class=\"rows card\">" + feeds.map(function (f) {
        return '<li><span class="rn"><b>' + esc(f[0]) + '</b></span><span class="rv ' + (f[1] === "ok" ? "ok" : "warn") + '">' + (f[1] === "ok" ? "✓ " + esc(f[2]) + " stories" : "⚠ didn't answer") + "</span></li>";
      }).join("") + "</ul>";
    }
    h += '<div class="card prose"><h3>How to read the numbers</h3>' +
      "<p><b>LMArena points:</b> people chat with two hidden models and vote for the better answer. The range in brackets is the margin of error.</p>" +
      (D.aaEnabled ? "<p><b>Artificial Analysis index:</b> the same set of hard tests run on every model, as one score. Private use only.</p>" : "") +
      "<p><b>LiveBench:</b> new tasks every release, kept hidden, so models can't have learned the answers.</p>" +
      "<p><b>⚡ Fast:</b> " + esc(fastNote()) + " A rough guide only; it never changes a pick.</p>" +
      "<p><b>Epoch Capabilities Index:</b> many benchmarks combined into one score, with a margin of error.</p>" +
      "<p>Data built " + esc(new Date(D.built).toLocaleString()) + ". No AI is used to pick anything. No sign-in, no tracking.</p></div>";
    return h;
  }

  // ---------------------------------------------------------------- shared bits
  function moreButton(tab, show) {
    if (show === false) return "";
    return '<a class="morebtn" href="#' + tab + '-more" data-more="' + tab + '">See more</a>';
  }
  function aaNote() {
    return '<p class="note aa">Based on data from ' + ext("https://artificialanalysis.ai/", AA_CREDIT) +
      ". These picks are made by this app and are not endorsed by Artificial Analysis.</p>";
  }
  function howPicks() {
    var ri = D.ruleInfo || {}, aa = !!D.aaEnabled, v = n0(ri.votes || 5000);
    var names = aa ? "LMArena, Artificial Analysis, LiveBench and Epoch AI" : "LMArena, LiveBench and Epoch AI";
    var best = aa ? "a model counts as best only when at least 3 of the 4 independent sources (" + names + ") put it in their top 3."
      : "a model counts as best only when all 3 independent sources (" + names + ") put it in their top 3.";
    var pics = aa ? "For pictures there are 2 sources (LMArena and Artificial Analysis), so both must agree."
      : "For pictures only LMArena has data, so no picture model is called best. The app shows LMArena's #1 marked \u201c1 source only\u201d, and the next ones under See more.";
    return '<div class="card prose"><h3>How the picks work</h3>' +
      "<p><b>Best</b>: " + esc(best) + " " + esc(pics) + "</p>" +
      "<p><b>Tie</b>: when two models both pass, and their error bars overlap (the range each source gives for its score), it's a tie and both are shown.</p>" +
      "<p><b>New, not sure yet</b>: fewer than 3 sources have tested the model, or it has fewer than " + v + " votes on LMArena's main text board (the text-to-image board for pictures).</p>" +
      "<p><b>No clear winner yet</b>: nobody passes the rule, so the closest candidates are shown instead.</p>" +
      "<p>No AI is used to choose; it's the same rule every day.</p>" +
      "<p><b>⚡ Fast</b>: " + esc(fastNote()) + " It is only a label and never changes a pick.</p>" + (aa ? aaNote() : "") + "</div>";
  }
  function backButton() { return '<button type="button" class="backbtn" data-less="1">‹ Back to the simple view</button>'; }
  function staleList(ids) { return ids.map(staleNote).join(""); }
  function credits(ids) {
    ids = ids.filter(active);
    if (!ids.length) return '<p class="credits"><a href="#sources">All sources and update status</a></p>';
    return '<p class="credits">Data from ' + ids.map(function (id) { var s = src(id); return s.url ? ext(s.url, esc(s.credit || s.name)) : esc(s.credit || s.name); }).join(", ") +
      '. <a href="#sources">All sources and update status</a></p>';
  }

  var VIEWS = { best: vBest, cost: vCost, releases: vReleases, news: vNews, sources: vSources };
  var MORE = { best: vBestMore, cost: vCostMore, releases: vReleasesMore, news: vNewsMore };

  function viewHtml(tab, more) {
    if (!D) return '<h2>No data yet</h2><p class="sub">Connect to the internet once and reopen the app.</p>';
    if (D.v !== 3 || !D.picks) return '<h2>Updating…</h2><p class="sub">The data is being rebuilt in a new format. Try again in a few minutes.</p>';
    try { return (more && MORE[tab] ? MORE[tab] : VIEWS[tab])(); }
    catch (e) { return '<h2>Something went wrong</h2><p class="sub">This part could not be shown. Pull to refresh or try again later.</p>'; }
  }

  // #best #cost #releases #news #sources, and "#<tab>-more" for the details. Anything else (old links) -> first tab.
  function routeFor(hash) {
    var h = String(hash || "").replace(/^#/, "").toLowerCase();
    if (h === "main") return null;                           // skip link
    var more = /-more$/.test(h);
    var t = h.replace(/-more$/, "");
    if (VIEWS_ALL.indexOf(t) >= 0) return { tab: t, more: more && !!MORE[t] };
    return { tab: "best", more: false };
  }

  root.AITracker = { routeFor: routeFor, pickTitle: pickTitle, tabs: TABS, setData: function (d) { D = d; },
    view: viewHtml, views: VIEWS, more: MORE };

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
    view.innerHTML = viewHtml(state.tab, state.more);
    document.querySelectorAll("#tabs button").forEach(function (b) {
      if (b.getAttribute("data-tab") === state.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    var sb = document.getElementById("srcbtn");
    if (sb) { if (state.tab === "sources") sb.setAttribute("aria-current", "page"); else sb.removeAttribute("aria-current"); }
  }
  function setHash(h) { if (location.hash !== h) { try { history.replaceState(null, "", h); } catch (e) {} } }
  function go(tab, more, keepScroll) {
    state.tab = VIEWS_ALL.indexOf(tab) >= 0 ? tab : "best";
    state.more = !!more && !!MORE[state.tab];
    setHash("#" + state.tab + (state.more ? "-more" : ""));
    render();
    if (!keepScroll) window.scrollTo(0, 0);
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-tab],[data-more],[data-less]");
    if (!t) return;
    if (t.hasAttribute("data-tab")) go(t.getAttribute("data-tab"));
    else if (t.hasAttribute("data-more")) { e.preventDefault(); go(t.getAttribute("data-more"), true); }
    else if (t.hasAttribute("data-less")) go(state.tab, false);
  });
  document.addEventListener("toggle", function (e) {
    var d = e.target;
    if (d && d.tagName === "DETAILS" && d.id) state.open[d.id] = d.open;
  }, true);
  window.addEventListener("hashchange", function () {
    var r = routeFor(location.hash);
    if (r) go(r.tab, r.more);
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

  var start = routeFor(location.hash) || { tab: "best", more: false };
  go(start.tab, start.more, true);
  pull(false);
  setInterval(setStamp, 60000);

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})(typeof window !== "undefined" ? window : this);
