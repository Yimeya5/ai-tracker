(function (root) {
  "use strict";
  // AI Tracker: 5 tabs that answer 5 questions, plus "Ask them all" (type once, open the question in each AI).
  //   Best for what · Cost · New releases · Big news · Agents · Ask   (+ a Sources view)
  // Each tab shows a short simple view first, and "See more" opens the full details.
  // All picks are made by fixed rules in scripts/update_data.py; this file only shows them.
  // ---- settings for "Ask all 4 here" (see worker/README.md). Leave ASK_API empty and the Ask tab is the free v8 tab.
  var CONFIG = {
    ASK_API: "https://ai-tracker-ask.ai-tracker-ask.workers.dev",            // the Worker URL, e.g. "https://ai-tracker-ask.<you>.workers.dev"
    PAY_LINK: "https://buy.stripe.com/test_fZu8wRan4foLbQwdEU2wU00",           // the Stripe Payment Link URL ($5 for 60 questions)
    FREE: 3, PACK: 60, PRICE: 5   // only for the wording; the Worker decides
  };
  var hasDom = typeof document !== "undefined";
  var D = root.AI_DATA || null;

  var TABS = ["best", "cost", "releases", "news", "agents", "ask"];
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

  // ---------------------------------------------------------------- view: Ask them all
  // Type once, then open the question in each AI's own website. Free: no AI calls, no keys, nothing is sent by this app,
  // and the question is never stored (it lives only in this page's memory until the page is closed).
  // mode "link": the AI reads the question from its link ({q}). mode "copy": its link drops the question, so the app
  // copies it and opens the home page. Checked by hand on Nov 2, 2026, logged out, desktop and Android phone size.
  var ASK_AIS = [
    { id: "chatgpt", name: "ChatGPT", mode: "link", url: "https://chatgpt.com/?q={q}", note: "Sends by itself. No login needed." },
    { id: "claude", name: "Claude", mode: "link", url: "https://claude.ai/new?q={q}", note: "Fills the box, tap send. Needs a free Claude login." },
    { id: "grok", name: "Grok", mode: "link", url: "https://grok.com/?q={q}", note: "Tap Send to confirm. No login needed." },
    { id: "perplexity", name: "Perplexity", mode: "link", url: "https://www.perplexity.ai/search?q={q}", note: "Sends by itself. May ask you to sign up." },
    { id: "copilot", name: "Copilot (Bing AI)", mode: "link", url: "https://www.bing.com/copilotsearch?q={q}", note: "Answers right away. No login needed." },
    { id: "duck", name: "Duck.ai", mode: "link", url: "https://duck.ai/?q={q}&ia=chat", note: "Fills the box, tap Ask. No login, private." },
    { id: "gemini", name: "Gemini", mode: "copy", url: "https://gemini.google.com/app" },
    { id: "meta", name: "Meta AI", mode: "copy", url: "https://www.meta.ai/" },
    { id: "deepseek", name: "DeepSeek", mode: "copy", url: "https://chat.deepseek.com/", note: "Needs a login." },
    { id: "lechat", name: "Le Chat", mode: "copy", url: "https://chat.mistral.ai/chat", note: "Needs a login." }
  ];
  var askQ = "";                     // memory only: never written to storage, never sent anywhere by this app
  function askLinks(q) {
    var t = String(q == null ? "" : q).trim();
    return ASK_AIS.map(function (a) {
      var url = a.mode === "copy" ? a.url : (t ? a.url.replace("{q}", encodeURIComponent(t)) : null);
      return { id: a.id, name: a.name, url: url, note: a.note || "", mode: a.mode };
    });
  }
  function askLinkHtml(l) {
    var on = !!l.url;
    return '<li><a class="askbtn' + (on ? "" : " off") + '" data-ask="' + esc(l.id) + '"' + (on ? ' href="' + esc(l.url) + '"' : "") +
      ' target="_blank" rel="noopener noreferrer"' + (on ? "" : ' aria-disabled="true"') + "><b>" + esc(l.name) + "</b>" +
      (l.note ? "<small>" + esc(l.note) + "</small>" : "") + "</a></li>";
  }
  function askCopyHtml(l) {
    return '<li><button type="button" class="askbtn' + (askQ.trim() ? "" : " off") + '" data-copy="' + esc(l.id) + '"' + (askQ.trim() ? "" : ' aria-disabled="true"') +
      "><b>" + esc(l.name) + "</b><small>Copies your question, then opens " + esc(l.name) + "." + (l.note ? " " + esc(l.note) : "") + "</small></button></li>";
  }
  // ---------------------------------------------------------------- Ask all 4 here (optional helper, see worker/)
  // One question to /ask returns 4 answers. The helper decides what is free or paid; the counts here are display only.
  // Answers are written with textContent (never innerHTML). The question itself is never stored.
  var FOUR = [
    { id: "chatgpt", name: "ChatGPT", model: "GPT-6.1 Terra" }, { id: "claude", name: "Claude", model: "Claude Sonnet 5.5" },
    { id: "gemini", name: "Gemini", model: "Gemini 3.8 Flash" }, { id: "grok", name: "Grok", model: "Grok 4.7" }
  ];
  var four = { busy: false, answers: null, left: null, notice: "", out: "", paid: null, redeemErr: false, codeMsg: "" };
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) {} }
  function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  // Text direction by MAJORITY of letters (Hebrew script vs Latin), so "Gemini איז גוט…" is still right-to-left.
  function textDir(s) {
    var t = String(s == null ? "" : s);
    var heb = (t.match(/[\u0590-\u05FF\uFB1D-\uFB4F]/g) || []).length;
    var lat = (t.match(/[A-Za-z\u00C0-\u024F]/g) || []).length;
    if (!heb && !lat) return "auto";
    return heb > lat ? "rtl" : "ltr";
  }
  function plainAnswer(s) { return String(s || "").replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/__([^_\n]+)__/g, "$1").replace(/^#{1,6}\s+/gm, ""); }
  function leftLine() {
    var l = four.left;
    if (l && l.paid_left != null) return "Paid questions left: " + l.paid_left;
    if (l && l.free_left != null) return "Free questions left: " + l.free_left;
    var used = parseInt(stored("ait.freeUsed") || "0", 10) || 0;
    return "Free questions left: " + Math.max(0, CONFIG.FREE - used);
  }
  function fourHtml() {
    var h = '<button type="button" class="askfour" id="askfour"' + (four.busy ? " disabled" : "") + ">" + (four.busy ? "Asking all 4…" : "Ask all 4 here") + "</button>" +
      '<p class="note askleft" id="askleft" aria-live="polite">' + esc(leftLine()) + "</p>";
    // the saved code, always copyable (for another device); the count lives only in the line above
    var saved = stored("ait.code");
    if (four.paid) {                          // right after the Stripe return only
      h += '<div class="paidbox card" role="status"><p><b>Paid!</b> Your code: <b class="code" id="paidcode">' + esc(four.paid.code) + '</b> <button type="button" class="linkbtn" data-copycode="1">Copy</button></p>' +
        '<p class="note">Keep it to use on another device.</p><p class="note" id="copymsg" aria-live="polite"></p></div>';
    } else if (saved) {
      h += '<p class="note codeline">Your code: <b class="code">' + esc(saved) + '</b> <button type="button" class="linkbtn" data-copycode="1">Copy</button>' +
        ' <span id="copymsg" aria-live="polite"></span></p>';
    }
    if (four.redeemErr) {
      h += '<div class="paidbox card" role="status"><p><b>Payment not confirmed yet.</b></p><button type="button" class="linkbtn" id="redeemretry">Retry</button></div>';
    }
    if (four.notice) h += '<p class="note bad" role="status">' + esc(four.notice) + "</p>";
    if (four.out === "free_used" || four.out === "code_empty") {
      h += '<div class="outbox card"><p><b>' + (four.out === "code_empty" ? "Your code has no questions left." : "Your " + CONFIG.FREE + " free questions are used.") + "</b></p>" +
        (CONFIG.PAY_LINK ? '<a class="paybtn" href="' + safeUrl(CONFIG.PAY_LINK) + '">Get ' + CONFIG.PACK + " more for $" + CONFIG.PRICE + "</a>" : "") +
        '<p class="note">Have a code?</p><div class="codebar"><input id="askcode" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="AT-XXXX-XXXX-XXXX" maxlength="20" aria-label="Your code">' +
        '<button type="button" class="linkbtn" id="askapply">Apply</button></div><p class="note" id="codemsg" aria-live="polite">' + esc(four.codeMsg) + "</p></div>";
    }
    if (four.answers || four.busy) {
      h += '<div class="acards" id="acards">' + FOUR.map(function (f) {
        return '<section class="acard card" data-card="' + f.id + '"><h4>' + esc(f.name) + ' <small class="amodel"></small></h4><p class="atext" dir="auto"></p></section>';
      }).join("") + "</div>";
    }
    return h;
  }
  // fill the cards after the view is drawn: plain text only
  function fourFill() {
    if (!hasDom) return;
    FOUR.forEach(function (f) {
      var card = document.querySelector('[data-card="' + f.id + '"]');
      if (!card) return;
      var a = four.answers ? four.answers.filter(function (x) { return x.id === f.id; })[0] : null;
      card.querySelector(".amodel").textContent = (a && a.model) || f.model;
      var t = card.querySelector(".atext");
      t.classList.toggle("muted", !a || !!(a && a.error));
      if (four.busy || !a) t.textContent = "Thinking…";
      else if (a.error) t.textContent = a.error;
      else t.textContent = plainAnswer(a.text) + (a.cut ? " (cut short)" : "");
      t.setAttribute("dir", textDir(t.textContent));
    });
  }

  function vAsk() {
    var links = askLinks(askQ);
    var h = "<h2>Ask them all</h2><p class=\"sub\">" + (CONFIG.ASK_API ? "Type once. Get all 4 answers here, or open your question in each AI's own website for free."
      : "Type once, then open your question in each AI. Free: each AI's own website, nothing goes through this app.") + "</p>";
    h += '<div class="askbox card"><label for="askq" class="sr">Your question</label>' +
      '<textarea id="askq" dir="' + textDir(askQ) + '" rows="4" maxlength="1500" placeholder="Type your question…" autocomplete="off">' + esc(askQ) + "</textarea>" +
      '<div class="askbar"><button type="button" class="linkbtn" id="askclear">Clear</button>' +
      '<button type="button" class="openall wide-only" id="askall">Open all</button></div>' + (CONFIG.ASK_API ? fourHtml() : "") + "</div>";
    if (CONFIG.ASK_API) h += '<h2 class="orh">Or open it in each AI (free)</h2>';
    h += '<p class="note phone-only">Phones open one tab per tap. Tap each AI below.</p><p class="note bad" id="askblocked" aria-live="polite"></p>';
    h += "<h3>Opens with your question</h3>" + '<ul class="asklist" id="asklinks">' + links.filter(function (l) { return l.mode === "link"; }).map(askLinkHtml).join("") + "</ul>";
    h += "<h3>Copy, then paste</h3><p class=\"sub\">These AIs don't take a question by link.</p>" +
      '<ul class="asklist" id="askcopies">' + links.filter(function (l) { return l.mode === "copy"; }).map(askCopyHtml).join("") + "</ul>" +
      '<p class="note" id="askmsg" aria-live="polite"></p>';
    if (CONFIG.ASK_API) h += '<p class="credits">Ask all 4 sends your question to ChatGPT, Claude, Gemini and Grok through this app\'s helper to get the answers. It is not saved.</p>' +
      '<p class="credits">For the buttons above: some AIs ask you to log in first, and this app never sees that question or those answers.</p>';
    else h += '<p class="credits">Some AIs ask you to log in first. This app never sees your question or answers.</p>';
    return h;
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

  var VIEWS = { best: vBest, cost: vCost, releases: vReleases, news: vNews, agents: vAgents, ask: vAsk, sources: vSources };
  var MORE = { best: vBestMore, cost: vCostMore, releases: vReleasesMore, news: vNewsMore, agents: vAgentsMore };

  function viewHtml(tab, more) {
    if (tab === "ask") return vAsk();                          // works without any data
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

  root.AITracker = { routeFor: routeFor, pickTitle: pickTitle, tabs: TABS, setData: function (d) { D = d; }, askLinks: askLinks, askAIs: ASK_AIS,
    config: CONFIG, plainAnswer: plainAnswer, four: four, textDir: textDir,
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
    if (state.tab === "ask") fourFill();
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

  // ---- Ask them all: links are rebuilt on every keystroke; nothing is stored or sent by the app
  function askSetQ(q) {
    askQ = q;
    var box = document.getElementById("askq");
    if (box) box.setAttribute("dir", textDir(askQ));
    var on = !!askQ.trim();
    askLinks(askQ).forEach(function (l) {
      var el = document.querySelector('[data-ask="' + l.id + '"],[data-copy="' + l.id + '"]');
      if (!el) return;
      if (l.mode === "link") { if (on) el.setAttribute("href", l.url); else el.removeAttribute("href"); }
      el.classList.toggle("off", !on);
      if (on) el.removeAttribute("aria-disabled"); else el.setAttribute("aria-disabled", "true");
    });
  }
  function askSay(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
  function askCopy(text) {
    // copy synchronously first: the new tab opened in the same click takes focus, and the async clipboard API can fail without focus
    if (askCopyOld(text)) return Promise.resolve(true);
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    }
    return Promise.resolve(false);
  }
  function askCopyOld(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.className = "sr";
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  }
  document.addEventListener("input", function (e) { if (e.target && e.target.id === "askq") askSetQ(e.target.value); });

  // ---- Ask all 4 here: the only calls to the helper (CONFIG.ASK_API). JSON in/out; nothing is stored but the code.
  function askApi(path, body) {
    var opt = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "GET" };
    opt.cache = "no-store"; opt.credentials = "omit";
    return fetch(CONFIG.ASK_API.replace(/\/+$/, "") + path, opt).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, json: j || {} }; }, function () { return { status: r.status, json: {} }; });
    });
  }
  function askRedraw() { if (state.tab === "ask") { var y = window.scrollY; render(); window.scrollTo(0, y); } }
  function setLeft(j) {
    if (!j) return;
    four.left = { free_left: j.free_left, paid_left: j.paid_left };
    if (j.free_left != null) store("ait.freeUsed", Math.max(0, CONFIG.FREE - j.free_left));
  }
  var PAUSED = "Answers here are paused right now. Open your question in each AI below.";
  function askFour() {
    var q = askQ.trim();
    if (!q) { askSay("askmsg", "Type your question first."); var b = document.getElementById("askq"); if (b) b.focus(); return; }
    if (four.busy) return;
    four.busy = true; four.answers = null; four.notice = ""; four.out = ""; four.codeMsg = ""; four.paid = null;
    askRedraw();
    var code = stored("ait.code");
    askApi("/ask", code ? { question: q, code: code } : { question: q }).then(function (r) {
      var j = r.json;
      four.busy = false;
      if (r.status === 200 && j.answers) {
        four.answers = j.answers; setLeft(j);
        if (j.refunded) four.notice = "None of the 4 answered this time, so it wasn't counted. Try again in a moment.";
      } else if (r.status === 402 && (j.reason === "free_used" || j.reason === "code_empty")) {
        four.out = j.reason; setLeft(j);
      } else if (r.status === 402 && j.reason === "daily_cap") {
        four.notice = "Today's free answers are used up. Try again tomorrow, or open your question in each AI below.";
      } else if (r.status === 429) {
        four.notice = "Please wait a few seconds before asking again.";
      } else {
        four.notice = PAUSED;                                       // disabled, balance_empty, errors
      }
      askRedraw();
    }, function () { four.busy = false; four.notice = PAUSED; askRedraw(); });
  }
  function applyCode() {
    var box = document.getElementById("askcode");
    var c = (box && box.value || "").trim().toUpperCase();
    if (!/^AT-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)) { askSay("codemsg", "Codes look like AT-XXXX-XXXX-XXXX."); return; }
    askApi("/status?code=" + encodeURIComponent(c)).then(function (r) {
      var j = r.json;
      if (r.status === 200 && j.paid_left != null) {
        if (j.paid_left > 0) { store("ait.code", c); setLeft(j); four.out = ""; four.notice = ""; four.codeMsg = ""; askRedraw(); askSay("askleft", "Code saved. " + leftLine()); }
        else askSay("codemsg", "That code has no questions left.");
      } else if (r.status === 200) askSay("codemsg", "That code wasn't found.");
      else askSay("codemsg", PAUSED);
    }, function () { askSay("codemsg", PAUSED); });
  }
  var sessionId = null;
  function redeem() {
    four.redeemErr = false;
    askApi("/redeem", { session_id: sessionId }).then(function (r) {
      if (r.status === 200 && r.json.code) {
        store("ait.code", r.json.code);
        four.paid = { code: r.json.code, paid_left: r.json.paid_left };
        four.left = { free_left: null, paid_left: r.json.paid_left }; four.out = "";
        try { history.replaceState(null, "", location.pathname + "#ask"); } catch (e) {}
      } else four.redeemErr = true;
      askRedraw();
    }, function () { four.redeemErr = true; askRedraw(); });
  }
  function loadLeft() {
    if (!CONFIG.ASK_API) return;
    var code = stored("ait.code");
    askApi("/status" + (code ? "?code=" + encodeURIComponent(code) : "")).then(function (r) {
      if (r.status !== 200) return;
      setLeft(r.json);
      if (r.json.enabled === false) four.notice = PAUSED;
      var el = document.getElementById("askleft"); if (el) el.textContent = leftLine();
      if (r.json.enabled === false) askRedraw();
    }, function () {});
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    var off = e.target.closest('#view [aria-disabled="true"]');
    if (off) { e.preventDefault(); askSay("askmsg", "Type your question first."); return; }
    if (e.target.closest("#askfour")) { askFour(); return; }
    if (e.target.closest("#askapply")) { applyCode(); return; }
    if (e.target.closest("#redeemretry")) { redeem(); return; }
    if (e.target.closest("[data-copycode]")) {
      var cc = (four.paid && four.paid.code) || stored("ait.code");
      if (cc) askCopy(cc).then(function (ok) { askSay("copymsg", ok ? "Copied." : "Select the code and copy it."); });
      return;
    }
    if (e.target.closest("#askclear")) {
      var box = document.getElementById("askq");
      if (box) { box.value = ""; box.focus(); }
      askSetQ(""); askSay("askmsg", ""); askSay("askblocked", "");
      return;
    }
    var cp = e.target.closest("[data-copy]");
    if (cp) {
      var item = askLinks(askQ).filter(function (l) { return l.id === cp.getAttribute("data-copy"); })[0];
      if (!item || !askQ.trim()) return;
      var copying = askCopy(askQ.trim());
      window.open(item.url, "_blank", "noopener,noreferrer");        // same click, so it isn't blocked
      copying.then(function (ok) { askSay("askmsg", ok ? "Copied. Paste it in " + item.name + "." : "Couldn't copy. Select your question and copy it."); });
      return;
    }
    if (e.target.closest("#askall")) {
      if (!askQ.trim()) { askSay("askmsg", "Type your question first."); return; }
      var blocked = 0;
      askLinks(askQ).filter(function (l) { return l.mode === "link"; }).forEach(function (l) {
        var w = window.open(l.url, "_blank");                          // no "noopener" here: it makes window.open return null
        if (!w) blocked++; else { try { w.opener = null; } catch (er) {} }
      });
      askSay("askblocked", blocked ? "Your browser blocked " + blocked + " tabs. Tap the buttons below, or allow pop-ups for this site." : "");
      return;
    }
  });
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
        if (nd && nd.built && (!D || nd.built !== D.built)) { D = nd; if (state.tab === "ask") setStamp(); else render(); } else setStamp();   // don't redraw the Ask box while typing
      })
      .catch(function () { if (!navigator.onLine) offline.hidden = false; })
      .then(function () { btn.classList.remove("spin"); });
  }
  btn.addEventListener("click", function () { pull(true); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { setStamp(); pull(false); } });
  window.addEventListener("online", function () { offline.hidden = true; pull(false); });
  window.addEventListener("offline", function () { offline.hidden = false; });

  var start = routeFor(location.hash) || { tab: "best", more: false };
  // back from Stripe: ?session_id=cs_...#ask -> turn the payment into a code (the helper checks it with Stripe)
  var sm = /[?&]session_id=(cs_[A-Za-z0-9_]{3,250})/.exec(location.search);
  if (sm && CONFIG.ASK_API) { sessionId = sm[1]; start = { tab: "ask", more: false }; redeem(); }
  else loadLeft();
  go(start.tab, start.more, true);
  pull(false);
  setInterval(setStamp, 60000);

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})(typeof window !== "undefined" ? window : this);
