(function (root) {
  "use strict";
  // AI Pro: 5 tabs that answer 5 questions, plus "Ask" (ask the AIs here with credits, or open the question in each AI).
  //   Top Picks · Cost · New releases · Big news · Agents · Explore · Race   (+ a Sources view)
  // Each tab shows a short simple view first, and "See more" opens the full details.
  // All picks are made by fixed rules in scripts/update_data.py; this file only shows them.
  // ---- settings for Explore ("Ask the AIs", see worker/README.md). Leave ASK_API empty and the Ask tab is the free v8 tab.
  var CONFIG = {
    ASK_API: "https://ai-tracker-ask.ai-tracker-ask.workers.dev",            // the Worker URL, e.g. "https://ai-tracker-ask.<you>.workers.dev"
    PAY_LINK: "https://buy.stripe.com/test_fZu8wRan4foLbQwdEU2wU00",           // the Stripe Payment Link URL ($5 for 100 credits)
    FREE: 10, PACK: 100, PRICE: 5,  // free credits, credits in the $5 pack, its price: only for the wording; the Worker decides
    WEB: 2,                         // web search: extra credits per AI that searched (fallback; GET /status sends the Worker's web_credits)
    ASK_NAME: "Explore"             // the Ask tab's name: nav label, its heading and the first screen's banner
  };
  // the subtitle under each main screen's title (the "See more" pages keep their longer text)
  var SUBS = {
    ask: "Compare answers from the top AIs.",
    best: "The top AI for each task.",
    cost: "Free and paid plans for each AI.",
    releases: "The latest AI models.",
    agents: "AIs that do tasks for you.",
    race: "Give one task to 2 to 4 AIs and see who finishes first."
  };
  var hasDom = typeof document !== "undefined";
  var D = root.AI_DATA || null;

  var TABS = ["best", "cost", "releases", "news", "agents", "ask", "race"];
  var VIEWS_ALL = TABS.concat(["sources"]);
  var state = { tab: "best", more: false, open: {} };

  // ---------------------------------------------------------------- helpers
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https:\/\//.test(u || "") ? esc(u) : ""; }
  function ext(u, text) { var s = safeUrl(u); return s ? '<a href="' + s + '" target="_blank" rel="noopener">' + text + "</a>" : text; }
  function list(x) { return Array.isArray(x) ? x : []; }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function day(iso) {
    if (!iso) return "";
    var p = String(iso).slice(0, 10).split("-");
    if (p.length < 3 || !+p[1]) return "";
    var y = +p[0], thisYear = new Date().getFullYear();
    return MON[+p[1] - 1] + "\u00a0" + (+p[2]) + (y && y !== thisYear ? ",\u00a0" + y : "");     // no-break spaces: a date never splits
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
  // Plain words for the simple view: no source names, no index names, no "per million tokens" without explaining it.
  var VOTES_SRC = "lmarena";
  function plainWhy(p) {
    var w = list(p.winners), n = p.n || list(p.boards).length || 3;
    if (p.id === "cheap") {
      return w.length ? "Cheapest to build apps with, among models rated top 10 by at least " + (p.need || 2) + " of " + n + " tests. " +
        "Price is for developers (per million tokens ≈ 750,000 words). For the cheapest app plan, see Cost."
        : "No model is rated top 10 by at least " + (p.need || 2) + " of " + n + " tests with a known price yet.";
    }
    if (p.status === "single") return "Rated #1 by people's votes. Only 1 test covers pictures right now, so no picture model is called best yet.";
    if (p.status === "none") {
      var close = list(p.candidates).slice(0, 3).map(function (c) { return c.n; });
      return "No clear winner yet: the " + n + " tests don't agree." + (close.length ? " Closest: " + close.join(", ") + "." : "");
    }
    if (p.status === "tie") return "Tie: " + w.map(function (c) { return c.n; }).join(" and ") + " are both in the top 3 of " + (w[0].top3 >= n ? "all " + n : w[0].top3 + " of " + n) + " tests, and too close to call.";
    var c = w[0] || {};
    var votes1 = list(c.ranks).some(function (r) { return r.src === VOTES_SRC && r.rank === 1; });
    return (c.top3 >= n ? n + " independent tests agree: it's in the top 3 of all of them." : "In the top 3 of " + c.top3 + " of " + n + " independent tests.") +
      (votes1 ? " Rated #1 by people's votes." : "");
  }
  function plainPrice(c) {
    if (!c || !c.price) return "";
    return '<p class="note">Price for developers: <b>' + money(c.price.pin) + "</b> to read and <b>" + money(c.price.pout) + "</b> to write, per million tokens (≈ 750,000 words).</p>";
  }
  function pickCard(p, idPrefix) {
    var id = idPrefix + p.id;
    var w = list(p.winners);
    var badge = "";
    if (p.id === "cheap" && w.length) badge = '<span class="badge one">' + (p.need || 2) + " of " + (p.n || 3) + " tests</span>";
    else if (p.status === "single") badge = '<span class="badge one">Rated #1 by people\'s votes · 1 test only</span>';
    else if (p.status === "tie") badge = '<span class="badge tie">Tie</span>';
    else if (p.status === "none") badge = '<span class="badge none">Not decided</span>';
    else if (w[0] && w[0].notSure) badge = '<span class="badge new">New, not sure yet</span>';
    var h = '<details class="pick" id="' + esc(id) + '"' + (state.open[id] ? " open" : "") + "><summary>" +
      '<span class="ico" aria-hidden="true">' + esc(p.icon || "•") + "</span>" +
      '<span class="pt"><span class="lab">' + esc(p.label) + "</span>" +
      '<span class="name">' + esc(pickTitle(p)) + "</span>" +
      (pickMaker(p) ? '<span class="who">' + esc(pickMaker(p)) + "</span>" : "") + (badge ? '<span class="badges">' + badge + "</span>" : "") + "</span>" +
      '<span class="chev" aria-hidden="true"></span></summary><div class="body">';
    h += '<p class="why">' + esc(plainWhy(p)) + "</p>";
    if (p.id === "cheap") h += plainPrice(w[0]);
    if (p.status === "single" && list(p.candidates).length) h += '<p class="note">Next: ' + esc(list(p.candidates).slice(0, 3).map(function (c) { return c.n; }).join(", ")) + ".</p>";
    list(p["new"]).forEach(function (c) {
      var votes1 = list(c.ranks).some(function (r) { return r.src === VOTES_SRC && r.rank === 1; });
      h += '<p class="newnote"><span class="badge new">New, not sure yet</span> <b>' + esc(c.n) + "</b>" +
        (votes1 ? " is rated #1 by people's votes" : " looks strong") + ", but it's too new to be sure.</p>";
    });
    if (p.usesAA) h += aaNote();
    h += '<p class="note"><a href="#best-more" data-more="best">See the test scores and how picks work</a></p>';
    return h + "</div></details>";
  }

  // ---------------------------------------------------------------- views: Top Picks (#best)
  // the first screen: a clear way into Ask (only when Ask is set up)
  // the "Explore — 10 free credits" banner is for new visitors only: hidden once free credits were spent on this
  // device (ait.freeCreditsUsed, saved from every balance the helper sends) or a paid code was saved
  function ctaOn() {
    if (!CONFIG.ASK_API || stored("ait.code")) return false;
    if ((parseInt(stored("ait.freeCreditsUsed") || "0", 10) || 0) > 0) return false;
    return !(pro.left && (pro.left.paid_left != null || (pro.left.free_left != null && pro.left.free_left < CONFIG.FREE)));
  }
  function askCta() {
    return ctaOn() ? '<a class="askcta" href="#ask" data-tab="ask"><span aria-hidden="true">💬</span> <b>' + esc(CONFIG.ASK_NAME) + "</b> — " + CONFIG.FREE +
      ' free credits <span class="go" aria-hidden="true">›</span></a>' : "";
  }
  // ---- AI tip of the week (tips.js: window.AI_TIPS). One tip per week, changing every Monday: weeks are counted
  // from Monday 5 Jan 1970 on the visitor's own calendar, so ISO week 53 -> week 1 simply moves on to the next tip.
  function tipsList() { var t = root.AI_TIPS; return Array.isArray(t) ? t.filter(function (x) { return typeof x === "string" && x; }) : []; }
  function weekNumber(d) {                                  // weeks since Mon 1970-01-05 (local date, no DST trouble)
    var day = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5;
    return Math.floor((day - 4) / 7);
  }
  function isoWeek(d) {                                     // {year, week} as in ISO 8601 (weeks start Monday)
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dow = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dow);                 // the Thursday of this week decides the year
    var y = t.getUTCFullYear();
    return { year: y, week: Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7) };
  }
  function tipFor(d) { var t = tipsList(); return t.length ? t[((weekNumber(d) % t.length) + t.length) % t.length] : ""; }
  function tipHtml(d) {
    var t = tipsList(), tip = tipFor(d);
    if (!tip) return "";
    return '<aside class="tip card" aria-labelledby="tiph"><p class="tiphead" id="tiph"><span aria-hidden="true">💡</span> AI tip of the week</p>' +
      '<p class="tiptext">' + esc(tip) + "</p>" +
      '<details class="tipall"><summary>See all tips</summary><ol>' + t.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol></details></aside>";
  }
  // ---- Top Picks finder (v16): the visitor picks a task, what matters most and Free / Paid; the app ranks the
  // tested models from the data it already has (no server call). Pure: rankModels(D, task, prio, plan).
  //  score    = quality alone, or 40% quality + 60% the chosen priority
  //  quality  = how high the independent tests rank it for that task (top 10 counts, #1 counts most), averaged over the tests
  //  speed    = the model's "fast" mark (guessed from its name), else a lower developer price as a rough hint
  //  price    = the developer price per million tokens (Paid: the cheapest monthly plan of its app)
  //  web      = can be asked in Explore here, where answers look up the web when the question needs it
  //  Free / Paid = the model is on its app's FREE plan (FREE_MODELS above) / the app has paid plans (from the Cost data)
  // Which TESTED models a FREE plan user can use, per app (by model key), checked 2026-11-06. "free" = on the free plan;
  // "limited" = on the free plan with tight limits, or not fully confirmed ("May be limited on free"). A model not listed
  // here needs a paid plan. Kept here, not in data/ (the daily Action rewrites data). Edit when plans change.
  var FREE_MODELS = {
    Claude: { "claude-sonnet-5-5": "free" },                          // Opus 5.5 and Fable 5.1: paid plans only
    ChatGPT: { "gpt-6-1-terra": "limited", "gpt-image-2": "limited" },   // default free chat is GPT-6 Luna (not tested); Sol, Astra, Image 2.5/2.6: paid
    Gemini: { "gemini-4-carbon": "limited", "gemini-nano-banana-2-1": "limited" },   // Gemini 4 Argon: subscribers only
    Copilot: { "mai-image-2-6": "limited" }
  };
  // the free plan's everyday model, for "Closest free option" when no tested model of a task is free
  var FREE_DEFAULT = { ChatGPT: "GPT-6 Luna", Claude: "Sonnet 5.5", Gemini: "Gemini Flash", Copilot: "Copilot" };
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function freeLevel(app, k) { return app && app.free && own(FREE_MODELS, app.app) && own(FREE_MODELS[app.app], k) ? FREE_MODELS[app.app][k] : ""; }
  function freeIn(app, k) { return !!freeLevel(app, k); }
  var PRIOS = [["quality", "Quality"], ["speed", "Speed"], ["price", "Price"], ["web", "Web search"]];
  var PLANS = [["any", "Any"], ["free", "Free"], ["paid", "Paid"]];
  var finder = null;
  function finderTasks() { return list(D && D.picks).filter(function (p) { return p.id !== "cheap" && list(p.winners).concat(list(p.candidates)).length; }); }
  function getFinder() {
    if (!finder) { var raw = null; try { raw = JSON.parse(stored("ait.finder")); } catch (e) {} finder = raw && typeof raw === "object" ? raw : {}; }
    var tasks = finderTasks().map(function (p) { return p.id; });
    var ok = function (v, l, d) { return l.indexOf(v) >= 0 ? v : d; };
    return { task: ok(finder.task, tasks, tasks[0] || ""), prio: ok(finder.prio, PRIOS.map(function (x) { return x[0]; }), "quality"),
             plan: ok(finder.plan, PLANS.map(function (x) { return x[0]; }), "any") };
  }
  function setFinder(k, v) { var f = getFinder(); f[k] = v; finder = f; store("ait.finder", JSON.stringify(f)); }
  function makerKey(o) { return String(o || "").toLowerCase().split(/\s+/)[0]; }
  function appFor(d, o) {
    var k = makerKey(o);
    return list(d && d.cost && d.cost.apps).filter(function (a) { return makerKey(a.maker) === k; })[0] || null;
  }
  function devFor(d, k) { return list(d && d.cost && d.cost.dev).filter(function (x) { return x.k === k; })[0] || null; }
  function cheapestPlan(app) {
    return list(app && app.plans).filter(function (p) { return p.usd_month > 0; }).sort(function (a, b) { return a.usd_month - b.usd_month; })[0] || null;
  }
  // the Explore AI + model for a tested model, when this app can ask it ("claude-opus-5-5" = anthropic/claude-opus-5.5)
  function exploreFor(k) {
    var hit = null;
    proModels().forEach(function (m) {
      (m.options || []).forEach(function (o) {
        var key = String(o.model).split("/").pop().replace(/[.]/g, "-").toLowerCase();
        if (!hit && key === k) hit = { id: m.id, name: m.name, model: o.model, label: o.label };
      });
    });
    return hit;
  }
  function scale(v, lo, hi) { var x = (Math.log(hi) - Math.log(v)) / (Math.log(hi) - Math.log(lo)); return Math.max(0, Math.min(1, x)); }
  function rankModels(d, task, prio, plan) {
    var p = list(d && d.picks).filter(function (x) { return x.id === task; })[0];
    if (!p) return [];
    var seen = {}, all = list(p.winners).concat(list(p.candidates)).filter(function (c) { if (!c || seen[c.k]) return false; seen[c.k] = 1; return true; });
    var n = Math.max(1, p.n || 1);
    return all.map(function (c) {
      var ranks = list(c.ranks).filter(function (r) { return r.rank != null; });
      var top10 = ranks.filter(function (r) { return r.rank <= 10; }).length, top3 = ranks.filter(function (r) { return r.rank <= 3; }).length;
      var quality = ranks.reduce(function (t, r) { return t + (r.rank <= 10 ? (11 - r.rank) / 10 : 0); }, 0) / n;
      var app = appFor(d, c.o), dev = devFor(d, c.k), plan1 = cheapestPlan(app);
      var blend = dev ? (3 * dev.pin + dev.pout) / 4 : null;
      var devScore = blend ? scale(blend, 0.2, 20) : 0.2;
      var ex = exploreFor(c.k);
      var scores = {
        quality: quality,
        speed: c.fast ? 1 : 0.6 * devScore,
        // Free / Any: usable for free = cheapest (free 1, may be limited 0.85); no developer price alone = middle, not last
        price: plan === "paid" ? (plan1 ? scale(plan1.usd_month, 4, 250) : 0)
          : freeLevel(app, c.k) === "free" ? 1 : freeLevel(app, c.k) === "limited" ? 0.85 : blend ? devScore : 0.5,
        web: ex ? 1 : 0
      };
      var score = prio === "quality" ? quality : 0.4 * quality + 0.6 * scores[prio];        // the chosen priority counts most
      return { k: c.k, n: c.n, o: c.o, fast: !!c.fast, score: score, quality: quality, top10: top10, top3: top3, tests: n,
               app: app ? app.app : "", free: freeIn(app, c.k), freeLevel: freeLevel(app, c.k), plan: plan1, dev: dev, blend: blend, explore: ex, scores: scores };
    }).filter(function (r) {
      if (plan === "free") return r.free;
      if (plan === "paid") return !!r.plan;
      return true;
    }).sort(function (a, b) { return b.score - a.score || b.quality - a.quality || (a.n < b.n ? -1 : 1); });
  }
  function money(v) { return "$" + (v >= 10 ? Math.round(v) : (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, "")); }
  function finderWhy(r, prio, plan) {
    var w = [];
    if (r.top3) w.push("Top 3 in " + r.top3 + " of " + r.tests + (r.tests === 1 ? " test" : " tests"));
    else if (r.top10) w.push("Top 10 in " + r.top10 + " of " + r.tests + (r.tests === 1 ? " test" : " tests"));
    if (r.fast) w.push("⚡ Fast");
    if (plan === "paid" && r.plan) w.push(r.app + " " + r.plan.name + " " + money(r.plan.usd_month) + "/month");
    else if (r.free) w.push(r.freeLevel === "limited" ? "May be limited on free" : "Free in " + r.app);
    else w.push("Paid plan needed" + (r.plan ? ": " + r.app + " " + r.plan.name + " " + money(r.plan.usd_month) + "/month" : ""));
    if (prio === "price" && plan !== "paid" && r.blend) w.push("Developer price " + money(r.blend) + " per million tokens");
    if (prio === "web" && r.explore) w.push("Can search the web in " + CONFIG.ASK_NAME);
    return w;
  }
  function seg(name, opts, cur, label) {
    return '<fieldset class="seg"><legend>' + esc(label) + '</legend><div class="segs">' + opts.map(function (o) {
      return '<label class="segopt' + (o[0] === cur ? " on" : "") + '"><input type="radio" name="' + name + '" value="' + esc(o[0]) + '"' + (o[0] === cur ? " checked" : "") +
        "><span>" + esc(o[1]) + "</span></label>";
    }).join("") + "</div></fieldset>";
  }
  function finderHtml() {
    var tasks = finderTasks();
    if (!tasks.length) return "";
    var f = getFinder(), ranked = rankModels(D, f.task, f.prio, f.plan), best = ranked[0];
    var h = '<section class="finder card" id="finder" aria-labelledby="finderh"><h3 id="finderh">Find your AI</h3>' +
      seg("ftask", tasks.map(function (p) { return [p.id, p.label]; }), f.task, "Task") +
      seg("fprio", PRIOS, f.prio, "Most important") +
      seg("fplan", PLANS, f.plan, "Plan") +
      '<div class="fresult" aria-live="polite">';
    if (!best && f.plan === "free") {                               // never an empty Free: point to the closest free app
      var near = rankModels(D, f.task, f.prio, "any").filter(function (r) { var a = appFor(D, r.o); return a && a.free; })[0];
      h += '<p class="note">No tested model for this task is free.' + (near ? " Closest free option: " + esc(near.app) + " Free (" +
        esc(FREE_DEFAULT[near.app] || "its free model") + ")." : "") + "</p>";
    } else if (!best) h += '<p class="note">No tested model fits this choice yet. Try another plan.</p>';
    else {
      var try1 = CONFIG.ASK_API && best.explore ? '<button type="button" class="trybtn" data-try="' + esc(best.explore.id + "|" + best.explore.model) + '">Ask it in ' + esc(CONFIG.ASK_NAME) + "</button>" : "";
      h += '<div class="fbest"><p class="fkick">Your best match</p><p class="fname"><b>' + esc(best.n) + "</b>" + (best.o ? ' <span class="muted">by ' + esc(best.o) + "</span>" : "") + "</p>" +
        '<ul class="fwhy">' + finderWhy(best, f.prio, f.plan).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" + try1 + "</div>";
      h += '<details class="frank"' + (ranked.length > 1 ? " open" : " hidden") + '><summary>Full ranking (' + ranked.length + ")</summary><ol>" + ranked.map(function (r, i) {
        var pct = Math.round(Math.max(0.04, Math.min(1, r.score)) * 100);
        return '<li><span class="rpos">' + (i + 1) + '</span><span class="rbody"><b>' + esc(r.n) + "</b>" + (r.o ? ' <span class="muted">' + esc(r.o) + "</span>" : "") +
          '<span class="rbar" aria-hidden="true"><i style="width:' + pct + '%"></i></span><small>' + esc(finderWhy(r, f.prio, f.plan).join(" · ")) + "</small></span></li>";
      }).join("") + "</ol></details>";
    }
    if (f.plan === "free" && best) {                                // free apps whose free model isn't in this task's tests
      var shown = {};
      ranked.forEach(function (r) { shown[r.app] = 1; });
      var also = (f.task === "pictures" ? ["ChatGPT", "Gemini", "Copilot"] : ["ChatGPT", "Claude", "Gemini"]).filter(function (a) {
        var app = list(D.cost && D.cost.apps).filter(function (x) { return x.app === a; })[0];
        return app && app.free && !shown[a];
      });
      if (also.length) h += '<p class="note falso">Also free, not tested for this task: ' +
        esc(also.map(function (a) { return a + " Free (" + (FREE_DEFAULT[a] || "its free model") + ")"; }).join(", ")) + ".</p>";
    }
    h += '<p class="note fnote">Ranked from the tests, prices and plans in this app. ' +
      (f.prio === "speed" ? "Speed is a guess from the model's name and price, not a speed test. " : "") +
      (f.plan === "free" ? "Free plans have limits, and may not include every model. " : "") + "</p></div></section>";
    return h;
  }
  // simple views name no sources; the credits (and CC BY attribution) are one tap away on the Sources page
  function plainCredits() {
    return '<p class="credits">Data: independent AI tests, the companies\' own pages and price lists. <a href="#sources" data-tab="sources">Sources and credits</a></p>';
  }
  function vBest() {
    var picks = list(D.picks);
    var h = "<h2>Top Picks</h2><p class=\"sub\">" + esc(SUBS.best) + "</p>" + askCta() + finderHtml() + tipHtml(new Date());   // the full rule is under See more
    h += staleList(["lmarena", "aa", "livebench", "epoch"]);
    if (list(D.picks).some(function (p) { return p.usesAA; })) h += aaNote();
    h += '<h3 class="stackh">Top Picks by task</h3><div class="stack">' + (picks.map(function (p) { return pickCard(p, "p-"); }).join("") || '<p class="note">No picks yet.</p>') + "</div>";
    h += moreButton("best") + plainCredits();
    return h;
  }
  function vBestMore() {
    var h = backButton() + "<h2>Top Picks: full details</h2>";
    h += howPicks();
    list(D.picks).forEach(function (p) {
      h += '<section class="job"><h3>' + esc(p.icon) + " " + esc(p.label) + ": " + esc(pickTitle(p)) + (p.status === "single" ? " (1 source only)" : "") + "</h3>";
      h += '<p class="why">' + esc(p.why) + "</p>";
      if (p.id !== "cheap" && list(p.candidates).length && p.status === "none") h += "<p><b>Closest:</b> " + esc(list(p.candidates).slice(0, 3).map(function (c) { return c.n + " (top 3 in " + c.top3 + ")"; }).join(", ")) + "</p>";
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
    var h = "<h2>Cost</h2><p class=\"sub\">" + esc(SUBS.cost) + "</p>" + staleNote("prices");
    h += '<ul class="rows card">' + apps.map(function (a) { return appRow(a, false); }).join("") + "</ul>";
    h += moreButton("cost") + plainCredits();
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
  // v16: each release is its own clean card: a coloured maker badge, the name (linked to the announcement), maker · date
  var HUES = [243, 268, 190, 152, 24, 330, 205, 45];
  function makerHue(o) { var h = 0, s2 = makerKey(o); for (var i = 0; i < s2.length; i++) h = (h * 31 + s2.charCodeAt(i)) >>> 0; return HUES[h % HUES.length]; }
  function relCard(r, withSrc) {
    var o = String(r.o || ""), fresh = r.d && (Date.now() - new Date(String(r.d).slice(0, 10) + "T12:00:00Z").getTime()) / 864e5 <= 3;
    return '<li class="relcard"><span class="av" style="--h:' + makerHue(o) + '" aria-hidden="true">' + esc((o.replace(/[^A-Za-z0-9]/g, "")[0] || "•").toUpperCase()) + "</span>" +
      '<span class="rb"><span class="rt">' + ext(r.u, esc(r.n)) + (fresh ? ' <span class="badge new">NEW</span>' : "") + fastTag(r.fast) + "</span>" +
      '<span class="rm">' + (withSrc ? esc(o) + " · " + esc(day(r.d)) + " · " + esc(r.src) : (o ? "New model from " + esc(o) + " · " : "") + esc(day(r.d))) + "</span></span></li>";
  }
  function relRow(r) { return relCard(r, true); }
  // simple view: "New model from Tencent · Nov 2", the name links to the announcement; the source name is under See more
  function relRowPlain(r) { return relCard(r, false); }
  function vReleases() {
    var items = list(D.releases && D.releases.items);
    var h = "<h2>New releases</h2><p class=\"sub\">" + esc(SUBS.releases) + "</p>" + staleNote("openrouter");
    h += '<ul class="rels">' + (items.slice(0, 6).map(relRowPlain).join("") || '<li class="relcard muted">Nothing new yet.</li>') + "</ul>";
    if (items.slice(0, 6).some(function (r) { return r.fast; })) h += '<p class="note">⚡ ' + esc(fastNote()) + "</p>";
    h += moreButton("releases", items.length > 6) + plainCredits();
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
    h += '<ul class="rels">' + (body || '<li class="relcard muted">Nothing new yet.</li>') + "</ul>";
    return h + backButton() + credits(["official", "openrouter", "aa"]);
  }

  // ---------------------------------------------------------------- views: Big news
  // News: title, a short summary, date and the source's name. With a link (http/https), the whole item is one tap that
  // opens the original article in a new tab (source + ↗ in the meta line); without one it stays plain text.
  function newsSummary(n) {
    var x = String(n.x || "").replace(/\s+/g, " ").trim();
    if (x) return x.length > 220 ? x.slice(0, 217).replace(/\s+\S*$/, "") + "…" : x;
    var who = String(n.s || "").replace(/\s+(news|blog|change ?log|newsroom)$/i, "").replace(/\s+API$/i, "");
    var t = String(n.tag || "").toLowerCase();
    if (t === "new model") return "A new model announced by " + (who || "its maker") + ".";
    if (/price/.test(t)) return "A price change announced by " + (who || "the company") + ".";
    if (/ipo|acquisition|funding|company/.test(t)) return "Company news from " + (who || "the company") + ".";
    return "Reported by " + (n.s || "the source") + ".";
  }
  function newsRow(n) {
    var u = typeof n.u === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(n.u) ? n.u : "";
    var body = (n.tag ? '<span class="tag">' + esc(n.tag) + "</span>" : "") + '<b class="nt">' + esc(n.t) + "</b>" +
      '<span class="nsum">' + esc(newsSummary(n)) + "</span>" +
      '<small class="nmeta">' + esc(day(n.d)) + (n.s ? " · " + esc(n.s) : "") +
      (u ? ' <span class="ext" aria-hidden="true">↗</span><span class="sr"> (opens in a new tab)</span>' : "") + "</small>";
    return u ? '<li class="newsitem"><a class="nlink rn" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + body + "</a></li>"
      : '<li class="newsitem"><span class="rn">' + body + "</span></li>";
  }
  // the credit line under the news stays plain text (the items themselves link to their articles)
  function creditsText(ids) { return credits(ids).replace(/<a [^>]*href="(?!#)[^"]*"[^>]*>([\s\S]*?)<\/a>/g, "$1"); }
  function vNews() {
    var items = list(D.bignews && D.bignews.items);
    var h = "<h2>Big news</h2><p class=\"sub\">Only the big stories: new models, price changes and major company news.</p>" + staleNote("news");
    h += '<ul class="rows card">' + (items.slice(0, 5).map(newsRow).join("") || '<li class="muted">No big news right now.</li>') + "</ul>";
    return h + moreButton("news", items.length > 5) + creditsText(["official", "news"]);
  }
  function vNewsMore() {
    var items = list(D.bignews && D.bignews.items);
    var h = backButton() + "<h2>Big news: last 30 days</h2><p class=\"sub\">" + esc((D.bignews && D.bignews.rules) || "") + " From the companies' own pages, AI lab blogs and tech news sites, picked by fixed word rules (opinion, lawsuits, rumors, partnerships and customer stories are left out). The same story from several sites is shown once, from the company's own page when there is one.</p>" + staleNote("news");
    h += '<ul class="rows card">' + (items.slice(0, 30).map(newsRow).join("") || '<li class="muted">No big news right now.</li>') + "</ul>";
    return h + backButton() + creditsText(["official", "news"]);
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
    var h = "<h2>AI agents</h2><p class=\"sub\">" + esc(SUBS.agents) + "</p>";
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
  // ---------------------------------------------------------------- Ask the AIs (Explore tab; optional helper, see worker/)
  // The visitor ticks 1 to 8 AIs; each answer costs credits. One question to /ask returns all the ticked answers.
  // The helper decides what is free or paid; the numbers here are display only. Answers are written with
  // textContent (never innerHTML). The question itself is never stored; the ticked AIs are (ait.pick).
  // main: shown in the main chips; the rest sit behind "More AIs". web "native": searches the web by itself (no web extra).
  // options: the models the visitor may choose for that AI; the FIRST is the default (credits = the default's).
  // Built-in copy of the Worker's table; GET /status sends the server's list, costs, flags and options, which win.
  function opts(list) { return list.map(function (o) { return { model: o[0], label: o[1], credits: o[2] }; }); }
  var PRO_AIS = [
    { id: "chatgpt", name: "ChatGPT", main: true, options: opts([["openai/gpt-6.1-terra", "GPT-6.1 Terra", 2], ["openai/gpt-6.1-sol", "GPT-6.1 Sol", 3], ["openai/gpt-6-astra", "GPT-6 Astra", 7]]) },
    { id: "claude", name: "Claude", main: true, options: opts([["anthropic/claude-sonnet-5.5", "Sonnet 5.5", 2], ["anthropic/claude-opus-5.5", "Opus 5.5", 4], ["anthropic/claude-fable-5.1", "Fable 5.1", 7]]) },
    { id: "gemini", name: "Gemini", main: true, options: opts([["google/gemini-3.8-flash", "3.8 Flash", 1], ["google/gemini-4-argon", "Gemini 4 Argon", 3]]) },
    { id: "grok", name: "Grok", main: true, options: opts([["x-ai/grok-4.7", "Grok 4.7", 1], ["x-ai/grok-4.3", "Grok 4.3", 1]]) },
    { id: "deepseek", name: "DeepSeek", main: true, options: opts([["deepseek/deepseek-v4.1-flash", "V4.1 Flash", 1], ["deepseek/deepseek-v4-pro-0813", "V4 Pro", 2]]) },
    { id: "llama", name: "Llama", main: false, options: opts([["meta-llama/llama-4-maverick", "Llama 4 Maverick", 1], ["meta-llama/llama-4-scout", "Llama 4 Scout", 1]]) },
    { id: "mistral", name: "Mistral", main: false, options: opts([["mistralai/mistral-large-4-0", "Large 4", 1], ["mistralai/mistral-medium-3-5", "Medium 3.5", 2]]) },
    { id: "perplexity", name: "Perplexity", main: false, web: "native", options: opts([["perplexity/sonar", "Sonar", 1], ["perplexity/sonar-pro", "Sonar Pro", 3], ["perplexity/sonar-reasoning-pro", "Sonar Reasoning Pro", 3]]) }
  ];
  PRO_AIS.forEach(function (m) { m.credits = m.options[0].credits; });
  var DEFAULT_PICK = ["chatgpt", "claude", "gemini"];
  var pro = { busy: false, asked: null, answers: null, left: null, notice: "", short: false, paid: null, redeemErr: false,
              codeMsg: "", charged: null, models: null, pick: null, webCredits: null, moreOpen: null,
              choice: null, askedChoice: null, sheet: null };
  var four = pro;                       // old name, kept for anything that still points at it
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) {} }
  function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  // Text direction by MAJORITY of letters (Hebrew script vs Latin), so "Gemini איז גוט…" is still right-to-left.
  function textDir(s) {
    var t = String(s == null ? "" : s);
    var heb = (t.match(/[֐-׿יִ-ﭏ]/g) || []).length;
    var lat = (t.match(/[A-Za-zÀ-ɏ]/g) || []).length;
    if (!heb && !lat) return "auto";
    return heb > lat ? "rtl" : "ltr";
  }
  // answers are shown as plain text: **bold**, __bold__ and # headings lose their marks, and a Markdown link
  // [text](https://…) becomes just "text" (the sources are listed under the card anyway)
  function plainAnswer(s) {
    return String(s || "").replace(/\[([^\[\]\n]{1,300})\]\(\s*https?:\/\/[^\s()]{1,2000}(?:\([^\s()]{0,200}\)[^\s()]{0,500})*\s*\)/g, "$1")
      .replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/__([^_\n]+)__/g, "$1").replace(/^#{1,6}\s+/gm, "");
  }
  function nCredits(n) { return n + (n === 1 ? " credit" : " credits"); }
  function proModels() { return pro.models && pro.models.length ? pro.models : PRO_AIS; }
  // pure: what a selection costs (unknown ids cost nothing and are ignored). With web on, every AI that doesn't
  // search by itself (web "native", i.e. Perplexity) costs webCredits more.
  // choice = {aiId: model id}; an unknown or missing model counts as that AI's default.
  function selectionCost(ids, models, web, webCredits, choice) {
    var by = {};
    (models || PRO_AIS).forEach(function (m) {
      by[m.id] = chosenOption(m, choice).credits + (web && m.web !== "native" ? (webCredits == null ? CONFIG.WEB : webCredits) : 0);
    });
    var seen = {};
    return (ids || []).reduce(function (t, id) { if (by[id] == null || seen[id]) return t; seen[id] = 1; return t + by[id]; }, 0);
  }
  function webCredits() { return pro.webCredits != null ? pro.webCredits : CONFIG.WEB; }
  // pure: the option an AI will use: the chosen model if it is one of THIS AI's options, else the default (first)
  function chosenOption(m, choice) {
    var list = m.options && m.options.length ? m.options : [{ model: "", label: "", credits: m.credits }];
    var want = choice && Object.prototype.hasOwnProperty.call(choice, m.id) ? choice[m.id] : null;
    return list.filter(function (o) { return o.model === want; })[0] || list[0];
  }
  function isDefault(m, o) { return !m.options || !m.options.length || o === m.options[0]; }
  // pure: the choices that differ from the defaults (what /ask needs), cleaned against the list
  function cleanChoice(choice, models) {
    var out = {};
    (models || PRO_AIS).forEach(function (m) { var o = chosenOption(m, choice); if (!isDefault(m, o)) out[m.id] = o.model; });
    return out;
  }
  // model choices are remembered on this device like the picks (ait.models); unknown ones fall back to the default
  function getChoice() {
    if (!pro.choice) { var raw = null; try { raw = JSON.parse(stored("ait.models")); } catch (e) {} pro.choice = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}; }
    return cleanChoice(pro.choice, proModels());
  }
  function setChoice(id, model) {
    var c = getChoice(); c[id] = model;
    pro.choice = cleanChoice(c, proModels()); store("ait.models", JSON.stringify(pro.choice));
  }
  // "ChatGPT, Claude Opus 5.5, Gemini": the ticked AIs, with the model's short label when it isn't the default
  function pickNames(ids, models, choice) {
    return (models || PRO_AIS).filter(function (m) { return (ids || []).indexOf(m.id) >= 0; }).map(function (m) {
      var o = chosenOption(m, choice);
      return isDefault(m, o) ? m.name : m.name + " " + o.label;
    }).join(", ");
  }
  // Web search is automatic (v13): the helper decides per question with the same rule. This copy is ONLY for the cost
  // preview under the question; the helper's decision is the one that counts. Keep these 3 lists equal to
  // worker/src/index.js (a test compares them). English: whole words; Hebrew / Yiddish: plain substrings.
  var WEB_WORDS_EN = ["news", "headline", "headlines", "today", "tonight", "yesterday", "tomorrow", "this week", "this month", "this year", "last week", "last night", "latest", "newest", "current", "currently", "now", "right now", "recent", "recently", "breaking", "updates", "price", "prices", "cost of", "stock", "stocks", "share price", "market", "bitcoin", "crypto", "exchange rate", "score", "scores", "who won", "who is winning", "results", "standings", "weather", "forecast", "temperature", "election", "elections", "poll", "polls", "what happened"];
  var WEB_WORDS_HE = ["חדשות", "היום", "אתמול", "מחר", "השבוע", "עכשיו", "כרגע", "מחיר", "מזג האוויר", "תחזית", "בחירות", "מי ניצח", "מה קרה", "תוצאות", "עדכני", "האחרון"];
  var WEB_WORDS_YI = ["נייעס", "היינט", "נעכטן", "מארגן", "די וואך", "יעצט", "איצט", "פרייז", "וועטער", "וואלן", "ווער האט געוואונען", "וואס איז געשען", "רעזולטאטן", "לעצטע"];
  var WEB_RE = new RegExp("\\b(?:" + WEB_WORDS_EN.map(function (w) { return w.replace(/ /g, "\\s+"); }).join("|") + ")\\b", "i");
  function needsWeb(question, now) {
    var q = String(question || "").slice(0, 1500);
    if (WEB_RE.test(q)) return true;
    if (WEB_WORDS_HE.concat(WEB_WORDS_YI).some(function (w) { return q.indexOf(w) >= 0; })) return true;
    var year = new Date(now).getUTCFullYear();
    return (q.match(/\b\d{4}\b/g) || []).some(function (y) { return Number(y) >= year && Number(y) <= year + 5; });   // not "3000 words"
  }
  // pure: the cost preview. base = without web; held = what the helper holds before asking (base + web for each AI that
  // doesn't search by itself, when the question needs the web); hint = say "+2 per AI if it needs the web".
  function costPreview(q, pick, models, choice, wc, now) {
    var web = needsWeb(q, now);
    var base = selectionCost(pick, models, false, wc, choice), held = selectionCost(pick, models, web, wc, choice);
    return { web: web, base: base, held: held, hint: held > base };
  }
  function mainIds(models) { return (models || PRO_AIS).filter(function (m) { return m.main; }).map(function (m) { return m.id; }); }
  // "More AIs" is open when the visitor opened it, or (until they choose) when one of its AIs is ticked
  function moreOpen(pick, models) {
    if (pro.moreOpen != null) return pro.moreOpen;
    return (models || PRO_AIS).some(function (m) { return !m.main && (pick || []).indexOf(m.id) >= 0; });
  }
  // pure: the ticked AIs, cleaned (known ids, no repeats, in the list's order); first visit = ChatGPT, Claude, Gemini
  function cleanPick(ids, models) {
    var list = models || PRO_AIS, want = {};
    if (!Array.isArray(ids)) return DEFAULT_PICK.slice();
    ids.forEach(function (id) { want[id] = 1; });
    return list.filter(function (m) { return want[m.id]; }).map(function (m) { return m.id; });
  }
  function getPick() {
    if (!pro.pick) { var raw = null; try { raw = JSON.parse(stored("ait.pick")); } catch (e) {} pro.pick = cleanPick(raw); }
    return cleanPick(pro.pick, proModels());
  }
  function setPick(ids) { pro.pick = cleanPick(ids, proModels()); store("ait.pick", JSON.stringify(pro.pick)); }
  // credits the visitor has: free + paid (from the helper; before it answers, from this device's last known numbers)
  function balance() {
    var l = pro.left;
    if (!l) {
      var used = parseInt(stored("ait.freeCreditsUsed") || "0", 10) || 0;
      l = { free_left: Math.max(0, CONFIG.FREE - used), paid_left: null };
    }
    var free = l.free_left || 0, paid = l.paid_left || 0;
    return { free: free, paid: paid, total: free + paid };
  }
  function askLabel(n, cost, held) {
    if (!n) return "Tick at least one AI";
    return "Ask " + n + (n === 1 ? " AI" : " AIs") + " (" + (held > cost ? "up to " + nCredits(held) : nCredits(cost)) + ")";
  }
  // the live line under the question: short and calm, one line on a phone. "Uses 4 credits · You have 10 credits"
  // (each half never breaks inside; at 360 px the halves may stack), plus
  // "(+2 per AI if it needs the web)" only when the rule says it will search, and the non-default models' names.
  function costLineHtml(cp, pick, models, choice, wc, bal, id) {
    var chosen = (models || PRO_AIS).filter(function (m) { return pick.indexOf(m.id) >= 0 && !isDefault(m, chosenOption(m, choice)); });
    return '<p class="costline" id="' + (id || "askcost") + '" aria-live="polite"><span class="cl">Uses <b>' + esc(nCredits(cp.base)) + "</b></span>" +
      ' · <span class="cl">You have <b>' + esc(nCredits(bal.total)) + "</b></span>" +
      (cp.hint ? '<small class="webhint">(+' + esc(String(wc)) + " per AI if it needs the web)</small>" : "") +
      (chosen.length ? '<small class="costnames">' + esc(pickNames(chosen.map(function (m) { return m.id; }), models, choice)) + "</small>" : "") +
      (bal.paid > 0 ? '<small class="split">' + bal.free + " free + " + bal.paid + " paid</small>" : "") + "</p>";
  }
  function proHtml() {
    var models = proModels(), pick = getPick(), wc = webCredits(), bal = balance(), choice = getChoice();
    var cp = costPreview(askQ, pick, models, choice, wc, Date.now());
    var short = pick.length > 0 && bal.total < cp.held;                // checked against what the helper will hold
    // a chip shows only the AI's name (and the chosen model's short label when it isn't the default); credits per
    // model appear only inside the model picker. The ▾ button sits outside the label, so it never ticks the box.
    function chip(m) {
      var on = pick.indexOf(m.id) >= 0, o = chosenOption(m, choice), many = m.options && m.options.length > 1;
      return '<span class="chip' + (on ? " on" : "") + (many ? " hasmodels" : "") + '"><label class="chipl"><input type="checkbox" data-pick="' + esc(m.id) + '"' + (on ? " checked" : "") +
        "><span><b>" + esc(m.name) + "</b>" + (isDefault(m, o) ? "" : '<small class="clabel">' + esc(o.label) + "</small>") + "</span></label>" +
        (many ? '<button type="button" class="chipmodel" data-models="' + esc(m.id) + '" aria-haspopup="dialog" aria-label="Choose ' + esc(m.name) + ' model">' +
          '<span aria-hidden="true">▾</span></button>' : "") + "</span>";
    }
    var main = models.filter(function (m) { return m.main; }), more = models.filter(function (m) { return !m.main; });
    var open = moreOpen(pick, models);
    var h = '<div class="pickhead"><h3 id="pickh">Pick the AIs</h3><span class="pickq"><button type="button" class="linkbtn" id="pickall">All</button>' +
      ' · <button type="button" class="linkbtn" id="picknone">Untick all</button></span></div>' +
      '<div class="chips" role="group" aria-labelledby="pickh">' + main.map(chip).join("") + "</div>";
    if (more.length) {
      var moreOn = more.filter(function (m) { return pick.indexOf(m.id) >= 0; }).length;
      h += '<button type="button" class="linkbtn morebtn2" id="moreais" aria-expanded="' + (open ? "true" : "false") + '" aria-controls="morechips">More AIs' +
        (moreOn ? " (" + moreOn + " ticked)" : "") + ' <span aria-hidden="true">' + (open ? "▴" : "▾") + "</span></button>" +
        '<div class="chips morechips" id="morechips" role="group" aria-label="More AIs"' + (open ? "" : " hidden") + ">" + more.map(chip).join("") + "</div>";
    }
    h += costLineHtml(cp, pick, models, choice, wc, bal);
    pro.shownShort = short;
    h += '<button type="button" class="askfour" id="askfour"' + (pro.busy || !pick.length || short ? " disabled" : "") + ">" +
      (pro.busy ? "Asking…" : esc(askLabel(pick.length, cp.base, cp.held))) + "</button>";
    if (pro.charged != null && !pro.busy) h += '<p class="note askleft" id="askleft">Charged ' + esc(nCredits(pro.charged)) + " for the last question.</p>";
    else h += '<p class="note askleft" id="askleft" aria-live="polite"></p>';
    // the saved code, always copyable (for another device); the "Paid!" box itself is at the top of the view
    var saved = stored("ait.code");
    if (!pro.paid && saved) {
      h += '<p class="note codeline">Your code: <b class="code">' + esc(saved) + '</b> <button type="button" class="linkbtn" data-copycode="1">Copy</button>' +
        ' <span id="copymsg" aria-live="polite"></span></p>';
    }
    if (pro.notice) h += '<p class="note bad" role="status">' + esc(pro.notice) + "</p>";
    if ((short || pro.short || bal.total === 0) && !pro.busy) h += outboxHtml(bal, false);
    if (pro.asked && (pro.answers || pro.busy)) {
      var by = {};
      models.forEach(function (m) { by[m.id] = m; });
      h += '<div class="acards" id="acards">' + pro.asked.map(function (id) {
        var m = by[id] || { id: id, name: friendlyName(id), credits: 0 };
        var o = chosenOption(m, pro.askedChoice);
        var a = pro.answers && !pro.busy ? pro.answers.filter(function (x) { return x.id === id; })[0] : null;
        return '<section class="acard card" data-card="' + esc(id) + '"><h4>' + esc(m.name) +
          (isDefault(m, o) ? "" : '<span class="amodel"> · ' + esc(o.label) + "</span>") +
          (a && a.searched === true && !a.error ? ' <span class="searched">🌐 Searched the web</span>' : "") +
          '</h4><p class="atext" dir="auto"></p><p class="asrcs" hidden></p></section>';
      }).join("") + "</div>" + '<p class="note fastmodel">Answered by each company\'s fast model, unless you pick another (▾).</p>';
    }
    return h;
  }
  // the buy / code box when the credits aren't enough (Explore and Race)
  function outboxHtml(bal, forRace) {
    return '<div class="outbox card"><p><b>' + (bal.total === 0 ? "You have no credits left." : "Not enough credits for this " + (forRace ? "race." : "question.")) + "</b> " +
      (bal.total === 0 ? "" : "Untick some AIs, or ") + (CONFIG.PAY_LINK ? (bal.total === 0 ? "G" : "g") + "et " + CONFIG.PACK + " credits for $" + CONFIG.PRICE + "." : "") + "</p>" +
      (CONFIG.PAY_LINK ? '<a class="paybtn" href="' + safeUrl(CONFIG.PAY_LINK) + '">Get ' + CONFIG.PACK + " credits for $" + CONFIG.PRICE + "</a>" : "") +
      '<p class="note">Have a code?</p><div class="codebar"><input id="askcode" type="text" autocomplete="off" spellcheck="false" placeholder="AP-XXXX-XXXX-XXXX" maxlength="20" aria-label="Your code">' +
      '<button type="button" class="linkbtn" id="askapply">Apply code</button></div><p class="note" id="codemsg" aria-live="polite">' + esc(pro.codeMsg) + "</p>" +
      (forRace ? "" : '<p class="note">Free: open your question in each AI\'s own website (buttons below).</p>') + "</div>";
  }
  // ---- the model picker: a bottom sheet on phones, a small centered dialog on wide screens.
  // It lives outside #view (so redraws don't close it); per-model credits are shown only here.
  function modelSheetHtml(id) {
    var m = proModels().filter(function (x) { return x.id === id; })[0];
    if (!m) return "";
    var cur = chosenOption(m, getChoice()), wc = webCredits();
    return '<div class="sheetback" data-sheetclose="1"></div>' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheeth" data-sheet="' + esc(m.id) + '">' +
      '<div class="sheethead"><h3 id="sheeth">Choose the ' + esc(m.name) + ' model</h3>' +
      '<button type="button" class="sheetx" data-sheetclose="1" aria-label="Close"><span aria-hidden="true">×</span></button></div>' +
      '<div class="mopts" role="radiogroup" aria-labelledby="sheeth">' + (m.options || []).map(function (o, i) {
        var on = o === cur;
        return '<label class="mopt' + (on ? " on" : "") + '"><input type="radio" name="mopt" value="' + esc(o.model) + '"' + (on ? " checked" : "") + ">" +
          '<span class="mname"><b>' + esc(o.label) + "</b>" + (i === 0 ? "<small>Default, fast</small>" : "") + "</span>" +
          '<span class="mcred">' + esc(nCredits(o.credits)) + "</span></label>";
      }).join("") + "</div>" +
      '<p class="note">Credits per answer.' + (m.web === "native" ? " " + esc(m.name) + " searches the web by itself (no extra credits)."
        : " +" + esc(nCredits(wc)) + " if the question needs the web (news, prices, today…).") + " Choosing a model also ticks " + esc(m.name) + ".</p>" +
      '<button type="button" class="sheetdone" data-sheetclose="1">Done</button></div>';
  }
  function openSheet(id) {
    var html = modelSheetHtml(id);
    if (!html || !hasDom) return;
    var wrap = document.getElementById("modelsheet");
    if (!wrap) { wrap = document.createElement("div"); wrap.id = "modelsheet"; wrap.className = "sheetwrap"; document.body.appendChild(wrap); }
    wrap.innerHTML = html; wrap.hidden = false; pro.sheet = id;
    document.documentElement.classList.add("sheetopen");
    var first = wrap.querySelector('input[name="mopt"]:checked') || wrap.querySelector('input[name="mopt"]');
    if (first) first.focus();
  }
  function closeSheet() {
    var wrap = document.getElementById("modelsheet"), id = pro.sheet;
    if (wrap) { wrap.hidden = true; wrap.innerHTML = ""; }
    pro.sheet = null;
    document.documentElement.classList.remove("sheetopen");
    var back = id && document.querySelector('[data-models="' + id + '"]');
    if (back) back.focus();
  }
  function chooseModel(id, model) {
    setChoice(id, model);
    if (state.tab === "race") {                                          // on Race: tick it there (up to 4)
      var rp = getRacePick();
      if (rp.indexOf(id) < 0 && rp.length < RACE_MAX) setRacePick(rp.concat(id));
    } else {
      var pick = getPick();
      if (pick.indexOf(id) < 0) setPick(pick.concat(id));               // choosing a model also ticks that AI
    }
    pro.short = false;
    askRedraw();
    var wrap = document.getElementById("modelsheet");
    if (wrap) wrap.querySelectorAll(".mopt").forEach(function (l) { l.classList.toggle("on", !!l.querySelector("input:checked")); });
  }
  // right after the Stripe return: at the TOP of the Ask view, so it's on the first screen of a phone
  function paidBoxes() {
    if (pro.paid) {
      return '<div class="paidbox card" id="paidbox" role="status"><p><b>Paid! You got ' + esc(nCredits(pro.paid.credits || CONFIG.PACK)) + ".</b></p>" +
        '<p>Your code: <b class="code" id="paidcode">' + esc(pro.paid.code) + '</b> <button type="button" class="linkbtn" data-copycode="1">Copy</button></p>' +
        '<p class="note">Keep it to use on another device.</p><p class="note" id="copymsg" aria-live="polite"></p></div>';
    }
    if (pro.redeemErr) return '<div class="paidbox card" id="paidbox" role="status"><p><b>Payment not confirmed yet.</b></p><button type="button" class="linkbtn" id="redeemretry">Retry</button></div>';
    return "";
  }
  // a name the visitor knows, never a model id like "openai/…"
  function friendlyName(id, name) {
    var m = proModels().filter(function (x) { return x.id === id; })[0];
    var n = (m && m.name) || name || id;
    return /\//.test(n) ? String(n).split("/").pop() : n;
  }
  // web answers: [1][2] markers removed (like Perplexity's)
  function stripMarks(s) { return String(s || "").replace(/ ?\[\d+\]/g, ""); }
  // pure: the sources of one web answer, made safe: http/https only, no repeats, at most 5; title or the hostname
  function webSources(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (x) {
      if (out.length >= 5 || !x || typeof x.url !== "string" || !/^https?:\/\/[^\s"'<>]+$/i.test(x.url) || x.url.length > 2000) return;
      var host = (x.url.match(/^https?:\/\/([^\/?#:@]+)/i) || [])[1];
      if (!host || seen[x.url]) return;
      seen[x.url] = 1;
      var title = String(x.title || "").replace(/\s+/g, " ").trim().slice(0, 120) || host.replace(/^www\./i, "");
      out.push({ title: title, url: x.url });
    });
    return out;
  }
  // fill the cards after the view is drawn: plain text only
  function fourFill() {
    if (!hasDom || !pro.asked) return;
    pro.asked.forEach(function (id) {
      var card = document.querySelector('[data-card="' + id + '"]');
      if (!card) return;
      var a = pro.answers ? pro.answers.filter(function (x) { return x.id === id; })[0] : null;
      var t = card.querySelector(".atext");
      t.classList.toggle("muted", !a || !!(a && a.error));
      if (pro.busy || !a) t.textContent = "Thinking…";
      else if (a.error) t.textContent = a.error + " — credits returned";
      else t.textContent = plainAnswer(a.sources ? stripMarks(a.text) : a.text) + (a.cut ? " (cut short)" : "");
      t.setAttribute("dir", textDir(t.textContent));
      var box = card.querySelector(".asrcs"), srcs = !pro.busy && a && !a.error ? webSources(a.sources) : [];
      if (box) {
        box.textContent = "";
        box.hidden = !srcs.length;
        if (srcs.length) {
          // a small list: the label, then one link per line (no separators), each ending in "…" when too long
          var lab = document.createElement("span");
          lab.className = "asrcl"; lab.textContent = "Sources";
          box.appendChild(lab);
          srcs.forEach(function (s) {
            var l = document.createElement("a");
            l.href = s.url; l.target = "_blank"; l.rel = "noopener noreferrer"; l.textContent = s.title;
            box.appendChild(l);
          });
        }
      }
    });
  }

  function vAsk() {
    var links = askLinks(askQ);
    var h = CONFIG.ASK_API ? "<h2>" + esc(CONFIG.ASK_NAME) + "</h2><p class=\"sub\">" + esc(SUBS.ask) + "</p>" + paidBoxes()
      : "<h2>Ask them all</h2><p class=\"sub\">Type once, then open your question in each AI. Free: each AI's own website, nothing goes through this app.</p>";
    h += '<div class="askbox card"><label for="askq" class="sr">Your question</label>' +
      '<textarea id="askq" dir="' + textDir(askQ) + '" rows="4" maxlength="1500" placeholder="Type your question…" autocomplete="off">' + esc(askQ) + "</textarea>" +
      '<div class="askbar' + (askQ ? "" : " isempty") + '"><button type="button" class="linkbtn" id="askclear"' + (askQ ? "" : " hidden") + ">Clear question</button>" +
      '<button type="button" class="openall wide-only" id="askall">Open all</button></div>' +
      '<p class="note bad askqmsg" id="askqmsg" aria-live="polite"></p>' + (CONFIG.ASK_API ? proHtml() : "") + "</div>";
    if (CONFIG.ASK_API) h += '<h2 class="orh">Or open it in each AI (free)</h2>';
    h += '<p class="note phone-only">Phones open one tab per tap. Tap each AI below.</p><p class="note bad" id="askblocked" aria-live="polite"></p>';
    h += "<h3>Opens with your question</h3>" + '<ul class="asklist" id="asklinks">' + links.filter(function (l) { return l.mode === "link"; }).map(askLinkHtml).join("") + "</ul>";
    h += "<h3>Copy, then paste</h3><p class=\"sub\">These AIs don't take a question by link.</p>" +
      '<ul class="asklist" id="askcopies">' + links.filter(function (l) { return l.mode === "copy"; }).map(askCopyHtml).join("") + "</ul>" +
      '<p class="note" id="askmsg" aria-live="polite"></p>';
    if (CONFIG.ASK_API) h += '<p class="credits">Asking here sends your question to the AIs you pick, through this app\'s helper, to get the answers. It is not saved.</p>' +
      '<p class="credits">For the buttons above: some AIs ask you to log in first, and this app never sees that question or those answers.</p>';
    else h += '<p class="credits">Some AIs ask you to log in first. This app never sees your question or answers.</p>';
    return h;
  }

  // ---------------------------------------------------------------- Race (v15)
  // 2-4 AIs get the same task. Each AI is its OWN /ask (one model), all sent at once with one race_id, so the helper
  // counts them as one ask for its burst guard. Each lane fills the moment its answer arrives: place + seconds.
  // Credits are exactly as in Explore (per AI, + web credits when the web rule fires), shown before Start.
  var RACE_MIN = 2, RACE_MAX = 4, RACE_DEFAULT = ["chatgpt", "claude"];
  var PLACES = ["1st", "2nd", "3rd", "4th"];
  var race = { q: "", pick: null, busy: false, lanes: null, id: null, notice: "", short: false, timer: null, shownShort: false, charged: null };
  function getRacePick() {
    if (!race.pick) { var raw = null; try { raw = JSON.parse(stored("ait.racepick")); } catch (e) {} race.pick = Array.isArray(raw) ? raw : RACE_DEFAULT; }
    return cleanPick(race.pick, proModels()).slice(0, RACE_MAX);
  }
  function setRacePick(ids) { race.pick = cleanPick(ids, proModels()).slice(0, RACE_MAX); store("ait.racepick", JSON.stringify(race.pick)); }
  // a random race id: 16 characters of A-Z a-z 0-9 _ - (the helper accepts 16-64)
  function newRaceId() {
    var abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-", out = "", bytes = null;
    try { bytes = root.crypto.getRandomValues(new Uint8Array(16)); } catch (e) {}
    for (var i = 0; i < 16; i++) out += abc[(bytes ? bytes[i] : Math.floor(Math.random() * 256)) % 64];
    return out;
  }
  function raceLabel(n, cost, held) {
    if (n < RACE_MIN) return "Pick at least 2 AIs";
    return "Start race (" + (held > cost ? "up to " + nCredits(held) : nCredits(cost)) + ")";
  }
  function raceChip(m, pick, choice) {
    var on = pick.indexOf(m.id) >= 0, full = !on && pick.length >= RACE_MAX, o = chosenOption(m, choice), many = m.options && m.options.length > 1;
    return '<span class="chip' + (on ? " on" : "") + (full ? " full" : "") + '"><label class="chipl"><input type="checkbox" data-rpick="' + esc(m.id) + '"' +
      (on ? " checked" : "") + (full || race.busy ? " disabled" : "") + "><span><b>" + esc(m.name) + "</b>" +
      (isDefault(m, o) ? "" : '<small class="clabel">' + esc(o.label) + "</small>") + "</span></label>" +
      (many ? '<button type="button" class="chipmodel" data-models="' + esc(m.id) + '" aria-haspopup="dialog" aria-label="Choose ' + esc(m.name) + ' model"' +
        (race.busy ? " disabled" : "") + '><span aria-hidden="true">▾</span></button>' : "") + "</span>";
  }
  function laneSecs(ms) { return (ms < 1000 ? (ms / 1000).toFixed(2) : (ms / 1000).toFixed(1)) + " s"; }
  function laneHtml(l) {
    var done = l.ms != null, state2 = !done ? "running" : l.error ? "failed" : "done";
    var srcs = done && !l.error ? webSources(l.sources) : [];
    return '<section class="lane card ' + state2 + '" data-lane="' + esc(l.id) + '"><div class="lhead"><b>' + esc(l.name) + "</b>" +
      (l.label ? '<span class="amodel"> · ' + esc(l.label) + "</span>" : "") +
      (l.searched && !l.error ? ' <span class="searched">🌐 Searched the web</span>' : "") +
      '<span class="lright">' + (l.place ? '<span class="lplace p' + l.place + '">' + PLACES[l.place - 1] + "</span>" : "") +
      '<span class="ltime">' + (done ? laneSecs(l.ms) : "0.0 s") + "</span></span></div>" +
      '<div class="lbar" aria-hidden="true"><i></i></div>' +
      (done ? '<p class="ltext' + (l.error ? " bad" : "") + '" dir="' + textDir(l.error || l.text) + '">' + esc(l.error || l.text) + "</p>"
        : '<p class="ltext muted">Working…</p>') +
      (srcs.length ? '<p class="asrcs"><span class="asrcl">Sources</span>' + srcs.map(function (x) {
        return '<a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.title) + "</a>"; }).join("") + "</p>" : "") + "</section>";
  }
  function vRace() {
    var h = "<h2>Race</h2><p class=\"sub\">" + esc(SUBS.race) + "</p>";
    if (!CONFIG.ASK_API) return h + '<p class="note">Race needs the app\'s answer helper, which isn\'t set up here. Use Explore to open your question in each AI.</p>';
    var models = proModels(), pick = getRacePick(), wc = webCredits(), bal = balance(), choice = getChoice();
    var cp = costPreview(race.q, pick, models, choice, wc, Date.now()), short = pick.length >= RACE_MIN && bal.total < cp.held;
    race.shownShort = short;
    h += '<div class="askbox card racebox"><label for="raceq" class="sr">The task</label>' +
      '<textarea id="raceq" dir="' + textDir(race.q) + '" rows="3" maxlength="1500" placeholder="Type one task for all of them…" autocomplete="off"' +
      (race.busy ? " disabled" : "") + ">" + esc(race.q) + "</textarea>" +
      '<p class="note bad askqmsg" id="raceqmsg" aria-live="polite"></p>' +
      '<div class="pickhead"><h3 id="rpickh">Pick 2 to 4 AIs</h3><span class="pickq"><button type="button" class="linkbtn" id="rpicknone"' + (race.busy ? " disabled" : "") +
      ">Untick all</button></span></div>" +
      '<div class="chips racechips" role="group" aria-labelledby="rpickh">' + models.map(function (m) { return raceChip(m, pick, choice); }).join("") + "</div>" +
      costLineHtml(cp, pick, models, choice, wc, bal, "racecost") +
      '<button type="button" class="askfour" id="racego"' + (race.busy || pick.length < RACE_MIN || short ? " disabled" : "") + ">" +
      (race.busy ? "Racing…" : esc(raceLabel(pick.length, cp.base, cp.held))) + "</button>";
    if (race.charged != null && !race.busy) h += '<p class="note askleft">Charged ' + esc(nCredits(race.charged)) + " for this race.</p>";
    if (race.notice) h += '<p class="note bad" role="status">' + esc(race.notice) + "</p>";
    if ((short || race.short || bal.total === 0) && !race.busy) h += outboxHtml(bal, true);
    h += "</div>";
    if (race.lanes) h += '<div class="lanes" id="lanes">' + race.lanes.map(laneHtml).join("") + "</div>";
    h += '<p class="credits">Each AI gets your task through this app\'s helper, all at the same moment. Times include the trip over the internet. Your task is not saved.</p>';
    return h;
  }
  function raceSay(text) { var el = document.getElementById("raceqmsg"); if (el) el.textContent = text; }
  // pure: lanes in finish order: 1st, 2nd, 3rd …, then finished-with-an-error (in the order they ended), then running
  function laneOrder(lanes) {
    var rank = function (l) { return l.place ? l.place : l.ms != null ? 100 + l.ms / 1e9 : 1000; };
    return list(lanes).map(function (l, i) { return { l: l, i: i }; })
      .sort(function (a, b) { return rank(a.l) - rank(b.l) || (a.l.ms != null && b.l.ms != null ? a.l.ms - b.l.ms : 0) || a.i - b.i; })
      .map(function (x) { return x.l; });
  }
  // a lane finished: redraw it, then move the lanes into finish order with a short slide (FLIP); no slide with
  // reduced motion
  function laneUpdate(l) {
    var box = document.getElementById("lanes");
    var el = document.querySelector('[data-lane="' + l.id + '"]');
    if (!box || !el) return;
    var before = {};
    [].forEach.call(box.children, function (c) { var r = c.getBoundingClientRect(); before[c.getAttribute("data-lane")] = { x: r.left, y: r.top }; });
    el.outerHTML = laneHtml(l);
    race.lanes = laneOrder(race.lanes);
    var els = {};
    [].forEach.call(box.children, function (c) { els[c.getAttribute("data-lane")] = c; });
    race.lanes.forEach(function (x) { if (els[x.id]) box.appendChild(els[x.id]); });
    var still = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) return;
    race.lanes.forEach(function (x) {
      var c = els[x.id], b = before[x.id];
      if (!c || !b || !c.animate) return;
      var r = c.getBoundingClientRect(), dx = b.x - r.left, dy = b.y - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      c.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "translate(0,0)" }], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
  }
  function raceTick() {
    if (!race.lanes) return;
    var now = Date.now();
    race.lanes.forEach(function (l) {
      if (l.ms != null) return;
      var el = document.querySelector('[data-lane="' + l.id + '"] .ltime');
      if (el) el.textContent = ((now - l.t0) / 1000).toFixed(1) + " s";
    });
  }
  // what one lane shows when its ask didn't give an answer (the other lanes go on)
  function laneError(r) {
    if (!r) return "Couldn't connect.";
    var j = r.json || {};
    if (r.status === 402 && j.reason === "not_enough") return "Not enough credits for this AI.";
    if (r.status === 402 && j.reason === "daily_cap") return "Today's free credits are used up.";
    if (j.reason === "disabled" || j.error === "disabled") return "Answers are paused right now.";
    if (r.status === 429) return "Too quick: wait a few seconds, then start again.";
    if (r.status === 400 && (j.error === "unknown_model" || j.error === "bad_models")) { setModels(j.models); return "This model isn't available. Pick another (▾)."; }
    return "Something went wrong on our side.";
  }
  function startRace() {
    var q = race.q.trim(), pick = getRacePick();
    if (race.busy) return;
    if (!q) { raceSay("Type a task first."); var b = document.getElementById("raceq"); if (b) b.focus(); return; }
    if (pick.length < RACE_MIN) return;
    var models = proModels(), choice = getChoice(), by = {}, code = stored("ait.code"), id = newRaceId(), t0 = Date.now(), placed = 0, open = pick.length;
    models.forEach(function (m) { by[m.id] = m; });
    race.busy = true; race.id = id; race.notice = ""; race.short = false; race.charged = 0;
    race.lanes = pick.map(function (aid) {
      var m = by[aid], o = chosenOption(m, choice);
      return { id: aid, name: m.name, label: isDefault(m, o) ? "" : o.label, model: o.model, t0: t0, ms: null, place: null, text: "", error: "", searched: false, sources: null };
    });
    askRedraw();
    race.timer = setInterval(raceTick, 100);
    race.lanes.forEach(function (l) {
      var body = { question: q, models: [l.id], race_id: id };
      if (l.label) { body.choice = {}; body.choice[l.id] = l.model; }
      if (code) body.code = code;
      askApi("/ask", body, 150000).then(function (r) { return r; }, function () { return null; }).then(function (r) {
        if (race.id !== id) return;                                         // an older race
        l.ms = Date.now() - l.t0;
        var a = r && r.status === 200 && r.json.answers && r.json.answers[0];
        if (a && !a.error) {
          l.place = ++placed; l.text = plainAnswer(a.sources ? stripMarks(a.text) : a.text) + (a.cut ? " (cut short)" : "");
          l.searched = a.searched === true; l.sources = a.sources || null;
        } else l.error = a ? a.error + " — credits returned" : laneError(r);
        if (r && r.json) { setLeft(r.json); if (r.status === 200 && r.json.charged != null) race.charged += r.json.charged; }
        if (r && r.status === 402 && r.json.reason === "not_enough") race.short = true;
        laneUpdate(l);
        if (--open === 0) { race.busy = false; clearInterval(race.timer); race.timer = null; askRedraw(); }
      });
    });
  }
  // live cost line while the task is typed (the web rule depends on the words); redraw only when "enough" flips
  function raceCostUpdate() {
    if (!hasDom || !CONFIG.ASK_API || state.tab !== "race" || race.busy) return;
    var line = document.getElementById("racecost"), btn = document.getElementById("racego");
    if (!line || !btn) return;
    var models = proModels(), pick = getRacePick(), wc = webCredits(), bal = balance(), choice = getChoice();
    var cp = costPreview(race.q, pick, models, choice, wc, Date.now()), short = pick.length >= RACE_MIN && bal.total < cp.held;
    if (short !== race.shownShort) {
      var box = document.getElementById("raceq"), a = box ? box.selectionStart : null, b = box ? box.selectionEnd : null;
      askRedraw("#raceq");
      var nb = document.getElementById("raceq");
      if (nb && a != null) { try { nb.setSelectionRange(a, b); } catch (e) {} }
      return;
    }
    line.outerHTML = costLineHtml(cp, pick, models, choice, wc, bal, "racecost");
    btn.textContent = raceLabel(pick.length, cp.base, cp.held);
  }

  // ---------------------------------------------------------------- Sources view
  function vSources() {
    var h = "<h2>Sources</h2><p class=\"sub\">Where every number comes from. The app rebuilds itself every day. If a source doesn't answer, its last good copy is kept.</p>";
    h += '<ul class="rows card srcs">' + list(D.sources).map(function (s) {
      var st = stat(s.id);
      var line = st.ok ? '<span class="ok">✓ Working</span>'
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
        var line = o.ok ? '<span class="ok">✓ Working</span>'
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

  var VIEWS = { best: vBest, cost: vCost, releases: vReleases, news: vNews, agents: vAgents, ask: vAsk, race: vRace, sources: vSources };
  var MORE = { best: vBestMore, cost: vCostMore, releases: vReleasesMore, news: vNewsMore, agents: vAgentsMore };

  function viewHtml(tab, more) {
    if (tab === "ask") return vAsk();                          // works without any data
    if (tab === "race") return vRace();
    if (!D) return '<h2>No data yet</h2><p class="sub">' + (typeof navigator !== "undefined" && navigator.onLine === false
      ? "You're offline and nothing is saved yet. Connect once to load it." : "Connect to the internet once and reopen the app.") + "</p>";
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
    config: CONFIG, plainAnswer: plainAnswer, four: pro, pro: pro, textDir: textDir, selectionCost: selectionCost, cleanPick: cleanPick,
    chosenOption: chosenOption, cleanChoice: cleanChoice, getChoice: getChoice, setChoice: setChoice, pickNames: pickNames,
    modelSheetHtml: modelSheetHtml,
    proAIs: PRO_AIS, nCredits: nCredits, askLabel: askLabel, webSources: webSources, stripMarks: stripMarks, mainIds: mainIds,
    setModels: setModels, setWebCredits: setWebCredits, moreOpen: moreOpen, needsWeb: needsWeb, costPreview: costPreview, subs: SUBS, rankModels: rankModels, finderHtml: finderHtml, getFinder: getFinder, setFinder: setFinder,
    exploreFor: exploreFor, laneOrder: laneOrder, newsRow: newsRow, newsSummary: newsSummary, relCard: relCard, race: race, newRaceId: newRaceId, getRacePick: getRacePick, setRacePick: setRacePick,
    laneHtml: laneHtml, ctaOn: ctaOn, tipFor: tipFor, isoWeek: isoWeek, weekNumber: weekNumber, tipHtml: tipHtml, setLeft: setLeft, plainAnswer: plainAnswer, updateDecision: updateDecision, day: day, setQuestion: function (q) { askQ = String(q == null ? "" : q); },
    view: viewHtml, views: VIEWS, more: MORE };

  if (!hasDom) return;
  // the Ask tab's name lives in CONFIG.ASK_NAME (index.html carries the same words for the first paint)
  (function () {
    var nb = document.querySelector('#tabs [data-tab="ask"]');
    if (!nb) return;
    nb.setAttribute("aria-label", CONFIG.ASK_NAME);
    nb.querySelectorAll(".long, .short").forEach(function (x) { x.textContent = CONFIG.ASK_NAME; });
  })();
  store("ait.web", null);               // v13: the web switch is gone (the helper decides); forget the old setting

  // ---------------------------------------------------------------- page wiring
  var view = document.getElementById("view");
  var stamp = document.getElementById("stamp");

  // v16: no "Updated … ago" line any more (the header shows the brand); kept as a hook for older callers
  function setStamp() { if (stamp) stamp.textContent = ""; }
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
  // Tabs replace the history entry. "See more" ADDS one (marked aitMore), so the phone's Back returns to the
  // simple view; "‹ Back to the simple view" then just goes back (the history doesn't grow).
  function setHash(h, push) {
    if (location.hash === h) return;
    try { if (push) history.pushState({ aitMore: 1 }, "", h); else history.replaceState(null, "", h); } catch (e) {}
  }
  function go(tab, more, keepScroll, push) {
    state.tab = VIEWS_ALL.indexOf(tab) >= 0 ? tab : "best";
    state.more = !!more && !!MORE[state.tab];
    setHash("#" + state.tab + (state.more ? "-more" : ""), !!push && state.more);
    render();
    if (!keepScroll) window.scrollTo(0, 0);
  }

  // ---- new version: reload by itself only when nothing would be lost
  function lastSwReload() { try { return +sessionStorage.getItem("ait.swreload") || 0; } catch (e) { return 0; } }
  function updateDecision(now, last) {
    if (last && now - last < 60000) return "notice";                    // reloaded for an update a moment ago: no loop
    var a = hasDom && document.activeElement, typing = a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.value;
    return askQ.trim() || pro.busy || pro.sheet || sessionId || typing || (hasDom && document.querySelector("#paidbox")) ? "notice" : "reload";
  }
  function showUpdateNotice() {
    if (document.getElementById("swupdate")) return;
    var n = document.createElement("div");
    n.id = "swupdate"; n.className = "swupdate"; n.setAttribute("role", "status");
    n.innerHTML = 'New version ready · <button type="button" class="linkbtn" id="swreload">Refresh</button>';
    document.body.appendChild(n);
    document.getElementById("swreload").addEventListener("click", function () { location.reload(); });
  }

  // ---- Ask them all: links are rebuilt on every keystroke; nothing is stored or sent by the app
  function askSetQ(q) {
    askQ = q;
    var cl = hasDom && document.getElementById("askclear");
    if (cl) { cl.hidden = !askQ; cl.parentNode.classList.toggle("isempty", !askQ); }   // only when there is something to clear
    askCostUpdate();
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
  // the cost line and the Ask button follow the question as it is typed (the web rule depends on the words);
  // only when "enough credits" flips is the view redrawn (keeping the cursor where it was)
  function askCostUpdate() {
    if (!hasDom || !CONFIG.ASK_API || state.tab !== "ask" || pro.busy) return;
    var line = document.getElementById("askcost"), btn = document.getElementById("askfour");
    if (!line || !btn) return;
    var models = proModels(), pick = getPick(), wc = webCredits(), bal = balance(), choice = getChoice();
    var cp = costPreview(askQ, pick, models, choice, wc, Date.now()), short = pick.length > 0 && bal.total < cp.held;
    if (short !== !!pro.shownShort) {
      var box = document.getElementById("askq"), a = box ? box.selectionStart : null, b = box ? box.selectionEnd : null;
      askRedraw("#askq");
      var nb = document.getElementById("askq");
      if (nb && a != null) { try { nb.setSelectionRange(a, b); } catch (e) {} }
      return;
    }
    line.outerHTML = costLineHtml(cp, pick, models, choice, wc, bal);
    btn.textContent = askLabel(pick.length, cp.base, cp.held);
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
  document.addEventListener("input", function (e) {
    if (e.target && e.target.id === "askq") askSetQ(e.target.value);
    if (e.target && e.target.id === "raceq") { race.q = e.target.value; e.target.setAttribute("dir", textDir(race.q)); raceSay(""); raceCostUpdate(); }
  });

  // ---- Ask the AIs: the only calls to the helper (CONFIG.ASK_API). JSON in/out; nothing is stored but the code and the ticks.
  // rejects (=> "Couldn't connect") when there is no connection or no answer in time
  function askApi(path, body, waitMs) {
    var opt = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "GET" };
    opt.cache = "no-store"; opt.credentials = "omit";
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null, timer = null;
    if (ctrl) { opt.signal = ctrl.signal; timer = setTimeout(function () { ctrl.abort(); }, waitMs || 20000); }
    return fetch(CONFIG.ASK_API.replace(/\/+$/, "") + path, opt).then(function (r) {
      if (timer) clearTimeout(timer);
      return r.json().then(function (j) { return { status: r.status, json: j || {} }; }, function () { return { status: r.status, json: {} }; });
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }
  function askRedraw(focusSel) {
    if (state.tab !== "ask" && state.tab !== "race") return;
    var y = window.scrollY; render(); window.scrollTo(0, y);
    if (focusSel) { var f = document.querySelector(focusSel); if (f) f.focus(); }
  }
  function setLeft(j) {
    if (!j || (j.free_left == null && j.paid_left === undefined)) return;
    pro.left = { free_left: j.free_left != null ? j.free_left : (pro.left && pro.left.free_left), paid_left: j.paid_left !== undefined ? j.paid_left : (pro.left && pro.left.paid_left) };
    if (j.free_left != null) store("ait.freeCreditsUsed", Math.max(0, CONFIG.FREE - j.free_left));
  }
  function setModels(list) {
    if (!Array.isArray(list) || !list.length) return;
    var ok = list.filter(function (m) { return m && typeof m.id === "string" && typeof m.name === "string" && m.credits > 0; });
    if (!ok.length) return;
    var built = {};
    PRO_AIS.forEach(function (m) { built[m.id] = m; });
    pro.models = ok.map(function (m) {
      var b = built[m.id] || {};
      return { id: m.id, name: m.name, credits: m.credits,
               main: typeof m.main === "boolean" ? m.main : (b.main != null ? b.main : true),          // server flag, else built-in
               web: m.web === "native" ? "native" : m.web === "plugin" ? undefined : b.web,               // same for "searches by itself"
               options: cleanOptions(m.options, m.credits) || b.options || [{ model: "", label: "", credits: m.credits }] };
    });
  }
  // the server's model options for one AI: {model, label, credits > 0}, the default first (default:true, else the first)
  function cleanOptions(list, credits) {
    if (!Array.isArray(list)) return null;
    var ok = list.filter(function (o) { return o && typeof o.model === "string" && o.model && typeof o.label === "string" && o.label && o.credits > 0; })
      .map(function (o) { return { model: o.model, label: o.label, credits: o.credits, d: o.default === true }; });
    if (!ok.length) return null;
    var d = ok.filter(function (o) { return o.d; })[0] || ok[0];
    return [d].concat(ok.filter(function (o) { return o !== d; })).map(function (o) { return { model: o.model, label: o.label, credits: o.credits }; });
  }
  function setWebCredits(n) { if (typeof n === "number" && n >= 0 && n <= 50 && Math.floor(n) === n) pro.webCredits = n; }
  var PAUSED = "Answers here are paused right now. Open your question in each AI below.";           // only when switched off
  var NO_NET = "Couldn't connect. Check your internet and tap Ask again.";
  var OUR_SIDE = "Something went wrong on our side. Try again in a few minutes, or open your question in each AI below.";
  function askPro() {
    var q = askQ.trim(), pick = getPick();
    if (!q) { askSay("askqmsg", "Type a question first."); var b = document.getElementById("askq"); if (b) b.focus(); return; }
    if (!pick.length || pro.busy) return;
    pro.busy = true; pro.asked = pick; pro.askedChoice = getChoice(); pro.answers = null; pro.notice = ""; pro.short = false; pro.codeMsg = ""; pro.paid = null; pro.charged = null;
    askRedraw();
    var code = stored("ait.code"), body = { question: q, models: pick, choice: pro.askedChoice };   // choice: only non-defaults; the helper checks them and decides about the web
    if (code) body.code = code;
    askApi("/ask", body, 150000).then(function (r) {
      var j = r.json;
      pro.busy = false;
      if (r.status === 200 && j.answers) {
        pro.answers = j.answers; setLeft(j); pro.charged = j.charged != null ? j.charged : null;
      } else if (r.status === 402 && j.reason === "not_enough") {
        setLeft(j); pro.short = true; pro.asked = null;
      } else if (r.status === 402 && j.reason === "daily_cap") {
        setLeft(j); pro.asked = null;
        pro.notice = "Today's free credits are used up. Try again tomorrow, use a code, or open your question in each AI below.";
      } else if (r.status === 429) {
        pro.asked = null; pro.notice = "Please wait a few seconds before asking again.";
      } else if (r.status === 400 && j.error === "bad_models") {
        setModels(j.models); pro.asked = null; pro.notice = "The list of AIs changed. Check your ticks and ask again.";
      } else if (r.status === 400 && j.error === "unknown_model") {
        setModels(j.models); pro.asked = null; pro.notice = "The list of models changed. Check your choices (▾) and ask again.";
      } else if (j.reason === "disabled" || j.error === "disabled") {
        setLeft(j); pro.asked = null; pro.notice = PAUSED;            // switched off by the owner
      } else {
        setLeft(j); pro.asked = null; pro.notice = OUR_SIDE;          // balance_empty, server errors
      }
      askRedraw();
    }, function () { pro.busy = false; pro.asked = null; pro.notice = NO_NET; askRedraw(); });
  }
  function applyCode() {
    var box = document.getElementById("askcode");
    var c = (box && box.value || "").trim().toUpperCase();
    if (!/^A[TP]-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)) { askSay("codemsg", "Codes look like AP-XXXX-XXXX-XXXX."); return; }      // AT- = older codes
    askApi("/status?code=" + encodeURIComponent(c)).then(function (r) {
      var j = r.json;
      if (r.status === 200 && j.paid_left != null) {
        if (j.paid_left > 0) {
          store("ait.code", c); setLeft(j); setModels(j.models); setWebCredits(j.web_credits); pro.short = false; pro.notice = ""; pro.codeMsg = "";
          askRedraw(); askSay("askleft", "Code saved. You have " + nCredits(balance().total) + ".");
        } else askSay("codemsg", "That code has no credits left.");
      } else if (r.status === 200) askSay("codemsg", "That code wasn't found.");
      else askSay("codemsg", "Couldn't check the code right now. Try again in a moment.");
    }, function () { askSay("codemsg", "Couldn't connect. Check your internet and tap Apply code again."); });
  }
  var sessionId = null;
  function redeem() {
    pro.redeemErr = false;
    askApi("/redeem", { session_id: sessionId }).then(function (r) {
      if (r.status === 200 && r.json.code) {
        store("ait.code", r.json.code);
        pro.paid = { code: r.json.code, credits: r.json.credits || CONFIG.PACK };
        setLeft({ paid_left: r.json.paid_left }); pro.short = false;
        try { history.replaceState(null, "", location.pathname + "#ask"); } catch (e) {}
        loadLeft();
      } else pro.redeemErr = true;
      askRedraw();
      var box = document.getElementById("paidbox");
      if (box && box.scrollIntoView) box.scrollIntoView({ block: "start" });
    }, function () { pro.redeemErr = true; askRedraw(); });
  }
  function loadLeft() {
    if (!CONFIG.ASK_API) return;
    var code = stored("ait.code");
    askApi("/status" + (code ? "?code=" + encodeURIComponent(code) : "")).then(function (r) {
      if (r.status !== 200) return;
      var cta = ctaOn();
      setLeft(r.json); setModels(r.json.models); setWebCredits(r.json.web_credits);
      if (r.json.enabled === false) pro.notice = PAUSED;
      if (!pro.busy) askRedraw();
      if (cta && !ctaOn() && state.tab === "best" && !state.more) {         // free credits already spent: drop the banner
        var y = window.scrollY; render(); window.scrollTo(0, y);
      }
    }, function () {});
  }
  // model picker: Escape closes it; Tab stays inside it while it is open
  document.addEventListener("keydown", function (e) {
    if (!pro.sheet) return;
    if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
    if (e.key !== "Tab") return;
    var f = [].slice.call(document.querySelectorAll('#modelsheet .sheet button, #modelsheet input[name="mopt"]:checked'));
    if (!f.length) return;
    var i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    else if (i < 0) { e.preventDefault(); f[0].focus(); }
  });
  document.addEventListener("change", function (e) {
    if (e.target && e.target.name === "mopt" && pro.sheet) { chooseModel(pro.sheet, e.target.value); return; }
    if (e.target && /^f(task|prio|plan)$/.test(e.target.name || "")) {
      setFinder(e.target.name.slice(1), e.target.value);
      var fb = document.getElementById("finder");
      if (fb) { fb.outerHTML = finderHtml(); var again = document.querySelector('#finder input[name="' + e.target.name + '"][value="' + e.target.value + '"]'); if (again) again.focus(); }
      return;
    }
    var rp = e.target && e.target.getAttribute && e.target.getAttribute("data-rpick");
    if (rp) {
      var rids = [];
      document.querySelectorAll("[data-rpick]").forEach(function (x) { if (x.checked) rids.push(x.getAttribute("data-rpick")); });
      setRacePick(rids); race.short = false;
      askRedraw('[data-rpick="' + rp + '"]');
      return;
    }
    var p = e.target && e.target.getAttribute && e.target.getAttribute("data-pick");
    if (!p) return;
    var ids = [];
    document.querySelectorAll("[data-pick]").forEach(function (x) { if (x.checked) ids.push(x.getAttribute("data-pick")); });
    setPick(ids); pro.short = false;
    askRedraw('[data-pick="' + p + '"]');
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    var off = e.target.closest('#view [aria-disabled="true"]');
    if (off) { e.preventDefault(); askSay("askqmsg", "Type a question first."); var qb = document.getElementById("askq"); if (qb) qb.focus(); return; }
    if (e.target.closest("[data-sheetclose]")) { closeSheet(); return; }
    var mb = e.target.closest("[data-models]");
    if (mb) { e.preventDefault(); openSheet(mb.getAttribute("data-models")); return; }
    if (e.target.closest("#askfour")) { askPro(); return; }
    if (e.target.closest("#racego")) { startRace(); return; }
    var tb = e.target.closest("[data-try]");
    if (tb) {                                                            // "Ask it in Explore": tick that AI, choose that model
      var tp = tb.getAttribute("data-try").split("|");
      setPick([tp[0]]); setChoice(tp[0], tp[1]); go("ask");
      var qb2 = document.getElementById("askq"); if (qb2) qb2.focus();
      return;
    }
    if (e.target.closest("#rpicknone")) { setRacePick([]); race.short = false; askRedraw("#rpicknone"); return; }
    if (e.target.closest("#pickall")) { setPick(mainIds(proModels())); pro.short = false; askRedraw("#pickall"); return; }       // the 5 main ones
    if (e.target.closest("#moreais")) { pro.moreOpen = !moreOpen(getPick(), proModels()); askRedraw("#moreais"); return; }
    if (e.target.closest("#picknone")) { setPick([]); pro.short = false; askRedraw("#picknone"); return; }
    if (e.target.closest("#askapply")) { applyCode(); return; }
    if (e.target.closest("#redeemretry")) { redeem(); return; }
    if (e.target.closest("[data-copycode]")) {
      var cc = (pro.paid && pro.paid.code) || stored("ait.code");
      if (cc) askCopy(cc).then(function (ok) { askSay("copymsg", ok ? "Copied." : "Select the code and copy it."); });
      return;
    }
    if (e.target.closest("#askclear")) {
      var box = document.getElementById("askq");
      if (box) { box.value = ""; box.focus(); }
      askSetQ(""); askSay("askmsg", ""); askSay("askqmsg", ""); askSay("askblocked", "");
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
      if (!askQ.trim()) { askSay("askqmsg", "Type a question first."); return; }
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
    else if (t.hasAttribute("data-more")) { e.preventDefault(); go(t.getAttribute("data-more"), true, false, true); }
    else if (t.hasAttribute("data-less")) {
      if (history.state && history.state.aitMore) history.back();      // same as the phone's Back (popstate below)
      else go(state.tab, false);
    }
  });
  window.addEventListener("popstate", function () {
    var r = routeFor(location.hash);
    if (r && (r.tab !== state.tab || r.more !== state.more)) go(r.tab, r.more);
  });
  document.addEventListener("toggle", function (e) {
    var d = e.target;
    if (d && d.tagName === "DETAILS" && d.id) state.open[d.id] = d.open;
  }, true);
  window.addEventListener("hashchange", function () {
    var r = routeFor(location.hash);
    if (r && (r.tab !== state.tab || r.more !== state.more)) go(r.tab, r.more);
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
      .catch(function () { if (!navigator.onLine) showOffline(); })
      .then(function () { btn.classList.remove("spin"); });
  }
  btn.addEventListener("click", function () { pull(true); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { setStamp(); pull(false); } });
  window.addEventListener("online", function () { offline.hidden = true; pull(false); });
  // "Showing the last saved copy" only when there is one; with nothing saved, the view says so instead
  function showOffline() { if (D) offline.hidden = false; else { offline.hidden = true; if (state.tab !== "ask") render(); } }
  window.addEventListener("offline", showOffline);

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
    // A new version took over (after a deploy). Not on the first visit (no controller before). Reload once by itself
    // when that loses nothing; otherwise a small "New version ready · Refresh". Never a loop: at most one automatic
    // reload per 60 s (sessionStorage), and a second change in the same page only shows the notice.
    var hadSw = !!navigator.serviceWorker.controller, swDone = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadSw || swDone) { hadSw = true; return; }
      swDone = true;
      if (updateDecision(Date.now(), lastSwReload()) === "reload") {
        try { sessionStorage.setItem("ait.swreload", String(Date.now())); } catch (e) {}
        location.reload();
      } else showUpdateNotice();
    });
  }
})(typeof window !== "undefined" ? window : this);
