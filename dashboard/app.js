// Token Launch Radar dashboard. Renders window.RADAR (written beside
// dashboard/ by main.ts) as a sortable, filterable board with a detail view
// per protocol. No network: every byte it shows is in data.js.
// Views are deep-linkable for screenshots and sharing:
//   ?detail=<slug>  ?cat=<category>  ?q=<search>  ?watchlist=1
(function () {
  'use strict';
  var DATA = window.RADAR;
  var main = document.getElementById('board');
  if (!DATA || !DATA.rows) { main.innerHTML = '<p class="empty">No radar data: run main.ts first.</p>'; return; }

  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    watchlistOnly: params.get('watchlist') === '1',
    sort: 'rank',
    dir: 1,
    detail: params.get('detail') || '',
  };

  function fmt(n) {
    if (n === null || n === undefined) return '—';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined) return '<span class="cat">—</span>';
    var cls = n >= 0 ? 'pos' : 'neg';
    return '<span class="' + cls + '">' + (n >= 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'age unknown';
    if (days < 365) return days + 'd old';
    return (days / 365).toFixed(1) + 'y old';
  }

  var cats = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();

  function visible() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function sorted(rows) {
    var k = state.sort, d = state.dir;
    var val = function (r) {
      if (k === 'name') return r.name.toLowerCase();
      if (k === 'tvl') return r.tvl_usd;
      if (k === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
      if (k === 'implied') return r.implied_value_usd;
      return r.rank;
    };
    return rows.slice().sort(function (a, b) {
      var x = val(a), y = val(b);
      if (x < y) return -d; if (x > y) return d;
      return a.rank - b.rank;
    });
  }

  function detailHtml(r) {
    var m = r.model;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<section class="detail" id="detail">' +
      '<button class="close" data-close="1">Close ✕</button>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + (r.watchlist ? '<span class="wl">watchlist</span>' : '<span class="early">early</span>') + '</h2>' +
      '<div class="meta">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chains listed') +
      ' · TVL ' + fmt(r.tvl_usd) + ' · 7d ' + pct(r.change_7d) + ' · ' + ageLabel(r.age_days) +
      ' · records no token yet</div>' +
      '<div class="mult">' +
      '<div><span>Implied value</span><b class="implied">' + fmt(r.implied_value_usd) + '</b></div>' +
      '<div><span>TVL</span><b>' + fmt(r.tvl_usd) + '</b></div>' +
      '<div><span>Category ×</span><b>' + m.category_multiple.toFixed(2) + '</b></div>' +
      '<div><span>Momentum ×</span><b>' + m.momentum_multiplier.toFixed(2) + '</b></div>' +
      '<div><span>Breadth ×</span><b>' + m.breadth_multiplier.toFixed(2) + '</b></div>' +
      '<div><span>Maturity ×</span><b>' + m.maturity_multiplier.toFixed(2) + '</b></div>' +
      '</div>' +
      '<p class="meta">Implied value = TVL × category × momentum × breadth × maturity, from the snapshot\u2019s own figures only. Re-derive it: ' +
      fmt(r.tvl_usd) + ' × ' + m.category_multiple.toFixed(2) + ' × ' + m.momentum_multiplier.toFixed(2) + ' × ' +
      m.breadth_multiplier.toFixed(2) + ' × ' + m.maturity_multiplier.toFixed(2) + ' ≈ ' + fmt(r.implied_value_usd) + '.</p>' +
      '<h3>How to farm it</h3><ol class="steps">' + steps + '</ol></section>';
  }

  function render() {
    var rows = sorted(visible());
    var detail = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.detail) detail = r; });
    var top = DATA.rows[0];
    var html = '<header class="top"><div class="kicker">Token Launch Radar · model ' + esc(DATA.model_version) + '</div>' +
      '<h1>Pre-token protocols, ranked by what their token could be worth</h1>' +
      '<p class="sub">Every protocol in the sealed DefiLlama snapshot that records no token yet — the whole ' +
      DATA.watchlist_size + '-protocol watchlist plus ' + DATA.early_size + ' early finds below the ' + fmt(DATA.floor_usd) +
      ' floor — scored by one stated model and given a concrete farm plan. Snapshot as of ' + esc(DATA.as_of) + '.</p></header>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + DATA.board_size + '</b><span>protocols ranked</span></div>' +
      '<div class="stat"><b>' + fmt(DATA.total_implied_usd) + '</b><span>total implied value</span></div>' +
      '<div class="stat"><b>' + esc(top ? top.name : '—') + '</b><span>#1: ' + fmt(top ? top.implied_value_usd : 0) + ' implied</span></div>' +
      '<div class="stat"><b>' + DATA.watchlist_size + ' / ' + DATA.board_size + '</b><span>watchlist / board</span></div></div>' +
      '<div class="model"><b>The model (radar-2):</b> <code>implied = TVL × category × momentum × breadth × maturity</code> — ' +
      'category is what listed peers are worth per TVL dollar (DEX 0.85, lending 0.55, bridges 0.30, launchpads 1.15); ' +
      'momentum follows the 7-day TVL change, clamped; breadth rewards multi-chain reach; maturity rewards survival. ' +
      'No name is special-cased, and every row shows its four multipliers.</div>';

    html += '<div class="controls">' +
      '<label>Search<input id="f-q" type="search" placeholder="Name or slug" value="' + esc(state.q) + '"></label>' +
      '<label>Category<select id="f-cat"><option value="">All categories</option>' +
      cats.map(function (c) { return '<option' + (c === state.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      '<label>Chain<select id="f-chain"><option value="">All chains</option>' +
      chains.map(function (c) { return '<option' + (c === state.chain ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      '<label class="check"><input id="f-wl" type="checkbox"' + (state.watchlistOnly ? ' checked' : '') + '> Watchlist only</label>' +
      '</div><div class="count">Showing ' + rows.length + ' of ' + DATA.board_size + ' protocols — click any row for its model breakdown and farm plan.</div>';

    if (detail) html += detailHtml(detail);

    if (rows.length === 0) {
      html += '<div class="empty">No protocol matches those filters. Clear the search or pick another category.</div>';
    } else {
      var th = function (key, label, cls) {
        var arrow = state.sort === key ? (state.dir === 1 ? ' ↑' : ' ↓') : '';
        return '<th class="' + (cls || '') + '" data-sort="' + key + '">' + label + arrow + '</th>';
      };
      html += '<table><thead><tr>' + th('rank', '#') + th('name', 'Protocol') + '<th>Category</th><th class="chains">Chains</th>' +
        th('tvl', 'TVL', 'num') + th('change', '7d', 'num') + th('implied', 'Implied value', 'num') + '<th class="num">Age</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        html += '<tr class="row" data-slug="' + esc(r.slug) + '"><td class="rank">' + r.rank + '</td>' +
          '<td><span class="name">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="wl">watchlist</span>' : '<span class="early">early</span>') + '</td>' +
          '<td class="cat">' + esc(r.category || '—') + '</td>' +
          '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
          '<td class="num">' + fmt(r.tvl_usd) + '</td><td class="num">' + pct(r.change_7d) + '</td>' +
          '<td class="num implied">' + fmt(r.implied_value_usd) + '</td>' +
          '<td class="num cat">' + ageLabel(r.age_days) + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '<footer>Source: ' + esc(DATA.source) + '. A protocol here records no token on DefiLlama; that is not proof it has none. ' +
      'Implied values are this radar\u2019s model claims, not prices or advice. Farm plans carry real cost and smart-contract risk — size positions accordingly.</footer>';
    main.innerHTML = html;
    main.setAttribute('aria-busy', 'false');
    bind();
    if (detail) {
      var el = document.getElementById('detail');
      if (el && params.get('detail')) el.scrollIntoView();
    }
  }

  function bind() {
    var q = document.getElementById('f-q');
    q.addEventListener('input', function () { state.q = q.value; renderKeepFocus(); });
    var cat = document.getElementById('f-cat');
    cat.addEventListener('change', function () { state.cat = cat.value; render(); });
    var ch = document.getElementById('f-chain');
    ch.addEventListener('change', function () { state.chain = ch.value; render(); });
    var wl = document.getElementById('f-wl');
    wl.addEventListener('change', function () { state.watchlistOnly = wl.checked; render(); });
    Array.prototype.forEach.call(main.querySelectorAll('th[data-sort]'), function (t) {
      t.addEventListener('click', function () {
        var k = t.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' ? 1 : -1; if (k === 'rank') state.dir = 1; }
        render();
      });
    });
    Array.prototype.forEach.call(main.querySelectorAll('tr.row'), function (tr) {
      tr.addEventListener('click', function () {
        state.detail = state.detail === tr.getAttribute('data-slug') ? '' : tr.getAttribute('data-slug');
        render();
        var el = document.getElementById('detail');
        if (el) el.scrollIntoView();
      });
    });
    var close = main.querySelector('[data-close]');
    if (close) close.addEventListener('click', function () { state.detail = ''; render(); });
  }

  function renderKeepFocus() {
    var pos = document.getElementById('f-q').selectionStart;
    render();
    var q2 = document.getElementById('f-q');
    q2.focus(); q2.setSelectionRange(pos, pos);
  }

  render();
})();
