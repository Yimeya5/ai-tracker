(function (root) {
  "use strict";
  // AI Tracker: 5 tabs that answer 5 questions.
  //   Best for what · Cost · New releases · Big news · Agents   (+ a Sources view)
  // Each tab shows a short simple view first, and "See more" opens the full details.
  // All picks are made by fixed rules in scripts/update_data.py; this file only shows them.
  var hasDom = typeof document !== "undefined";
  var D = root.AI_DATA || null;

  var TABS = ["best", "cost", "releases", "news", "agents"];
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
  // Each app shows where today's price came from (its own pricing page, or its own App Store listing),
  // when it was last checked, and a "stale" mark when that check is more than D.staleDays (30) days old.
  function staleMark(isStale) { return isStale ? ' <span class="stale" title="Not confirmed for more than ' + ((D && D.staleDays) || 30) + ' days">⚠ stale</span>' : ""; }
  function appRow(a, full) {
    var src = a.src || { label: "Pricing page", url: a.page };
    var right = a.free ? '<span class="free">Free ✓</span>' : '<span class="muted">No free plan</span>';
    var paid = a.cheapest ? "Paid plans from " + monthly(a.cheapest.usd_month) + staleMark(a.cheapest.stale) : esc(a.note || "No paid plan");
    var h = "<li><span class=\"rn\"><b>" + esc(a.app) + "</b><small>" + esc(a.maker) + " · " + paid + "</small>";
    if (full && list(a.plans).length) {
      h += '<span class="plans">' + list(a.plans).map(function (p) {
        return '<span class="plan">' + esc(p.name) + ": <b>" + esc(monthly(p.usd_month)) + "</b>" + (p.note ? " (" + esc(p.note) + ")" : "") + staleMark(p.stale) + "</span>";
      }).join("") + "</span>";
    }
    var read = a.readToday === undefined ? a.read_ok : a.readToday;
    h += '<small class="checked">' + ext(src.url || a.page, esc(src.label || "Pricing page")) +
      (read ? " · checked " + esc(day(a.checked)) : ' · <span class="warn">price last checked ' + esc(day(a.checked)) + "</span>") +
      staleMark(a.stale) + "</small></span>" +
      '<span class="rv">' + right + "</span></li>";
    return h;
  }
  function vCost() {
    var apps = list(D.cost && D.cost.apps);
    var h = "<h2>Cost</h2><p class=\"sub\">Can you use it for free, and what does the paid plan cost? Monthly US prices.</p>" + staleNote("prices");
    h += '<ul class="rows card">' + apps.map(function (a) { return appRow(a, false); }).join("") + "</ul>";
    h += moreButton("cost") + credits(["prices", "openrouter", "aa"]);
    return h;
  }
  function vCostMore() {
    var apps = list(D.cost && D.cost.apps), dev = list(D.cost && D.cost.dev);
    var h = backButton() + "<h2>Cost: full details</h2><h3>Apps: every plan</h3>" +
      "<p class=\"sub\">Monthly prices in US dollars, read every day from each company's own pricing page, or from the company's own App Store listing (US prices) when its web page blocks servers. App Store prices can differ from web prices by a few cents. If a page can't be read, the last good price stays with the date it was last checked; after " + ((D && D.staleDays) || 30) + " days it is marked stale.</p>" + staleNote("prices");
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
    var h = "<h2>New releases</h2><p class=\"sub\">The newest models from the big AI companies, from their own announcements.</p>" + staleNote("openrouter");
    h += '<ul class="rows card">' + (items.slice(0, 5).map(relRow).join("") || '<li class="muted">Nothing new yet.</li>') + "</ul>";
    if (items.slice(0, 5).some(function (r) { return r.fast; })) h += '<p class="note">⚡ ' + esc(fastNote()) + "</p>";
    h += moreButton("releases", items.length > 5) + credits(["official", "openrouter", "aa"]);
    return h;
  }
  function vReleasesMore() {
    var items = list(D.releases && D.releases.items);
    var h = backButton() + "<h2>New releases: last " + ((D.releases && D.releases.days) || 60) + " days</h2>" +
      "<p class=\"sub\">Date and link = the company's own announcement when it has one (OpenAI, Google, Anthropic, Mistral, xAI, Meta, DeepSeek), otherwise the date it became available on OpenRouter" + (D.aaEnabled ? " or the release date listed by " + AA_CREDIT : "") + ". Each model is listed once. ⚡ " + esc(fastNote()) + "</p>" + staleNote("openrouter");
    var lastMo = "", body = "";
    items.forEach(function (r) {
      var mo = String(r.d).slice(0, 7);
      if (mo !== lastMo) { body += '<li class="mo">' + esc(MON[+mo.slice(5, 7) - 1] + " " + mo.slice(0, 4)) + "</li>"; lastMo = mo; }
      body += relRow(r);
    });
    h += '<ul class="rows card">' + (body || '<li class="muted">Nothing new yet.</li>') + "</ul>";
    return h + backButton() + credits(["official", "openrouter", "aa"]);
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
    return h + moreButton("news", items.length > 5) + credits(["official", "news"]);
  }
  function vNewsMore() {
    var items = list(D.bignews && D.bignews.items);
    var h = backButton() + "<h2>Big news: last 30 days</h2><p class=\"sub\">" + esc((D.bignews && D.bignews.rules) || "") + " From the companies' own pages, AI lab blogs and tech news sites, picked by fixed word rules (opinion, lawsuits, rumors, partnerships and customer stories are left out). The same story from several sites is shown once, from the company's own page when there is one.</p>" + staleNote("news");
    h += '<ul class="rows card">' + (items.slice(0, 30).map(newsRow).join("") || '<li class="muted">No big news right now.</li>') + "</ul>";
    return h + backButton() + credits(["official", "news"]);
  }

  // ---------------------------------------------------------------- views: Agents
  // Agents = AI that does tasks for you. 3 parts: the best model inside an agent (top 3 in at least 2 of 3 agent tests),
  // the agent apps and what they cost, and agent news. Built by fixed rules in scripts/update_data.py.
  function AG() { return (D && D.agents) || null; }
  function agentTest(id) { return list(AG() && AG().tests).filter(function (t) { return t.id === id; })[0] || null; }
  function agentRankLine(r) {
    var t = agentTest(r.test) || {};
    var head = ext(r.url || t.url, esc(r.name));
    if (!r.rank) return "<li>" + head + ': <span class="muted">not listed</span></li>';
    var bits = ["#" + r.rank];
    if (r.shown) bits.push(r.shown);
    if (r.date) bits.push(day(r.date));
    return "<li" + (r.top3 ? ' class="agree"' : "") + ">" + head + ": <b>" + esc(bits.join(" · ")) + "</b>" + (r.top3 ? ' <span class="tick" aria-label="top 3">✓ top 3</span>' : "") + "</li>";
  }
  function agentWho(c, n) {
    return (c.o ? "by " + esc(c.o) + " · " : "") + "top 3 in " + c.top3 + " of " + n + " agent tests";
  }
  function agentBestCard(full) {
    var b = AG().best || {}, w = list(b.winners);
    var h = '<section class="card abest"><h3><span class="ico sm" aria-hidden="true">🤖</span>Best AI for agents</h3>' +
      '<p class="note">' + (full ? esc(AG().rule || "") : "The AI model inside an agent. Named best only when it is top 3 in at least 2 of 3 independent agent tests.") + "</p>";
    if (b.status === "best" && w.length) {
      h += '<ul class="rows">' + w.map(function (c) {
        return '<li><span class="rn"><b class="big">' + esc(c.n) + "</b>" + (full ? fastTag(c.fast) : "") + "<small>" + agentWho(c, b.n) + "</small>" +
          '<small class="checked">' + list(c.ranks).filter(function (r) { return r.top3; }).map(function (r) {
            return ext(r.url, esc(r.name)) + " #" + r.rank + (r.date ? ", " + esc(day(r.date)) : "");
          }).join(" · ") + "</small></span></li>";
      }).join("") + "</ul>";
    } else {
      h += '<p class="why"><b>No clear winner yet.</b> ' + esc(b.why || "") + "</p>";
      var close = list(b.candidates).slice(0, 3);
      if (close.length) h += '<p class="note">Closest: ' + esc(close.map(function (c) { return c.n + " (top 3 in " + c.top3 + ")"; }).join(", ")) + "</p>";
    }
    return h + "</section>";
  }
  function agentPrice(a) {
    if (a.cheapest) return "paid from " + monthly(a.cheapest.usd_month) + staleMark(a.cheapest.stale);
    return list(a.plans).length ? "" : "no price found";
  }
  function agentFree(a) {
    if (a.free === true) return '<span class="free">Free ✓</span>';
    if (a.free === false) return '<span class="muted">Paid</span>';
    return '<span class="muted" title="The pricing page doesn\'t list a free plan">Free?</span>';
  }
  function nameMaker(a) { return "<b>" + esc(a.app) + '</b> <span class="mk">· ' + esc(a.maker) + "</span>"; }
  function agentSimpleRow(a) {
    var s = a.src || {}, only = list(a.plans);
    var bits = [];
    if (a.plansFrom && a.free === false && only.length === 1) bits.push("only with " + esc(only[0].name));
    else if (a.plansFrom) bits.push("with " + esc(a.plansFrom) + " plans");
    var price = agentPrice(a);
    if (price) bits.push(price);
    var src = ext(s.url, esc(s.label || "Pricing page")) + (s.readToday ? ", " + esc(day(s.checked || a.checked)) : ', <span class="warn">last checked ' + esc(day(s.checked || a.checked)) + "</span>") + staleMark(s.stale);
    return '<li><span class="rn">' + nameMaker(a) + (bits.length ? "<small>" + bits.join(" · ") + "</small>" : "") + '<small class="checked">' + src + '</small></span><span class="rv">' + agentFree(a) + "</span></li>";
  }
  // Hand-checked agents (scripts/agents_static.json): price text exactly as checked by hand, never parsed.
  // The daily check only confirms the maker's page is still up ("page still up: <date>").
  function staticRow(a, full) {
    var s = a.src || {}, c = a.check || {};
    var h = '<li><span class="rn">' + nameMaker(a) + "<small>" + esc(a.priceText || "") + "</small>";
    if (full) {
      h += "<small>" + esc(a.what || "") + "</small><small>Access: " + esc(a.access || "") + "</small>";
      if (list(a.plans).length) h += '<span class="plans">' + list(a.plans).map(function (p) {
        return '<span class="plan">' + esc(p.name) + ": <b>" + esc(monthly(p.usd_month)) + "</b></span>";
      }).join("") + "</span>";
    }
    h += '<small class="checked">' + ext(s.url, esc(s.label || "Official page")) + ", checked " + esc(day(a.checked)) + staleMark(a.stale || c.stale) + "</small>";
    if (full) h += '<small class="checked">' + (c.readToday ? "Page still up: " + esc(day(c.checked)) : '<span class="warn">Page last read ' + esc(day(c.checked)) + "</span>") + "</small>";
    return h + '</span><span class="rv">' + agentFree(a) + "</span></li>";
  }
  // Personal assistants (text or call them): no public prices, so they show access + a plain price line instead.
  function assistantRow(a, full) {
    var s = a.src || {};
    var src = ext(s.url, esc(s.label || "Home page")) + (s.readToday ? ", checked " + esc(day(s.checked || a.checked))
      : ', <span class="warn">last checked ' + esc(day(s.checked || a.checked)) + "</span>") + staleMark(s.stale);
    var h = '<li><span class="rn">' + nameMaker(a) + "<small>" + esc(a.access || "") + " · " + esc(a.priceText || "") + "</small>";
    if (full) h += "<small>" + esc(a.what || "") + "</small><small>Access: " + esc(a.access || "") + " · Price: " + esc(a.priceText || "") + "</small>";
    return h + '<small class="checked">' + (full ? "Source: " : "") + src + "</small></span></li>";
  }
  function agentAppRow(a, full) {
    if (a.static) return staticRow(a, full);
    if (a.group === "assistants") return assistantRow(a, full);
    if (!full) return agentSimpleRow(a);
    var s = a.src || {}, pf = a.proof;
    var bits = [esc(a.maker)];
    if (a.plansFrom) bits.push(a.free ? "comes with " + esc(a.plansFrom) + ", Free plan too" : "comes with paid " + esc(a.plansFrom) + " plans");
    else if (a.free === true) bits.push("Free plan");
    else if (a.free == null) bits.push("free plan not listed on the pricing page");
    var price = agentPrice(a);
    if (price) bits.push(price);
    var h = '<li><span class="rn"><b>' + esc(a.app) + "</b><small>" + bits.join(" · ") + "</small>";
    if (full) {
      h += "<small>" + esc(a.what) + (a.note ? " " + esc(a.note) : "") + (a.freeNote ? " " + esc(a.freeNote) + "." : "") + "</small>";
      if (list(a.plans).length) h += '<span class="plans">' + list(a.plans).map(function (p) {
        return '<span class="plan">' + esc(p.name) + ": <b>" + esc(monthly(p.usd_month)) + "</b>" + (p.note ? " (" + esc(p.note) + ")" : "") + staleMark(p.stale) + "</span>";
      }).join("") + "</span>";
    } else if (a.note) {
      h += "<small>" + esc(a.note) + "</small>";
    }
    var read = s.readToday;
    h += '<small class="checked">' + (a.plansFrom ? "Prices: " : "") + ext(s.url, esc(s.label || "Pricing page")) +
      (read ? " · checked " + esc(day(s.checked || a.checked)) : ' · <span class="warn">price last checked ' + esc(day(s.checked || a.checked)) + "</span>") + staleMark(s.stale) + "</small>";
    if (pf) {
      h += '<small class="checked">' + (full && pf.text ? "Included: " + esc(pf.text) + " · " : "Included: ") + ext(pf.url, esc(pf.label)) +
        (pf.readToday ? " · checked " + esc(day(pf.checked)) : ' · <span class="warn">last checked ' + esc(day(pf.checked)) + "</span>") + staleMark(pf.stale) + "</small>";
    }
    return h + '</span><span class="rv">' + agentFree(a) + "</span></li>";
  }
  // One collapsible section per group, "Label (N)", closed until tapped (open/closed is remembered like other cards).
  function agentGroups(full) {
    var apps = list(AG().apps), h = "", groups = [];
    list(AG().groups).forEach(function (g) {
      var rows = apps.filter(function (a) { return a.group === g.id; });
      if (rows.length) groups.push({ g: g, rows: rows });
    });
    var n = groups.reduce(function (t, x) { return t + x.rows.length; }, 0);
    if (groups.length) h += '<p class="note">' + n + " agents in " + groups.length + " groups. Tap a group to open it.</p>";
    groups.forEach(function (x) {
      var id = "ag-" + x.g.id + (full ? "-more" : "");
      h += '<details class="agrp" id="' + esc(id) + '"' + (state.open[id] ? " open" : "") + "><summary><span>" + esc(x.g.label) +
        ' <span class="cnt">(' + x.rows.length + ')</span></span><span class="chev" aria-hidden="true"></span></summary>' +
        '<ul class="rows card">' + x.rows.map(function (a) { return agentAppRow(a, full); }).join("") + "</ul></details>";
    });
    return h;
  }
  function agentNewsRows(n) {
    var items = list(AG().news && AG().news.items).slice(0, n);
    return '<ul class="rows card">' + (items.map(newsRow).join("") || '<li class="muted">No agent news in the last ' + ((AG().news && AG().news.days) || 14) + " days.</li>") + "</ul>";
  }
  function agentCredits(full) {
    var extra = list(AG() && AG().tests).filter(function (t) { return /via Epoch AI/.test(t.credit) && (full || t.inRule); }).map(function (t) { return ext(t.url, esc(t.credit)); });
    var ids = full ? ["lmarena", "livebench", "epoch", "agentapps", "prices", "official", "news"] : ["lmarena", "livebench", "epoch", "agentapps", "news"];
    return credits(ids).replace("Data from ", "Data from " + (extra.length ? extra.join(", ") + ", " : ""));
  }
  function vAgents() {
    if (!AG()) return "<h2>AI agents</h2><p class=\"sub\">The agents data is being built. Check back after the next daily update.</p>";
    var h = "<h2>AI agents</h2><p class=\"sub\">AI that does tasks for you: the best model inside an agent, the agent apps and what they cost, and agent news.</p>";
    h += staleList(["lmarena", "livebench", "epoch", "agentapps"]);
    h += agentBestCard(false);
    h += "<h3>Agent apps</h3>" + agentGroups(false);
    h += "<h3>Agent news</h3>" + agentNewsRows(4);
    return h + moreButton("agents") + agentCredits();
  }
  function vAgentsMore() {
    if (!AG()) return backButton() + vAgents();
    var ag = AG(), b = ag.best || {};
    var h = backButton() + "<h2>AI agents: full details</h2>";
    h += '<div class="card prose"><h3>How the pick works</h3><p><b>Best AI for agents</b>: ' + esc(ag.rule || "") +
      " The 3 tests are run by different groups in different ways: people's votes (LMArena), hidden tasks (LiveBench) and real work tasks (APEX-Agents). Every model that passes is shown.</p>" +
      "<p>A test whose newest result is more than " + (ag.maxAge || 120) + " days old is left out. With fewer than 2 usable tests no model is named best.</p>" +
      "<p>Vending-Bench 2, Remote Labor Index and LiveBench Browser are shown for information only; they don't change the pick. No AI is used to choose.</p></div>";
    h += agentBestCard(true);
    list(b.winners).forEach(function (c) {
      h += '<div class="cand card pad"><p class="cn"><b>' + esc(c.n) + "</b>" + fastTag(c.fast) + (c.o ? ' <span class="muted">by ' + esc(c.o) + "</span>" : "") + "</p>" +
        '<p class="note">Top 3 in ' + c.top3 + " of " + b.n + " agent tests.</p><ul class=\"ranks\">" + list(c.ranks).map(agentRankLine).join("") + "</ul></div>";
    });
    if (list(b.candidates).length) {
      h += '<details class="sub-more"><summary>Other candidates (' + b.candidates.length + ")</summary>" + list(b.candidates).map(function (c) {
        return '<div class="cand"><p class="cn"><b>' + esc(c.n) + "</b>" + (c.o ? ' <span class="muted">by ' + esc(c.o) + "</span>" : "") + '</p><p class="note">Top 3 in ' + c.top3 + " of " + b.n +
          ' tests.</p><ul class="ranks">' + list(c.ranks).map(agentRankLine).join("") + "</ul></div>";
      }).join("") + "</details>";
    }
    h += "<h3>Each agent test: top 5</h3>";
    list(ag.tests).forEach(function (t) {
      h += '<section class="job"><h4>' + ext(t.url, esc(t.name)) + (t.inRule ? "" : ' <span class="badge none">Info only</span>') + "</h4>" +
        '<p class="note">' + esc(t.what) + " " + esc(t.credit) + (t.date ? " · newest result " + esc(day(t.date)) : "") +
        (t.license ? " · " + (t.licenseUrl ? ext(t.licenseUrl, esc(t.license)) : esc(t.license)) : "") + "</p>" +
        (t.skipped ? '<p class="note bad">Left out today: ' + esc(t.skipWhy) + ".</p>" : "") +
        (t.ok === false && !t.skipped ? '<p class="note bad">Didn\'t answer today; using the last good copy.</p>' : "") +
        '<ol class="top5">' + list(t.top).map(function (r, i) {
          return '<li><span class="rk">' + (i + 1) + '.</span><span class="nm"><b>' + esc(r.n) + "</b>" + (r.o ? ' <span class="muted">' + esc(r.o) + "</span>" : "") +
            '</span><span class="sc">' + esc(r.shown) + "</span></li>";
        }).join("") + "</ol></section>";
    });
    h += "<h3>Agent apps: every plan</h3><p class=\"sub\">Monthly US prices, read every day from each app's own pricing page or App Store listing. Agents that come with a ChatGPT, Claude or Gemini plan show that plan's price (same as the Cost tab) and the line on the company's page that says which plans include it. After " + ((D && D.staleDays) || 30) + " days without a check a price is marked stale.</p>" + staleNote("agentapps");
    h += agentGroups(true);
    h += "<h3>Agent news: last " + ((ag.news && ag.news.days) || 14) + " days</h3><p class=\"sub\">" + esc((ag.news && ag.news.rules) || "") + "</p>" + agentNewsRows((ag.news && ag.news.max) || 8);
    return h + backButton() + agentCredits(true);
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
    var offs = list(D.officialSources);
    if (offs.length) {
      h += "<h3>Official company pages (new models)</h3><ul class=\"rows card\">" + offs.map(function (o) {
        var line = o.ok ? '<span class="ok">✓ Read OK ' + esc(ago(o.updated)) + "</span>"
          : o.updated ? '<span class="warn">⚠ Failed today, using the copy from ' + esc(day(o.updated)) + "</span>" : '<span class="warn">⚠ No copy yet</span>';
        return '<li><span class="rn"><b>' + ext(o.url, esc(o.label)) + "</b><small>" + line + (o.err ? ' · <span class="muted">' + esc(o.err) + "</span>" : "") + "</small></span></li>";
      }).join("") + "</ul>";
    }
    var apps = list(D.cost && D.cost.apps);
    if (apps.length) {
      var stale = list(D.stalePrices);
      h += "<h3>App prices</h3>" + (stale.length ? '<p class="note bad">⚠ ' + stale.length + " price" + (stale.length > 1 ? "s" : "") +
        " not confirmed for more than " + ((D && D.staleDays) || 30) + " days: " + esc(stale.map(function (x) { return x.app + (x.plan ? " " + x.plan : ""); }).join(", ")) + "</p>" : "");
      h += '<ul class="rows card">' + apps.map(function (a) {
        var src = a.src || { label: "Pricing page", url: a.page };
        var read = a.readToday === undefined ? a.read_ok : a.readToday;
        var line = read ? '<span class="ok">✓ Read today</span>' : '<span class="warn">⚠ Failed today</span>';
        var failed = list(a.tried).filter(function (t) { return !t.ok; }).map(function (t) { return t.label + ": " + t.err; });
        return '<li><span class="rn"><b>' + esc(a.app) + "</b><small>" + ext(src.url || a.page, esc(src.label || "Pricing page")) + " · last checked " + esc(day(a.checked)) + staleMark(a.stale) + "</small>" +
          "<small>" + line + (failed.length ? ' · <span class="muted">' + esc(failed.join("; ")) + "</span>" : "") + "</small></span></li>";
      }).join("") + "</ul>";
    }
    var ag = AG();
    if (ag && list(ag.tests).length) {
      h += "<h3>Agent tests (Agents tab)</h3><ul class=\"rows card\">" + list(ag.tests).map(function (t) {
        var line = t.skipped ? '<span class="warn">⚠ Left out today: ' + esc(t.skipWhy) + "</span>"
          : t.ok ? '<span class="ok">✓ OK</span>' + (t.date ? " · newest result " + esc(day(t.date)) : "")
          : '<span class="warn">⚠ Using last good copy' + (t.updated ? " from " + esc(day(t.updated)) : "") + "</span>";
        return '<li><span class="rn"><b>' + ext(t.url, esc(t.credit)) + "</b><small>" + esc(t.name) + ": " + esc(t.what) + (t.inRule ? "" : " Information only.") + "</small>" +
          (t.license ? "<small>License: " + (t.licenseUrl ? ext(t.licenseUrl, esc(t.license)) : esc(t.license)) + "</small>" : "") +
          "<small>" + line + "</small></span></li>";
      }).join("") + "</ul>";
      var aps = list(ag.apps);
      h += '<details class="agrp" id="src-agentpages"' + (state.open["src-agentpages"] ? " open" : "") + '><summary><span>Agent app pages <span class="cnt">(' + aps.length +
        ')</span></span><span class="chev" aria-hidden="true"></span></summary><ul class="rows card">' + aps.map(function (a) {
        var pg = a.check || a.proof || a.src || {};
        var line = pg.readToday ? '<span class="ok">✓ Read today</span>' : '<span class="warn">⚠ Failed today</span>';
        var failed = list(pg.tried).filter(function (t) { return !t.ok; }).map(function (t) { return t.label + ": " + t.err; });
        return '<li><span class="rn"><b>' + esc(a.app) + "</b><small>" + ext(pg.url, esc(pg.label || "Pricing page")) + " · last checked " + esc(day(pg.checked)) + staleMark(pg.stale) +
          (a.plansFrom ? " · prices from the " + esc(a.plansFrom) + " row above" : "") + "</small>" +
          "<small>" + line + (failed.length ? ' · <span class="muted">' + esc(failed.join("; ")) + "</span>" : "") + "</small></span></li>";
      }).join("") + "</ul></details>";
    }
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
      "<p><b>Prices:</b> \u201cApp Store price (US)\u201d comes from the company's own App Store listing. A price not confirmed for more than " + ((D && D.staleDays) || 30) + " days is marked \u26a0 stale.</p>" +
      "<p><b>New releases:</b> taken from each company's own page when it announced the model (that date and link), otherwise the date it appeared on OpenRouter.</p>" +
      "<p><b>Epoch Capabilities Index:</b> many benchmarks combined into one score, with a margin of error.</p>" +
      (ag ? "<p><b>Agent tests:</b> LMArena Agent Arena score (people's votes between two agents, higher is better), LiveBench Long Agentic (0 to 100), APEX-Agents (share of work tasks solved on the first try). A model is best for agents when it is top 3 in at least 2 of the 3.</p>" : "") +
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
    return '<p class="credits">Data from ' + ids.map(function (id) {
      var s = src(id), t = String(s.credit || s.name || "");
      if (/^Each /.test(t)) t = "each" + t.slice(4);          // mid-sentence: "Data from each company's…"
      return s.url ? ext(s.url, esc(t)) : esc(t);
    }).join(", ") +
      '. <a href="#sources">All sources and update status</a></p>';
  }

  var VIEWS = { best: vBest, cost: vCost, releases: vReleases, news: vNews, agents: vAgents, sources: vSources };
  var MORE = { best: vBestMore, cost: vCostMore, releases: vReleasesMore, news: vNewsMore, agents: vAgentsMore };

  function viewHtml(tab, more) {
    if (!D) return '<h2>No data yet</h2><p class="sub">Connect to the internet once and reopen the app.</p>';
    if (D.v !== 3 || !D.picks) return '<h2>Updating…</h2><p class="sub">The data is being rebuilt in a new format. Try again in a few minutes.</p>';
    try { return (more && MORE[tab] ? MORE[tab] : VIEWS[tab])(); }
    catch (e) { return '<h2>Something went wrong</h2><p class="sub">This part could not be shown. Pull to refresh or try again later.</p>'; }
  }

  // #best #cost #releases #news #agents #sources, and "#<tab>-more" for the details. Anything else (old links) -> first tab.
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
