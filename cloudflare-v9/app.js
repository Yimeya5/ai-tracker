(function (root) {
  "use strict";
  // AI Pro (v17): a home screen with 3 sections, each with its tabs (+ a Sources view):
  //   Find your AI: Top Picks · Cost · Agents   Try it: Explore · Race   Updates: New Releases · News
  // Each tab shows a short simple view first, and "See more" opens the full details.
  // All picks are made by fixed rules in scripts/update_data.py; this file only shows them.
  var VERSION = "v17m-2026-11-11";   // the same as sw.js
  // ---- settings for Explore ("Ask the AIs", see worker/README.md). Leave ASK_API empty and the Ask tab is the free v8 tab.
  var CONFIG = {
    ASK_API: "https://ai-tracker-ask.ai-tracker-ask.workers.dev",            // the Worker URL, e.g. "https://ai-tracker-ask.<you>.workers.dev"
    PAY_LINK: "https://buy.stripe.com/test_fZu8wRan4foLbQwdEU2wU00",           // the Stripe Payment Link URL ($5 for 100 credits)
    FREE: 10, PACK: 100, PRICE: 5,  // free credits, credits in the $5 pack, its price: only for the wording; the Worker decides
    WEB: 2,                         // web search: extra credits per AI that searched (fallback; GET /status sends the Worker's web_credits)
    ASK_NAME: "Explore"             // the Ask tab's name: its heading and the first screen's banner
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
  var D = oneWinner(root.AI_DATA || null);

  var TABS = ["best", "cost", "releases", "news", "agents", "ask", "race"];
  var VIEWS_ALL = TABS.concat(["sources", "home"]);
  // v17: a home screen with 3 sections replaces the tab bar. Each section = a title + segmented tabs (today's views).
  var SECTIONS = [
    { id: "find", title: "Find your AI", line: "Top Picks, Cost, Agents", desc: "The best AI for each job, what it costs, and AI agents", tabs: [["best", "Top Picks"], ["cost", "Cost"], ["agents", "Agents"]],
      icon: '<path d="M8 4h8v6a4 4 0 0 1-8 0V4z"/><path d="M8 6H5.5A1.5 1.5 0 0 0 4 7.5 3.5 3.5 0 0 0 7.5 11H8"/><path d="M16 6h2.5A1.5 1.5 0 0 1 20 7.5a3.5 3.5 0 0 1-3.5 3.5H16"/><path d="M12 14v4"/><path d="M8 20h8"/>' },
    { id: "try", title: "Try it", line: "Explore, Race", desc: "Ask several AIs the same question and compare the answers", tabs: [["ask", "Explore"], ["race", "Race"]],
      icon: '<path d="M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>' },
    { id: "updates", title: "Updates", line: "New Releases, News", desc: "The newest AI models and the latest AI news", tabs: [["releases", "New Releases"], ["news", "News"]],
      icon: '<path d="M4 4h12a1 1 0 0 1 1 1v14a1 1 0 0 0 1 1H6a2 2 0 0 1-2-2V4z"/><path d="M17 8h2a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2"/><path d="M8 8h5M8 12h5M8 16h3"/>' }
  ];
  var lastTab = {};                                                   // the last tab per section, for this visit only
  function sectionOf(tab) { return SECTIONS.filter(function (x) { return x.tabs.some(function (t) { return t[0] === tab; }); })[0] || null; }
  var state = { tab: "home", more: false, open: {} };

  // ---------------------------------------------------------------- helpers
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // v16f: "Google DeepMind" is shown as "Google" wherever a model's maker is shown (display only; source names stay)
  function makerName(o) { return /^\s*google deepmind\s*$/i.test(String(o == null ? "" : o)) ? "Google" : o; }
  function safeUrl(u) { return /^https:\/\//.test(u || "") ? esc(u) : ""; }
  // v16h2: no links out of the app. A source is credited as plain text; the url stays in the data only.
  function ext(u, text) { return text; }
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
  // v17b: line icons (stroke = the text colour, or the accent where the CSS says so) instead of colour emoji
  var ICONS = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', cross: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>', bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    agent: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4.5"/><circle cx="12" cy="3.5" r="1"/><path d="M9 13v2M15 13v2"/>',
    chat: '<path d="M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>',
    writing: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    coding: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
    math: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
    pictures: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
    cheap: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.6 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/>',
    research: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
    voice: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    translate: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    dot: '<circle cx="12" cy="12" r="4"/>'
  };
  function ic(name, cls) {
    return '<svg class="ic' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      (ICONS[name] || ICONS.dot) + "</svg>";
  }
  // a task's icon by its id (never the data's emoji); an unknown task gets a plain dot
  function taskIcon(id, cls) { return ic(own(ICONS, id) && ["check", "cross", "warn", "bolt", "bulb", "globe", "agent", "plus", "trash", "dot"].indexOf(id) < 0 ? id : "dot", cls); }
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
  // v16h4: there is always ONE winner. New data says "lead" (one winner, runners-up in candidates, a short why).
  // Old data is turned into the same shape once, when it arrives: "tie" -> the first winner leads, the others become
  // runners-up; "none" -> the first candidate leads; nothing at all -> the card is hidden (p.hide). A why is written
  // from that model's tests: "Top 3 in N of M tests." Applies to picks, Find your AI tasks and the agents' best model.
  function topLine(c, n) { return "Leading pick."; }                 // v17e: no counts of tests or sources on screen
  function onePick(p) {
    if (!p || typeof p !== "object") return p;
    var w = list(p.winners), c = list(p.candidates);
    if (p.status === "none" || p.status === "tie" || (!w.length && c.length)) {
      var all = w.concat(c);
      if (!all.length) { p.hide = true; return p; }
      p.winners = [all[0]]; p.candidates = all.slice(1);
      p.status = "lead"; p.why = topLine(all[0], p.n || list(p.boards).length || 3);
    } else if (w.length > 1) { p.winners = [w[0]]; p.candidates = w.slice(1).concat(c); }
    else if (!w.length) p.hide = true;
    return p;
  }
  // v16h5: Mistral renamed Le Chat to Vibe. Old data that still says "Le Chat" is read as "Vibe" (formerly Le Chat).
  function renameApps(d) {
    var RENAMED = { "Le Chat": "Vibe" };                             // inside: runs at load, before the file's vars are set
    var c = d.cost, pv = d.finder && d.finder.privacy;
    list(c && c.apps).forEach(function (a) { if (a && own(RENAMED, a.app)) { a.formerly = a.formerly || a.app; a.app = RENAMED[a.app]; } });
    list(d.stalePrices).forEach(function (x) { if (x && own(RENAMED, x.app)) x.app = RENAMED[x.app]; });
    if (pv && pv.apps) Object.keys(RENAMED).forEach(function (o) {
      if (own(pv.apps, o) && !own(pv.apps, RENAMED[o])) { pv.apps[RENAMED[o]] = pv.apps[o]; delete pv.apps[o]; }
      if (Array.isArray(pv.order)) pv.order = pv.order.map(function (x) { return x === o ? RENAMED[o] : x; });
    });
  }
  function oneWinner(d) {
    if (!d || typeof d !== "object") return d;
    renameApps(d);
    list(d.picks).forEach(onePick);
    list(d.finder && d.finder.tasks).forEach(onePick);
    if (d.agents && d.agents.best) onePick(d.agents.best);
    return d;
  }
  function pickTitle(p) { var c = list(p && p.winners)[0] || list(p && p.candidates)[0]; return c && c.n ? c.n : ""; }
  function pickMaker(p) {
    var c = list(p && p.winners)[0] || list(p && p.candidates)[0], o = c ? makerName(c.o) : "";
    return o ? "by " + o : "";
  }
  var AA_CREDIT = "Artificial Analysis (artificialanalysis.ai)";
  // v16d: the screen never says "top 3" / "top 10" / "N of N tests". The ranking rules are unchanged; only the words.
  var BEST_RULE = "A model is called best only when the independent tests agree it is one of the strongest.";
  var AGENT_RULE = "Named best only when most independent agent tests agree it is one of the strongest.";
  var CHEAP_HOW = "The strongest models in the general tests, ordered by developer price (3 parts input to 1 part output). Price from OpenRouter.";
  // a sentence from the daily data that still speaks of "top 3" / "top 10" is replaced by a short neutral one
  function plainRule(text, fallback) { return /\btop[\s-]*(3|three|10|ten)\b|\btheir top\b/i.test(String(text || "")) ? fallback : String(text || ""); }
  function rankLine(r) {
    var s = src(r.src);
    var head = r.src === "aa" ? "Source: " + ext(r.url || "https://artificialanalysis.ai/", AA_CREDIT) + " · " + esc(r.board)
      : ext(r.url || s.url, esc(r.name)) + " · " + esc(r.board);
    if (!r.rank) return "<li>" + head + ': <span class="muted">not listed</span></li>';
    var bits = ["#" + r.rank];
    if (r.score != null) bits.push(r.lo != null && r.hi != null && r.lo !== r.hi ? r.score + " (" + r.lo + " to " + r.hi + ")" : String(r.score));
    if (r.votes != null) bits.push(n0(r.votes) + " votes");
    if (r.date) bits.push(day(r.date));
    return "<li" + (r.top3 ? ' class="agree"' : "") + ">" + head + ": <b>" + esc(bits.join(" · ")) + "</b></li>";
  }
  // "Fast" is guessed from the model's name (see FAST_WORDS in scripts/update_data.py), not measured. Label only.
  function fastNote() { return (D && D.fastNote) || "Fast = guessed from the model's name (Flash, Mini, Haiku…), not a speed test."; }
  function fastTag(isFast) {
    return isFast ? ' <span class="fast" title="' + esc(fastNote()) + '">' + ic("bolt") + " Fast</span>" : "";
  }
  function candDetail(c, showFast) {
    var h = '<div class="cand"><p class="cn"><b>' + esc(c.n) + "</b>" + (showFast ? fastTag(c.fast) : "") + (c.o ? " <span class=\"muted\">by " + esc(makerName(c.o)) + "</span>" : "") +
      (c.notSure ? ' <span class="badge new">New model</span>' : "") + "</p>";
    var note = c.votes != null ? n0(c.votes) + " LMArena votes on its main board." : "";   // v17d: no "not sure" reason
    if (note) h += '<p class="note">' + note + "</p>";
    if (c.price) h += '<p class="note">Developer price: <b>' + money(c.price.pin) + " in / " + money(c.price.pout) + " out</b> per million tokens · " +
      "Source: " + ext(c.price.u, esc(c.price.srcName)) + (c.price.date ? ", " + esc(day(c.price.date)) : "") + "</p>";
    h += '<ul class="ranks">' + list(c.ranks).map(rankLine).join("") + "</ul></div>";
    return h;
  }
  // Plain words for the simple view: no source names, no index names, no "per million tokens" without explaining it.
  var VOTES_SRC = "lmarena";
  function plainWhy(p) {
    var w = list(p.winners), n = p.n || list(p.boards).length || 3;
    if (p.id === "cheap") {
      return w.length ? "Cheapest to build apps with, among the strongest models. " +
        "Price is for developers (per million tokens ≈ 750,000 words). For the cheapest app plan, see Cost."
        : "None of the strongest models has a known price yet.";
    }
    if (p.status === "single") return "Rated #1 by people's votes.";
    if (p.status === "lead") return leadWhy(p.why);                  // "Top 3 in 2 of 3 tests, best on LMArena." -> "Leading pick, best on LMArena."
    var c = w[0] || {};
    var votes1 = list(c.ranks).some(function (r) { return r.src === VOTES_SRC && r.rank === 1; });
    return votes1 ? "Rated #1 by people's votes." : "";
  }
  function plainPrice(c) {
    if (!c || !c.price) return "";
    return '<p class="note">Price for developers: <b>' + money(c.price.pin) + "</b> to read and <b>" + money(c.price.pout) + "</b> to write, per million tokens (≈ 750,000 words).</p>";
  }
  function pickCard(p, idPrefix) {
    var id = idPrefix + p.id;
    var w = list(p.winners);
    var badge = "";
    if (w[0] && w[0].notSure) badge = '<span class="badge new">New model</span>';
    // v17b: one compact row (icon · task · winner · ›); the maker, badges and everything else open under it
    var h = '<details class="pick" id="' + esc(id) + '"' + (state.open[id] ? " open" : "") + "><summary>" +
      '<span class="pico" aria-hidden="true">' + taskIcon(p.id) + "</span>" +
      '<span class="plab">' + esc(p.label) + "</span>" +
      '<span class="pwin">' + esc(pickTitle(p)) + "</span>" +
      '<span class="chev" aria-hidden="true"></span></summary><div class="body">' +
      (pickMaker(p) || badge ? '<p class="who">' + esc(pickMaker(p)) + (badge ? (pickMaker(p) ? " " : "") + badge : "") + "</p>" : "");
    var why = plainWhy(p);
    if (why) h += '<p class="why">' + esc(why) + "</p>";
    if (p.id === "cheap") h += plainPrice(w[0]);
    if (p.status === "single" && list(p.candidates).length) h += '<p class="note">Next: ' + esc(list(p.candidates).slice(0, 3).map(function (c) { return c.n; }).join(", ")) + ".</p>";
    list(p["new"]).forEach(function (c) {
      var votes1 = list(c.ranks).some(function (r) { return r.src === VOTES_SRC && r.rank === 1; });
      h += '<p class="newnote"><span class="badge new">New model</span> <b>' + esc(c.n) + "</b>" +
        (votes1 ? " is rated #1 by people's votes." : " looks strong.") + "</p>";
    });
    if (p.usesAA) h += aaNote();
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
    return ctaOn() ? '<a class="askcta" href="#ask" data-tab="ask"><span aria-hidden="true">' + ic("chat") + '</span> <b>' + esc(CONFIG.ASK_NAME) + "</b> — " + CONFIG.FREE +
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
    return '<aside class="tip card" aria-labelledby="tiph"><p class="tiphead" id="tiph"><span aria-hidden="true">' + ic("bulb") + '</span> AI tip of the week</p>' +
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
  // v16f3 Find your AI extra tasks (voice): free with limits per third-party pages, NOT confirmed on the companies' own pages
  // (2026-11-06). Gemini 3.8 Live Extended (thinking) and the video models are left as paid until checked.
  FREE_MODELS.ChatGPT["gpt-live-1"] = "limited";
  FREE_MODELS.Grok = { "grok-voice-think-fast-2-0": "limited" };
  // the free plan's everyday model, for "Closest free option" when no tested model of a task is free
  var FREE_DEFAULT = { ChatGPT: "GPT-6 Luna", Claude: "Sonnet 5.5", Gemini: "Gemini Flash", Copilot: "Copilot" };
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function freeLevel(app, k) { return app && app.free && own(FREE_MODELS, app.app) && own(FREE_MODELS[app.app], k) ? FREE_MODELS[app.app][k] : ""; }
  function freeIn(app, k) { return !!freeLevel(app, k); }
  var PRIOS = [["quality", "Quality"], ["speed", "Speed"], ["price", "Price"], ["web", "Web search"], ["privacy", "Privacy"]];
  // "Privacy" is offered only when data.json has privacy rows (finder.privacy.apps); without them it is hidden
  function hasPrivacy() { var p = D && D.finder && D.finder.privacy; return !!(p && p.apps && typeof p.apps === "object" && Object.keys(p.apps).length); }
  function prios() { return PRIOS.filter(function (x) { return x[0] !== "privacy" || hasPrivacy(); }); }
  var PLANS = [["any", "Any"], ["free", "Free"], ["paid", "Paid"]];
  var finder = null;
  // Top Picks jobs + the extra Find-your-AI tasks from data.json "finder" (Research, Video, Voice & talking, Translation);
  // a task missing from the data (its source was down) is simply not offered
  function allTasks(d) { return list(d && d.picks).concat(list(d && d.finder && d.finder.tasks)); }
  function finderTasks() { return allTasks(D).filter(function (p) { return p.id !== "cheap" && list(p.winners).concat(list(p.candidates)).length; }); }
  // the app's privacy row (score 0..1, rank, one line) from data.json finder.privacy, by app name ("ChatGPT")
  function privacyFor(d, app) {
    var p = d && d.finder && d.finder.privacy;
    if (!p || !app || !p.apps) return null;
    return own(p.apps, app.app) ? p.apps[app.app] : app.formerly && own(p.apps, app.formerly) ? p.apps[app.formerly] : null;
  }
  function getFinder() {
    if (!finder) { var raw = null; try { raw = JSON.parse(stored("ait.finder")); } catch (e) {} finder = raw && typeof raw === "object" ? raw : {}; }
    var tasks = finderTasks().map(function (p) { return p.id; });
    var ok = function (v, l, d) { return l.indexOf(v) >= 0 ? v : d; };
    return { task: ok(finder.task, tasks, tasks[0] || ""), prio: ok(finder.prio, prios().map(function (x) { return x[0]; }), "quality"),
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
    var p = allTasks(d).filter(function (x) { return x.id === task; })[0];
    if (!p) return [];
    var seen = {}, all = list(p.winners).concat(list(p.candidates)).filter(function (c) { if (!c || seen[c.k]) return false; seen[c.k] = 1; return true; });
    var n = Math.max(1, p.finder ? list(p.boards).length : (p.n || 1));   // finder tasks: 1 source, maybe 2 boards
    return all.map(function (c) {
      var ranks = list(c.ranks).filter(function (r) { return r.rank != null; });
      var top10 = ranks.filter(function (r) { return r.rank <= 10; }).length, top3 = ranks.filter(function (r) { return r.rank <= 3; }).length;
      var quality = ranks.reduce(function (t, r) { return t + (r.rank <= 10 ? (11 - r.rank) / 10 : 0); }, 0) / n;
      var app = appFor(d, c.o), dev = devFor(d, c.k), plan1 = cheapestPlan(app);
      var blend = dev ? (3 * dev.pin + dev.pout) / 4 : null;
      var devScore = blend ? scale(blend, 0.2, 20) : 0.2;
      var ex = exploreFor(c.k), pv = privacyFor(d, app);
      var scores = {
        quality: quality,
        speed: c.fast ? 1 : 0.6 * devScore,
        // Free / Any: usable for free = cheapest (free 1, may be limited 0.85); no developer price alone = middle, not last
        price: plan === "paid" ? (plan1 ? scale(plan1.usd_month, 4, 250) : 0)
          : freeLevel(app, c.k) === "free" ? 1 : freeLevel(app, c.k) === "limited" ? 0.85 : blend ? devScore : 0.5,
        web: ex ? 1 : 0,
        privacy: pv && typeof pv.score === "number" ? pv.score : 0        // no privacy check for this maker = last
      };
      var score = prio === "quality" ? quality : 0.4 * quality + 0.6 * scores[prio];        // the chosen priority counts most
      return { k: c.k, n: c.n, o: c.o, fast: !!c.fast, score: score, quality: quality, top10: top10, top3: top3, tests: n,
               app: app ? app.app : "", free: freeIn(app, c.k), freeLevel: freeLevel(app, c.k), plan: plan1, dev: dev, blend: blend, explore: ex, privacy: pv, scores: scores };
    }).filter(function (r) {
      if (plan === "free") return r.free;
      if (plan === "paid") return !!r.plan;
      return true;
    }).sort(function (a, b) { return b.score - a.score || b.quality - a.quality || (a.n < b.n ? -1 : 1); });
  }
  function money(v) { return "$" + (v >= 10 ? Math.round(v) : (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, "")); }
  // "Plus" -> "Gemini Plus"; "Google AI Plus" / "Microsoft 365 Premium" / "SuperGrok Lite" already name a brand: as is
  var TIER_WORDS = /^(go|plus|pro|max|ultra|lite|team|teams|premium|basic|business|standard|individual|personal|starter|core|free|enterprise|heavy)$/i;
  function planName(app, name) {
    var n = String(name || ""), first = n.split(/\s+/)[0];
    if (!app || n.toLowerCase().indexOf(String(app).toLowerCase()) >= 0 || !TIER_WORDS.test(first)) return n;
    return app + " " + n;
  }
  function finderWhy(r, prio, plan) {
    var w = [];
    if (r.fast) w.push("Fast");
    if (plan === "paid" && r.plan) w.push(planName(r.app, r.plan.name) + " " + money(r.plan.usd_month) + "/month");
    else if (r.free) w.push(r.freeLevel === "limited" ? "May be limited on free" : "Free in " + r.app);
    else w.push("Paid plan needed" + (r.plan ? ": " + planName(r.app, r.plan.name) + " " + money(r.plan.usd_month) + "/month" : ""));
    if (prio === "web" && r.explore) w.push("Can search the web in " + CONFIG.ASK_NAME);
    if (prio === "privacy") {
      if (!r.privacy) w.push("No privacy check for this maker yet");
      else if (privBoth(r.privacy)) {                              // new data: both outside rankings, not one
        w.push("Privacy #" + privRank(r.app) + " of " + privCount() + " · " + privRanks(r.privacy));
        var ln = privLine(r.privacy);
        if (ln) w.push(ln);
      } else w.push("Privacy #" + privRank(r.app) + ": " + r.privacy.line);
    }
    return w;
  }
  // v16h5: the score is the average of 2 outside rankings (Incogni 2026, ObscureIQ). Old data (Incogni + checks) still works.
  function privBoth(x) { var r = x && x.ranks; return !!(r && r.incogni != null && r.obscureiq != null); }
  function privCount() { var p = D && D.finder && D.finder.privacy; return p && p.apps ? Object.keys(p.apps).length : 0; }
  function shortRank(v) { var n = Number(v); return isFinite(n) && n > 0 ? (n % 1 ? "joint #" + Math.floor(n) : "#" + n) : "–"; }   // 2.5 (shared) -> "joint #2"
  function privRanks(x) { return "Incogni 2026: " + shortRank(x.ranks.incogni) + " · ObscureIQ: " + shortRank(x.ranks.obscureiq); }
  // the app's one-line summary, minus a part that names only one ranking ("Ranked most private by Incogni")
  function privLine(x) {
    if (!privBoth(x)) return String(x && x.line || "");
    return String(x.line || "").split(/;\s*/).filter(function (t) { return t && !/incogni|obscureiq/i.test(t); }).join("; ");
  }
  function privRank(app) {
    var p = D && D.finder && D.finder.privacy, a = p && own(p.apps, app) ? p.apps[app] : null;
    return a && a.rank ? a.rank : list(p && p.order).indexOf(app) + 1 || "–";
  }
  // "How we score privacy": a tap-to-open row (same style as the source rows): each app's rank, score, its 5 checks with
  // the page each was read on, and the outside ranking(s) the score comes from (plain text, no links)
  function privacyHowHtml() {
    var p = D && D.finder && D.finder.privacy;
    if (!p || !p.apps) return "";
    var names = list(p.order).filter(function (a) { return own(p.apps, a); });
    Object.keys(p.apps).forEach(function (a) { if (names.indexOf(a) < 0) names.push(a); });
    var key = "finder|privacy", on = !!xopen[key];
    var apps = names.map(function (a) {
      var x = p.apps[a] || {};
      var checks = list(x.checks).map(function (c) {
        var src = c.src && c.src.label ? ' <span class="pnote">· Source: ' + esc(c.src.label) + "</span>" : "";
        return '<li><span class="' + (c.ok ? "pvok" : "pvno") + '" aria-label="' + (c.ok ? "Yes" : "No") + '">' + (c.ok ? ic("check") : ic("cross")) + "</span><span>" + esc(c.label) +
          (c.unverified ? ' <span class="pnote">(not confirmed)</span>' : "") + src + "</span></li>";
      }).join("");
      return '<div class="pvapp"><span class="pl"><span class="pln"><b>#' + esc(String(privRank(a))) + " " + esc(a) + "</b></span>" +
        '<span class="plp">' + esc(String(Math.round((x.score || 0) * 100))) + "/100</span></span>" +
        (privBoth(x) ? '<span class="pnote pvline">' + esc(privRanks(x)) + "</span>" : "") +
        (privLine(x) ? '<span class="pnote pvline">' + esc(privLine(x)) + "</span>" : "") + (checks ? '<ul class="pvchk">' + checks + "</ul>" : "") + "</div>";
    }).join("");
    var named = function (x, dflt) { return x ? esc(x.name || dflt) + (x.published ? " (" + esc(x.published) + ")" : "") : ""; };
    var inc = p.obscureiq ? '<p class="pvsrc">Sources: ' + [named(p.incogni, "Incogni privacy ranking"), named(p.obscureiq, "ObscureIQ privacy ranking")].filter(Boolean).join(" · ") + ".</p>"
      : p.incogni && p.incogni.url ? '<p class="pvsrc">Independent half: ' + ext(p.incogni.url, esc(p.incogni.name || "Incogni privacy ranking")) +
      (p.incogni.published ? " (" + esc(p.incogni.published) + ")" : "") + ".</p>" : "";
    return '<ul class="rows fpriv"><li class="xrow' + (on ? " xopen" : "") + '" data-xkey="' + key + '" role="button" tabindex="0" aria-expanded="' + (on ? "true" : "false") + '">' +
      '<span class="rn"><b>How we score privacy</b><small>' + esc(p.checked ? "Checked " + p.checked : "") + "</small></span>" +
      '<span class="xchev" aria-hidden="true"></span><div class="xmore">' + (p.how ? '<p class="pvhow">' + esc(p.how) + "</p>" : "") +
      (p.checksNote ? '<p class="pvhow">' + esc(p.checksNote) + "</p>" : "") +
      '<div class="plist">' + apps + "</div>" + inc + "</div></li></ul>";
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
      seg("fprio", prios(), f.prio, "Most important") +
      seg("fplan", PLANS, f.plan, "Plan") +
      '<div class="fresult" aria-live="polite">';
    var fell = "";
    if (!best) {                                                     // never empty: the task's overall #1 (or its first candidate)
      var anyR = rankModels(D, f.task, f.prio, "any"), t0 = allTasks(D).filter(function (x) { return x.id === f.task; })[0] || {};
      var c0 = list(t0.winners)[0] || list(t0.candidates)[0];
      best = anyR[0] || (c0 ? { k: c0.k, n: c0.n, o: c0.o, fast: !!c0.fast, score: 0, quality: 0, app: "", free: false, plan: null, scores: {} } : null);
      ranked = best ? [best] : [];
      if (f.plan === "free") {                                       // still point to the closest free app
        var near = anyR.filter(function (r) { var a = appFor(D, r.o); return a && a.free; })[0];
        fell = "No tested model for this task is free, so this is the overall #1." + (near ? " Closest free option: " + near.app + " Free (" +
          (FREE_DEFAULT[near.app] || "its free model") + ")." : "");
      } else fell = "No tested model fits this plan, so this is the overall #1 for this task.";
    }
    if (best) {
      var try1 = CONFIG.ASK_API && best.explore ? '<button type="button" class="trybtn" data-try="' + esc(best.explore.id + "|" + best.explore.model) + '">Ask it in ' + esc(CONFIG.ASK_NAME) + "</button>" : "";
      h += '<div class="fbest"><p class="fkick">Your best match</p><p class="fname"><b>' + esc(best.n) + "</b>" + (best.o ? ' <span class="muted">by ' + esc(makerName(best.o)) + "</span>" : "") + "</p>" +
        '<ul class="fwhy">' + finderWhy(best, f.prio, f.plan).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" + try1 + "</div>";
      if (fell) h += '<p class="note">' + esc(fell) + "</p>";
      h += '<details class="frank"' + (ranked.length > 1 ? " open" : " hidden") + '><summary>Full ranking (' + ranked.length + ")</summary><ol>" + ranked.map(function (r, i) {
        var pct = Math.round(Math.max(0.04, Math.min(1, r.score)) * 100);
        return '<li><span class="rpos">' + (i + 1) + '</span><span class="rbody"><b>' + esc(r.n) + "</b>" + (r.o ? ' <span class="muted">' + esc(makerName(r.o)) + "</span>" : "") +
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
    var task1 = allTasks(D).filter(function (x) { return x.id === f.task; })[0] || {};
    if (task1.note && list(task1.note.langs).length) {              // Translation: Hebrew / Yiddish results (Intento 2026)
      h += '<p class="note ftrans">' + list(task1.note.langs).map(function (x) {
        return x && x.line ? ext(x.url, esc(x.line)) : "";
      }).filter(Boolean).join("<br>") + "</p>";
    }
    var pvd = f.prio === "privacy" && hasPrivacy();
    h += '<p class="note fnote">Ranked from the tests, prices and plans in this app. ' +
      (pvd ? (D.finder.privacy.obscureiq ? "Privacy: the average of 2 independent privacy rankings, Incogni 2026 and ObscureIQ. "
        : "Privacy: half Incogni's 2026 privacy ranking, half 5 checks on each company's own pages. ") : "") +
      (f.prio === "speed" ? "Speed is a guess from the model's name and price, not a speed test. " : "") +
      (f.plan === "free" ? "Free plans have limits, and may not include every model. " : "") + "</p>" + (pvd ? privacyHowHtml() : "") + "</div></section>";
    return h;
  }
  // simple views name no sources; the credits (and CC BY attribution) are one tap away on the Sources page
  function plainCredits() {
    return '<p class="credits">Data: independent AI tests, the companies\' own pages and price lists. <a href="#sources" data-tab="sources">Sources and credits</a></p>';
  }
  function vBest() {
    var picks = list(D.picks).filter(function (p) { return !p.hide; });
    // v17b: the winners first (all six on the first phone screen), then the Explore banner, the finder and the tip
    var h = "<h2>Top Picks</h2><p class=\"sub\">" + esc(SUBS.best) + "</p>";   // the full rule is under See more
    h += '<div class="picklist card">' + (picks.map(function (p) { return pickCard(p, "p-"); }).join("") || '<p class="note">No picks yet.</p>') + "</div>";
    h += staleList(["lmarena", "aa", "livebench", "epoch", "eqbench", "lechmazur", "vals", "matharena"]);
    if (list(D.picks).some(function (p) { return p.usesAA; })) h += aaNote();
    h += '<div class="afterpicks">' + askCta() + finderHtml() + tipHtml(new Date()) + "</div>";
    h += '<p class="note pickslink"><a href="#best-more" data-more="best">See the test scores and how picks work</a></p>';
    h += moreButton("best") + plainCredits();
    return h;
  }
  // v17c: no "only 1 source / 1 test" notes on screen. The data's why / how text drops every sentence that says so;
  // what is left is shown (or the caller's fallback when nothing is left). Sentences end at . ! ? followed by a space,
  // so "Opus 5.5" stays whole.
  // v17d: also any sentence that counts how few sources or tests rated a model ("1 of 3 sources", "sources have tested")
  var ONE_RE = /\b(only|just)\s+1\s+(source|test)s?\b|\b1\s+(source|test)s?\s+only\b|\bbased on 1\b|\b\d+\s+of\s+\d+\s+sources?\b|\bsources?\s+ha(ve|s)\s+tested\b|\btested by\s+\d+\b|\bonly\s+\d+\s+(sources?|tests?)\b/i;
  // v17e: and any wording that counts how many tests or sources agree ("Top 3 in 2 of 3 tests", "at least 3 of", "all 4 sources")
  var COUNT_RE = /\b\d+\s+of\s+(the\s+)?\d+(\s+\w+){0,3}?\s+(tests?|sources?)\b|\bin\s+\d+\s+of\s+\d+\b|\bat least\s+\d+\s+of\b|\bof all\s+\d+\b|\ball\s+\d+\s+(\w+\s+)?(tests|sources)\b/i;
  function noOne(t) {
    return String(t || "").replace(/([.!?])\s+/g, "$1\u0000").split("\u0000").map(function (x) { return x.trim(); })
      .filter(function (x) { return x && !ONE_RE.test(x) && !COUNT_RE.test(x); }).join(" ");
  }
  // a lead winner's reason, short and neutral: the data's clauses minus any count ("Top 3 in 2 of 3 tests") or
  // "more than any other model"; what is left follows "Leading pick, " ("best on LMArena"), else just "Leading pick."
  function leadWhy(t) {
    var keep = String(t || "").split(/,\s+|[.!?](?:\s+|$)/).map(function (x) { return x.trim(); }).filter(function (x) {
      return x && !ONE_RE.test(x) && !COUNT_RE.test(x) && !/more than any other model/i.test(x);
    }).map(function (x) { return /^[A-Z][a-z]/.test(x) ? x.charAt(0).toLowerCase() + x.slice(1) : x; });
    return keep.length ? "Leading pick, " + keep.join(", ") + "." : "Leading pick.";
  }
  function vBestMore() {
    var h = backButton() + "<h2>Top Picks: full details</h2>";
    h += howPicks();
    list(D.picks).forEach(function (p) {
      if (p.hide) return;
      h += '<section class="job"><h3>' + taskIcon(p.id, "acc") + " " + esc(p.label) + ": " + esc(pickTitle(p)) + "</h3>";
      var pfb = p.id === "cheap" ? "Cheapest to build apps with, among the strongest models." : p.status === "best" ? BEST_RULE : plainWhy(p);
      var pw = p.status === "lead" ? plainWhy(p) : plainRule(noOne(p.why) || (p.status === "single" ? plainWhy(p) : ""), pfb) || pfb;   // v17e: never empty
      if (pw) h += '<p class="why">' + esc(pw) + "</p>";
      h += '<p class="note"><b>Sources used:</b> ' + esc(plainRule(noOne(p.how), p.id === "cheap" ? CHEAP_HOW : "The independent tests listed below.") || "The independent tests listed below.") + "</p>";
      h += '<ul class="boards">' + list(p.boards).map(function (b) {
        return "<li>" + (b.src === "aa" ? "Source: " + ext(b.url, AA_CREDIT) : ext(b.url, esc(b.name))) + " · " + esc(b.board) + (b.ai ? " (graded by AI)" : "") + (b.date ? " · " + esc(day(b.date)) : "") + "</li>";
      }).join("") + "</ul>";
      list(p.winners).forEach(function (c) { h += candDetail(c, true); });
      var others = list(p.candidates).concat(list(p["new"]));
      if (others.length) {
        h += '<details class="sub-more"><summary>Other candidates (' + others.length + ")</summary>" + others.map(function (c) { return candDetail(c, true); }).join("") + "</details>";
      }
      h += "</section>";
    });
    h += backButton() + credits(["lmarena", "aa", "livebench", "epoch", "eqbench", "lechmazur", "vals", "matharena", "openrouter"]);
    return h;
  }

  // ---------------------------------------------------------------- views: Cost
  // Each app shows where today's price came from (its own pricing page, or its own App Store listing),
  // when it was last checked, and a "stale" mark when that check is more than D.staleDays (30) days old.
  function staleMark(isStale) { return isStale ? ' <span class="stale" title="Not confirmed for more than ' + ((D && D.staleDays) || 30) + ' days">' + ic("warn") + ' stale</span>' : ""; }
  // a plan's price: "from $99.99/mo" when its note starts with "from" (the raw note isn't shown), else "$19.99/mo (note)"
  // v17b: a plan whose note lists several prices ("from; $99.99 or $199.99") has several tiers: show each price.
  // The prices come from the note, so they follow the data. Returns {prices: [99.99, 199.99], rest: "other note text"}.
  function planTiers(p) {
    var note = String(p && p.note || ""), parts = note.split(/\s*;\s*/), prices = [], rest = [];
    parts.forEach(function (x) {
      var m = x.match(/\$\s?\d[\d,]*(\.\d+)?/g);
      if (m && m.length > 1 && /^[\s$\d.,]*(or|and|\/)?[\s$\d.,or]*$/i.test(x)) prices = m.map(function (v) { return Number(v.replace(/[$,\s]/g, "")); });
      else if (x && !/^from$/i.test(x)) rest.push(x);
    });
    return { prices: prices.filter(function (v) { return isFinite(v) && v > 0; }), rest: rest.join("; "), from: /^from\b/i.test(note) };
  }
  function priceList(vs) { var m = vs.map(function (v) { return monthly(v).replace("/mo", ""); }); return m.length > 1 ? m.slice(0, -1).join(", ") + " or " + m[m.length - 1] + "/mo" : monthly(vs[0]); }
  function planPrice(p) {
    var note = String(p.note || ""), t = planTiers(p);
    if (t.prices.length > 1) return "<b>" + esc(priceList(t.prices)) + "</b>" + (t.rest ? " (" + esc(t.rest) + ")" : "");
    if (/^from\b/i.test(note)) return "<b>from " + esc(monthly(p.usd_month)) + "</b>";
    return "<b>" + esc(monthly(p.usd_month)) + "</b>" + (note ? " (" + esc(note) + ")" : "");
  }
  // v16f3: all of an app's plans, one per line, "Free" first, then cheapest first; shown when the row is tapped (.xmore)
  function planList(a) {
    var ps = list(a.plans).filter(function (p) { return p && p.usd_month != null; }).map(function (p, i) { return { p: p, i: i }; })
      .sort(function (x, y) { return x.p.usd_month - y.p.usd_month || x.i - y.i; }).map(function (x) { return x.p; });
    if (!ps.length && a.free !== true) return "";
    return '<span class="xmore"><span class="plist">' + (a.free === true ? '<span class="pl"><span class="pln">Free</span><span class="plp">$0</span></span>' : "") +
      ps.map(function (p) {
        var t = planTiers(p);
        if (t.prices.length > 1) return t.prices.map(function (v) {             // one line per tier ($99.99, $199.99)
          return '<span class="pl"><span class="pln">' + esc(p.name) + (t.rest ? ' <span class="pnote">(' + esc(t.rest) + ")</span>" : "") + "</span>" +
            '<span class="plp">' + esc(monthly(v)) + staleMark(p.stale) + "</span></span>";
        }).join("");
        var from = /^from\b/i.test(String(p.note || ""));
        return '<span class="pl"><span class="pln">' + esc(p.name) + (p.note && !from ? ' <span class="pnote">(' + esc(p.note) + ")</span>" : "") + "</span>" +
          '<span class="plp">' + (from ? "from " : "") + esc(monthly(p.usd_month)) + staleMark(p.stale) + "</span></span>";
      }).join("") + "</span></span>";
  }
  function appRow(a, full) {
    var src = a.src || { label: "Pricing page", url: a.page };
    var right = a.free ? '<span class="free">Free ' + ic("check") + "</span>" : '<span class="muted">No free plan</span>';
    var paid = a.cheapest ? "Paid plans from " + monthly(a.cheapest.usd_month) + staleMark(a.cheapest.stale) : esc(a.note || "No paid plan");
    var h = "<li><span class=\"rn\"><b>" + esc(a.app) + "</b>" + (a.formerly ? ' <span class="muted">(formerly ' + esc(a.formerly) + ")</span>" : "") +
      "<small>" + esc(a.maker) + " · " + paid + "</small>";
    if (full && list(a.plans).length) {
      h += '<span class="plans">' + list(a.plans).map(function (p) {
        return '<span class="plan">' + esc(p.name) + ": " + planPrice(p) + staleMark(p.stale) + "</span>";
      }).join("") + "</span>";
    }
    var read = a.readToday === undefined ? a.read_ok : a.readToday;
    h += '<small class="checked">Source: ' + ext(src.url || a.page, esc(src.label || "Pricing page")) +
      (read ? " · checked " + esc(day(a.checked)) : ' · <span class="warn">price last checked ' + esc(day(a.checked)) + "</span>") +
      staleMark(a.stale) + "</small></span>" +
      '<span class="rv">' + right + "</span>" + (full ? "" : planList(a)) + "</li>";      // the plans: a full-width line under the row
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
      '<p class="note">' + ic("bolt") + " " + esc(fastNote()) + "</p>";
    h += staleNote("openrouter");
    h += '<ul class="rows card">' + (dev.map(function (d) {
      return '<li><span class="rn"><b>' + esc(d.n) + "</b>" + fastTag(d.fast) + "<small>" + esc(makerName(d.o)) + '</small><small class="checked">Source: ' + ext(d.u, esc(d.srcName)) + (d.date ? ", " + esc(day(d.date)) : "") +
        '</small></span><span class="rv">' + money(d.pin) + " / " + money(d.pout) + "</span></li>";
    }).join("") || '<li class="muted">No developer prices yet.</li>') + "</ul>";
    h += backButton() + credits(["prices", "openrouter", "aa"]);
    return h;
  }

  // ---------------------------------------------------------------- views: New Releases
  // v16: each release is its own clean card: a coloured maker badge, the name (linked to the announcement), maker · date
  var HUES = [243, 268, 190, 152, 24, 330, 205, 45];
  function makerHue(o) { var h = 0, s2 = makerKey(o); for (var i = 0; i < s2.length; i++) h = (h * 31 + s2.charCodeAt(i)) >>> 0; return HUES[h % HUES.length]; }
  // v16f3: each maker's own logo (icons/makers/, from @lobehub/icons-static-svg 1.102.0), on a small white tile in both
  // themes (some logos are one dark colour). The ONE table: maker name (lower case) -> file. Unknown maker -> a letter.
  var MAKER_LOGOS = { "openai": "openai", "google": "google", "google deepmind": "google", "anthropic": "anthropic", "z.ai": "z-ai", "zhipu": "z-ai",
    "mistral": "mistral", "mistral ai": "mistral", "xai": "xai", "xiaomi": "xiaomi", "deepseek": "deepseek", "inception": "inception",
    "nvidia": "nvidia", "meta": "meta", "meta ai": "meta", "inclusionai": "inclusionai", "alibaba": "alibaba", "qwen": "alibaba",
    "tencent": "tencent", "moonshot": "moonshot", "moonshot ai": "moonshot", "minimax": "minimax", "liquid ai": "liquid-ai", "liquid": "liquid-ai",
    "stepfun": "stepfun", "cohere": "cohere", "microsoft": "microsoft", "amazon": "amazon", "aws": "amazon", "perplexity": "perplexity",
    "apple": "apple", "bytedance": "bytedance", "baidu": "baidu", "ibm": "ibm", "ai21": "ai21", "ai21 labs": "ai21" };
  function makerLogo(o) {
    var name = String(makerName(o) || ""), k = own(MAKER_LOGOS, name.trim().toLowerCase()) ? MAKER_LOGOS[name.trim().toLowerCase()] : "";
    var letter = esc((name.replace(/[^A-Za-z0-9]/g, "")[0] || "•").toUpperCase());
    if (!k) return '<span class="av" style="--h:' + makerHue(name) + '" aria-hidden="true">' + letter + "</span>";
    return '<span class="mlogo" aria-hidden="true"><img src="icons/makers/' + k + '.svg" alt="" width="24" height="24" loading="lazy" decoding="async">' +
      '<span class="mletter">' + letter + "</span></span>";                    // the letter shows only if the file can't load
  }
  // pure: newest first by release date (YYYY-MM-DD), the data's order for the same day, items without a date last
  function relSorted(items) {
    return list(items).map(function (r, i) { return { r: r, i: i, d: String((r && r.d) || "").slice(0, 10) }; }).sort(function (a, b) {
      if (!a.d !== !b.d) return a.d ? -1 : 1;
      return a.d < b.d ? 1 : a.d > b.d ? -1 : a.i - b.i;
    }).map(function (x) { return x.r; });
  }
  // v17l: the model's type ("ty" in the data); old data without it = no label
  var REL_TYPES = { text: "Text", image: "Image", video: "Video", voice: "Voice", music: "Music", audio: "Audio", embeddings: "Embeddings", world: "World", robotics: "Robotics" };
  function relType(r) { var t = String((r && r.ty) || "").toLowerCase(); return own(REL_TYPES, t) ? REL_TYPES[t] : ""; }
  function typeTag(r) { var t = relType(r); return t ? ' <span class="rtype">' + esc(t) + "</span>" : ""; }
  // the whole card is one button (it opens the model's sheet); the release date stays on the card
  function relCard(r, withSrc) {
    var o = String(makerName(r.o) || ""), fresh = r.d && (Date.now() - new Date(String(r.d).slice(0, 10) + "T12:00:00Z").getTime()) / 864e5 <= 3;
    var key = r.k || r.n;
    return '<li class="relcard">' + makerLogo(r.o) +
      '<span class="rb"><span class="rt"><button type="button" class="rtb" data-rel="' + esc(key) + '" aria-haspopup="dialog">' + esc(r.n) + "</button>" +
      (fresh ? ' <span class="badge new">NEW</span>' : "") + fastTag(r.fast) + typeTag(r) + "</span>" +
      '<span class="rm">' + (withSrc ? esc(o) + " · " + esc(day(r.d)) + " · " + esc(r.src) : (o ? "New model from " + esc(o) + " · " : "") + esc(day(r.d))) + "</span></span></li>";
  }
  function relRow(r) { return relCard(r, true); }
  // ---- the sheet about one released model: only facts we have (maker, date, where it was announced or listed, what its
  // name says), its places in the tests (Top Picks data), its prices (Cost data) and "Ask it" when this app can ask it
  var NAME_HINTS = [
    [/\b(flash|lite|mini|nano|haiku|air|turbo|instant)\b/i, "Its name marks a fast, lower-cost version."],
    [/\b(coder|code|codex|codestral|devstral)\b/i, "Its name marks a model for coding."],
    [/\b(video|veo|sora)\b/i, "Its name marks a model for video."],
    [/\b(image|imagen|banana|diffusion)\b/i, "Its name marks a model for images."],
    [/\b(legal|law)\b/i, "Its name marks a model for legal work."],
    [/\b(audio|voice|speech|tts|asr|whisper|music)\b/i, "Its name marks a model for sound or speech."],
    [/\b(vl|vision|omni)\b/i, "Its name marks a model that also reads images."],
    [/\b(embed|embedding|embeddings|rerank)\b/i, "Its name marks a model for search and embeddings."],
    [/\b(math|prover)\b/i, "Its name marks a model for math."]];
  function relFind(key) { return list(D && D.releases && D.releases.items).filter(function (r) { return (r.k || r.n) === key; })[0] || null; }
  function relSheetHtml(r) {
    var o = String(makerName(r.o) || ""), when = day(r.d), src = String(r.src || "");
    var desc = [(o ? o + " released " : "Released ") + String(r.n) + (when ? " on " + when : "") + "." +
      (relType(r) ? " " + relType(r) + " model." : "") + (src ? (r.official ? " Announced on " : " Listed on ") + src + "." : "")];
    var hint = NAME_HINTS.filter(function (x) { return x[0].test(String(r.n)); })[0];
    if (hint) desc.push(hint[1]);
    // its places in the tests (the Find your AI ranking, quality first), "Top pick" when it is a pick's winner
    var good = [];
    list(D && D.picks).forEach(function (p) {
      if (p.id === "cheap") return;
      var won = list(p.winners).some(function (c) { return c.k === r.k; });
      var ranked = rankModels(D, p.id, "quality", "any"), pos = -1;
      ranked.forEach(function (x, i) { if (pos < 0 && x.k === r.k) pos = i; });
      if (won) good.push("Top pick for " + p.label);
      else if (pos >= 0) good.push("#" + (pos + 1) + " in " + p.label + " tests");
    });
    var price = [], dev = devFor(D, r.k), app = appFor(D, r.o), lvl = freeLevel(app, r.k);
    if (lvl) price.push(lvl === "free" ? "Free in " + app.app : "In " + app.app + "'s free plan (may be limited)");
    if (dev) price.push("For developers: " + money(dev.pin) + " to read and " + money(dev.pout) + " to write, per million tokens");
    var ex = CONFIG.ASK_API ? exploreFor(r.k) : null;
    return '<div class="sheetback" data-relclose="1"></div>' +
      '<div class="sheet relsheet" role="dialog" aria-modal="true" aria-labelledby="relh"><div class="grabber" aria-hidden="true"></div>' +
      '<div class="sheethead"><div class="relhead">' + makerLogo(r.o) + '<div class="relht"><h3 id="relh">' + esc(r.n) + "</h3>" +
      '<p class="relsub">' + esc(o) + (o && when ? " · " : "") + esc(when) + "</p></div></div>" +
      '<button type="button" class="sheetx" data-relclose="1" aria-label="Close"><span aria-hidden="true">×</span></button></div>' +
      '<p class="reldesc">' + desc.map(esc).join(" ") + "</p>" +
      (good.length ? '<h4 class="relh4">Good at</h4><ul class="rellist">' + good.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      (price.length ? '<h4 class="relh4">Price</h4><ul class="rellist">' + price.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      (ex ? '<button type="button" class="sheetdone" data-relask="' + esc(ex.id + "|" + ex.model) + '">Ask it in ' + esc(CONFIG.ASK_NAME) + "</button>" : "") +
      (src ? '<p class="relsrc">Source: ' + esc(src) + "</p>" : "") + "</div>";
  }
  // simple view: "New model from Tencent · Nov 2", tap opens the model sheet; the source name (plain text) is under See more
  function relRowPlain(r) { return relCard(r, false); }
  function vReleases() {
    var items = relSorted(D.releases && D.releases.items);
    var h = "<h2>New Releases</h2><p class=\"sub\">" + esc(SUBS.releases) + "</p>" + staleNote("openrouter");
    h += '<ul class="rels">' + (items.slice(0, 6).map(relRowPlain).join("") || '<li class="relcard muted">Nothing new yet.</li>') + "</ul>";
    if (items.slice(0, 6).some(function (r) { return r.fast; })) h += '<p class="note">' + ic("bolt") + " " + esc(fastNote()) + "</p>";
    h += moreButton("releases", items.length > 6) + plainCredits();
    return h;
  }
  // v17l: every release ever recorded (hundreds), newest first, in batches of REL_BATCH: "Show more" (#relmore) adds the
  // next batch in place. relShown stays for the visit, so Back / reopening shows the same cards (and the same scroll).
  var REL_BATCH = 40, relShown = REL_BATCH;
  function relMonth(r) { return /^\d{4}-\d{2}/.test(String(r.d || "")) ? String(r.d).slice(0, 7) : "none"; }
  // cards from..to, with a month heading where the month changes (prev = the card before `from`)
  function relBatchHtml(items, from, to) {
    var lastMo = from > 0 ? relMonth(items[from - 1]) : "", body = "";
    items.slice(from, to).forEach(function (r) {
      var mo = relMonth(r);
      if (mo !== lastMo) { body += '<li class="mo">' + esc(mo === "none" ? "No date" : MON[+mo.slice(5, 7) - 1] + " " + mo.slice(0, 4)) + "</li>"; lastMo = mo; }
      body += relRow(r);
    });
    return body;
  }
  function relFastNote(items) {
    return items.some(function (r) { return r.fast; }) ? '<p class="note relfast">' + ic("bolt") + " " + esc(fastNote()) + "</p>" : "";
  }
  function vReleasesMore() {
    var items = relSorted(D.releases && D.releases.items), n = Math.min(items.length, Math.max(REL_BATCH, relShown));
    var h = backButton() + "<h2>New Releases</h2><p class=\"sub\">New AI models, newest first.</p>" + staleNote("openrouter");
    h += '<ul class="rels" id="relsall">' + (relBatchHtml(items, 0, n) || '<li class="relcard muted">Nothing new yet.</li>') + "</ul>";
    h += relFastNote(items.slice(0, n));
    if (n < items.length) h += '<button type="button" class="morebtn relmorebtn" id="relmore">Show more</button>';
    return h + backButton() + credits(["official", "openrouter", "aa"]);
  }
  // "Show more": the next batch is added to the list (no redraw, the scroll stays); the button goes after the last one
  function relShowMore(btn) {
    var items = relSorted(D.releases && D.releases.items), ul = document.getElementById("relsall");
    if (!ul) return;
    var from = ul.querySelectorAll("li.relcard").length, to = Math.min(items.length, from + REL_BATCH);
    ul.insertAdjacentHTML("beforeend", relBatchHtml(items, from, to));
    relShown = to;
    var fast = document.querySelector(".relfast");
    if (!fast && items.slice(from, to).some(function (r) { return r.fast; })) ul.insertAdjacentHTML("afterend", relFastNote(items.slice(from, to)));
    if (to >= items.length) {
      var next = ul.querySelectorAll("li.relcard")[from];
      btn.parentNode.removeChild(btn);
      var b = next && next.querySelector(".rtb");                          // keep the keyboard in the list
      if (b) b.focus({ preventScroll: true });
    }
  }

  // ---------------------------------------------------------------- views: Big news
  // News is read INSIDE the app (v16d): a tap opens the story view (#story/news/3 or #story/agents/1). No outside links.
  // The list shows a short line only when the data has a summary (n.x); nothing is made up.
  function newsSummary(n) {
    var x = String(n.x || "").replace(/\s+/g, " ").trim();
    return x.length > 220 ? x.slice(0, 217).replace(/\s+\S*$/, "") + "…" : x;
  }
  // v16f: the tab is called Updates, so a story tagged "News" in the data shows "Update" (display only)
  function tagName(t) { return /^\s*news\s*$/i.test(String(t)) ? "Update" : t; }
  function newsRow(n, src, i) {
    var sum = newsSummary(n);
    var body = (n.tag ? '<span class="tag">' + esc(tagName(n.tag)) + "</span>" : "") + '<b class="nt">' + esc(n.t) + "</b>" +
      (sum ? '<span class="nsum">' + esc(sum) + "</span>" : "") +
      '<small class="nmeta">' + esc(day(n.d)) + (n.s ? " · " + esc(n.s) : "") + ' <span class="go" aria-hidden="true">›</span></small>';
    return src ? '<li class="newsitem"><a class="nlink rn" href="#story/' + esc(src) + "/" + (+i) + '" data-story="' + esc(src) + "|" + (+i) + '">' + body + "</a></li>"
      : '<li class="newsitem"><span class="rn">' + body + "</span></li>";
  }
  function newsList(src) { return src === "agents" ? list(AG() && AG().news && AG().news.items) : list(D && D.bignews && D.bignews.items); }
  // the story view: Back, tag, headline, the summary in short paragraphs, source · date (plain text), Back again.
  // Text = n.x (the article's own summary) or else n.w; else one short muted line. Nothing invented.
  function storyHtml(src, i) {
    var n = newsList(src)[i], back = '<button type="button" class="backbtn storyback" data-storyback="1">‹ Back</button>';
    if (!n) return back + '<h2>Story not found</h2><p class="sub">This story is no longer in the list.</p>';
    // v16i1: an AI-written detailed summary (n.xd) first, marked as such; else (v16h6) the summary (n.x, the article's own
    // short text), then older paragraphs (n.w)
    var byAi = !!String(n.xd || "").trim();
    var paras = byAi ? String(n.xd).split(/\n\s*\n/).map(function (x) { return x.replace(/\s+/g, " ").trim(); }).filter(Boolean)
      : String(n.x || "").trim() ? String(n.x).split(/\n\s*\n/).map(function (x) { return x.replace(/\s+/g, " ").trim(); }).filter(Boolean) : [];
    if (!paras.length) paras = list(n.w).filter(function (x) { return typeof x === "string" && x.trim(); }).map(function (x) { return x.trim(); });
    var meta = [n.s ? String(n.s) : "", n.d ? day(n.d) : ""].filter(Boolean).join(" · ");
    return '<article class="story">' + back +
      (n.tag ? '<p class="stag"><span class="tag">' + esc(tagName(n.tag)) + "</span></p>" : "") +
      '<h2 class="sth" id="storyh" tabindex="-1" dir="auto">' + esc(n.t) + "</h2>" +
      (paras.length ? '<div class="sbody" dir="auto">' + paras.map(function (x) { return "<p>" + esc(x) + "</p>"; }).join("") + "</div>"
        : '<p class="snone muted">No summary from the source yet.</p>') +
      (meta ? '<p class="smeta">' + esc(meta) + "</p>" : "") +
      back.replace("storyback", "storyback bottom") + "</article>";
  }
  // the credit line under the news stays plain text
  function creditsText(ids) { return credits(ids).replace(/<a [^>]*href="(?!#)[^"]*"[^>]*>([\s\S]*?)<\/a>/g, "$1"); }
  function vNews() {
    var items = list(D.bignews && D.bignews.items);
    var h = "<h2>News</h2><p class=\"sub\">Only the big stories: new models, price changes and major company updates.</p>" + staleNote("news");
    h += '<ul class="rows card">' + (items.slice(0, 5).map(function (n, i) { return newsRow(n, "news", i); }).join("") || '<li class="muted">No updates right now.</li>') + "</ul>";
    return h + moreButton("news", items.length > 5) + creditsText(["official", "news"]);
  }
  function vNewsMore() {
    var items = list(D.bignews && D.bignews.items);
    var h = backButton() + "<h2>News: last 30 days</h2><p class=\"sub\">" + esc((D.bignews && D.bignews.rules) || "") + " From the companies' own pages, AI lab blogs and tech sites, picked by fixed word rules (opinion, lawsuits, rumors, partnerships and customer stories are left out). The same story from several sites is shown once, from the company's own page when there is one.</p>" + staleNote("news");
    h += '<ul class="rows card">' + (items.slice(0, 30).map(function (n, i) { return newsRow(n, "news", i); }).join("") || '<li class="muted">No updates right now.</li>') + "</ul>";
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
    return "<li" + (r.top3 ? ' class="agree"' : "") + ">" + head + ": <b>" + esc(bits.join(" · ")) + "</b></li>";
  }
  function agentWho(c, n) {
    return c.o ? "by " + esc(makerName(c.o)) : "";
  }
  function agentBestCard(full) {
    var b = AG().best || {}, w = list(b.winners);
    if (!w.length || b.hide) return "";                              // never a "no winner" card
    var h = '<section class="card abest"><h3><span class="ico sm" aria-hidden="true">' + ic("agent") + '</span>Best AI for agents</h3>' +
      '<p class="note">' + (full ? esc(plainRule(noOne(AG().rule), AGENT_RULE) || AGENT_RULE) : "The best AI model for agents.") + "</p>";
    var bwhy = b.status === "lead" ? leadWhy(b.why) : "";
    if (bwhy) h += '<p class="why">' + esc(bwhy) + "</p>";
    if (w.length) {
      h += '<ul class="rows">' + w.map(function (c) {
        return '<li><span class="rn"><b class="big">' + esc(c.n) + "</b>" + (full ? fastTag(c.fast) : "") + (agentWho(c, b.n) ? "<small>" + agentWho(c, b.n) + "</small>" : "") +
          '<small class="checked">' + list(c.ranks).filter(function (r) { return r.top3; }).map(function (r) {
            return ext(r.url, esc(r.name)) + " #" + r.rank + (r.date ? ", " + esc(day(r.date)) : "");
          }).join(" · ") + "</small></span></li>";
      }).join("") + "</ul>";
    }
    return h + "</section>";
  }
  function agentPrice(a) {
    if (a.cheapest) return "paid from " + monthly(a.cheapest.usd_month) + staleMark(a.cheapest.stale);
    return list(a.plans).length ? "" : "no price found";
  }
  function agentFree(a) {
    if (a.free === true) return '<span class="free">Free ' + ic("check") + "</span>";
    if (a.free === false) return '<span class="muted">Paid</span>';
    return "";                                                       // unknown: no badge
  }
  // v16f: the maker is left out when it is the app's own name ("Lindy · Lindy")
  function sameName(a) { return String(a.maker || "").trim().toLowerCase() === String(a.app || "").trim().toLowerCase(); }
  function nameMaker(a) { return "<b>" + esc(a.app) + "</b>" + (a.maker && !sameName(a) ? ' <span class="mk">· ' + esc(makerName(a.maker)) + "</span>" : ""); }
  // one price style on the Agents tab: "/mo", and "<source> · checked <date>" like the Cost tab
  function perMo(t) { return String(t || "").replace(/\/month\b/g, "/mo"); }
  function checkedLine(label, url, read, date, stale) {
    return "Source: " + ext(url, esc(label)) + (read ? " · checked " + esc(day(date)) : ' · <span class="warn">last checked ' + esc(day(date)) + "</span>") + staleMark(stale);
  }
  function agentSimpleRow(a) {
    var s = a.src || {}, only = list(a.plans);
    var bits = [];
    if (a.plansFrom && a.free === false && only.length === 1) bits.push("only with " + esc(only[0].name));
    else if (a.plansFrom) bits.push("with " + esc(a.plansFrom) + " plans");
    var price = agentPrice(a);
    if (price) bits.push(a.free === true && /^paid from /.test(price) ? "Free · " + price : price);
    var src = checkedLine(s.label || "Pricing page", s.url, s.readToday, s.checked || a.checked, s.stale);
    return '<li><span class="rn">' + nameMaker(a) + (bits.length ? "<small>" + bits.join(" · ") + "</small>" : "") + '<small class="checked">' + src + '</small></span><span class="rv">' + agentFree(a) + "</span>" + planList(a) + "</li>";
  }
  // Hand-checked agents (scripts/agents_static.json): price text exactly as checked by hand, never parsed.
  // The daily check only confirms the maker's page is still up ("page still up: <date>").
  function staticRow(a, full) {
    var s = a.src || {}, c = a.check || {};
    var h = '<li><span class="rn">' + nameMaker(a) + "<small>" + esc(perMo(a.priceText)) + "</small>";
    if (full) {
      h += "<small>" + esc(a.what || "") + "</small><small>Access: " + esc(a.access || "") + "</small>";
      if (list(a.plans).length) h += '<span class="plans">' + list(a.plans).map(function (p) {
        return '<span class="plan">' + esc(p.name) + ": <b>" + esc(monthly(p.usd_month)) + "</b></span>";
      }).join("") + "</span>";
    }
    h += '<small class="checked">Source: ' + ext(s.url, esc(s.label || "Official page")) + " · checked " + esc(day(a.checked)) + staleMark(a.stale || c.stale) + "</small>";
    if (full) h += '<small class="checked">' + (c.readToday ? "Page still up: " + esc(day(c.checked)) : '<span class="warn">Page last read ' + esc(day(c.checked)) + "</span>") + "</small>";
    return h + '</span><span class="rv">' + agentFree(a) + "</span>" + (full ? "" : planList(a)) + "</li>";
  }
  // Personal assistants (text or call them): no public prices, so they show access + a plain price line instead.
  function assistantRow(a, full) {
    var s = a.src || {};
    var src = checkedLine(s.label || "Home page", s.url, s.readToday, s.checked || a.checked, s.stale);
    var h = '<li><span class="rn">' + nameMaker(a) + "<small>" + esc(a.access || "") + " · " + esc(perMo(a.priceText)) + "</small>";
    if (full) h += "<small>" + esc(a.what || "") + "</small><small>Access: " + esc(a.access || "") + " · Price: " + esc(perMo(a.priceText)) + "</small>";
    return h + '<small class="checked">' + (full ? "Source: " : "") + src + "</small></span></li>";
  }
  function agentAppRow(a, full) {
    if (a.static) return staticRow(a, full);
    if (a.group === "assistants") return assistantRow(a, full);
    if (!full) return agentSimpleRow(a);
    var s = a.src || {}, pf = a.proof;
    var bits = a.maker && !sameName(a) ? [esc(makerName(a.maker))] : [];
    if (a.plansFrom) bits.push(a.free ? "comes with " + esc(a.plansFrom) + ", Free plan too" : "comes with paid " + esc(a.plansFrom) + " plans");
    else if (a.free === true) bits.push("Free plan");
    else if (a.free == null) bits.push("free plan not listed on the pricing page");
    var price = agentPrice(a);
    if (price) bits.push(price);
    var h = '<li><span class="rn"><b>' + esc(a.app) + "</b>" + (bits.length ? "<small>" + bits.join(" · ") + "</small>" : "");
    if (full) {
      h += "<small>" + esc(a.what) + (a.note ? " " + esc(a.note) : "") + (a.freeNote ? " " + esc(a.freeNote) + "." : "") + "</small>";
      if (list(a.plans).length) h += '<span class="plans">' + list(a.plans).map(function (p) {
        return '<span class="plan">' + esc(p.name) + ": " + planPrice(p) + staleMark(p.stale) + "</span>";
      }).join("") + "</span>";
    } else if (a.note) {
      h += "<small>" + esc(a.note) + "</small>";
    }
    var read = s.readToday;
    h += '<small class="checked">' + (a.plansFrom ? "Prices: " : "Source: ") + ext(s.url, esc(s.label || "Pricing page")) +
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
    return '<ul class="rows card">' + (items.map(function (x, i) { return newsRow(x, "agents", i); }).join("") || '<li class="muted">No agent updates in the last ' + ((AG().news && AG().news.days) || 14) + " days.</li>") + "</ul>";
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
    h += "<h3>Agent updates</h3>" + agentNewsRows(4);
    return h + moreButton("agents") + agentCredits();
  }
  function vAgentsMore() {
    if (!AG()) return backButton() + vAgents();
    var ag = AG(), b = ag.best || {};
    var h = backButton() + "<h2>AI agents: full details</h2>";
    h += '<div class="card prose"><h3>How the pick works</h3><p><b>Best AI for agents</b>: ' + esc(plainRule(noOne(ag.rule), AGENT_RULE) || AGENT_RULE) +
      " These tests are run by independent groups in different ways: people's votes (LMArena), hidden tasks (LiveBench) and real work tasks (APEX-Agents). If more than one model passes, the one with the best ranks is #1.</p>" +
      "<p>A test whose newest result is more than " + (ag.maxAge || 120) + " days old is left out. When too few tests have recent results, the model with the best ranks leads.</p>" +
      "<p>Vending-Bench 2, Remote Labor Index and LiveBench Browser are shown for information only; they don't change the pick. No AI is used to choose.</p></div>";
    h += agentBestCard(true);
    list(b.winners).forEach(function (c) {
      h += '<div class="cand card pad"><p class="cn"><b>' + esc(c.n) + "</b>" + fastTag(c.fast) + (c.o ? ' <span class="muted">by ' + esc(makerName(c.o)) + "</span>" : "") + "</p>" +
        '<ul class="ranks">' + list(c.ranks).map(agentRankLine).join("") + "</ul></div>";
    });
    if (list(b.candidates).length) {
      h += '<details class="sub-more"><summary>Other candidates (' + b.candidates.length + ")</summary>" + list(b.candidates).map(function (c) {
        return '<div class="cand"><p class="cn"><b>' + esc(c.n) + "</b>" + (c.o ? ' <span class="muted">by ' + esc(makerName(c.o)) + "</span>" : "") + '</p><ul class="ranks">' +
          list(c.ranks).map(agentRankLine).join("") + "</ul></div>";
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
          return '<li><span class="rk">' + (i + 1) + '.</span><span class="nm"><b>' + esc(r.n) + "</b>" + (r.o ? ' <span class="muted">' + esc(makerName(r.o)) + "</span>" : "") +
            '</span><span class="sc">' + esc(r.shown) + "</span></li>";
        }).join("") + "</ol></section>";
    });
    h += "<h3>Agent apps: every plan</h3><p class=\"sub\">Monthly US prices, read every day from each app's own pricing page or App Store listing. Agents that come with a ChatGPT, Claude or Gemini plan show that plan's price (same as the Cost tab) and the line on the company's page that says which plans include it. After " + ((D && D.staleDays) || 30) + " days without a check a price is marked stale.</p>" + staleNote("agentapps");
    h += agentGroups(true);
    h += "<h3>Agent updates: last " + ((ag.news && ag.news.days) || 14) + " days</h3><p class=\"sub\">" + esc((ag.news && ag.news.rules) || "") + "</p>" + agentNewsRows((ag.news && ag.news.max) || 8);
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
    { id: "lechat", name: "Vibe", mode: "copy", url: "https://chat.mistral.ai/chat", note: "Needs a login." }
  ];
  var askQ = "";                     // memory only while typing; an ASKED question is kept in Past questions on this device (v17j)
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
  // textContent (never innerHTML). The question is stored only in "Past questions" on this device (v17j, ait.askhist,
  // no file contents); the ticked AIs are (ait.pick).
  // main: shown in the main chips; the rest sit behind "More AIs". web "native": searches the web by itself (no web extra).
  // options: the models the visitor may choose for that AI; the FIRST is the default (credits = the default's).
  // Built-in copy of the Worker's table; GET /status sends the server's list, costs, flags and options, which win.
  // [model, label, credits, vision, ctx, max_in]: ctx / max_in = the context window (tokens) of the host it runs on (v17i)
  function opts(list) { return list.map(function (o) { var x = { model: o[0], label: o[1], credits: o[2] }; if (o[3] === false) x.vision = false; if (o[4]) x.ctx = o[4]; if (o[5]) x.max_in = o[5]; return x; }); }
  var PRO_AIS = [
    { id: "chatgpt", name: "ChatGPT", main: true, options: opts([["openai/gpt-6.1-terra", "GPT-6.1 Terra", 2, true, 1050000, 922000], ["openai/gpt-6.1-sol", "GPT-6.1 Sol", 3, true, 1050000, 922000], ["openai/gpt-6-astra", "GPT-6 Astra", 7, true, 1050000, 922000]]) },
    { id: "claude", name: "Claude", main: true, options: opts([["anthropic/claude-sonnet-5.5", "Sonnet 5.5", 2, true, 1000000], ["anthropic/claude-opus-5.5", "Opus 5.5", 4, true, 1000000], ["anthropic/claude-fable-5.1", "Fable 5.1", 7, true, 1000000]]) },
    { id: "gemini", name: "Gemini", main: true, options: opts([["google/gemini-3.8-flash", "3.8 Flash", 1, true, 1048576], ["google/gemini-4-argon", "Gemini 4 Argon", 3, true, 1048576]]) },
    { id: "grok", name: "Grok", main: true, options: opts([["x-ai/grok-4.7", "Grok 4.7", 1, true, 500000], ["x-ai/grok-4.3", "Grok 4.3", 1, true, 1000000]]) },
    { id: "deepseek", name: "DeepSeek", main: true, options: opts([["deepseek/deepseek-v4.1-flash", "V4.1 Flash", 1, true, 1048576], ["deepseek/deepseek-v4-pro-0813", "V4 Pro", 2, false, 1048576]]) },
    { id: "llama", name: "Llama", main: false, options: opts([["meta-llama/llama-4-maverick", "Llama 4 Maverick", 1, true, 524288], ["meta-llama/llama-4-scout", "Llama 4 Scout", 1, true, 1310720]]) },
    { id: "mistral", name: "Mistral", main: false, options: opts([["mistralai/mistral-large-4-0", "Large 4", 1, true, 524288], ["mistralai/mistral-medium-3-5", "Medium 3.5", 2, true, 262144]]) },
    { id: "perplexity", name: "Perplexity", main: false, web: "native", options: opts([["perplexity/sonar", "Sonar", 1, true, 127072], ["perplexity/sonar-pro", "Sonar Pro", 3, true, 200000], ["perplexity/sonar-reasoning-pro", "Sonar Reasoning Pro", 3, true, 128000]]) }
  ];
  PRO_AIS.forEach(function (m) { m.credits = m.options[0].credits; });
  var DEFAULT_PICK = ["chatgpt", "claude", "gemini"];
  var pro = { busy: false, asked: null, answers: null, left: null, notice: "", short: false, paid: null, redeemErr: false, files: [], fileMsg: "",
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
  function isOffline() { return typeof navigator !== "undefined" && navigator.onLine === false; }
  var OFF_NOTE = '<p class="note bad offnote" role="status">You\'re offline.</p>';
  // ---------------------------------------------------------------- files (v16f): attach documents and pictures in Explore and Race
  // Read IN THE BROWSER: PDF (pdf.js), Excel (SheetJS), Word and PowerPoint (JSZip + their XML), text files as they are;
  // pictures are shrunk (longest side 1600 px). The helper prices and checks them again (worker/src/index.js). Each tab
  // keeps its own list (pro.files, race.files). Libraries load only when a file of that type is attached.
  // v17i: no fixed text cut. Each AI gets as much of the files as ITS context window holds (fileBudget, the helper's rule);
  // the browser uploads no more than the largest ticked model reads. FILE_TEXT_MAX = the old cut, kept ONLY for an older
  // helper that sends no context windows (its limit). MAX_FILE_CHARS = the most the helper accepts (and the reader keeps).
  var FILE_MAX = 3, FILE_MAX_BYTES = 50 * 1024 * 1024, FILE_TEXT_MAX = 100000, MAX_FILE_CHARS = 4000000;
  var FILE_FREE_CHARS = 5000, FILE_CHARS_PER_CREDIT = 20000, IMAGE_CREDITS = 1;      // same rule as the helper's
  // the same numbers as worker/src/index.js (a test compares them): tokens per character and the per-model budget
  var TPC_LATIN = 0.3, TPC_NON_LATIN = 0.9, TPC_DIGIT = 0.3, TPC_FULL = 200000, TPC_SLICES = 200, TPC_SLICE = 1000;
  var FILE_OUT_TOKENS = 2250, FILE_CTX_SHARE = 0.9, FILE_PROMPT_TOKENS = 4000, FILE_IMAGE_TOKENS = 2000;
  var FILE_ACCEPT = ".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.pptx,.ppt,.png,.jpg,.jpeg,.webp";
  var FILES_REFUSED = "These files can't be sent. Remove one and try again.";
  var FILE_KINDS = { pdf: "pdf", docx: "docx", xlsx: "sheet", xls: "sheet", csv: "text", txt: "text", md: "text", pptx: "pptx",
                     png: "image", jpg: "image", jpeg: "image", webp: "image", doc: "olddoc", ppt: "oldppt" };
  function fileKind(name) { var m = /\.([a-z0-9]+)$/i.exec(String(name || "")); return m && own(FILE_KINDS, m[1].toLowerCase()) ? FILE_KINDS[m[1].toLowerCase()] : ""; }
  // pure: tokens per character of the texts (in order, read in place): 0.3, + 0.9 x the share of non-Latin letters
  // (Hebrew, Yiddish, Cyrillic, CJK...), + 0.3 x the share of digits; 200 slices of 1,000 characters above 200,000
  function fileTpc(texts) {
    var n = 0, i, seen = 0, non = 0, dig = 0;
    for (i = 0; i < texts.length; i++) n += texts[i].length;
    if (!n) return TPC_LATIN;
    function scan(g, len) {
      var k = 0, off = g;
      while (k < texts.length && off >= texts[k].length) { off -= texts[k].length; k++; }
      while (len > 0 && k < texts.length) {
        var s = texts[k], end = Math.min(s.length, off + len);
        for (var j = off; j < end; j++) {
          var c = s.charCodeAt(j);
          if (c >= 48 && c <= 57) dig++;
          else if (c >= 0x370 && (c < 0x2000 || c > 0x2bff) && c !== 0xfeff) non++;
        }
        seen += end - off; len -= end - off; k++; off = 0;
      }
    }
    if (n <= TPC_FULL) scan(0, n);
    else for (i = 0; i < TPC_SLICES; i++) scan(Math.floor(i * (n - TPC_SLICE) / (TPC_SLICES - 1)), TPC_SLICE);
    return Math.round((TPC_LATIN + TPC_NON_LATIN * non / seen + TPC_DIGIT * dig / seen) * 1000) / 1000;
  }
  // pure: characters of file text one model option reads (its context window, minus the answer, the instructions,
  // the question and its images); the helper's fileBudget
  function fileBudget(o, tpc, images) {
    var inTok = o.ctx - FILE_OUT_TOKENS;
    if (o.max_in && o.max_in < inTok) inTok = o.max_in;
    var avail = Math.floor(inTok * FILE_CTX_SHARE) - FILE_PROMPT_TOKENS - images * FILE_IMAGE_TOKENS;
    return Math.max(0, Math.floor(avail / tpc));
  }
  var fpMemo = { key: null, val: null }, tpcMemo = { key: null, tpc: 0 };
  // pure: what a tab's files send, for the ticked models' options (sel): the text from the start, files in order, cut
  // to what the LARGEST of them reads (cut = true when something is left out for everyone), the images, whether a file
  // is still being read, total = all the text read from the files, tpc = the rule's ratio on the text that is sent (the
  // helper measures the same text). An older helper (no ctx) = the old 100,000-character cut (legacy).
  function filePayload(files, sel) {
    var ok = [], reading = false, images = 0, ids = [];
    list(files).forEach(function (f) {
      if (f.status === "reading") { reading = true; return; }
      if (f.status !== "ok") return;
      ok.push(f); ids.push(f.id);
      if (f.kind === "image") images++;
    });
    var full = ok.filter(function (f) { return f.kind !== "image"; }).map(function (f) { return String(f.text || ""); });
    var total = full.reduce(function (t, x) { return t + x.length; }, 0);
    var legacy = (sel || []).some(function (o) { return !o || !o.ctx; }), cap = MAX_FILE_CHARS, idk = ids.join(",");
    if (legacy) cap = FILE_TEXT_MAX;
    else if (sel && sel.length && total) {
      if (tpcMemo.key !== idk || tpcMemo.files !== files) tpcMemo = { key: idk, files: files, tpc: fileTpc(full) };   // the whole text's ratio
      var t1 = tpcMemo.tpc;
      cap = Math.min(MAX_FILE_CHARS, Math.max.apply(null, sel.map(function (o) { return fileBudget(o, t1, o.vision === false ? 0 : images); })));
    }
    var key = idk + "|" + cap + "|" + (reading ? 1 : 0);
    if (fpMemo.key === key && fpMemo.files === files) return fpMemo.val;
    var left = cap, out = [], chars = 0, sent = [];
    ok.forEach(function (f) {
      var name = String(f.name).slice(0, 120);
      if (f.kind === "image") { out.push({ name: name, kind: "image", mime: f.mime, data: f.data }); return; }
      var t = String(f.text || "");
      if (t.length > left) t = t.slice(0, left);
      left -= t.length; chars += t.length; sent.push(t);
      out.push({ name: name, kind: "text", text: t });
    });
    var val = { attachments: out, chars: chars, total: total, texts: sent.length, images: images, cut: chars < total, reading: reading,
                legacy: legacy, tpc: legacy || !chars ? 0 : fileTpc(sent) };
    fpMemo = { key: key, files: files, val: val };
    return val;
  }
  // pure: the characters of file text one model option is sent (the helper's fileSent; an older helper: all that is sent)
  function fileSentFor(o, fp) {
    if (!fp || !fp.tpc || !o || !o.ctx) return fp ? fp.chars : 0;
    return Math.min(fp.chars, fileBudget(o, fp.tpc, o.vision === false ? 0 : fp.images));
  }
  // pure: extra credits for one AI's chosen model: ceil(max(0, chars it receives - 5,000) / 20,000) + 1 per image it can read
  function fileCreditsFor(option, fp) {
    if (!fp || !fp.attachments || !fp.attachments.length) return 0;
    return Math.ceil(Math.max(0, fileSentFor(option, fp) - FILE_FREE_CHARS) / FILE_CHARS_PER_CREDIT) + (option && option.vision === false ? 0 : fp.images * IMAGE_CREDITS);
  }
  // the ticked AIs of a tab with the model each will use: [{m, o}]
  function tabSel(which) {
    var models = proModels(), choice = getChoice(), pick = which === "race" ? getRacePick() : getPick();
    return models.filter(function (m) { return pick.indexOf(m.id) >= 0; }).map(function (m) { return { m: m, o: chosenOption(m, choice) }; });
  }
  function tabFiles(which) {
    return filePayload(which === "race" ? race.files : pro.files, tabSel(which).map(function (x) { return x.o; }));
  }
  // "A", "A and B", "A, B and C"
  function andList(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  // under the files, before Start: which ticked AIs will read only the start (nothing when every one reads it all)
  function fileReadNote(which, fp) {
    if (!fp.total) return "";
    if (fp.legacy) return fp.cut ? "Long file: only the first 100,000 characters are sent." : "";
    var short = tabSel(which).filter(function (x) { return fileSentFor(x.o, fp) < fp.total; }).map(function (x) { return aiModelName(x.m, x.o); });
    return short.length ? andList(short) + " will read only the first part of " + (fp.texts > 1 ? "these files." : "this file.") : "";
  }
  // in an answer card or a lane: how much of the file text that AI read (nothing when it read it all)
  function fileGotNote(chars, total, texts) {
    if (typeof chars !== "number" || !total || chars >= total) return "";
    var pct = Math.floor(chars * 100 / total), what = texts > 1 ? "files." : "file.";
    return pct < 1 ? "Read only the very start of the " + what : "Read the first " + pct + "% of the " + what;
  }
  function fileSize(n) { return n < 1024 ? n + " B" : n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1).replace(/\.0$/, "") + " MB"; }
  var FILE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
  var FILE_ICONS = {
    doc: FILE_ICON + '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>',
    sheet: FILE_ICON + '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/></svg>',
    slides: FILE_ICON + '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/></svg>',
    image: FILE_ICON + '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/></svg>'
  };
  var CLIP_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/></svg>';
  function fileIcon(kind) { return FILE_ICONS[kind === "sheet" ? "sheet" : kind === "pptx" ? "slides" : kind === "image" ? "image" : "doc"]; }
  // the Attach button, the limit line, the chips (icon, name, size or "Reading…", ×), the long-file notice and the error line
  function attachHtml(which, files, msg, busy) {
    var fp = tabFiles(which), full = list(files).length >= FILE_MAX, note = fileReadNote(which, fp);
    return '<div class="attach"><div class="attachbar"><button type="button" class="attachbtn" data-attach="' + which + '"' + (busy || full ? " disabled" : "") +
      ' aria-describedby="' + which + 'filelim">' + CLIP_ICON + "<span>Attach</span></button>" +
      '<span class="attachlim" id="' + which + 'filelim">Up to 3 files, 50 MB each</span>' +
      '<input type="file" class="sr" id="' + which + 'file" data-filein="' + which + '" multiple accept="' + FILE_ACCEPT + '" tabindex="-1" aria-hidden="true"></div>' +
      (list(files).length ? '<ul class="fchips">' + files.map(function (f) {
        return '<li class="fchip' + (f.status === "reading" ? " reading" : "") + '"><span class="ficon" aria-hidden="true">' + fileIcon(f.kind) + "</span>" +
          '<span class="fcname" title="' + esc(f.name) + '">' + esc(f.name) + '</span><span class="fcsize">' + (f.status === "reading" ? "Reading…" : esc(fileSize(f.size))) + "</span>" +
          '<button type="button" class="fcx" data-fremove="' + which + "|" + f.id + '" aria-label="Remove ' + esc(f.name) + '"' + (busy ? " disabled" : "") + '><span aria-hidden="true">×</span></button></li>';
      }).join("") + "</ul>" : "") +
      (note ? '<p class="note fnotice">' + esc(note) + "</p>" : "") +
      '<p class="note bad fmsg" id="' + which + 'filemsg" aria-live="polite">' + esc(msg || "") + "</p></div>";
  }
  function nCredits(n) { return n + (n === 1 ? " credit" : " credits"); }
  function proModels() { return pro.models && pro.models.length ? pro.models : PRO_AIS; }
  // pure: what a selection costs (unknown ids cost nothing and are ignored). With web on, every AI that doesn't
  // search by itself (web "native", i.e. Perplexity) costs webCredits more.
  // choice = {aiId: model id}; an unknown or missing model counts as that AI's default.
  function selectionCost(ids, models, web, webCredits, choice, fp) {
    var by = {};
    (models || PRO_AIS).forEach(function (m) {
      by[m.id] = chosenOption(m, choice).credits + (web && m.web !== "native" ? (webCredits == null ? CONFIG.WEB : webCredits) : 0) + fileCreditsFor(chosenOption(m, choice), fp);
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
  // an AI with the model it will use, never repeating the AI's name: "ChatGPT GPT-6 Astra", "Gemini 4 Argon", "Grok 4.7"
  function aiModelName(m, o) {
    var lab = o && o.label ? String(o.label) : "";
    if (!lab) return m.name;
    return lab.toLowerCase().indexOf(String(m.name).toLowerCase()) === 0 ? lab : m.name + " " + lab;
  }
  // every ticked AI with its model, default or not: "ChatGPT GPT-6 Astra · Claude Fable 5.1 · Gemini 4 Argon · Grok 4.7"
  function pickNames(ids, models, choice) {
    return (models || PRO_AIS).filter(function (m) { return (ids || []).indexOf(m.id) >= 0; }).map(function (m) {
      return aiModelName(m, chosenOption(m, choice));
    }).join(" · ");
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
  function costPreview(q, pick, models, choice, wc, now, fp) {
    var web = needsWeb(q, now);
    var base = selectionCost(pick, models, false, wc, choice, fp), held = selectionCost(pick, models, web, wc, choice, fp);
    var files = fp ? base - selectionCost(pick, models, false, wc, choice) : 0;          // what the attached files add
    return { web: web, base: base, held: held, hint: held > base, files: files };
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
  // "(+2 per AI if it needs the web)" only when the rule says it will search, and every ticked AI with its model.
  function costLineHtml(cp, pick, models, choice, wc, bal, id) {
    var chosen = (models || PRO_AIS).filter(function (m) { return pick.indexOf(m.id) >= 0; });
    return '<p class="costline" id="' + (id || "askcost") + '" aria-live="polite"><span class="cl">Uses <b>' + esc(nCredits(cp.base)) + "</b></span>" +
      (cp.files ? ' · <span class="cl">' + esc(String(cp.files)) + " for files</span>" : "") +
      (cp.best3 ? ' · <span class="cl">Best of 3</span>' : "") +
      ' · <span class="cl">You have <b>' + esc(nCredits(bal.total)) + "</b></span>" +
      (cp.hint ? '<small class="webhint">(+' + esc(String(wc)) + " per AI if it needs the web)</small>" : "") +
      (chosen.length ? '<small class="costnames">' + esc(pickNames(chosen.map(function (m) { return m.id; }), models, choice)) + "</small>" : "") +
      (bal.paid > 0 ? '<small class="split">' + bal.free + " free + " + bal.paid + " paid</small>" : "") + "</p>";
  }
  function proHtml() {
    var models = proModels(), pick = getPick(), wc = webCredits(), bal = balance(), choice = getChoice();
    var fp = tabFiles("ask"), cp = costPreview(askQ, pick, models, choice, wc, Date.now(), fp);
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
    h += '<button type="button" class="askfour" id="askfour"' + (pro.busy || !pick.length || short || isOffline() || fp.reading ? " disabled" : "") + ">" +
      (pro.busy ? "Asking…" : esc(askLabel(pick.length, cp.base, cp.held))) + "</button>" + (isOffline() && !pro.busy ? OFF_NOTE : "");
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
    if (pro.asked && pro.answers && !pro.busy) h += newBtnHtml("ask");
    if (pro.histMsg && !pro.busy) h += '<p class="note bad histmsg" role="status">' + esc(pro.histMsg) + "</p>";
    if (pro.asked && (pro.answers || pro.busy)) {
      var by = {};
      models.forEach(function (m) { by[m.id] = m; });
      h += '<div class="acards" id="acards">' + pro.asked.map(function (id) {
        var m = by[id] || { id: id, name: friendlyName(id), credits: 0 };
        var o = chosenOption(m, pro.askedChoice);
        var a = pro.answers && !pro.busy ? pro.answers.filter(function (x) { return x.id === id; })[0] : null;
        return '<section class="acard card" data-card="' + esc(id) + '"><h4>' + esc(m.name) +
          (isDefault(m, o) ? "" : '<span class="amodel"> · ' + esc(o.label) + "</span>") +
          (a && a.searched === true && !a.error ? ' <span class="searched">' + ic("globe") + " Searched the web</span>" : "") +
          (a && a.images_skipped === true && !a.error ? ' <span class="imgskip">Can\'t read images</span>' : "") +
          '</h4><p class="atext" dir="auto"></p>' +
          (a && !a.error && fileGotNote(a.file_chars, pro.fileTotal, pro.fileTexts) ? '<p class="lmeta fread">' + esc(fileGotNote(a.file_chars, pro.fileTotal, pro.fileTexts)) + "</p>" : "") +
          '<p class="asrcs" hidden></p></section>';
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
  // the chosen row's check mark (shown by CSS on .mopt.on)
  var SHEET_CHECK = '<span class="mcheck" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg></span>';
  function modelSheetHtml(id) {
    var m = proModels().filter(function (x) { return x.id === id; })[0];
    if (!m) return "";
    var cur = chosenOption(m, getChoice()), wc = webCredits();
    return '<div class="sheetback" data-sheetclose="1"></div>' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheeth" data-sheet="' + esc(m.id) + '">' +
      '<div class="grabber" aria-hidden="true"></div>' +
      '<div class="sheethead"><h3 id="sheeth">Choose the ' + esc(m.name) + ' model</h3>' +
      '<button type="button" class="sheetx" data-sheetclose="1" aria-label="Close"><span aria-hidden="true">×</span></button></div>' +
      '<div class="mopts" role="radiogroup" aria-labelledby="sheeth">' + (m.options || []).map(function (o, i) {
        var on = o === cur;
        return '<label class="mopt' + (on ? " on" : "") + '"><input type="radio" name="mopt" value="' + esc(o.model) + '"' + (on ? " checked" : "") + ">" +
          '<span class="mname"><b>' + esc(o.label) + "</b>" + (i === 0 || o.vision === false ? "<small>" + (i === 0 ? "Default, fast" : "") + (i === 0 && o.vision === false ? " · " : "") + (o.vision === false ? "Can't read images" : "") + "</small>" : "") + "</span>" +
          '<span class="mcred">' + esc(nCredits(o.credits)) + "</span>" + SHEET_CHECK + "</label>";
      }).join("") + "</div>" +
      '<p class="note">Credits per answer.' + (m.web === "native" ? " " + esc(m.name) + " searches the web by itself (no extra credits)."
        : " +" + esc(nCredits(wc)) + " if the question needs the web (updates, prices, today…).") + " Choosing a model also ticks " + esc(m.name) + ".</p>" +
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
  // closing: the sheet is gone at once (as before); a still copy slides out over 0.2 s, then is removed
  function sheetGhost(wrap) {
    if (!wrap || wrap.hidden || !wrap.firstChild || (root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    var g = wrap.cloneNode(true);
    g.removeAttribute("id"); g.classList.add("closing"); g.setAttribute("aria-hidden", "true"); g.inert = true;
    g.querySelectorAll("[id],[data-sheetclose],[data-sheet]").forEach(function (x) { x.removeAttribute("id"); x.removeAttribute("data-sheetclose"); x.removeAttribute("data-sheet"); });
    g.querySelectorAll("input").forEach(function (x) { x.removeAttribute("name"); x.disabled = true; });
    document.body.appendChild(g);
    setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 220);
  }
  function closeSheet() {
    var wrap = document.getElementById("modelsheet"), id = pro.sheet;
    sheetGhost(wrap);
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
  // tapping (or Space/Enter on) the row that is ALREADY chosen fires no "change": tick that AI the same way, only when it
  // is not ticked yet (Race: only with room for it), so a real change never runs twice and a ticked AI is left as it is
  function chooseSame(input) {
    var id = pro.sheet, m = id && proModels().filter(function (x) { return x.id === id; })[0], cur = m && chosenOption(m, getChoice());
    if (!cur || !input || input.value !== cur.model) return;          // another row: its "change" does the work
    var ticked = state.tab === "race" ? getRacePick() : getPick();
    if (ticked.indexOf(id) >= 0 || (state.tab === "race" && ticked.length >= RACE_MAX)) return;
    chooseModel(id, input.value);
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
          // a small list: the label, then one site per line as plain text (no links out), each ending in "…" when too long
          var lab = document.createElement("span");
          lab.className = "asrcl"; lab.textContent = "Sources";
          box.appendChild(lab);
          srcs.forEach(function (s) {
            var l = document.createElement("span");
            l.className = "asrc"; l.textContent = s.title;
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
    if (CONFIG.ASK_API && pro.view && !pro.busy) return h + savedAskHtml(pro.view) + histHtml("ask");
    h += '<div class="askbox card"><label for="askq" class="sr">Your question</label>' +
      '<textarea id="askq" dir="' + textDir(askQ) + '" rows="4" maxlength="1500" placeholder="Type your question…" autocomplete="off">' + esc(askQ) + "</textarea>" +
      (CONFIG.ASK_API ? attachHtml("ask", pro.files, pro.fileMsg, pro.busy) : "") +
      '<div class="askbar' + (askQ ? "" : " isempty") + '"><button type="button" class="linkbtn" id="askclear"' + (askQ ? "" : " hidden") + ">Clear question</button>" +
      '<button type="button" class="openall wide-only" id="askall">Open all</button></div>' +
      '<p class="note bad askqmsg" id="askqmsg" aria-live="polite"></p>' + (CONFIG.ASK_API ? proHtml() : "") + "</div>";
    if (CONFIG.ASK_API) h += histHtml("ask");
    if (CONFIG.ASK_API) h += '<h2 class="orh">Or open it in each AI (free)</h2>';
    h += '<p class="note phone-only">Phones open one tab per tap. Tap each AI below.</p><p class="note bad" id="askblocked" aria-live="polite"></p>';
    h += "<h3>Opens with your question</h3>" + '<ul class="asklist" id="asklinks">' + links.filter(function (l) { return l.mode === "link"; }).map(askLinkHtml).join("") + "</ul>";
    h += "<h3>Copy, then paste</h3><p class=\"sub\">These AIs don't take a question by link.</p>" +
      '<ul class="asklist" id="askcopies">' + links.filter(function (l) { return l.mode === "copy"; }).map(askCopyHtml).join("") + "</ul>" +
      '<p class="note" id="askmsg" aria-live="polite"></p>';
    if (CONFIG.ASK_API) h += '<p class="credits">Asking here sends your question and any attached files to the AIs you pick, through this app\'s helper, to get the answers. They are not kept on our server; past questions are saved only on this device.</p>' +
      '<p class="credits">For the buttons above: some AIs ask you to log in first, and this app never sees that question or those answers.</p>';
    else h += '<p class="credits">Some AIs ask you to log in first. This app never sees your question or answers.</p>';
    return h;
  }

  // ---------------------------------------------------------------- Race (v15; server-timed since v16f2)
  // 2-4 AIs get the same task in ONE request (POST /race). The helper checks everything and holds the credits first, then
  // starts every AI at the same moment and times each one itself (first word, answer time, words per second). It streams
  // one line per AI as it finishes. The lanes show ONLY the helper's numbers, and the places come from its answer times,
  // never from when a line reached this phone. "Best of 3" runs the race 3 times and shows the averages.
  // An older helper without /race (404): the v15 way (one /ask per AI with a race_id, timed here) is used instead.
  // Credits are exactly as in Explore (per AI, + web credits when the web rule fires, + files), shown before Start.
  var RACE_MIN = 2, RACE_MAX = 4, RACE_DEFAULT = ["chatgpt", "claude"];
  var RACE_FOOT = '<p class="credits">Timed on our server: AI speed only. Your task and files are not kept on our server; past races are saved only on this device.</p>';
  var PLACES = ["1st", "2nd", "3rd", "4th"];
  var race = { q: "", pick: null, busy: false, lanes: null, id: null, notice: "", short: false, timer: null, shownShort: false, charged: null, moreOpen: null,
               files: [], fileMsg: "", best3: false, rounds: 1, round: 0 };
  // the cost before Start: Best of 3 holds 3 rounds
  function raceCost(cp) {
    if (!race.best3) return cp;
    return { web: cp.web, base: cp.base * 3, held: cp.held * 3, hint: cp.hint, files: cp.files * 3, best3: true };
  }
  function raceMoreOpen(pick, models) {
    if (race.moreOpen != null) return race.moreOpen;
    return (models || PRO_AIS).some(function (m) { return !m.main && (pick || []).indexOf(m.id) >= 0; });
  }
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
  function secs1(ms) { return (Math.round(ms / 100) / 10).toFixed(1) + " s"; }            // the helper's times, to 0.1 s
  function avg(a) { return a.length ? a.reduce(function (t, x) { return t + x; }, 0) / a.length : null; }
  // a lane timed by the helper: place + answer time on the right; under the answer: answer time, words/s (words ÷ answer
  // time), first word, who served it
  function serverLaneHtml(l) {
    var done = l.ms != null, state2 = !done ? "running" : l.error ? "failed" : "done";
    var srcs = l.text && !l.error ? webSources(l.sources) : [], b3 = race.rounds > 1 && l.rounds > 1;
    var meta = "";
    if (l.total != null) {
      meta = (b3 ? "Average answer time <b>" : "Answer time <b>") + esc(secs1(l.total)) + "</b>" +
        (b3 && l.times.length > 1 ? ' <span class="lrounds">(' + esc(l.times.map(function (t) { return (Math.round(t / 100) / 10).toFixed(1); }).join(" · ")) + " s)</span>" : "") +
        (l.wps != null ? " · <b>" + esc(String(Math.round(l.wps))) + "</b> words/s" : "") +
        (l.first != null ? ' · <span class="lfirst">First word ' + esc(secs1(l.first)) + "</span>" : "") +
        (l.provider ? ' · <span class="lprov">Served by ' + esc(l.provider) + "</span>" : "");
    }
    var live = !done && l.text ? '<p class="lmeta live">Round ' + Math.min(race.round || 1, l.rounds) + " of " + l.rounds + "…</p>" : "";
    return '<section class="lane card ' + state2 + '" data-lane="' + esc(l.id) + '"><div class="lhead"><b>' + esc(l.name) + "</b>" +
      (l.label ? '<span class="amodel"> · ' + esc(l.label) + "</span>" : "") +
      (l.searched && !l.error ? ' <span class="searched">' + ic("globe") + " Searched the web</span>" : "") +
      (l.imgSkip && !l.error ? ' <span class="imgskip">Can\'t read images</span>' : "") +
      '<span class="lright">' + (l.place ? '<span class="lplace p' + l.place + '">' + PLACES[l.place - 1] + "</span>" : "") +
      (done && l.error ? "" : '<span class="ltime' + (done ? "" : " live") + '">' + (done ? esc(secs1(l.total)) : "0.0 s") + "</span>") + "</span></div>" +
      '<div class="lbar" aria-hidden="true"><i></i></div>' +
      (l.error ? '<p class="ltext bad">' + esc(l.error) + "</p>"
        : l.text ? '<p class="ltext" dir="' + textDir(l.text) + '">' + esc(l.text) + "</p>" + (l.note ? '<p class="lmeta">' + esc(l.note) + "</p>" : "") +
          (l.fileNote ? '<p class="lmeta fread">' + esc(l.fileNote) + (l.norank ? '<span class="norank"> Not ranked for the win.</span>' : "") + "</p>" : "")
        : '<p class="ltext muted">Working…</p>') +
      (meta ? '<p class="lmeta">' + meta + "</p>" : "") + live +
      (srcs.length ? '<p class="asrcs"><span class="asrcl">Sources</span>' + srcs.map(function (x) {
        return '<span class="asrc">' + esc(x.title) + "</span>"; }).join("") + "</p>" : "") + "</section>";
  }
  function laneHtml(l) {
    if (l.server) return serverLaneHtml(l);
    var done = l.ms != null, state2 = !done ? "running" : l.error ? "failed" : "done";
    var srcs = done && !l.error ? webSources(l.sources) : [];
    return '<section class="lane card ' + state2 + '" data-lane="' + esc(l.id) + '"><div class="lhead"><b>' + esc(l.name) + "</b>" +
      (l.label ? '<span class="amodel"> · ' + esc(l.label) + "</span>" : "") +
      (l.searched && !l.error ? ' <span class="searched">' + ic("globe") + " Searched the web</span>" : "") +
      (l.imgSkip && !l.error ? ' <span class="imgskip">Can\'t read images</span>' : "") +
      '<span class="lright">' + (l.place ? '<span class="lplace p' + l.place + '">' + PLACES[l.place - 1] + "</span>" : "") +
      (done && l.error ? "" : '<span class="ltime">' + (done ? laneSecs(l.ms) : "0.0 s") + "</span>") + "</span></div>" +
      '<div class="lbar" aria-hidden="true"><i></i></div>' +
      (done ? '<p class="ltext' + (l.error ? " bad" : "") + '" dir="' + textDir(l.error || l.text) + '">' + esc(l.error || l.text) + "</p>" +
          (!l.error && l.fileNote ? '<p class="lmeta fread">' + esc(l.fileNote) + (l.norank ? '<span class="norank"> Not ranked for the win.</span>' : "") + "</p>" : "")
        : '<p class="ltext muted">Working…</p>') +
      (srcs.length ? '<p class="asrcs"><span class="asrcl">Sources</span>' + srcs.map(function (x) {
        return '<span class="asrc">' + esc(x.title) + "</span>"; }).join("") + "</p>" : "") + "</section>";
  }
  function vRace() {
    var h = "<h2>Race</h2><p class=\"sub\">" + esc(SUBS.race) + "</p>";
    if (!CONFIG.ASK_API) return h + '<p class="note">Race needs the app\'s answer helper, which isn\'t set up here. Use Explore to open your question in each AI.</p>';
    if (race.view && !race.busy) return h + savedRaceHtml(race.view) + histHtml("race") + RACE_FOOT;
    var models = proModels(), pick = getRacePick(), wc = webCredits(), bal = balance(), choice = getChoice();
    var cp = raceCost(costPreview(race.q, pick, models, choice, wc, Date.now(), tabFiles("race"))), short = pick.length >= RACE_MIN && bal.total < cp.held;
    race.shownShort = short;
    h += '<div class="askbox card racebox"><label for="raceq" class="sr">The task</label>' +
      '<textarea id="raceq" dir="' + textDir(race.q) + '" rows="3" maxlength="1500" placeholder="Type one task for all of them…" autocomplete="off"' +
      (race.busy ? " disabled" : "") + ">" + esc(race.q) + "</textarea>" + attachHtml("race", race.files, race.fileMsg, race.busy) +
      '<p class="note bad askqmsg" id="raceqmsg" aria-live="polite"></p>' +
      '<div class="pickhead"><h3 id="rpickh">Pick 2 to 4 AIs</h3><span class="pickq"><button type="button" class="linkbtn" id="rpicknone"' + (race.busy ? " disabled" : "") +
      ">Untick all</button></span></div>" +
      '<div class="chips racechips" role="group" aria-labelledby="rpickh">' + models.filter(function (m) { return m.main; }).map(function (m) { return raceChip(m, pick, choice); }).join("") + "</div>";
    var rmore = models.filter(function (m) { return !m.main; });
    if (rmore.length) {
      var ropen = raceMoreOpen(pick, models), rOn = rmore.filter(function (m) { return pick.indexOf(m.id) >= 0; }).length;
      h += '<button type="button" class="linkbtn morebtn2" id="rmoreais" aria-expanded="' + (ropen ? "true" : "false") + '" aria-controls="rmorechips">More AIs' +
        (rOn ? " (" + rOn + " ticked)" : "") + ' <span aria-hidden="true">' + (ropen ? "▴" : "▾") + "</span></button>" +
        '<div class="chips racechips morechips" id="rmorechips" role="group" aria-label="More AIs"' + (ropen ? "" : " hidden") + ">" +
        rmore.map(function (m) { return raceChip(m, pick, choice); }).join("") + "</div>";
    }
    h += '<label class="b3"><input type="checkbox" role="switch" id="raceb3"' + (race.best3 ? " checked" : "") + (race.busy ? " disabled" : "") + ">" +
      '<span class="b3t"><b>Best of 3</b><small>Runs the race 3 times and shows each AI\'s average.</small></span></label>' +
      costLineHtml(cp, pick, models, choice, wc, bal, "racecost") +
      '<button type="button" class="askfour" id="racego"' + (race.busy || pick.length < RACE_MIN || short || isOffline() || tabFiles("race").reading ? " disabled" : "") + ">" +
      (race.busy ? "Racing…" : esc(raceLabel(pick.length, cp.base, cp.held))) + "</button>" + (isOffline() && !race.busy ? OFF_NOTE : "");
    if (race.charged && !race.busy) h += '<p class="note askleft">Charged ' + esc(nCredits(race.charged)) + " for this race.</p>";
    if (race.notice) h += '<p class="note bad" role="status">' + esc(race.notice) + "</p>";
    if ((short || race.short || bal.total === 0) && !race.busy) h += outboxHtml(bal, true);
    h += "</div>";
    if (race.lanes && !race.busy) h += newBtnHtml("race");
    if (race.histMsg && !race.busy) h += '<p class="note bad histmsg" role="status">' + esc(race.histMsg) + "</p>";
    if (race.lanes && race.partWin) h += partWinHtml(race.fileTexts);
    if (race.lanes) h += '<div class="lanes" id="lanes">' + race.lanes.map(laneHtml).join("") + "</div>";
    return h + histHtml("race") + RACE_FOOT;
  }

  // ---------------------------------------------------------------- v17j: "New race" / "New question" and the past ones
  // Saved on THIS device only (localStorage "ait.racehist" / "ait.askhist"), newest first, at most 50 each. An entry keeps
  // what was shown (question, AIs, answers, times, places, notes, file NAMES) but never a file's contents or its text.
  // A full or blocked storage never throws: the oldest entries go first, then one short line if it still can't be saved.
  var HIST_MAX = 50, HIST_KEYS = { race: "ait.racehist", ask: "ait.askhist" }, histMem = { race: null, ask: null };
  function histList(kind) {
    if (histMem[kind]) return histMem[kind];
    var raw = null;
    try { raw = JSON.parse(stored(HIST_KEYS[kind]) || "[]"); } catch (e) {}
    histMem[kind] = (Array.isArray(raw) ? raw : []).filter(function (x) {
      return x && typeof x === "object" && typeof x.id === "string" && typeof x.q === "string" && typeof x.t === "number";
    }).slice(0, HIST_MAX);
    return histMem[kind];
  }
  // write the list; on a full storage drop the oldest and retry. true = saved
  function histWrite(kind, list) {
    var l = list.slice(0, HIST_MAX);
    for (;;) {
      try { localStorage.setItem(HIST_KEYS[kind], JSON.stringify(l)); histMem[kind] = l; return true; }
      catch (e) {
        if (l.length <= 1) { histMem[kind] = list.slice(0, HIST_MAX); return false; }    // kept for this visit only
        l = l.slice(0, l.length - 1);
      }
    }
  }
  function histAdd(kind, entry) {
    var ok = histWrite(kind, [entry].concat(histList(kind)));
    fileState(kind).histMsg = ok ? "" : "Couldn't save this on this device.";
  }
  function histRemove(kind, id) {
    var st = fileState(kind);
    histWrite(kind, histList(kind).filter(function (x) { return x.id !== id; }));
    if (st.view && st.view.id === id) st.view = null;
  }
  function histClear(kind) {
    try { localStorage.removeItem(HIST_KEYS[kind]); } catch (e) {}
    histMem[kind] = []; fileState(kind).view = null;
  }
  function histId() { return Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36); }
  function histWhen(t) {
    var d = new Date(t);
    try { return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
    catch (e) { return d.toISOString().slice(0, 16).replace("T", " "); }
  }
  function fileNames(files) { return list(files).filter(function (f) { return f.status === "ok"; }).map(function (f) { return String(f.name).slice(0, 120); }); }
  // an AI's full name with the model it used (from the model id; the plain name when the model is no longer listed)
  function aiFullName(id, model) {
    var m = proModels().filter(function (x) { return x.id === id; })[0];
    if (!m) return friendlyName(id);
    var o = (m.options || []).filter(function (x) { return x.model === model; })[0] || chosenOption(m, null);
    return aiModelName(m, o);
  }
  function aiOrder(id) { var i = proModels().map(function (m) { return m.id; }).indexOf(id); return i < 0 ? 99 : i; }
  var LANE_KEEP = ["id", "name", "label", "ms", "place", "text", "error", "searched", "sources", "imgSkip", "fileNote", "note", "server", "rounds",
                   "times", "firsts", "wpss", "errs", "total", "first", "wps", "provider", "share", "norank"];
  // a finished race -> its entry (once per race)
  function saveRace() {
    if (!race.lanes || !race.lanes.some(function (l) { return l.ms != null; }) || race.savedId === race.id) return;
    race.savedId = race.id;
    var lanes = race.lanes.map(function (l) { var x = {}; LANE_KEEP.forEach(function (k) { if (l[k] !== undefined) x[k] = l[k]; }); return x; });
    var win = race.lanes.filter(function (l) { return l.place === 1; })[0];
    histAdd("race", { id: histId(), t: Date.now(), q: race.askedQ || "", files: race.fileNames || [], rounds: race.rounds || 1,
      charged: race.charged || 0, notice: race.notice || "", ais: race.lanes.slice().sort(function (a, b) { return aiOrder(a.id) - aiOrder(b.id); }).map(function (l) { return aiFullName(l.id, l.model); }),
      winner: win ? aiFullName(win.id, win.model) : "", lanes: lanes, partWin: race.partWin ? (race.fileTexts > 1 ? 2 : 1) : 0 });
  }
  // a finished Explore answer -> its entry
  function saveAsk() {
    if (!pro.asked || !pro.answers) return;
    var models = proModels(), by = {};
    models.forEach(function (m) { by[m.id] = m; });
    var cards = pro.asked.map(function (id) {
      var m = by[id] || { id: id, name: friendlyName(id), credits: 0 }, o = chosenOption(m, pro.askedChoice);
      var a = pro.answers.filter(function (x) { return x.id === id; })[0] || { error: "No answer this time" };
      return { id: id, name: m.name, label: isDefault(m, o) ? "" : o.label, full: aiModelName(m, o),
        text: a.error ? "" : plainAnswer(a.sources ? stripMarks(a.text) : a.text) + (a.cut ? " (cut short)" : ""),
        error: a.error ? a.error + " — credits returned" : "", searched: a.searched === true && !a.error, imgSkip: a.images_skipped === true && !a.error,
        fileNote: a.error ? "" : fileGotNote(a.file_chars, pro.fileTotal, pro.fileTexts), sources: a.error ? [] : webSources(a.sources) };
    });
    histAdd("ask", { id: histId(), t: Date.now(), q: pro.askedQ || "", files: pro.fileNames || [], charged: pro.charged || 0,
      ais: cards.map(function (c) { return c.full; }), cards: cards });
  }
  // the "New race" / "New question" button (only when results are shown and nothing is running)
  function newBtnHtml(kind) {
    return '<div class="newbar"><button type="button" class="newbtn" id="' + (kind === "race" ? "racenew" : "asknew") + '">' + ic("plus") +
      "<span>" + (kind === "race" ? "New race" : "New question") + "</span></button></div>";
  }
  function newStart(kind) {
    var st = fileState(kind);
    if (st.busy) return;
    st.files = []; st.fileMsg = ""; st.notice = ""; st.short = false; st.charged = null; st.view = null; st.histMsg = ""; st.histConfirm = false;
    if (kind === "race") {
      race.q = ""; race.lanes = null; race.id = null; race.ended = false; race.round = 0; race.partWin = false;
      if (race.timer) { clearInterval(race.timer); race.timer = null; }
    } else {
      askQ = ""; pro.asked = null; pro.answers = null; pro.askedChoice = null;
    }
    render();
    var box = document.getElementById(kind === "race" ? "raceq" : "askq");
    if (box) {
      var card = box.closest(".askbox") || box;
      try { card.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) { card.scrollIntoView(); }
      try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); }
    }
  }
  // the list of past races / questions (hidden when there is none)
  function histHtml(kind) {
    var items = histList(kind), st = fileState(kind), busy = st.busy, pre = kind === "race" ? "race" : "ask";
    if (!items.length) return "";
    var h = '<section class="hist" id="' + pre + 'hist" aria-labelledby="' + pre + 'histh"><div class="histhead"><h3 id="' + pre + 'histh">' +
      (kind === "race" ? "Past races" : "Past questions") + "</h3>" +
      (st.histConfirm ? '<span class="histconfirm"><span>Delete all?</span><button type="button" class="linkbtn histyes" id="' + pre + 'histyes">Delete</button>' +
        '<button type="button" class="linkbtn" id="' + pre + 'histno">Cancel</button></span>'
        : '<button type="button" class="linkbtn" id="' + pre + 'histclear"' + (busy ? " disabled" : "") + ">Clear all</button>") + "</div>" +
      '<ul class="histlist card">' + items.map(function (x) {
        var on = st.view && st.view.id === x.id;
        return '<li class="histrow' + (on ? " on" : "") + '" data-hist="' + esc(x.id) + '"><button type="button" class="histopen" data-histopen="' + esc(x.id) + '"' +
          (busy ? " disabled" : "") + (on ? ' aria-current="true"' : "") + '><span class="histq" dir="' + textDir(x.q) + '">' + esc(x.q || "—") + "</span>" +
          '<span class="histmeta">' + esc(histWhen(x.t)) + " · " + esc(list(x.ais).join(", ")) + "</span>" +
          (kind === "race" && x.winner ? '<span class="histwin">Winner: ' + esc(x.winner) + "</span>" : "") + "</button>" +
          '<button type="button" class="histdel" data-histdel="' + esc(x.id) + '" aria-label="Delete this ' + (kind === "race" ? "race" : "question") + '"' +
          (busy ? " disabled" : "") + ">" + ic("trash") + "</button></li>";
      }).join("") + "</ul></section>";
    return h;
  }
  // the top of a reopened entry: read only (the question, its files, when, what it cost)
  function savedHead(kind, x) {
    return newBtnHtml(kind) + '<div class="card saved" id="' + (kind === "race" ? "race" : "ask") + 'saved"><p class="savedkick">' +
      (kind === "race" ? "Past race" : "Past question") + " · " + esc(histWhen(x.t)) + "</p>" +
      '<p class="savedq" dir="' + textDir(x.q) + '">' + esc(x.q) + "</p>" +
      (list(x.files).length ? '<ul class="fchips">' + x.files.map(function (n) {
        return '<li class="fchip saved"><span class="ficon" aria-hidden="true">' + fileIcon(fileKind(n)) + '</span><span class="fcname" title="' + esc(n) + '">' + esc(n) + "</span></li>";
      }).join("") + "</ul>" : "") +
      (x.rounds > 1 ? '<p class="note savednote">Best of 3</p>' : "") +
      (x.charged ? '<p class="note savednote">Charged ' + esc(nCredits(x.charged)) + (kind === "race" ? " for this race." : " for this question.") + "</p>" : "") +
      (x.notice ? '<p class="note bad savednote">' + esc(x.notice) + "</p>" : "") + "</div>";
  }
  function savedRaceHtml(x) {
    var keep = race.rounds;
    race.rounds = x.rounds || 1;                                           // the lanes read the race's rounds (Best of 3)
    var lanes = list(x.lanes).map(function (l) { var c = {}; for (var k in l) if (own(l, k)) c[k] = l[k]; c.times = list(c.times); c.firsts = list(c.firsts);
      c.wpss = list(c.wpss); c.errs = list(c.errs); if (c.ms == null) c.ms = 0; return c; });
    var h = savedHead("race", x) + (x.partWin ? partWinHtml(x.partWin) : "") + '<div class="lanes" id="savedlanes">' + laneOrder(lanes).map(laneHtml).join("") + "</div>";
    race.rounds = keep;
    return h;
  }
  function savedAskHtml(x) {
    return savedHead("ask", x) + '<div class="acards savedcards">' + list(x.cards).map(function (c) {
      var srcs = webSources(c.sources);
      return '<section class="acard card" data-scard="' + esc(c.id) + '"><h4>' + esc(c.name) + (c.label ? '<span class="amodel"> · ' + esc(c.label) + "</span>" : "") +
        (c.searched ? ' <span class="searched">' + ic("globe") + " Searched the web</span>" : "") +
        (c.imgSkip ? ' <span class="imgskip">Can\'t read images</span>' : "") + "</h4>" +
        '<p class="atext' + (c.error ? " muted" : "") + '" dir="' + textDir(c.error || c.text) + '">' + esc(c.error || c.text) + "</p>" +
        (c.fileNote ? '<p class="lmeta fread">' + esc(c.fileNote) + "</p>" : "") +
        (srcs.length ? '<p class="asrcs"><span class="asrcl">Sources</span>' + srcs.map(function (s2) { return '<span class="asrc">' + esc(s2.title) + "</span>"; }).join("") + "</p>" : "") +
        "</section>";
    }).join("") + "</div>";
  }
  function histOpen(kind, id) {
    var st = fileState(kind);
    if (st.busy) return;
    var x = histList(kind).filter(function (e) { return e.id === id; })[0];
    if (!x) return;
    st.view = x; st.histConfirm = false;
    render();
    var top = document.getElementById(kind === "race" ? "racenew" : "asknew");
    if (top) { try { top.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) { top.scrollIntoView(); } try { top.focus({ preventScroll: true }); } catch (e) {} }
  }
  if (hasDom) document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    var b;
    if ((b = e.target.closest("#relmore"))) { relShowMore(b); return; }
    if ((b = e.target.closest("#racenew"))) { newStart("race"); return; }
    if ((b = e.target.closest("#asknew"))) { newStart("ask"); return; }
    var kind = state.tab === "race" ? "race" : "ask";
    if ((b = e.target.closest("[data-histopen]"))) { histOpen(kind, b.getAttribute("data-histopen")); return; }
    if ((b = e.target.closest("[data-histdel]"))) {
      if (fileState(kind).busy) return;
      var row = b.closest(".histrow"), next = row && (row.nextElementSibling || row.previousElementSibling);
      var nid = next && next.getAttribute("data-hist");
      histRemove(kind, b.getAttribute("data-histdel")); askRedraw();
      var f = nid && document.querySelector('[data-histdel="' + nid + '"]');      // keep the keyboard in the list
      if (f) f.focus();
      return;
    }
    if (e.target.closest("#racehistclear, #askhistclear")) { fileState(kind).histConfirm = true; askRedraw("#" + (kind === "race" ? "race" : "ask") + "histno"); return; }
    if (e.target.closest("#racehistno, #askhistno")) { fileState(kind).histConfirm = false; askRedraw("#" + (kind === "race" ? "race" : "ask") + "histclear"); return; }
    if (e.target.closest("#racehistyes, #askhistyes")) { fileState(kind).histConfirm = false; histClear(kind); askRedraw(); return; }
  });
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
    if (r.status === 400 && (j.error === "bad_attachments" || j.error === "attachments_too_big")) return FILES_REFUSED;
    return "Something went wrong on our side.";
  }
  // places from the helper's answer times (the average in Best of 3), among the lanes that are done and answered
  function racePlaces() { placeLanes(function (l) { return l.total; }); }
  // v17k: with files, an AI that read only part of them (l.share = the share it read) can't win. AIs that read it all
  // are placed first by time, the partial ones after them by time (placed only when every lane is done, so a partial
  // one is never shown 1st for a moment). If NO answered AI read it all, the one that read the most wins (ties: the
  // fastest), then the rest by share and time, and race.partWin says so. Without files: by time, as before.
  // timeOf = the lane's time (the helper's average in /race, the browser's in the fallback)
  function placeLanes(timeOf) {
    var byTime = function (a, b) { return timeOf(a) - timeOf(b); };
    var fin = race.lanes.filter(function (l) { return l.ms != null && !l.error && timeOf(l) != null; });
    race.lanes.forEach(function (l) { l.place = null; l.norank = false; });
    race.partWin = false;
    if (!race.fileTotal) { fin.sort(byTime).forEach(function (l, i) { l.place = i + 1; }); return; }
    var full = fin.filter(function (l) { return l.share == null; }).sort(byTime), part = fin.filter(function (l) { return l.share != null; });
    part.forEach(function (l) { l.norank = full.length > 0; });
    if (race.lanes.some(function (l) { return l.ms == null; })) part = [];
    else if (!full.length && part.length) { race.partWin = true; part.sort(function (a, b) { return b.share - a.share || byTime(a, b); }); }
    else part.sort(byTime);
    full.concat(part).forEach(function (l, i) { l.place = i + 1; });
  }
  // the share of the files' text an AI read when it read only part of them (null = all of it, or no files)
  function partShare(chars) {
    return typeof chars === "number" && race.fileTotal && chars < race.fileTotal ? Math.max(0, chars) / race.fileTotal : null;
  }
  var PART_WIN = "No AI read the whole file, so the one that read the most wins.", PART_WIN_N = "No AI read all the files, so the one that read the most wins.";
  function partWinHtml(files) { return '<p class="note partwin" role="status">' + esc(files > 1 ? PART_WIN_N : PART_WIN) + "</p>"; }
  // one line from the helper's race stream
  function raceLine(o, rid) {
    if (race.id !== rid || !o || typeof o !== "object") return;
    if (o.type === "start") {
      race.round = o.round || 1;
      race.lanes.forEach(function (l) { l.t0 = Date.now(); });                // the live clock only; the real times come from the helper
      if (race.round > 1) race.lanes.forEach(function (l) { var el = document.querySelector('[data-lane="' + l.id + '"]'); if (el && l.ms == null) el.outerHTML = laneHtml(l); });
      return;
    }
    if (o.type === "done") {
      var l = race.lanes.filter(function (x) { return x.id === o.id; })[0];
      if (!l) return;
      if (o.round === 1 || o.round == null) {
        if (o.provider) l.provider = String(o.provider);
        if (!o.error) {
          var t = String(o.text || "");
          l.text = plainAnswer(o.sources ? stripMarks(t) : t) + (o.cut ? " (cut short)" : "");
          l.searched = o.searched === true; l.sources = o.sources || null; l.imgSkip = o.images_skipped === true;
          l.fileNote = fileGotNote(o.file_chars, race.fileTotal, race.fileTexts); l.share = l.fileNote ? partShare(o.file_chars) : null;
        } else l.firstErr = o.error;
      }
      if (!o.error && typeof o.total_ms === "number") {
        l.times.push(o.total_ms); if (typeof o.first_ms === "number") l.firsts.push(o.first_ms); if (typeof o.wps === "number") l.wpss.push(o.wps);
        l.total = avg(l.times); l.first = avg(l.firsts); l.wps = avg(l.wpss);
      } else l.errs.push(o.error || "No answer this time");
      if ((o.round || 1) >= l.rounds) {                                        // this lane is finished
        l.ms = l.total != null ? l.total : 0;
        if (!l.times.length) { l.error = l.errs[l.errs.length - 1] + " — credits returned"; l.text = ""; }
        else if (l.firstErr) l.note = "No answer in round 1 (credits returned for it).";
        else if (l.errs.length) l.note = "No answer in " + l.errs.length + (l.errs.length === 1 ? " round" : " rounds") + " (credits returned for " + (l.errs.length === 1 ? "it" : "them") + ").";
        var old = {};
        race.lanes.forEach(function (x) { old[x.id] = x.place; });
        racePlaces();
        race.lanes.forEach(function (x) {                                       // a place that moved is redrawn
          if (x !== l && (x.place !== old[x.id] || x.norank) && x.ms != null) { var el = document.querySelector('[data-lane="' + x.id + '"]'); if (el) el.outerHTML = laneHtml(x); }
        });
      }
      laneUpdate(l);
      return;
    }
    if (o.type === "end") {
      race.ended = true;
      setLeft(o);
      if (typeof o.charged === "number") race.charged = o.charged;
      if (o.reason === "balance_empty") race.notice = OUR_SIDE;
    }
  }
  function raceFinish(rid) {
    if (race.id !== rid) return;
    race.busy = false; clearInterval(race.timer); race.timer = null;
    if (!race.ended) {                                                        // the line to the helper dropped before the end
      race.lanes.forEach(function (l) { if (l.ms == null) { l.ms = 0; l.error = "Connection lost."; } });
      racePlaces();
      race.notice = "The connection dropped before the race finished. Your credits were updated: AIs that didn't answer are not charged.";
      loadLeft();
    }
    saveRace();
    askRedraw();
  }
  // read the helper's NDJSON stream: one JSON object per line, handled as soon as it arrives
  function readRace(r, rid) {
    var reader = r.body.getReader(), dec = new TextDecoder(), buf = "";
    function pump() {
      return reader.read().then(function (x) {
        if (x.done) { if (buf.trim()) { try { raceLine(JSON.parse(buf), rid); } catch (e) {} } return; }
        buf += dec.decode(x.value, { stream: true });
        var nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          var line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (line.trim()) { try { raceLine(JSON.parse(line), rid); } catch (e) {} }
        }
        return pump();
      });
    }
    return pump();
  }
  function startRace() {
    var q = race.q.trim(), pick = getRacePick();
    if (race.busy) return;
    if (!q) { raceSay("Type a task first."); var b = document.getElementById("raceq"); if (b) b.focus(); return; }
    var rfp = tabFiles("race");
    if (rfp.reading) { raceSay("Wait until the files are read."); return; }
    if (pick.length < RACE_MIN) return;
    if (!root.ReadableStream || !root.TextDecoder || !window.fetch) return startRaceOld();
    var models = proModels(), choice = getChoice(), by = {}, code = stored("ait.code"), id = newRaceId(), rounds = race.best3 ? 3 : 1;
    models.forEach(function (m) { by[m.id] = m; });
    race.busy = true; race.id = id; race.notice = ""; race.short = false; race.charged = 0; race.rounds = rounds; race.round = 0; race.ended = false;
    race.partWin = false; race.fileTotal = rfp.total; race.fileTexts = rfp.texts; race.askedQ = q; race.fileNames = fileNames(race.files); race.histMsg = ""; race.view = null;
    race.lanes = pick.map(function (aid) {
      var m = by[aid], o = chosenOption(m, choice);
      return { id: aid, name: m.name, label: isDefault(m, o) ? "" : o.label, model: o.model, t0: Date.now(), ms: null, place: null, text: "", error: "",
               searched: false, sources: null, server: true, rounds: rounds, times: [], firsts: [], wpss: [], errs: [], total: null, first: null, wps: null, provider: "" };
    });
    askRedraw();
    race.timer = setInterval(raceTick, 100);
    var body = { question: q, models: pick }, ch = {}, any = false;
    race.lanes.forEach(function (l) { if (l.label) { ch[l.id] = l.model; any = true; } });
    if (any) body.choice = ch;
    if (rounds > 1) body.rounds = rounds;
    if (rfp.attachments.length) body.attachments = rfp.attachments;
    if (code) body.code = code;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null, timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 600000) : null;
    fetch(CONFIG.ASK_API.replace(/\/+$/, "") + "/race", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      cache: "no-store", credentials: "omit", signal: ctrl ? ctrl.signal : undefined }).then(function (r) {
      if (race.id !== id) return;
      if (r.status === 404) { race.busy = false; clearInterval(race.timer); race.timer = null; race.id = null; if (timer) clearTimeout(timer); return startRaceOld(); }   // an older helper
      if (r.status !== 200 || !/ndjson/.test(r.headers.get("Content-Type") || "") || !r.body) {
        return r.json().then(function (j) { return j || {}; }, function () { return {}; }).then(function (j) {
          setLeft(j);
          if (r.status === 402 && j.reason === "not_enough") { race.short = true; race.lanes = null; }
          else { race.notice = laneError({ status: r.status, json: j }); race.lanes = null; }
          race.ended = true;
        });
      }
      return readRace(r, id);
    }).catch(function () {
      if (race.id === id && !race.lanes.some(function (l) { return l.ms != null; })) {
        race.lanes = null; race.ended = true; race.notice = "Couldn't connect. Check your internet and start again.";
      }
    }).then(function () { if (timer) clearTimeout(timer); raceFinish(id); });
  }
  function startRaceOld() {
    var q = race.q.trim(), pick = getRacePick();
    if (race.busy) return;
    if (!q) { raceSay("Type a task first."); var b = document.getElementById("raceq"); if (b) b.focus(); return; }
    var rfp = tabFiles("race");
    if (rfp.reading) { raceSay("Wait until the files are read."); return; }
    if (pick.length < RACE_MIN) return;
    var models = proModels(), choice = getChoice(), by = {}, code = stored("ait.code"), id = newRaceId(), t0 = Date.now(), open = pick.length;
    models.forEach(function (m) { by[m.id] = m; });
    race.busy = true; race.id = id; race.notice = ""; race.short = false; race.charged = 0;
    race.partWin = false; race.fileTotal = rfp.total; race.fileTexts = rfp.texts; race.askedQ = q; race.fileNames = fileNames(race.files); race.histMsg = ""; race.view = null;
    race.lanes = pick.map(function (aid) {
      var m = by[aid], o = chosenOption(m, choice);
      return { id: aid, name: m.name, label: isDefault(m, o) ? "" : o.label, model: o.model, t0: t0, ms: null, place: null, text: "", error: "", searched: false, sources: null };
    });
    askRedraw();
    race.timer = setInterval(raceTick, 100);
    race.lanes.forEach(function (l) {
      var body = { question: q, models: [l.id], race_id: id };
      if (rfp.attachments.length) body.attachments = rfp.attachments;
      if (l.label) { body.choice = {}; body.choice[l.id] = l.model; }
      if (code) body.code = code;
      askApi("/ask", body, 150000).then(function (r) { return r; }, function () { return null; }).then(function (r) {
        if (race.id !== id) return;                                         // an older race
        l.ms = Date.now() - l.t0;
        var a = r && r.status === 200 && r.json.answers && r.json.answers[0];
        if (a && !a.error) {
          l.text = plainAnswer(a.sources ? stripMarks(a.text) : a.text) + (a.cut ? " (cut short)" : "");
          l.searched = a.searched === true; l.sources = a.sources || null; l.imgSkip = a.images_skipped === true;
          l.fileNote = fileGotNote(a.file_chars, race.fileTotal, race.fileTexts); l.share = l.fileNote ? partShare(a.file_chars) : null;
        } else l.error = a ? a.error + " — credits returned" : laneError(r);
        var old = {};                                                       // places by the browser's times (v17k: the file rule)
        race.lanes.forEach(function (x) { old[x.id] = x.place; });
        placeLanes(function (x) { return x.ms; });
        race.lanes.forEach(function (x) {
          if (x !== l && (x.place !== old[x.id] || x.norank) && x.ms != null) { var el = document.querySelector('[data-lane="' + x.id + '"]'); if (el) el.outerHTML = laneHtml(x); }
        });
        if (r && r.json) { setLeft(r.json); if (r.status === 200 && r.json.charged != null) race.charged += r.json.charged; }
        if (r && r.status === 402 && r.json.reason === "not_enough") race.short = true;
        laneUpdate(l);
        if (--open === 0) { race.busy = false; clearInterval(race.timer); race.timer = null; saveRace(); askRedraw(); }
      });
    });
  }
  // live cost line while the task is typed (the web rule depends on the words); redraw only when "enough" flips
  function raceCostUpdate() {
    if (!hasDom || !CONFIG.ASK_API || state.tab !== "race" || race.busy) return;
    var line = document.getElementById("racecost"), btn = document.getElementById("racego");
    if (!line || !btn) return;
    var models = proModels(), pick = getRacePick(), wc = webCredits(), bal = balance(), choice = getChoice();
    var cp = raceCost(costPreview(race.q, pick, models, choice, wc, Date.now(), tabFiles("race"))), short = pick.length >= RACE_MIN && bal.total < cp.held;
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
    var h = "<h2 class=\"sr\">Sources</h2><p class=\"sub\">Where every number comes from. The app rebuilds itself every day. If a source doesn't answer, its last good copy is kept.</p>";
    h += '<ul class="rows card srcs">' + list(D.sources).map(function (s) {
      var st = stat(s.id);
      var line = st.ok ? '<span class="ok">' + ic("check") + " Working</span>"
        : st.updated ? '<span class="warn">' + ic("warn") + " Using last good copy from " + esc(day(st.updated)) + "</span>" : '<span class="warn">' + ic("warn") + " No data yet</span>";
      return '<li><span class="rn"><b>' + (s.url ? ext(s.url, esc(s.credit || s.name)) : esc(s.credit || s.name)) + "</b>" +
        "<small>" + esc(s.what) + "</small>" +
        (s.license ? "<small>License: " + (s.licenseUrl ? ext(s.licenseUrl, esc(s.license)) : esc(s.license)) + "</small>" : "") +
        "<small>" + line + (st.note ? " · " + esc(st.note) : "") + (!st.ok && st.err ? ' · <span class="muted">' + esc(st.err) + "</span>" : "") + "</small></span></li>";
    }).join("") + "</ul>";
    var offs = list(D.officialSources);
    if (offs.length) {
      h += "<h3>Official company pages (new models)</h3><ul class=\"rows card\">" + offs.map(function (o) {
        var line = o.ok ? '<span class="ok">' + ic("check") + " Working</span>"
          : o.updated ? '<span class="warn">' + ic("warn") + " Failed today, using the copy from " + esc(day(o.updated)) + "</span>" : '<span class="warn">' + ic("warn") + " No copy yet</span>";
        return '<li><span class="rn"><b>' + ext(o.url, esc(o.label)) + "</b><small>" + line + (o.err ? ' · <span class="muted">' + esc(o.err) + "</span>" : "") + "</small></span></li>";
      }).join("") + "</ul>";
    }
    var apps = list(D.cost && D.cost.apps);
    if (apps.length) {
      var stale = list(D.stalePrices);
      h += "<h3>App prices</h3>" + (stale.length ? '<p class="note bad">' + ic("warn") + " " + stale.length + " price" + (stale.length > 1 ? "s" : "") +
        " not confirmed for more than " + ((D && D.staleDays) || 30) + " days: " + esc(stale.map(function (x) { return x.app + (x.plan ? " " + x.plan : ""); }).join(", ")) + "</p>" : "");
      h += '<ul class="rows card">' + apps.map(function (a) {
        var src = a.src || { label: "Pricing page", url: a.page };
        var read = a.readToday === undefined ? a.read_ok : a.readToday;
        var line = read ? '<span class="ok">' + ic("check") + " Read today</span>" : '<span class="warn">' + ic("warn") + " Failed today</span>";
        var failed = list(a.tried).filter(function (t) { return !t.ok; }).map(function (t) { return t.label + ": " + t.err; });
        return '<li><span class="rn"><b>' + esc(a.app) + "</b><small>" + ext(src.url || a.page, esc(src.label || "Pricing page")) + " · last checked " + esc(day(a.checked)) + staleMark(a.stale) + "</small>" +
          "<small>" + line + (failed.length ? ' · <span class="muted">' + esc(failed.join("; ")) + "</span>" : "") + "</small></span></li>";
      }).join("") + "</ul>";
    }
    var ag = AG();
    if (ag && list(ag.tests).length) {
      h += "<h3>Agent tests (Agents tab)</h3><ul class=\"rows card\">" + list(ag.tests).map(function (t) {
        var line = t.skipped ? '<span class="warn">' + ic("warn") + " Left out today: " + esc(t.skipWhy) + "</span>"
          : t.ok ? '<span class="ok">' + ic("check") + " OK</span>" + (t.date ? " · newest result " + esc(day(t.date)) : "")
          : '<span class="warn">' + ic("warn") + " Using last good copy" + (t.updated ? " from " + esc(day(t.updated)) : "") + "</span>";
        return '<li><span class="rn"><b>' + ext(t.url, esc(t.credit)) + "</b><small>" + esc(t.name) + ": " + esc(t.what) + (t.inRule ? "" : " Information only.") + "</small>" +
          (t.license ? "<small>License: " + (t.licenseUrl ? ext(t.licenseUrl, esc(t.license)) : esc(t.license)) + "</small>" : "") +
          "<small>" + line + "</small></span></li>";
      }).join("") + "</ul>";
      var aps = list(ag.apps);
      h += '<details class="agrp" id="src-agentpages"' + (state.open["src-agentpages"] ? " open" : "") + '><summary><span>Agent app pages <span class="cnt">(' + aps.length +
        ')</span></span><span class="chev" aria-hidden="true"></span></summary><ul class="rows card">' + aps.map(function (a) {
        var pg = a.check || a.proof || a.src || {};
        var line = pg.readToday ? '<span class="ok">' + ic("check") + " Read today</span>" : '<span class="warn">' + ic("warn") + " Failed today</span>";
        var failed = list(pg.tried).filter(function (t) { return !t.ok; }).map(function (t) { return t.label + ": " + t.err; });
        return '<li><span class="rn"><b>' + esc(a.app) + "</b><small>" + ext(pg.url, esc(pg.label || "Pricing page")) + " · last checked " + esc(day(pg.checked)) + staleMark(pg.stale) +
          (a.plansFrom ? " · prices from the " + esc(a.plansFrom) + " row above" : "") + "</small>" +
          "<small>" + line + (failed.length ? ' · <span class="muted">' + esc(failed.join("; ")) + "</span>" : "") + "</small></span></li>";
      }).join("") + "</ul></details>";
    }
    var feeds = list(D.bignews && D.bignews.feeds);
    if (feeds.length) {
      h += "<h3>Update feeds</h3><ul class=\"rows card\">" + feeds.map(function (f) {
        return '<li><span class="rn"><b>' + esc(f[0]) + '</b></span><span class="rv ' + (f[1] === "ok" ? "ok" : "warn") + '">' + (f[1] === "ok" ? ic("check") + " " + esc(f[2]) + " stories" : ic("warn") + " didn't answer") + "</span></li>";
      }).join("") + "</ul>";
    }
    h += '<div class="card prose"><h3>How to read the numbers</h3>' +
      "<p><b>LMArena points:</b> people chat with two hidden models and vote for the better answer. The range in brackets is the margin of error.</p>" +
      (D.aaEnabled ? "<p><b>Artificial Analysis index:</b> the same set of hard tests run on every model, as one score. Private use only.</p>" : "") +
      "<p><b>LiveBench:</b> new tasks every release, kept hidden, so models can't have learned the answers.</p>" +
      "<p><b>" + ic("bolt") + " Fast:</b> " + esc(fastNote()) + " A rough guide only; it never changes a pick.</p>" +
      "<p><b>Prices:</b> \u201cApp Store price (US)\u201d comes from the company's own App Store listing. A price not confirmed for more than " + ((D && D.staleDays) || 30) + " days is marked " + ic("warn") + " stale.</p>" +
      "<p><b>New Releases:</b> every release ever recorded, of every type (text, image, video, voice, music and more), with the date and link from the company's own page when it announced the model, otherwise the date it appeared on OpenRouter.</p>" +
      "<p><b>Epoch Capabilities Index:</b> many benchmarks combined into one score, with a margin of error.</p>" +
      (ag ? "<p><b>Agent tests:</b> LMArena Agent Arena score (people's votes between two agents, higher is better), LiveBench Long Agentic (0 to 100), APEX-Agents (share of work tasks solved on the first try). " + esc(AGENT_RULE) + "</p>" : "") +
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
    var ri = D.ruleInfo || {}, aa = !!D.aaEnabled;
    var names = ri.names ? String(ri.names) : aa ? "LMArena, Artificial Analysis, LiveBench and Epoch AI" : "LMArena, LiveBench and Epoch AI";
    // v16i1: the pipeline's own rule (minus a pictures sentence; the pictures line below says it) and test names
    var rule = (String(D.rule || "").match(/[^.]+(\.|$)/g) || []).map(function (x) { return x.trim(); }).filter(function (x) { return x && !/picture/i.test(x); }).join(" ");
    if (COUNT_RE.test(rule) || ONE_RE.test(rule)) rule = "A model is named best when the independent tests agree it is one of the strongest.";   // v17e: no counts
    var best = rule ? rule + (ri.names ? " The tests: " + names + "." : "")
      : "a model counts as best only when the independent sources (" + names + ") agree it is one of the strongest.";
    var pics = aa ? "For pictures, LMArena and Artificial Analysis must agree."
      : "For pictures, the pick is LMArena's #1 (people's blind votes); the next ones are under See more.";
    return '<div class="card prose"><h3>How the picks work</h3>' +
      "<p><b>Best</b>: " + esc(best) + " " + esc(pics) + "</p>" +
      "<p><b>New model</b>: recently released; its place may change as more results come in.</p>" +
      "<p><b>Lead</b>: when no model passes the rule, the one that does best across the tests is shown as the winner.</p>" +
      "<p>No AI is used to choose; it's the same rule every day.</p>" +
      "<p><b>" + ic("bolt") + " Fast</b>: " + esc(fastNote()) + " It is only a label and never changes a pick.</p>" + (aa ? aaNote() : "") + "</div>";
  }
  function backButton() { return '<button type="button" class="backbtn" data-less="1">‹ Back to the simple view</button>'; }
  function staleList(ids) { return ids.map(staleNote).join(""); }
  function credits(ids) {
    ids = ids.filter(active);
    if (!ids.length) return '<p class="credits"><a href="#sources" data-tab="sources">All sources and update status</a></p>';
    return '<p class="credits">Data from ' + ids.map(function (id) {
      var s = src(id), t = String(s.credit || s.name || "");
      if (/^Each /.test(t)) t = "each" + t.slice(4);          // mid-sentence: "Data from each company's…"
      return s.url ? ext(s.url, esc(t)) : esc(t);
    }).join(", ") +
      '. <a href="#sources" data-tab="sources">All sources and update status</a></p>';
  }

  // ---------------------------------------------------------------- v17: home and the section bar
  function svg(paths, size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + paths + "</svg>";
  }
  var CHEV_R = '<path d="M9 6l6 6-6 6"/>', CHEV_L = '<path d="M15 6l-6 6 6 6"/>';
  // v17h: Home = only the 3 big cards, filling the screen. A card = one surface: its icon, its title (a button, the
  // keyboard way in), one plain line on what's inside, and a chip per tab. A tap on the card opens the section's last (or first) tab; a chip opens that tab.
  function vHome() {
    var h = '<h2 class="sr">Home</h2><div class="home">' + SECTIONS.map(function (x) {
      var first = lastTab[x.id] || x.tabs[0][0];
      return '<section class="hcard" data-tab="' + first + '" data-sec="' + x.id + '">' +
        '<span class="hib">' + svg(x.icon, 32) + '</span><span class="hch">' + svg(CHEV_R, 22) + "</span>" +
        '<div class="hbody"><h3 class="htt"><button type="button" class="hmain" data-tab="' + first + '">' + esc(x.title) + "</button></h3>" +
        '<p class="hdesc">' + esc(x.desc) + "</p>" +
        '<div class="hchips" role="group" aria-label="' + esc(x.title) + '">' + x.tabs.map(function (t) {
          return '<button type="button" class="hchip" data-tab="' + t[0] + '">' + esc(t[1]) + "</button>";
        }).join("") + "</div></div></section>";
    }).join("") + "</div>";
    var upd = D && D.built ? day(D.built) : "";
    return h + '<p class="homefoot"><button type="button" class="linkbtn" data-tab="sources">Sources</button>' + (upd ? '<span class="muted"> · updated ' + esc(upd) + "</span>" : "") + "</p>";
  }
  // the bar on a section's tabs: ‹ Home, the section title, its tabs (Sources: only ‹ Home and the title)
  function sectionBar(tab) {
    var x = sectionOf(tab), title = x ? x.title : tab === "sources" ? "Sources" : "";
    if (!title) return "";
    var h = '<div class="secbar"><button type="button" class="secback" data-tab="home" aria-label="Home">' + svg(CHEV_L, 22) + '<span aria-hidden="true">Home</span></button>' +
      '<p class="sectt">' + esc(title) + "</p>";
    if (x) h += '<div class="stabs" role="group" aria-label="' + esc(title) + '">' + x.tabs.map(function (t) {
      return '<button type="button" class="stab' + (t[0] === tab ? " on" : "") + '" data-tab="' + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : "") + ">" + esc(t[1]) + "</button>";
    }).join("") + "</div>";
    return h + "</div>";
  }
  var VIEWS = { best: vBest, cost: vCost, releases: vReleases, news: vNews, agents: vAgents, ask: vAsk, race: vRace, sources: vSources, home: vHome };
  var MORE = { best: vBestMore, cost: vCostMore, releases: vReleasesMore, news: vNewsMore, agents: vAgentsMore };

  function viewHtml(tab, more) {
    if (tab === "home") return vHome();                        // works without any data
    if (tab === "ask") return vAsk();                          // works without any data
    if (tab === "race") return vRace();
    if (!D) return '<h2>No data yet</h2><p class="sub">' + (typeof navigator !== "undefined" && navigator.onLine === false
      ? "You're offline and nothing is saved yet. Connect once to load it." : "Connect to the internet once and reopen the app.") + "</p>";
    if (D.v !== 3 || !D.picks) return '<h2>Updating…</h2><p class="sub">The data is being rebuilt in a new format. Try again in a few minutes.</p>';
    try { return (more && MORE[tab] ? MORE[tab] : VIEWS[tab])(); }
    catch (e) { return '<h2>Something went wrong</h2><p class="sub">This part could not be shown. Pull to refresh or try again later.</p>'; }
  }

  // #home #best #cost #releases #news #agents #ask #race #sources, and "#<tab>-more" for the details. Anything else -> home.
  function routeFor(hash) {
    var h = String(hash || "").replace(/^#/, "").toLowerCase();
    if (h === "main") return null;                           // skip link
    var sm = h.match(/^story\/(news|agents)\/(\d{1,3})$/);   // a news story inside the app
    if (sm) return { tab: sm[1], more: false, story: { src: sm[1], i: +sm[2] } };
    var more = /-more$/.test(h);
    var t = h.replace(/-more$/, "");
    if (t === "updates") t = "news";                        // v16f: the News tab is called Updates; #news still works
    if (VIEWS_ALL.indexOf(t) >= 0) return { tab: t, more: more && !!MORE[t] };
    return { tab: "home", more: false };
  }

  root.AITracker = { routeFor: routeFor, pickTitle: pickTitle, tabs: TABS, setData: function (d) { D = oneWinner(d); }, askLinks: askLinks, askAIs: ASK_AIS,
    config: CONFIG, plainAnswer: plainAnswer, four: pro, pro: pro, textDir: textDir, selectionCost: selectionCost, cleanPick: cleanPick,
    chosenOption: chosenOption, cleanChoice: cleanChoice, getChoice: getChoice, setChoice: setChoice, pickNames: pickNames,
    modelSheetHtml: modelSheetHtml,
    proAIs: PRO_AIS, nCredits: nCredits, askLabel: askLabel, webSources: webSources, stripMarks: stripMarks, mainIds: mainIds,
    setModels: setModels, setWebCredits: setWebCredits, moreOpen: moreOpen, needsWeb: needsWeb, costPreview: costPreview, subs: SUBS, rankModels: rankModels, finderHtml: finderHtml, getFinder: getFinder, setFinder: setFinder,
    exploreFor: exploreFor, laneOrder: laneOrder, newsRow: newsRow, newsSummary: newsSummary, relCard: relCard, race: race, newRaceId: newRaceId, getRacePick: getRacePick, setRacePick: setRacePick,
    laneHtml: laneHtml, ctaOn: ctaOn, tipFor: tipFor, isoWeek: isoWeek, weekNumber: weekNumber, tipHtml: tipHtml, setLeft: setLeft, plainAnswer: plainAnswer, updateDecision: updateDecision, day: day, setQuestion: function (q) { askQ = String(q == null ? "" : q); },
    view: viewHtml, views: VIEWS, more: MORE, storyHtml: storyHtml, plainRule: plainRule,
    histList: histList, histKeys: HIST_KEYS, aiModelName: aiModelName, version: VERSION };

  if (!hasDom) return;
  store("ait.web", null);               // v13: the web switch is gone (the helper decides); forget the old setting

  // ---------------------------------------------------------------- page wiring
  var view = document.getElementById("view");
  var stamp = document.getElementById("stamp");

  // v16: no "Updated … ago" line any more (the header shows the brand); kept as a hook for older callers
  function setStamp() { if (stamp) stamp.textContent = ""; }
  // ---- source lines (v16d8): a row's sources and dates (its small.checked lines) start hidden; tapping the row
  // (or Enter / Space on it) shows them in place, tapping again hides them. Links, buttons and inputs inside a row
  // work as before and never toggle it. The open rows are remembered per view while the app is open.
  var xopen = {};
  function xrows() {
    if (state.story || state.tab === "sources") return;                // the Sources page shows everything
    var n = 0, where = state.tab + (state.more ? "-more" : "");
    view.querySelectorAll(".rows li").forEach(function (li) {
      if (!li.querySelector("small.checked")) return;
      var key = where + "|" + (n++), on = !!xopen[key];
      li.classList.add("xrow"); li.classList.toggle("xopen", on);
      li.setAttribute("data-xkey", key); li.setAttribute("role", "button"); li.setAttribute("tabindex", "0");
      li.setAttribute("aria-expanded", on ? "true" : "false");
      var c = document.createElement("span"); c.className = "xchev"; c.setAttribute("aria-hidden", "true"); li.appendChild(c);
    });
  }
  function xtoggle(li) {
    var on = !li.classList.contains("xopen");
    li.classList.toggle("xopen", on); li.setAttribute("aria-expanded", on ? "true" : "false");
    xopen[li.getAttribute("data-xkey")] = on;
  }
  document.addEventListener("click", function (e) {
    var li = e.target.closest && e.target.closest("#view .xrow");
    if (!li || e.target.closest("a,button,input,select,textarea,label,summary")) return;
    xtoggle(li);
  });
  document.addEventListener("keydown", function (e) {
    if (!e.target.classList || !e.target.classList.contains("xrow") || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault(); xtoggle(e.target);
  });
  function render() {
    setStamp();
    // v17: a section's tab (not its See more page, not a story) gets the section bar on top
    var bar = !state.story && !state.more ? sectionBar(state.tab) : "";
    view.innerHTML = state.story && D ? storyHtml(state.story.src, state.story.i) : bar + viewHtml(state.tab, state.more);
    var sx = sectionOf(state.tab); if (sx) lastTab[sx.id] = state.tab;
    xrows();
    if (state.tab === "ask") fourFill();
    var sb = document.getElementById("srcbtn");
    if (sb) { if (state.tab === "sources") sb.setAttribute("aria-current", "page"); else sb.removeAttribute("aria-current"); }
  }
  // History (v16f, v17): each entry carries d = how many steps it sits above Home. Opening a tab from Home ADDS one entry
  // (aitTab); later tab switches (in a section or across) replace it, so the phone's Back from any tab returns to Home
  // and Back on Home leaves the app. "See more" and a story ADD one each, so Back returns to the tab. "‹ Home" steps
  // back to the Home entry (the history doesn't grow).
  function histD() { var s2 = history.state; return s2 && s2.d > 0 ? s2.d : 0; }
  function setHash(h, push) {
    if (location.hash === h) return;
    try { if (push) history.pushState({ aitMore: 1, d: histD() + 1 }, "", h); else history.replaceState(histD() ? { aitTab: 1, d: histD() } : null, "", h); } catch (e) {}
  }
  function goTab(tab) {
    tab = VIEWS_ALL.indexOf(tab) >= 0 ? tab : "home";
    var d = histD();
    if (tab === "home" && d > 0) { try { history.go(-d); return; } catch (e) {} }
    if (tab !== "home" && d === 0 && !(state.tab === tab && !state.more && !state.story)) {
      try { history.pushState({ aitTab: 1, d: 1 }, "", "#" + tab); } catch (e) {}
    }
    go(tab);
  }
  function go(tab, more, keepScroll, push) {
    state.story = null;
    state.tab = VIEWS_ALL.indexOf(tab) >= 0 ? tab : "home";
    state.more = !!more && !!MORE[state.tab];
    setHash("#" + state.tab + (state.more ? "-more" : ""), !!push && state.more);
    render();
    if (!keepScroll) window.scrollTo(0, 0);
  }

  // ---- news stories: opening one ADDS a history entry (#story/news/3), so Back (button, browser or phone gesture)
  // returns to the same list at the same scroll spot
  function showStory(st, push, from) {
    state.storyFrom = from || state.storyFrom || null;
    state.story = { src: st.src, i: st.i };
    state.tab = st.src; state.more = false;
    var h = "#story/" + st.src + "/" + st.i;
    if (push) { try { history.pushState({ aitStory: 1, d: histD() + 1 }, "", h); } catch (e) {} }
    else if (location.hash !== h) { try { history.replaceState(histD() ? { aitTab: 1, d: histD() } : null, "", h); } catch (e) {} }
    render();
    window.scrollTo(0, 0);
    var hd = document.getElementById("storyh"); if (hd) hd.focus({ preventScroll: true });
  }
  function closeStory() {
    var from = state.storyFrom || { tab: state.tab, more: false, y: 0 };
    state.story = null; state.storyFrom = null;
    state.tab = from.tab; state.more = from.more;
    setHash("#" + from.tab + (from.more ? "-more" : ""), false);
    render();
    window.scrollTo(0, from.y || 0);
  }
  // the route after Back / Forward / a typed hash
  function applyRoute(r) {
    if (!r) return;
    if (r.story) {
      if (!state.story || state.story.src !== r.story.src || state.story.i !== r.story.i)
        showStory(r.story, false, state.story ? state.storyFrom : { tab: state.tab, more: state.more, y: window.scrollY });
      return;
    }
    if (state.story) {
      var from = state.storyFrom;
      state.story = null; state.storyFrom = null; state.tab = r.tab; state.more = r.more;
      render();
      window.scrollTo(0, from && from.tab === r.tab && from.more === r.more ? from.y || 0 : 0);
      return;
    }
    if (r.tab !== state.tab || r.more !== state.more) go(r.tab, r.more);
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
    var cp = costPreview(askQ, pick, models, choice, wc, Date.now(), tabFiles("ask")), short = pick.length > 0 && bal.total < cp.held;
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
      .map(function (o) { return { model: o.model, label: o.label, credits: o.credits, d: o.default === true, vision: o.vision !== false,
        ctx: posInt(o.ctx), max_in: posInt(o.max_in) }; });
    if (!ok.length) return null;
    var d = ok.filter(function (o) { return o.d; })[0] || ok[0];
    return [d].concat(ok.filter(function (o) { return o !== d; })).map(function (o) {
      var x = { model: o.model, label: o.label, credits: o.credits }; if (!o.vision) x.vision = false; if (o.ctx) x.ctx = o.ctx; if (o.max_in) x.max_in = o.max_in; return x; });
  }
  // a context window from the helper: a whole number of tokens in a sane range, else none (an older helper sends none)
  function posInt(n) { return typeof n === "number" && Math.floor(n) === n && n >= 8000 && n <= 100000000 ? n : 0; }
  function setWebCredits(n) { if (typeof n === "number" && n >= 0 && n <= 50 && Math.floor(n) === n) pro.webCredits = n; }
  var PAUSED = "Answers here are paused right now. Open your question in each AI below.";           // only when switched off
  var NO_NET = "Couldn't connect. Check your internet and tap Ask again.";
  var OUR_SIDE = "Something went wrong on our side. Try again in a few minutes, or open your question in each AI below.";
  function askPro() {
    var q = askQ.trim(), pick = getPick();
    if (!q) { askSay("askqmsg", "Type a question first."); var b = document.getElementById("askq"); if (b) b.focus(); return; }
    var afp = tabFiles("ask");
    if (afp.reading) { askSay("askqmsg", "Wait until the files are read."); return; }
    if (!pick.length || pro.busy) return;
    pro.fileTotal = afp.total; pro.fileTexts = afp.texts; pro.askedQ = q; pro.fileNames = fileNames(pro.files); pro.histMsg = ""; pro.view = null;
    pro.busy = true; pro.asked = pick; pro.askedChoice = getChoice(); pro.answers = null; pro.notice = ""; pro.short = false; pro.codeMsg = ""; pro.paid = null; pro.charged = null;
    askRedraw();
    var code = stored("ait.code"), body = { question: q, models: pick, choice: pro.askedChoice };   // choice: only non-defaults; the helper checks them and decides about the web
    if (afp.attachments.length) body.attachments = afp.attachments;
    if (code) body.code = code;
    askApi("/ask", body, afp.attachments.length ? 330000 : 150000).then(function (r) {   // big files: the helper allows each AI more time
      var j = r.json;
      pro.busy = false;
      if (r.status === 200 && j.answers) {
        pro.answers = j.answers; setLeft(j); pro.charged = j.charged != null ? j.charged : null;
        saveAsk();
      } else if (r.status === 402 && j.reason === "not_enough") {
        setLeft(j); pro.short = true; pro.asked = null;
      } else if (r.status === 402 && j.reason === "daily_cap") {
        setLeft(j); pro.asked = null;
        pro.notice = "Today's free credits are used up. Try again tomorrow, use a code, or open your question in each AI below.";
      } else if (r.status === 429) {
        pro.asked = null; pro.notice = "Please wait a few seconds before asking again.";
      } else if (r.status === 400 && j.error === "bad_models") {
        setModels(j.models); pro.asked = null; pro.notice = "The list of AIs changed. Check your ticks and ask again.";
      } else if (r.status === 400 && (j.error === "bad_attachments" || j.error === "attachments_too_big")) {
        pro.asked = null; pro.notice = FILES_REFUSED;
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
        try { history.replaceState(history.state, "", location.pathname + "#ask"); } catch (e) {}
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
    if ((e.key === "Enter" || e.key === " ") && e.target && e.target.name === "mopt") { chooseSame(e.target); return; }   // Chrome sends no click for Space on a checked radio
    if (e.key !== "Tab") return;
    var f = [].slice.call(document.querySelectorAll('#modelsheet .sheet button, #modelsheet input[name="mopt"]:checked'));
    if (!f.length) return;
    var i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    else if (i < 0) { e.preventDefault(); f[0].focus(); }
  });
  document.addEventListener("click", function (e) {
    if (e.target && e.target.name === "mopt" && pro.sheet) chooseSame(e.target);
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
    if (e.target && e.target.id === "raceb3") { race.best3 = !!e.target.checked; race.short = false; askRedraw("#raceb3"); return; }
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
      setPick([tp[0]]); setChoice(tp[0], tp[1]); goTab("ask");
      var qb2 = document.getElementById("askq"); if (qb2) qb2.focus();
      return;
    }
    if (e.target.closest("#rmoreais")) { race.moreOpen = !raceMoreOpen(getRacePick(), proModels()); askRedraw("#rmoreais"); return; }
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
    var so = e.target.closest("[data-story]");
    if (so) {
      e.preventDefault();
      var sp = so.getAttribute("data-story").split("|");
      showStory({ src: sp[0], i: +sp[1] }, true, { tab: state.tab, more: state.more, y: window.scrollY });
      return;
    }
    if (e.target.closest("[data-storyback]")) {
      if (history.state && history.state.aitStory) history.back();     // same as the phone's Back (popstate below)
      else closeStory();
      return;
    }
    var t = e.target.closest("[data-tab],[data-more],[data-less]");
    if (!t) return;
    if (t.hasAttribute("data-tab")) { e.preventDefault(); goTab(t.getAttribute("data-tab")); }
    else if (t.hasAttribute("data-more")) { e.preventDefault(); go(t.getAttribute("data-more"), true, false, true); }
    else if (t.hasAttribute("data-less")) {
      if (history.state && history.state.aitMore) history.back();      // same as the phone's Back (popstate below)
      else go(state.tab, false);
    }
  });
  window.addEventListener("popstate", function () { applyRoute(routeFor(location.hash)); });
  document.addEventListener("toggle", function (e) {
    var d = e.target;
    if (d && d.tagName === "DETAILS" && d.id) state.open[d.id] = d.open;
  }, true);
  window.addEventListener("hashchange", function () { applyRoute(routeFor(location.hash)); });

  // light / dark follows the phone's setting only (v16f): forget a manual choice saved by an older version
  try { localStorage.removeItem("ait-theme"); } catch (e) {}
  document.documentElement.removeAttribute("data-theme");

  // fresh data from the network (the service worker falls back to the saved copy when offline)
  var btn = document.getElementById("refresh");
  var offline = document.getElementById("offline");
  // the refresh button says what happened, for about 2 s: "Updated", "You're offline" or "Couldn't check right now"
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2000);
  }
  function pull(manual) {
    if (!window.fetch) return;
    if (manual) btn.classList.add("spin");
    var fresh = false;
    fetch("data/data.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (nd) {
        if (nd && nd.built && (!D || nd.built !== D.built)) { fresh = true; D = oneWinner(nd); if (state.tab === "ask") setStamp(); else render(); } else setStamp();   // don't redraw the Ask box while typing
        return true;
      }, function () { return false; })
      .then(function (ok) {
        btn.classList.remove("spin");
        showOffline();
        if (manual) toast(isOffline() ? "You're offline" : ok ? "Updated" : "Couldn't check right now");
      });
  }
  btn.addEventListener("click", function () { pull(true); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { setStamp(); pull(false); } });
  // the offline bar follows navigator.onLine (the saved copy answers the data request, so a fetch can't tell);
  // with nothing saved, the view says so instead. Explore and Race redraw so Ask / Start are off while offline.
  function showOffline() {
    if (!isOffline()) { offline.hidden = true; return; }
    if (D) offline.hidden = false; else { offline.hidden = true; if (state.tab !== "ask" && state.tab !== "race") render(); }
  }
  function netChanged() {
    showOffline();
    if (state.tab === "ask" || state.tab === "race") {
      var a = document.activeElement, keep = a && (a.id === "askq" || a.id === "raceq") ? "#" + a.id : null;
      var s1 = keep ? a.selectionStart : null, s2 = keep ? a.selectionEnd : null;
      askRedraw(keep);
      var nb = keep && document.querySelector(keep);
      if (nb && s1 != null) { try { nb.setSelectionRange(s1, s2); } catch (e) {} }
    }
  }
  window.addEventListener("online", function () { netChanged(); pull(false); });
  window.addEventListener("offline", netChanged);

  // ---- files: libraries, readers and the attach events (v16f)
  // Each library is loaded once, only when a file of its type is attached, from an exact version with SRI (the browser
  // refuses a file whose hash doesn't match). pdf.js is a module: its worker is fetched with the same check and started
  // from a blob, so it runs off the main thread.
  var PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/";
  var LIBS = {
    jszip: { url: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js", sri: "sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG", global: "JSZip" },
    xlsx: { url: "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js", sri: "sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT", global: "XLSX" },
    pdf: { url: PDFJS + "legacy/build/pdf.min.mjs", sri: "sha384-YzR7Q88uWohu1vX4vuDiPCeT46Pk8qPXuDLcDO7a/LOb6syUvYvYYcQclRT2VSPT", global: "pdfjsLib", module: true },
    pdfworker: { url: PDFJS + "legacy/build/pdf.worker.min.mjs", sri: "sha384-xmo046yHKZIFB8fX6VJCV8nUAOARH/5lJdjB/bgsbvRwnVXay7R4ebX/EkVjhHoT", global: "pdfjsWorker", module: true }
  };
  var libWait = {};
  function loadLib(key) {
    var L = LIBS[key];
    if (root[L.global]) return Promise.resolve(root[L.global]);
    if (!libWait[key]) {
      libWait[key] = new Promise(function (ok, no) {
        var sc = document.createElement("script");
        if (L.module) sc.type = "module";
        sc.src = L.url; sc.integrity = L.sri; sc.crossOrigin = "anonymous"; sc.async = true;
        sc.onload = function () { if (root[L.global]) ok(root[L.global]); else no(new Error("lib")); };
        sc.onerror = function () { no(new Error("lib")); };
        document.head.appendChild(sc);
      });
      libWait[key].catch(function () { delete libWait[key]; });        // a failed load (offline) can be tried again
    }
    return libWait[key];
  }
  var pdfReady = null;
  function pdfLib() {
    if (pdfReady) return pdfReady;
    pdfReady = loadLib("pdf").then(function (lib) {
      return fetch(LIBS.pdfworker.url, { integrity: LIBS.pdfworker.sri, mode: "cors", credentials: "omit" })
        .then(function (r) { if (!r.ok) throw new Error("worker"); return r.blob(); })
        .then(function (b) { lib.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([b], { type: "text/javascript" })), { type: "module" }); return lib; })
        .catch(function () { return loadLib("pdfworker").then(function () { return lib; }); });   // no module workers: read on the page
    });
    pdfReady.catch(function () { pdfReady = null; });
    return pdfReady;
  }
  function readErr(text) { var e = new Error(text); e.userMsg = text; return e; }
  var LIB_FAIL = "couldn't be read right now. Check your connection and try again.";
  function lib(key) { return (key === "pdf" ? pdfLib() : loadLib(key)).catch(function () { throw readErr(LIB_FAIL); }); }
  function buf(file) { return file.arrayBuffer ? file.arrayBuffer() : new Response(file).arrayBuffer(); }
  // the text of a Word or PowerPoint XML part: paragraphs on their own lines, tabs and line breaks kept; a table comes out
  // one row per line with its cells split by a tab
  function ooxmlText(xml) {
    var doc = new DOMParser().parseFromString(xml, "application/xml"), out = [];
    (function walk(n, cell) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        var t = c.localName;
        if (t === "t") out.push(c.textContent);
        else if (t === "tab") out.push("\t");
        else if (t === "br" || t === "cr") out.push(cell ? " " : "\n");
        else if (t === "tc") { walk(c, true); out.push("\t"); }
        else { walk(c, cell); if (t === "p") out.push(cell ? " " : "\n"); else if (t === "tr") out.push("\n"); }
      }
    })(doc.documentElement, false);
    return out.join("").replace(/ +\t/g, "\t").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function zipOf(file) {
    return lib("jszip").then(function (JSZip) {
      return buf(file).then(function (b) { return JSZip.loadAsync(b); }).catch(function () { throw readErr("couldn't be read. Is it password-protected?"); });
    });
  }
  var READERS = {
    text: function (file) { return file.text(); },
    pdf: function (file) {
      var task = null;
      return lib("pdf").then(function (pdfjs) {
        return buf(file).then(function (b) {
          task = pdfjs.getDocument({ data: new Uint8Array(b), cMapUrl: PDFJS + "cmaps/", cMapPacked: true, standardFontDataUrl: PDFJS + "standard_fonts/",
                                   isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
          return task.promise;
        });
      }).then(function (pdf) {
        var pages = [], n = 0, total = 0;
        function next() {
          if (n >= pdf.numPages || total > MAX_FILE_CHARS) { try { task.destroy(); } catch (e) {} return pages.join("\n\n"); }
          n++;
          return pdf.getPage(n).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
            var t = tc.items.map(function (i) { return (i.str || "") + (i.hasEOL ? "\n" : ""); }).join("").replace(/[ \t]+\n/g, "\n").trim();
            if (t) { pages.push("Page " + n + "\n" + t); total += t.length; }
            return next();
          });
        }
        return next();
      }, function (e) {
        if (e && e.name === "PasswordException") throw readErr("is password-protected.");
        throw e && e.userMsg ? e : readErr("couldn't be read.");
      }).then(function (t) { if (!t.trim()) throw readErr("has no text to read (a scanned PDF?)."); return t; });
    },
    sheet: function (file) {
      return lib("xlsx").then(function (XLSX) {
        return buf(file).then(function (b) {
          var wb;
          try { wb = XLSX.read(new Uint8Array(b), { type: "array" }); }
          catch (e) { throw readErr(/password|encrypt/i.test(String(e && e.message)) ? "is password-protected." : "couldn't be read."); }
          return wb.SheetNames.map(function (n) { return "Sheet: " + n + "\n" + XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false }).trim(); }).join("\n\n");
        });
      });
    },
    docx: function (file) {
      return zipOf(file).then(function (zip) {
        var part = zip.file("word/document.xml");
        if (!part) throw readErr("couldn't be read.");
        return part.async("string").then(ooxmlText);
      });
    },
    pptx: function (file) {
      return zipOf(file).then(function (zip) {
        var slides = zip.file(/^ppt\/slides\/slide\d+\.xml$/).sort(function (a, b) { return +a.name.match(/(\d+)\.xml$/)[1] - +b.name.match(/(\d+)\.xml$/)[1]; });
        if (!slides.length) throw readErr("couldn't be read.");
        return Promise.all(slides.map(function (f) { return f.async("string"); })).then(function (xs) {
          return xs.map(function (x, i) { return "Slide " + (i + 1) + "\n" + ooxmlText(x); }).join("\n\n");
        });
      });
    },
    // a picture: longest side at most 1600 px, sent as JPEG (quality 0.85); a small PNG that needs no shrinking is kept as it is
    image: function (file) {
      var url = URL.createObjectURL(file);
      return new Promise(function (ok, no) {
        var im = new Image();
        im.onload = function () { ok(im); };
        im.onerror = function () { no(readErr("couldn't be read.")); };
        im.src = url;
      }).then(function (im) {
        var w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, 1600 / Math.max(w, h, 1));
        if (k === 1 && file.type === "image/png" && file.size <= 1048576) {
          return new Promise(function (ok, no) { var fr = new FileReader(); fr.onload = function () { ok({ mime: "image/png", data: fr.result }); }; fr.onerror = no; fr.readAsDataURL(file); });
        }
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        var g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);              // transparent parts turn white, not black
        g.drawImage(im, 0, 0, c.width, c.height);
        var data = c.toDataURL("image/jpeg", 0.85);
        if (data.length > 3200000) data = c.toDataURL("image/jpeg", 0.7);         // stay under the helper's 2.5 MB per image
        return { mime: "image/jpeg", data: data };
      }).then(function (r) { URL.revokeObjectURL(url); return r; }, function (e) { URL.revokeObjectURL(url); throw e; });
    }
  };
  var fileSeq = 0;
  function fileState(w) { return w === "race" ? race : pro; }
  // redraw the tab the files belong to, keeping the cursor in the question / task box
  function filesRedraw(w) {
    if (state.tab !== (w === "race" ? "race" : "ask") || state.story) return;
    var a = document.activeElement, keep = a && (a.id === "askq" || a.id === "raceq") ? "#" + a.id : null;
    var s1 = keep ? a.selectionStart : null, s2 = keep ? a.selectionEnd : null;
    askRedraw(keep);
    var nb = keep && document.querySelector(keep);
    if (nb && s1 != null) { try { nb.setSelectionRange(s1, s2); } catch (e) {} }
  }
  function addFiles(w, picked) {
    var st = fileState(w), msgs = [];
    [].slice.call(picked || []).forEach(function (file) {
      var k = fileKind(file.name);
      if (st.files.length >= FILE_MAX) { if (msgs.indexOf("Up to 3 files. Remove one to add another.") < 0) msgs.push("Up to 3 files. Remove one to add another."); return; }
      if (k === "olddoc") return msgs.push(file.name + ": save it as .docx first.");
      if (k === "oldppt") return msgs.push(file.name + ": save it as .pptx first.");
      if (!k) return msgs.push(file.name + ": this file type isn't supported.");
      if (file.size > FILE_MAX_BYTES) return msgs.push(file.name + " is over 50 MB.");
      var f = { id: ++fileSeq, name: file.name, size: file.size, kind: k, status: "reading" };
      st.files.push(f);
      READERS[k](file).then(function (r) {
        if (st.files.indexOf(f) < 0) return;                                     // removed while it was being read
        if (k === "image") { f.mime = r.mime; f.data = r.data; }
        else {
          var t = String(r || "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
          if (!t.trim()) throw readErr("is empty.");
          f.text = t.length > MAX_FILE_CHARS ? t.slice(0, MAX_FILE_CHARS + 1) : t;  // more than any model reads; enough to know it was cut
        }
        f.status = "ok";
        filesRedraw(w);
      }).catch(function (e) {
        var i = st.files.indexOf(f);
        if (i < 0) return;
        st.files.splice(i, 1);
        st.fileMsg = file.name + " " + (e && e.userMsg ? e.userMsg : (isOffline() ? "couldn't be read while offline." : "couldn't be read."));
        filesRedraw(w);
      });
    });
    st.fileMsg = msgs.join(" ");
    st.short = false;
    filesRedraw(w);
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    var b = e.target.closest("[data-attach]");
    if (b) { var inp = document.getElementById(b.getAttribute("data-attach") + "file"); if (inp) inp.click(); return; }
    var x = e.target.closest("[data-fremove]");
    if (x) {
      var p = x.getAttribute("data-fremove").split("|"), st = fileState(p[0]);
      st.files = st.files.filter(function (f) { return String(f.id) !== p[1]; });
      st.fileMsg = "";
      filesRedraw(p[0]);
      var again = document.querySelector('[data-attach="' + p[0] + '"]'); if (again && !document.activeElement.closest("textarea")) again.focus();
    }
  });
  document.addEventListener("change", function (e) {
    var w = e.target && e.target.getAttribute && e.target.getAttribute("data-filein");
    if (!w) return;
    addFiles(w, e.target.files);
    e.target.value = "";
  });

  // ---- New releases: the sheet about one model (v16f3). Same sheet as the model picker; closes on ×, the backdrop and
  // Escape; focus goes to × when it opens and back to the model's card when it closes; Tab stays inside it.
  var relFrom = null;
  function relOpen() { var w = document.getElementById("relsheet"); return !!(w && !w.hidden); }
  function openRel(key, from) {
    var r = relFind(key);
    if (!r) return;
    var wrap = document.getElementById("relsheet");
    if (!wrap) { wrap = document.createElement("div"); wrap.id = "relsheet"; wrap.className = "sheetwrap"; document.body.appendChild(wrap); }
    wrap.innerHTML = relSheetHtml(r); wrap.hidden = false; relFrom = from || null;
    document.documentElement.classList.add("sheetopen");
    var x = wrap.querySelector(".sheetx"); if (x) x.focus();
  }
  function closeRel(noFocus) {
    var wrap = document.getElementById("relsheet");
    if (!wrap || wrap.hidden) return;
    sheetGhost(wrap);
    wrap.hidden = true; wrap.innerHTML = "";
    if (!pro.sheet) document.documentElement.classList.remove("sheetopen");
    if (!noFocus && relFrom && document.body.contains(relFrom)) relFrom.focus();
    relFrom = null;
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    var b = e.target.closest("[data-rel]");
    if (b) { openRel(b.getAttribute("data-rel"), b); return; }
    if (e.target.closest("[data-relclose]")) { closeRel(); return; }
    var a = e.target.closest("[data-relask]");
    if (a) {                                                                   // "Ask it": Explore with that AI and model chosen
      var tp = a.getAttribute("data-relask").split("|");
      closeRel(true);
      setPick([tp[0]]); setChoice(tp[0], tp[1]); goTab("ask");
      var qb = document.getElementById("askq"); if (qb) qb.focus();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (!relOpen()) return;
    if (e.key === "Escape") { e.preventDefault(); closeRel(); return; }
    if (e.key !== "Tab") return;
    var f = [].slice.call(document.querySelectorAll("#relsheet .sheet button, #relsheet .sheet a[href]"));
    var i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
  });
  // a maker logo that can't load (offline, missing file) shows its letter instead
  document.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t.tagName === "IMG" && t.parentNode && t.parentNode.classList && t.parentNode.classList.contains("mlogo")) t.parentNode.classList.add("broken");
  }, true);

  // ---- "Install app" (header): only in a normal browser tab, never inside the installed app.
  // Chrome / Edge / Android: the browser's own prompt (beforeinstallprompt, kept until tapped; used once).
  // Everywhere else (iPhone / iPad Safari, in-app browsers, Firefox, prompt already used): a short sheet with the steps.
  var installBtn = document.getElementById("installbtn"), installEvt = null, installDone = false;
  function installMq(q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } }
  function isStandalone() {
    return installMq("(display-mode: standalone)") || installMq("(display-mode: fullscreen)") || installMq("(display-mode: minimal-ui)") || navigator.standalone === true;
  }
  function installSync() { if (installBtn) installBtn.hidden = installDone || isStandalone(); }
  function installSteps() {
    var ua = navigator.userAgent || "";
    var ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);     // iPadOS reports as a Mac
    var inApp = /WhatsApp|FBAN|FBAV|Instagram|; wv\)/.test(ua);
    var lines = { ios: "Tap Share, then Add to Home Screen.", app: "Tap ⋮, then Open in Chrome. Then tap ⋮ and Install app.",
                  other: "Open this page in Chrome or Safari and add it to your home screen." };
    var first = ios ? "ios" : /Android/.test(ua) && inApp ? "app" : "other";
    return { first: lines[first], rest: ["ios", "app", "other"].filter(function (k) { return k !== first; }).map(function (k) { return lines[k]; }) };
  }
  function openInstall() {
    var st = installSteps(), wrap = document.getElementById("installsheet");
    if (!wrap) { wrap = document.createElement("div"); wrap.id = "installsheet"; wrap.className = "sheetwrap"; document.body.appendChild(wrap); }
    wrap.innerHTML = '<div class="sheetback" data-installclose="1"></div>' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="installh"><div class="grabber" aria-hidden="true"></div>' +
      '<div class="sheethead"><h3 id="installh">Install AI Pro</h3>' +
      '<button type="button" class="sheetx" data-installclose="1" aria-label="Close"><span aria-hidden="true">×</span></button></div>' +
      '<p class="istep">' + esc(st.first) + '</p><ul class="iother">' + st.rest.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
      '<button type="button" class="sheetdone" data-installclose="1">Done</button></div>';
    wrap.hidden = false;
    document.documentElement.classList.add("sheetopen");
    var done = wrap.querySelector(".sheetdone"); if (done) done.focus();
  }
  function closeInstall() {
    var wrap = document.getElementById("installsheet");
    if (!wrap || wrap.hidden) return;
    sheetGhost(wrap);
    wrap.hidden = true; wrap.innerHTML = "";
    if (!pro.sheet) document.documentElement.classList.remove("sheetopen");
    if (installBtn && !installBtn.hidden) installBtn.focus();
  }
  function installOpen() { var w = document.getElementById("installsheet"); return !!(w && !w.hidden); }
  if (installBtn) {
    installBtn.addEventListener("click", function () {
      if (!installEvt) { openInstall(); return; }
      var ev = installEvt; installEvt = null;                              // a prompt can be used once
      try {
        ev.prompt();
        Promise.resolve(ev.userChoice).then(function (c) { if (c && c.outcome === "accepted") { installDone = true; installSync(); } }, function () {});
      } catch (e) { openInstall(); }
    });
  }
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); installEvt = e; installSync(); });
  window.addEventListener("appinstalled", function () { installDone = true; installEvt = null; closeInstall(); installSync(); });
  ["(display-mode: standalone)", "(display-mode: fullscreen)", "(display-mode: minimal-ui)"].forEach(function (q) {
    try { var m = window.matchMedia(q); if (m.addEventListener) m.addEventListener("change", installSync); else if (m.addListener) m.addListener(installSync); } catch (e) {}
  });
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("[data-installclose]")) closeInstall(); });
  document.addEventListener("keydown", function (e) {
    if (!installOpen()) return;
    if (e.key === "Escape") { e.preventDefault(); closeInstall(); return; }
    if (e.key !== "Tab") return;                                             // Tab stays inside the sheet
    var f = [].slice.call(document.querySelectorAll("#installsheet .sheet button"));
    var i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
  });
  installSync();

  var start = routeFor(location.hash) || { tab: "home", more: false };
  // back from Stripe: ?session_id=cs_...#ask -> turn the payment into a code (the helper checks it with Stripe)
  var sm = /[?&]session_id=(cs_[A-Za-z0-9_]{3,250})/.exec(location.search);
  if (sm && CONFIG.ASK_API) { sessionId = sm[1]; start = { tab: "ask", more: false }; redeem(); }
  else loadLeft();
  // v17f: the installed app opens on Home when it is launched (not on a reload or Back/Forward), whatever start URL the
  // home-screen icon kept from an older install (#best). The Stripe return above still opens Ask.
  var navType = (function () {
    try { var en = performance.getEntriesByType && performance.getEntriesByType("navigation")[0]; if (en && en.type) return en.type; } catch (e) {}
    try { var t = performance.navigation && performance.navigation.type; return t === 1 ? "reload" : t === 2 ? "back_forward" : "navigate"; } catch (e) {}
    return "navigate";
  })();
  if (!sm && navType === "navigate" && isStandalone()) {
    start = { tab: "home", more: false };
    try { history.replaceState(null, "", location.pathname + "#home"); } catch (e) {}
  }
  // a deep link (#news, #best-more, #story/news/2): Home first, then its tab, then the page, so Back walks down to Home
  if (start.tab !== "home" && !histD()) {
    try {
      history.replaceState(null, "", location.pathname + "#home");
      history.pushState({ aitTab: 1, d: 1 }, "", location.pathname + "#" + start.tab);
      if (start.more) history.pushState({ aitMore: 1, d: 2 }, "", location.pathname + "#" + start.tab + "-more");
    } catch (e) {}
  }
  go(start.tab, start.more, true);
  showOffline();
  if (start.story) showStory(start.story, true, { tab: start.tab, more: false, y: 0 });   // a shared #story/… link
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
