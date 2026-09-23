import { renderChart } from './chart.js';
import { gh, guessRepo, WORKFLOW, TEST_WORKFLOW } from './github.js';
import { enablePush, disablePush, pushStatus, isIOS, isStandalone } from './push.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const COLORS = { G4: '#00f0ff', G5: '#ff2bd6', G6: '#b6ff3b' };
const MODELS = ['G4', 'G5', 'G6'];
const COND_LABEL = { new: 'NEW', refurbished: '2ND CHANCE', used: 'USED' };
const eur = (n) => (n == null ? '—' : '€' + Math.round(n).toLocaleString('nl-NL'));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem('oh.' + k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('oh.' + k, JSON.stringify(v)); } catch {} },
};

const state = {
  deals: null,
  history: {},
  model: store.get('model', 'ALL'),
  cond: store.get('cond', 'all'),
  sort: store.get('sort', 'price'),
  range: store.get('range', 30),
  tvModel: 'G5',
  scanning: false,
};

// ------------------------------------------------------------------ utils
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
function nextNoon() {
  const now = new Date();
  const ams = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
  const target = new Date(ams);
  target.setHours(12, 0, 0, 0);
  if (ams >= target) target.setDate(target.getDate() + 1);
  const mins = Math.round((target - ams) / 60000);
  return mins > 90 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

// ------------------------------------------------------------------ data
async function loadData({ fresh = false } = {}) {
  let deals, history;
  if (gh.connected && fresh) {
    try {
      [deals, history] = await Promise.all([gh.file('data/deals.json').then(JSON.parse), gh.file('data/history.json').then(JSON.parse)]);
    } catch (e) {
      console.warn('API data failed, using site data', e);
    }
  }
  if (!deals) {
    const bust = fresh ? `?t=${Date.now()}` : '';
    const [d, h] = await Promise.all([
      fetch('data/deals.json' + bust, { cache: fresh ? 'no-store' : 'default' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('data/history.json' + bust, { cache: fresh ? 'no-store' : 'default' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    deals = d;
    history = h;
  }
  if (deals) {
    state.deals = deals;
    state.history = history || {};
    store.set('cache', { deals, history });
  } else {
    const c = store.get('cache', null);
    if (c) Object.assign(state, { deals: c.deals, history: c.history });
  }
  render();
}

function offers() {
  return state.deals?.offers || [];
}
function bestFor(m, conds = ['new']) {
  const b = state.deals?.best?.[m] || {};
  return conds.map((c) => b[c]).filter(Boolean).sort((a, z) => a.price - z.price)[0] || null;
}

// ------------------------------------------------------------------ render
function render() {
  const d = state.deals;
  // header
  const okSrc = d?.sources?.filter((s) => s.ok).length ?? 0;
  $('#lastScan').textContent = d
    ? `scan ${ago(d.generatedAt)} · ${okSrc} sources · ${offers().length} deals · next ${nextNoon()}`
    : 'no data yet: tap SCAN';
  const live = $('#liveDot');
  live.className = 'live ' + (state.scanning ? 'busy' : !d ? '' : Date.now() - new Date(d.generatedAt) < 26 * 3600e3 ? 'ok' : 'warn');
  $('#liveText').textContent = state.scanning ? 'SCAN' : !d ? '—' : Date.now() - new Date(d.generatedAt) < 26 * 3600e3 ? 'LIVE' : 'OLD';

  renderSeg();
  renderHero();
  renderTiles();
  renderChartCard();
  renderDeals();
  renderSources();
  updateTV();
}

function renderSeg() {
  const idx = ['ALL', ...MODELS].indexOf(state.model);
  $$('#modelSeg button').forEach((b) => b.classList.toggle('on', b.dataset.model === state.model));
  const g = $('.seg-glider');
  g.style.transform = `translateX(${idx * 100}%)`;
  g.style.setProperty('--gc', COLORS[state.model] || '#00f0ff');
}

function renderHero() {
  const el = $('#hero');
  const models = state.model === 'ALL' ? MODELS : [state.model];
  const conds = state.cond === 'all' ? ['new', 'refurbished', 'used'] : [state.cond];
  const cands = models.map((m) => bestFor(m, conds)).filter(Boolean).sort((a, b) => a.price - b.price);
  const top = cands[0];
  if (!state.deals) {
    el.innerHTML = '<div class="skeleton" style="grid-column:1/-1;height:80px"></div>';
    return;
  }
  if (!top) {
    el.innerHTML = `<div class="label">BEST NOW</div><div class="empty">No ${state.model === 'ALL' ? '' : state.model + ' '}offers found in the last scan. Tap <b>SCAN</b>, or check the sources below.</div>`;
    return;
  }
  const st = state.deals.stats?.[top.model] || {};
  const atl = st.allTimeLow && top.condition === 'new' && top.price <= st.allTimeLow;
  const delta = top.condition === 'new' && st.changeVsPrev ? st.changeVsPrev : null;
  el.innerHTML = `
    <div class="label">BEST NOW${atl ? ' · ALL-TIME LOW 🔥' : ''}</div>
    <div>
      <div class="price">${eur(top.price)}${top.oldPrice ? `<span class="was">${eur(top.oldPrice)}</span>` : ''}</div>
      <div class="meta"><b style="color:${COLORS[top.model]}">${top.model}</b> · <b>${esc(top.shop)}</b> · ${COND_LABEL[top.condition]}${top.inStock === false ? ' · out of stock' : ''}
      ${delta ? `<span class="${delta < 0 ? 'down' : 'up'}"> ${delta < 0 ? '▼' : '▲'} ${eur(Math.abs(delta))} vs yesterday</span>` : ''}</div>
    </div>
    <a class="btn primary open" href="${safeUrl(top.url)}" target="_blank" rel="noopener">OPEN ↗</a>`;
}

function renderTiles() {
  const el = $('#tiles');
  el.innerHTML = MODELS.map((m) => {
    const n = bestFor(m, ['new']);
    const s2 = bestFor(m, ['refurbished', 'used']);
    const st = state.deals?.stats?.[m] || {};
    const ch = st.changeVsPrev;
    return `<button class="tile ${state.model === m ? 'on' : ''}" data-model="${m}" style="--c:${COLORS[m]}">
      <div><span class="m">${m}</span><span class="y">${state.deals?.models?.[m]?.year || ''}</span></div>
      <div class="p">${eur(n?.price)}</div>
      <div class="s">${n ? esc(n.shop) : 'no new offer'}</div>
      <div class="s">2nd: ${s2 ? eur(s2.price) : '—'}</div>
      ${ch ? `<div class="d ${ch < 0 ? 'down' : 'up'}">${ch < 0 ? '▼' : '▲'} ${eur(Math.abs(ch))}</div>` : st.allTimeLow ? `<div class="d muted">low ${eur(st.allTimeLow)}</div>` : ''}
    </button>`;
  }).join('');
}

function renderChartCard() {
  $$('#rangePills button').forEach((b) => b.classList.toggle('on', Number(b.dataset.range) === state.range));
  renderChart($('#chart'), $('#legend'), state.history, {
    models: state.model === 'ALL' ? MODELS : [state.model],
    rangeDays: state.range,
    showSecond: state.model !== 'ALL',
  });
}

function renderDeals() {
  const ul = $('#deals');
  $$('#condChips button').forEach((b) => b.classList.toggle('on', b.dataset.cond === state.cond));
  $('#sortSel').value = state.sort;
  if (!state.deals) {
    ul.innerHTML = '<li class="skeleton"></li><li class="skeleton"></li><li class="skeleton"></li>';
    return;
  }
  let list = offers().filter((o) => (state.model === 'ALL' || o.model === state.model) && (state.cond === 'all' || o.condition === state.cond));
  const disc = (o) => (o.oldPrice ? (o.oldPrice - o.price) / o.oldPrice : 0);
  if (state.sort === 'price') list.sort((a, b) => a.price - b.price);
  if (state.sort === 'discount') list.sort((a, b) => disc(b) - disc(a) || a.price - b.price);
  if (state.sort === 'new') list.sort((a, b) => new Date(b.firstSeen) - new Date(a.firstSeen));
  $('#dealCount').textContent = list.length ? `(${list.length})` : '';
  if (!list.length) {
    ul.innerHTML = '<li class="empty-list">Nothing here yet. Try another filter, or tap SCAN.</li>';
    return;
  }
  const lowest = {};
  for (const o of offers()) if (o.condition === 'new' && (!lowest[o.model] || o.price < lowest[o.model])) lowest[o.model] = o.price;
  ul.innerHTML = list.slice(0, 80).map((o, i) => {
    const drop = o.prevPrice && o.prevPrice > o.price;
    const badges = [
      `<span class="badge ${o.condition}">${COND_LABEL[o.condition]}</span>`,
      o.condition === 'new' && o.price === lowest[o.model] ? '<span class="badge hot">LOWEST</span>' : '',
      drop ? `<span class="badge hot">▼ ${eur(o.prevPrice - o.price)}</span>` : '',
      o.aggregator ? '<span class="badge muted">COMPARE</span>' : '',
      o.stale ? '<span class="badge muted">STALE</span>' : '',
      o.inStock === false ? '<span class="badge muted">OUT OF STOCK</span>' : '',
      o.priceType ? `<span class="badge muted">${esc(o.priceType).toUpperCase()}</span>` : '',
    ].join('');
    return `<li><a class="deal" style="--i:${i};--c:${COLORS[o.model]}" href="${safeUrl(o.url)}" target="_blank" rel="noopener">
      <span class="av">${o.model}</span>
      <span class="t"><span class="shop">${esc(o.shop)}</span><span class="ti">${esc(o.title)}${o.location ? ' · ' + esc(o.location) : ''}</span><span class="badges">${badges}</span></span>
      <span class="pr"><b>${eur(o.price)}</b>${o.oldPrice ? `<s>${eur(o.oldPrice)}</s> ` : ''}<span class="go">open ↗</span></span>
    </a></li>`;
  }).join('');
}

function renderSources() {
  const src = state.deals?.sources || [];
  $('#srcDots').innerHTML = src.map((s) => `<i class="${!s.ok ? 'bad' : s.found ? '' : 'zero'}" title="${esc(s.name)}"></i>`).join('');
  $('#srcSum').textContent = src.length ? `${src.filter((s) => s.ok).length}/${src.length} OK` : '';
  $('#sources').innerHTML = src.map((s) => `<li><span>${s.ok ? (s.found ? '🟢' : '🟡') : '🔴'}</span><span>${esc(s.name)} <span class="muted small">${s.kind}</span></span><b>${s.found}</b>${s.lastError && !s.ok ? `<em>${esc(s.lastError)}</em>` : ''}</li>`).join('');
}

// ------------------------------------------------------------------ 3D TV
let tv = null;
async function initTV() {
  const stage = $('#stage');
  try {
    const c = document.createElement('canvas');
    if (!(c.getContext('webgl2') || c.getContext('webgl'))) throw new Error('no webgl');
    const { createTV } = await import('./tv3d.js');
    tv = createTV(stage, {
      onTap: () => {
        const i = MODELS.indexOf(state.tvModel);
        state.tvModel = MODELS[(i + 1) % 3];
        tv.spin();
        updateTV();
        navigator.vibrate?.(8);
      },
    });
    updateTV();
  } catch (e) {
    console.warn('3D unavailable', e);
    $('#stageFallback').hidden = false;
    $('.stage-hud .hint').textContent = '';
    updateTV();
  }
}
function updateTV() {
  const m = state.tvModel;
  const b = bestFor(m, ['new', 'refurbished', 'used']);
  const year = state.deals?.models?.[m]?.year || { G4: 2024, G5: 2025, G6: 2026 }[m];
  $('#stageModel').textContent = `${m} · ${year}`;
  $('#stageModel').style.color = COLORS[m];
  const info = {
    model: m,
    price: b?.price,
    label: state.scanning ? 'SCANNING ALL SHOPS…' : b ? `${b.shop} · ${COND_LABEL[b.condition]}` : state.deals ? 'NO OFFERS YET' : 'LOADING…',
    accent: COLORS[m],
  };
  tv?.setInfo(info);
  const fb = $('#stageFallback');
  if (!fb.hidden) fb.innerHTML = `<div><div style="color:${COLORS[m]}">${m} · 83"</div><div>${eur(info.price)}</div><div class="small muted">${esc(info.label)}</div></div>`;
}

// ------------------------------------------------------------------ scan
async function scan() {
  if (state.scanning) return;
  navigator.vibrate?.(12);
  if (!gh.connected) {
    setScanning(true, 'Fetching latest data…');
    await loadData({ fresh: true });
    setScanning(false);
    toast(`Latest scan: ${ago(state.deals?.generatedAt)}. Connect GitHub in ⚙ for live scans.`, 4500);
    return;
  }
  const since = Date.now();
  setScanning(true, 'Starting scan on GitHub…', 0.05);
  try {
    await gh.dispatch(WORKFLOW, { notify: 'false' });
    let run = null;
    for (let i = 0; i < 30 && !run; i++) {
      await sleep(2500);
      run = await gh.latestRun(WORKFLOW, since);
      setScanning(true, 'Queued: waiting for a runner…', 0.1);
    }
    if (!run) throw new Error('Scan did not start (check Actions is enabled)');
    const t0 = Date.now();
    while (true) {
      await sleep(4000);
      const r = await gh.run(run.id);
      if (r.status === 'completed') {
        if (r.conclusion !== 'success') throw new Error(`Scan ${r.conclusion}. See GitHub → Actions.`);
        break;
      }
      let label = r.status === 'queued' ? 'Queued…' : 'Scanning shops…';
      let prog = Math.min(0.9, 0.15 + (Date.now() - t0) / 240000);
      try {
        const jobs = await gh.jobs(run.id);
        const steps = jobs[0]?.steps || [];
        const cur = steps.find((s) => s.status === 'in_progress');
        const done = steps.filter((s) => s.status === 'completed').length;
        if (steps.length) prog = Math.max(prog, done / steps.length);
        if (cur) label = cur.name;
      } catch {}
      setScanning(true, label, prog);
      if (Date.now() - t0 > 15 * 60e3) throw new Error('Scan is taking too long; it will keep running on GitHub.');
    }
    setScanning(true, 'Loading results…', 0.97);
    const before = state.deals?.generatedAt;
    await loadData({ fresh: true });
    setScanning(false);
    toast(state.deals?.generatedAt !== before ? `✓ Scan done: ${offers().length} deals` : 'Scan finished; data unchanged.');
    tv?.spin();
  } catch (e) {
    setScanning(false);
    toast('⚠ ' + e.message, 6000);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setScanning(on, label = '', prog = 0) {
  state.scanning = on;
  $('#scanBtn').classList.toggle('busy', on);
  $('#scanLabel').textContent = on ? 'SCANNING' : 'SCAN';
  $('.scan-fab .ring circle').style.strokeDashoffset = String(182 * (1 - prog));
  const st = $('#scanStatus');
  st.hidden = !on;
  st.textContent = label;
  $('#liveDot').className = 'live ' + (on ? 'busy' : 'ok');
  $('#liveText').textContent = on ? 'SCAN' : 'LIVE';
  updateTV();
}

// ------------------------------------------------------------------ settings
function openSheet(open) {
  $('#sheet').classList.toggle('open', open);
  $('#sheet').setAttribute('aria-hidden', String(!open));
  $('#sheetBackdrop').hidden = !open;
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) refreshSettings();
}
async function refreshSettings() {
  $('#repoIn').value = gh.repo || guessRepo(state.deals?.repo);
  $('#tokenIn').value = gh.token ? '••••••••••••' : '';
  $('#ghState').innerHTML = gh.connected ? `<span class="ok-text">✓ Connected to ${esc(gh.repo)}</span>` : '<span class="muted">Not connected: SCAN only reloads the latest data.</span>';
  $('#alertBelow').value = store.get('alertBelow', '') || '';
  $('#ntfyTopic').value = store.get('ntfy', '') || '';
  const ps = await pushStatus().catch(() => ({ state: 'unsupported' }));
  const msg = {
    subscribed: '<span class="ok-text">✓ Push is on. You will get the best deals every day at 12:00.</span>',
    off: 'Push is off.',
    denied: '<span class="err-text">Notifications are blocked. Allow them in iOS Settings → Notifications → OLED Hunt.</span>',
    install: 'Install the app first: Share → Add to Home Screen, then open it from your home screen.',
    unsupported: 'Push is not supported in this browser.',
  }[ps.state];
  $('#pushState').innerHTML = msg;
  $('#pushBtn').textContent = ps.state === 'subscribed' ? 'Disable push' : 'Enable push';
  $('#pushBtn').dataset.state = ps.state;
}

async function withBusy(btn, fn) {
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '…';
  try { await fn(); } catch (e) { toast('⚠ ' + e.message, 6000); } finally { btn.disabled = false; btn.textContent = old; refreshSettings(); }
}

function bind() {
  $('#scanBtn').addEventListener('click', scan);
  $('#settingsBtn').addEventListener('click', () => openSheet(true));
  $('#closeSheet').addEventListener('click', () => openSheet(false));
  $('#sheetBackdrop').addEventListener('click', () => openSheet(false));
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => { $('#' + b.dataset.close).hidden = true; store.set('hideInstall', true); }));

  // swipe down to close sheet
  let sy = null;
  $('#sheet').addEventListener('touchstart', (e) => { sy = $('#sheet').scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  $('#sheet').addEventListener('touchmove', (e) => { if (sy != null && e.touches[0].clientY - sy > 90) { sy = null; openSheet(false); } }, { passive: true });

  $('#modelSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setModel(b.dataset.model);
  });
  $('#tiles').addEventListener('click', (e) => {
    const b = e.target.closest('.tile');
    if (b) setModel(state.model === b.dataset.model ? 'ALL' : b.dataset.model);
  });
  $('#condChips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.cond = b.dataset.cond;
    store.set('cond', state.cond);
    renderHero();
    renderDeals();
  });
  $('#sortSel').addEventListener('change', (e) => { state.sort = e.target.value; store.set('sort', state.sort); renderDeals(); });
  $('#rangePills').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.range = Number(b.dataset.range);
    store.set('range', state.range);
    renderChartCard();
  });

  $('#tokenHelp').addEventListener('click', (e) => { e.preventDefault(); $('#tokenHelpBox').hidden = !$('#tokenHelpBox').hidden; });
  $('#connectBtn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const repo = $('#repoIn').value.trim();
    const tokenVal = $('#tokenIn').value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repository must look like owner/name');
    gh.save(repo, tokenVal.startsWith('•') ? undefined : tokenVal);
    if (!gh.token) throw new Error('Paste a token first');
    const r = await gh.test();
    toast(`✓ Connected to ${r.full_name}`);
    // prefill remote settings
    gh.getVar('ALERT_BELOW').then((v) => v && store.set('alertBelow', v)).catch(() => {});
    gh.getVar('NTFY_TOPIC').then((v) => v && store.set('ntfy', v)).catch(() => {});
  }));
  $('#forgetBtn').addEventListener('click', () => { gh.forget(); toast('Token removed from this device'); refreshSettings(); });

  $('#pushBtn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    if (e.currentTarget.dataset.state === 'subscribed') {
      await disablePush();
      toast('Push disabled');
      return;
    }
    const r = await enablePush(state.deals?.push?.vapidPublicKey);
    if (r.saved) toast('✓ Push enabled. Tap "Send test" to try it.', 4500);
    else {
      await navigator.clipboard?.writeText(JSON.stringify(r.sub)).catch(() => {});
      toast('Subscribed, but not saved: connect GitHub so the daily scan knows where to send it.', 6000);
    }
  }));
  $('#testPushBtn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    if (!gh.connected) throw new Error('Connect GitHub first');
    await gh.dispatch(TEST_WORKFLOW, {});
    toast('Test push requested: it should arrive in ~30–60 s', 5000);
  }));
  $('#saveAlert').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const v = $('#alertBelow').value.replace(/\D/g, '');
    store.set('alertBelow', v);
    if (!gh.connected) throw new Error('Saved locally. Connect GitHub to activate server alerts.');
    await gh.setVar('ALERT_BELOW', v || '0');
    toast(v ? `✓ You'll get an alert when a price drops to €${v} or less` : 'Price alert removed');
  }));
  $('#saveNtfy').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const v = $('#ntfyTopic').value.trim();
    store.set('ntfy', v);
    if (!gh.connected) throw new Error('Connect GitHub first');
    await gh.setVar('NTFY_TOPIC', v || '-');
    toast(v ? `✓ Subscribe to "${v}" in the ntfy app` : 'ntfy disabled');
  }));
  $('#resetCache').addEventListener('click', async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map((r) => r.update()));
    location.reload();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      navigator.clearAppBadge?.().catch(() => {});
      if (state.deals && Date.now() - new Date(state.deals.generatedAt) > 3600e3) loadData({ fresh: true });
    }
  });
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderChartCard, 150); });
}

function setModel(m) {
  state.model = m;
  store.set('model', m);
  if (m !== 'ALL') {
    state.tvModel = m;
    tv?.spin();
  }
  navigator.vibrate?.(6);
  render();
}

// ------------------------------------------------------------------ boot
async function boot() {
  bind();
  if (state.model !== 'ALL') state.tvModel = state.model;
  const cached = store.get('cache', null);
  if (cached?.deals) Object.assign(state, { deals: cached.deals, history: cached.history || {} });
  render();
  initTV();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  if (isIOS() && !isStandalone() && !store.get('hideInstall', false)) $('#installHint').hidden = false;
  await loadData({ fresh: true });
  navigator.clearAppBadge?.().catch(() => {});
  if (new URLSearchParams(location.search).has('scan')) scan();
  setInterval(() => render(), 60_000);
}
boot();
