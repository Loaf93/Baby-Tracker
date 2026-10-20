import { Store, DEFAULT_SETTINGS } from './store.js';
import * as M from './model.js';

const { MIN, HOUR } = M;
const store = new Store();
window.__store = store; // handy for debugging in Safari dev tools

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = () => store.settings;
const recs = () => store.all();

const TYPES = {
  sleep: { label: 'Sleep', ico: '🌙', color: 'var(--sleep)', verb: 'Asleep' },
  feed: { label: 'Feed', ico: '🤱', color: 'var(--feed)', verb: 'Feeding' },
  awake: { label: 'Awake', ico: '☀️', color: 'var(--awake)', verb: 'Awake' },
};
const NAPPY = {
  wee: { label: 'Wee', ico: '💧', color: 'var(--wee)' },
  poo: { label: 'Poo', ico: '💩', color: 'var(--poo)' },
  both: { label: 'Wee + Poo', short: 'Both', ico: '💧💩', color: 'var(--poo)' },
};
const PLACE_COLOR = { bassinet: 'var(--sleep)', cosleep: 'var(--sleep-co)', carrier: 'var(--sleep-ca)' };
const SIDE_LABEL = { L: 'Left', R: 'Right' };

const ui = {
  tab: 'today',
  logDay: M.dayStart(Date.now()),
  logFilter: 'all',
  insMode: 'day',
  insDay: M.dayStart(Date.now()),
  insHighlight: 'all',
  sort: { key: 'day', dir: -1 },
  barMode: null,      // null = auto (Tonight 12am–8am, else Today) | 'tonight' | 'today'
  pulse: null,        // { key, t } – brief visual confirmation after a tap
  showLegend: (() => { try { return localStorage.getItem('bt.legend') === '1'; } catch { return false; } })(),
};

// ───────────────────────── Theme ─────────────────────────
const inHours = (h, from, to) => (from === to ? false : from < to ? h >= from && h < to : h >= from || h < to);
function applyTheme() {
  const s = S();
  const h = new Date().getHours();
  const dark = s.themeMode === 'dark' || (s.themeMode === 'auto' && inHours(h, s.themeDarkFrom, s.themeDarkTo));
  const red = s.redLight && inHours(h, s.redFrom, s.redTo);
  document.body.classList.toggle('dark', dark || red);
  document.body.classList.toggle('red', red);
  $('#themeColor').setAttribute('content', dark || red ? '#120F0D' : '#FBF7F2');
}

function pulse(key) { ui.pulse = { key, t: Date.now() }; }
const pulsing = key => ui.pulse && ui.pulse.key === key && Date.now() - ui.pulse.t < 900 ? ' pulse' : '';

function inBackdateHours(now = Date.now()) {
  const h = new Date(now).getHours();
  const { backdateFrom: a, backdateTo: b } = S();
  return a < b ? h >= a && h < b : (h >= a || h < b);
}

// ───────────────────────── Undo-able actions ─────────────────────────
function withUndo(label, fn) {
  const before = new Map();
  const origPut = store.put;
  store.put = function (rec) {
    if (rec.id && !before.has(rec.id)) { const o = store.map.get(rec.id); before.set(rec.id, o ? { ...o } : null); }
    const r = origPut.call(store, rec);
    if (!before.has(r.id)) before.set(r.id, null);
    return r;
  };
  try { store.batch(fn); } finally { store.put = origPut; }
  toast(label, {
    undo: () => store.batch(() => {
      for (const [id, old] of before) {
        if (old) store.put({ ...old });
        else { const cur = store.map.get(id); if (cur) store.put({ ...cur, deleted: true }); }
      }
    }),
  });
}

function startState(type, v, offsetMin = 0) {
  const now = Date.now();
  const at = now - offsetMin * MIN;
  const open = recs().filter(r => r.kind === 'state' && r.end == null);
  const t = TYPES[type];
  pulse('now');
  withUndo(`${t.ico} ${t.label} started${offsetMin ? ` ${offsetMin}m ago` : ''}`, () => {
    for (const r of open) {
      if (r.start >= at) store.put({ ...r, deleted: true }); // superseded by a back-dated start
      else store.put({ ...r, end: at });
    }
    store.put({ kind: 'state', type, start: at, end: null, parts: v ? [{ at, v }] : [] });
  });
}

function switchPart(seg, v) {
  const r = store.map.get(seg.id);
  if (!r) return;
  const parts = (r.parts || []).slice().sort((a, b) => a.at - b.at);
  if (parts.at(-1)?.v === v) return;
  const now = Date.now();
  parts.push({ at: now, v });
  const what = r.type === 'feed' ? `Switched to ${SIDE_LABEL[v]}` : `Moved to ${M.placeLabel(v)}`;
  pulse('now');
  withUndo(what, () => store.put({ ...r, parts }));
}

function logNappy(type) {
  const n = NAPPY[type];
  pulse('nap-' + type);
  withUndo(`${n.ico} ${n.label} logged`, () => store.put({ kind: 'nappy', type, at: Date.now() }));
}

// ───────────────────────── Toast / tooltip ─────────────────────────
let toastTimer;
function toast(msg, { undo, ms = 4500 } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button>Undo</button>' : ''}`;
  el.hidden = false;
  if (undo) $('button', el).onclick = () => { undo(); el.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

let tipTimer;
function showTip(html, x, y) {
  const el = $('#tip');
  el.innerHTML = html;
  el.hidden = false;
  const w = el.offsetWidth;
  const cx = Math.min(Math.max(x, w / 2 + 8), window.innerWidth - w / 2 - 8);
  el.style.left = cx + 'px';
  el.style.top = Math.max(y, 50) + 'px';
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => (el.hidden = true), 2600);
}
document.addEventListener('pointerdown', e => {
  const p = e.target.closest('[data-tip]');
  if (!p) { $('#tip').hidden = true; return; }
  showTip(p.dataset.tip, e.clientX, p.getBoundingClientRect().top);
});

// ───────────────────────── Sims bar ─────────────────────────
function pieceTip(p) {
  const t = TYPES[p.type];
  const sub = p.type === 'sleep' && p.v ? ` · ${M.placeLabel(p.v)}` : '';
  return esc(`<b>${t.label}${sub}</b><br>${M.fmtTime(p.start)} – ${M.fmtTime(p.end)} · ${M.fmtDur(p.end - p.start)}`);
}

function hourLabel(h) { h = ((h % 24) + 24) % 24; return h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`; }

/** Sims bar for [a, b). Defaults to the calendar day starting at a. */
function simsBar(a, { b = M.addDays(a, 1), compact = false, highlight = 'all', now = Date.now(), axis = true, nightBands = true } = {}) {
  const span = b - a;
  const pct = t => ((t - a) / span) * 100;
  const all = recs();
  const pieces = M.barPieces(all, a, b, now);
  const cur = M.currentSegment(all, now);
  let html = `<div class="sims${compact ? ' compact' : ''}">`;

  // markers (nappies + notes)
  html += '<div class="sims-marks">';
  for (const n of M.events(all, 'nappy', a, b)) {
    const dim = highlight !== 'all' && highlight !== 'nappy' ? ' style="opacity:.15"' : '';
    html += `<span class="mark ${n.type}" style="left:${pct(n.at)}%"${dim} data-tip="${esc(`<b>${NAPPY[n.type].label}</b> · ${M.fmtTime(n.at)}`)}"></span>`;
  }
  if (!compact) for (const n of M.events(all, 'note', a, b)) {
    html += `<span class="mark note" style="left:${pct(n.at)}%" data-tip="${esc(`<b>Note</b> · ${M.fmtTime(n.at)}<br>${esc(n.text).slice(0, 60)}`)}"></span>`;
  }
  html += '</div><div class="sims-bar">';
  if (nightBands && !compact && span > 20 * HOUR) {
    const s = S();
    html += `<div class="night-band" style="left:0;width:${pct(M.atHour(a, s.nightEnd))}%"></div>`;
    html += `<div class="night-band" style="left:${pct(M.atHour(a, s.nightStart))}%;right:0"></div>`;
  }
  for (const p of pieces) {
    const l = pct(p.start), w = pct(p.end) - l;
    const live = cur && p.segId === cur.id && p.end >= now - 1000 ? ' live' : '';
    const dim = highlight !== 'all' && highlight !== p.type ? ' dim' : '';
    html += `<div class="piece ${p.type} ${p.v || ''}${live}${dim}" style="left:calc(${l}% + 1px);width:max(1px, calc(${w}% - 2px))" data-tip="${pieceTip(p)}"></div>`;
  }
  if (now >= a && now < b) html += `<div class="now-line" style="left:${pct(now)}%"></div>`;
  html += '</div>';
  if (axis) {
    const step = span > 20 * HOUR ? 6 : span > 9 * HOUR ? 3 : 2;
    const ticks = [];
    for (let t = a; t <= b + 60_000; ) {
      ticks.push(t);
      const d = new Date(t); t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + step).getTime();
    }
    html += '<div class="sims-axis">' + ticks.map(t => `<span style="left:${Math.min(100, pct(t))}%">${hourLabel(new Date(t).getHours())}</span>`).join('') + '</div>';
  }
  return html + '</div>';
}

function legend({ places = true } = {}) {
  const items = places
    ? [['var(--sleep)', 'Bassinet'], ['var(--sleep-co)', 'Co-sleep'], ['var(--sleep-ca)', 'Carrier'], ['var(--feed)', 'Feed'], ['var(--awake)', 'Awake']]
    : [['var(--sleep)', 'Sleep'], ['var(--feed)', 'Feed'], ['var(--awake)', 'Awake']];
  return `<div class="legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}
    <span><i class="dot" style="background:var(--wee)"></i>Wee</span><span><i class="dot" style="background:var(--poo)"></i>Poo</span></div>`;
}

// ───────────────────────── Today ─────────────────────────
function wakeMeterHTML(since) {
  return `<div class="wake-meter" data-wake="${since}"><div class="wake-track"><div class="wake-fill"></div></div>
    <div class="wake-text"><span>Awake window <b class="num"></b></span><span class="cue"></span></div></div>`;
}
function updateWakeMeters(now = Date.now()) {
  const target = S().wakeWindowMin * MIN;
  for (const el of $$('.wake-meter')) {
    const since = +el.dataset.wake;
    const ms = now - since;
    const r = ms / target;
    const cls = r >= 1 ? 'over' : r >= 0.8 ? 'warn' : '';
    const fill = $('.wake-fill', el);
    fill.style.width = Math.min(100, r * 100) + '%';
    fill.className = 'wake-fill ' + cls;
    $('b', el).textContent = M.fmtDur(ms);
    const cue = $('.cue', el);
    cue.className = 'cue ' + cls;
    cue.textContent = r >= 1 ? 'Past wake window' : r >= 0.8 ? `Tired cues soon · ~${M.fmtTime(since + target)}` : `Sleep due ~${M.fmtTime(since + target)}`;
  }
}

function feedChips(all, now, { side = true } = {}) {
  const fi = M.feedSideInfo(all, now);
  const pr = M.predictNextFeed(all, now);
  const chips = [];
  if (fi.lastStart) chips.push(`<span class="info-chip">Last feed <b class="num" data-t0="${fi.lastStart}">${M.fmtDur(now - fi.lastStart)}</b> ago</span>`);
  const sideTxt = side ? ` · <b>${fi.next}</b> side` : '';
  if (pr) chips.push(`<span class="info-chip${now > pr.at ? ' due' : ''}" data-tip="${esc(`Usual gap ${M.fmtDur(pr.gap)} at this time of day<br>(median of ${pr.n} recent feeds, start → start)`)}">Next <b class="num">~${M.fmtTime(pr.at)}</b>${sideTxt}</span>`);
  else if (side) chips.push(`<span class="info-chip">Start on <b>${fi.next === 'L' ? 'Left' : 'Right'}</b></span>`);
  return chips.length ? `<div class="info-line">${chips.join('')}</div>` : '';
}

function nowCardHTML(all, now) {
  const cur = M.currentSegment(all, now);
  const pc = pulsing('now');
  if (!cur) {
    return `<section class="card now-card${pc}"><div class="now-empty"><b>What's baby doing now?</b>Tap Sleep, Feed or Awake to start the clock.</div>${feedChips(all, now)}</section>`;
  }
  const t = TYPES[cur.type];
  const subs = M.subIntervals(cur);
  const lastV = subs.at(-1)?.v;
  let label = t.verb, extra = '';
  if (cur.type === 'sleep') {
    label += lastV ? ` · ${M.placeLabel(lastV)}` : '';
    extra = `<div class="seg" style="--accent:var(--sleep)">${M.PLACES.map(p => {
      const acc = subs.filter(s => s.v === p.v).reduce((x, s) => x + (s.end - s.start), 0);
      const running = p.v === lastV;
      const timer = acc || running ? `<small class="num" ${running ? `data-t0="${subs.at(-1).start}" data-acc="${acc - (subs.at(-1).end - subs.at(-1).start)}"` : ''}>${M.fmtDur(acc)}</small>` : '<small>&nbsp;</small>';
      return `<button data-place="${p.v}" class="${running ? 'on' : ''}">${p.label}${timer}</button>`;
    }).join('')}</div>${feedChips(all, now)}`;
  } else if (cur.type === 'feed') {
    label += lastV ? ` · ${SIDE_LABEL[lastV]} side` : '';
    extra = `<div class="seg big" style="--accent:var(--feed)">${['L', 'R'].map(sd => {
      const acc = subs.filter(s => s.v === sd).reduce((x, s) => x + (s.end - s.start), 0);
      const running = sd === lastV;
      const last = subs.at(-1);
      return `<button data-side="${sd}" class="${running ? 'on' : ''}">${sd}<small class="num" ${running ? `data-t0="${last.start}" data-acc="${acc - (last.end - last.start)}"` : ''}>${M.fmtDur(acc)}</small></button>`;
    }).join('')}</div>`;
    const wake = M.currentWake(all, now);
    if (wake) extra += wakeMeterHTML(wake.since);
    extra += `<button class="link-btn" data-finish>Finish feed → Awake</button>`;
  } else {
    const wake = M.currentWake(all, now);
    if (wake) extra = wakeMeterHTML(wake.since);
    extra += feedChips(all, now);
  }
  return `<section class="card now-card${pc}" style="--accent:${t.color}">
    <div class="now-label"><span class="pill"></span>${esc(label)}</div>
    <div class="now-timer num" data-t0="${cur.start}" data-fmt="timer">${M.fmtTimer(now - cur.start)}</div>
    <div class="now-since">since ${M.fmtTime(cur.start)}${cur.start < M.dayStart(now) ? ' yesterday' : ''}</div>
    ${extra}
  </section>`;
}

/** Light stats for an arbitrary window (used by the Tonight bar). */
function rangeStats(all, a, b, now) {
  const segs = M.segments(all, now);
  let sleep = 0;
  for (const s of segs) if (s.type === 'sleep') sleep += M.overlap(s.start, s.end, a, b);
  const blocks = M.sleepBlocks(segs).filter(k => k.end > a && k.start < b);
  const longest = blocks.reduce((m, k) => Math.max(m, Math.min(k.end, b) - Math.max(k.start, a)), 0);
  const feeds = segs.filter(s => s.type === 'feed' && s.start >= a && s.start < b).length;
  const nap = M.events(all, 'nappy', a, b);
  return { sleep, longest, feeds, wakes: Math.max(0, blocks.length - 1),
    wees: nap.filter(n => n.type !== 'poo').length, poos: nap.filter(n => n.type !== 'wee').length };
}

function barCardHTML(all, now) {
  const s = S();
  const today = M.dayStart(now);
  const nightRelevant = new Date(now).getHours() < s.nightEnd;
  const mode = nightRelevant ? (ui.barMode || 'tonight') : 'today';
  let bar, summary;
  if (mode === 'tonight') {
    const a = M.atHour(M.addDays(today, -1), s.nightStart), b = M.atHour(today, s.nightEnd);
    const rs = rangeStats(all, a, b, now);
    bar = simsBar(a, { b, now });
    summary = `<span>🌙 <b class="num">${M.fmtDur(rs.sleep, { short: true })}</b> asleep</span><span>longest <b class="num">${M.fmtDur(rs.longest, { short: true })}</b></span><span>🤱 <b class="num">${rs.feeds}</b></span>`;
  } else {
    const st = M.dayStats(all, today, s, now);
    bar = simsBar(today, { now });
    summary = `<span>🌙 <b class="num">${M.fmtDur(st.sleep, { short: true })}</b></span><span>🤱 <b class="num">${st.feeds}</b></span><span>💧 <b class="num">${st.wees}</b></span><span>💩 <b class="num">${st.poos}</b></span>`;
  }
  const toggle = nightRelevant
    ? `<div class="mini-seg">${[['tonight', `Tonight`], ['today', 'Today']].map(([k, l]) => `<button data-bar="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>`
    : '';
  const rec = M.sleepRecord(all, now);
  const record = rec?.isNew ? `<div class="record">🎉 Longest sleep yet · <b class="num">${M.fmtDur(rec.len)}</b> <span>(was ${M.fmtDur(rec.prevLen)})</span></div>` : '';
  return `<section class="card bar-card">
    ${toggle}${bar}
    ${ui.showLegend ? legend() : ''}
    <div class="slim"><div class="slim-stats">${summary}</div><button class="help" data-legend aria-label="Show colour key">${ui.showLegend ? '✕' : '?'}</button></div>
    ${record}
  </section>`;
}

function renderToday() {
  const now = Date.now();
  const all = recs();
  const cur = M.currentSegment(all, now);
  const view = $('#view');
  view.innerHTML = `
    ${barCardHTML(all, now)}
    ${nowCardHTML(all, now)}
    <div class="thumb">
      <div class="actions">
        ${Object.entries(TYPES).map(([k, t]) => `<button class="act ${k}${cur?.type === k ? ' current' : ''}${cur?.type === k ? pulsing('now') : ''}" data-act="${k}"><span class="ico">${t.ico}</span><span>${t.label}</span></button>`).join('')}
      </div>
      <div class="nappies">
        ${['wee', 'poo', 'both'].map(k => `<button class="nap ${k}${pulsing('nap-' + k)}" data-nappy="${k}"><span class="ico">${NAPPY[k].ico}</span>${NAPPY[k].short || NAPPY[k].label}</button>`).join('')}
        <button class="nap note" data-note><span class="ico">📝</span>Note</button>
      </div>
    </div>`;
  $$('[data-act]', view).forEach(b => (b.onclick = () => onAction(b.dataset.act)));
  $$('[data-nappy]', view).forEach(b => (b.onclick = () => logNappy(b.dataset.nappy)));
  $('[data-note]', view).onclick = () => noteSheet();
  $$('[data-place]', view).forEach(b => (b.onclick = () => switchPart(M.currentSegment(recs()), b.dataset.place)));
  $$('[data-side]', view).forEach(b => (b.onclick = () => switchPart(M.currentSegment(recs()), b.dataset.side)));
  $$('[data-bar]', view).forEach(b => (b.onclick = () => { ui.barMode = b.dataset.bar; render(); }));
  $('[data-legend]', view).onclick = () => {
    ui.showLegend = !ui.showLegend;
    try { localStorage.setItem('bt.legend', ui.showLegend ? '1' : '0'); } catch {}
    render();
  };
  const fin = $('[data-finish]', view);
  if (fin) fin.onclick = () => startState('awake');
  updateWakeMeters(now);
}

function onAction(type) {
  const cur = M.currentSegment(recs());
  const night = inBackdateHours();
  if (cur?.type === type) {
    if (type === 'awake') return toast('Already awake ☀️');
    return startSheet(type, { switching: cur });
  }
  if (type === 'awake' && !night) return startState('awake');
  startSheet(type, { night });
}

// ───────────────────────── Sheets ─────────────────────────
function openSheet(html, bind) {
  const wrap = $('#sheetWrap');
  $('#sheetBody').innerHTML = html;
  wrap.hidden = false;
  $$('[data-close]', wrap).forEach(el => (el.onclick = closeSheet));
  bind?.($('#sheetBody'));
}
function closeSheet() {
  const sh = $('.sheet');
  sh.style.transform = ''; sh.style.transition = '';
  $('#sheetWrap').hidden = true; $('#sheetBody').innerHTML = '';
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}

// iPhone: swipe a sheet down to dismiss it (only when scrolled to its top)
(() => {
  const sh = $('.sheet');
  let y0 = null, dy = 0;
  sh.addEventListener('touchstart', e => {
    if (sh.scrollTop > 0 || e.target.closest('input, textarea, select, .chips')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; sh.style.transition = 'none';
  }, { passive: true });
  sh.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 0) sh.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sh.addEventListener('touchend', () => {
    if (y0 == null) return;
    sh.style.transition = 'transform .2s ease';
    if (dy > 90) { sh.style.transform = 'translateY(100%)'; setTimeout(closeSheet, 180); }
    else sh.style.transform = '';
    y0 = null;
  });
})();

// iPhone: keep sheets above the on-screen keyboard
if (window.visualViewport) {
  const fit = () => {
    const vv = window.visualViewport;
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', kb + 'px');
  };
  visualViewport.addEventListener('resize', fit);
  visualViewport.addEventListener('scroll', fit);
}
// iOS Safari only applies :active styles when a touch listener exists
document.addEventListener('touchstart', () => {}, { passive: true });

const OFFSETS = [0, 5, 10, 15, 20, 30, 45];
function startSheet(type, { night = false, switching = null } = {}) {
  const all = recs();
  const t = TYPES[type];
  let off = 0;
  let choices = '';
  if (type === 'sleep') {
    const rec = switching ? null : M.lastPlace(all);
    const curV = switching ? M.subIntervals(switching).at(-1)?.v : null;
    choices = `<div class="label-sm">Where?</div><div class="big-choices cols-3">${M.PLACES.map(p =>
      `<button class="choice${p.v === rec ? ' rec' : ''}" style="--c:${PLACE_COLOR[p.v]}" data-v="${p.v}"><span class="ico">${p.v === 'bassinet' ? '🛏️' : p.v === 'cosleep' ? '🫂' : '🎒'}</span>${p.label}${p.v === rec ? '<small>last used</small>' : p.v === curV ? '<small>current</small>' : '<small>&nbsp;</small>'}</button>`).join('')}</div>`;
  } else if (type === 'feed') {
    const fi = M.feedSideInfo(all);
    const curV = switching ? M.subIntervals(switching).at(-1)?.v : null;
    choices = `<div class="label-sm">Which side?</div><div class="big-choices cols-2">${['L', 'R'].map(sd =>
      `<button class="choice xl${!switching && sd === fi.next ? ' rec' : ''}" style="--c:var(--feed)" data-v="${sd}">${sd}<small>${!switching && sd === fi.next ? 'suggested next' : sd === curV ? 'current' : SIDE_LABEL[sd]}</small></button>`).join('')}</div>`;
  } else {
    choices = `<div class="big-choices"><button class="choice" style="--c:var(--awake)" data-v=""><span class="ico">☀️</span>Start awake</button></div>`;
  }
  const chips = night && !switching
    ? `<div class="label-sm">Started</div><div class="chips">${OFFSETS.map(o => `<button class="chip${o === 0 ? ' on' : ''}" data-off="${o}">${o ? o + ' min ago' : 'Now'}</button>`).join('')}</div>`
    : '';
  const title = switching ? (type === 'feed' ? 'Switch side' : 'Move baby') : `${t.ico} ${t.label}`;
  openSheet(`<h3>${title}</h3>${night && !switching ? '<p class="hint">Forgot to tap? Pick when it really started.</p>' : '<p class="hint">&nbsp;</p>'}${chips}${choices}
    <div class="btn-row"><button class="btn" data-close>Cancel</button></div>`, el => {
    $$('[data-off]', el).forEach(c => (c.onclick = () => { off = +c.dataset.off; $$('[data-off]', el).forEach(x => x.classList.toggle('on', x === c)); }));
    $$('[data-v]', el).forEach(c => (c.onclick = () => {
      closeSheet();
      if (switching) switchPart(switching, c.dataset.v);
      else startState(type, c.dataset.v || null, off);
    }));
  });
}

function noteSheet(rec = null) {
  openSheet(`<h3>📝 ${rec ? 'Edit note' : 'Note'}</h3><p class="hint">e.g. "vaccinations today", "fussy evening"</p>
    <div class="form"><label class="field"><textarea id="noteText" placeholder="Write a note…">${esc(rec?.text || '')}</textarea></label>
    <div class="btn-row"><button class="btn" data-close>Cancel</button><button class="btn primary" id="noteSave">Save</button></div></div>`, el => {
    const ta = $('#noteText', el);
    setTimeout(() => ta.focus(), 250);
    $('#noteSave', el).onclick = () => {
      const text = ta.value.trim();
      if (!text) return closeSheet();
      store.put(rec ? { ...rec, text } : { kind: 'note', text, at: Date.now() });
      closeSheet();
      toast('📝 Note saved');
    };
  });
}

// ───────────────────────── Log ─────────────────────────
function describeSeg(seg) {
  const subs = M.subIntervals(seg).filter(s => s.v);
  if (seg.type === 'feed') return 'Feed' + (subs.length ? ' · ' + subs.map(s => `${s.v} ${M.fmtDur(s.end - s.start)}`).join(' · ') : '');
  if (seg.type === 'sleep') return 'Sleep' + (subs.length ? ' · ' + [...new Set(subs.map(s => M.placeLabel(s.v)))].join(' → ') : '');
  return 'Awake';
}

function dayNav(day, onChange) {
  const today = M.dayStart(Date.now());
  const rel = day === today ? 'Today' : day === M.addDays(today, -1) ? 'Yesterday' : '';
  return {
    html: `<div class="daynav"><button class="arrow" data-dn="-1">‹</button><div class="d">${M.fmtDay(day, { weekday: 'long', day: 'numeric', month: 'long' })}<small>${rel || '&nbsp;'}</small></div><button class="arrow" data-dn="1" ${day >= today ? 'disabled' : ''}>›</button></div>`,
    bind: el => $$('[data-dn]', el).forEach(b => (b.onclick = () => onChange(M.addDays(day, +b.dataset.dn)))),
  };
}

function renderLog() {
  const now = Date.now();
  const a = ui.logDay, b = M.addDays(a, 1);
  const all = recs();
  const items = [];
  for (const seg of M.segments(all, now)) {
    if (seg.end <= a || seg.start >= b) continue;
    if (ui.logFilter !== 'all' && ui.logFilter !== seg.type) continue;
    items.push({ t: seg.start, id: seg.id, c: TYPES[seg.type].color, live: seg.open, title: describeSeg(seg),
      sub: `${M.fmtTime(seg.start)}${seg.start < a ? ' (prev day)' : ''} – ${seg.open ? 'now' : M.fmtTime(seg.end) + (seg.end > b ? ' (next day)' : '')}`,
      dur: seg.open ? `<span data-t0="${seg.start}">${M.fmtDur(now - seg.start)}</span>` : M.fmtDur(seg.end - seg.start) });
  }
  if (ui.logFilter === 'all' || ui.logFilter === 'nappy')
    for (const n of M.events(all, 'nappy', a, b)) items.push({ t: n.at, id: n.id, c: NAPPY[n.type].color, title: `${NAPPY[n.type].ico} ${NAPPY[n.type].label}`, sub: M.fmtTime(n.at), dur: '' });
  if (ui.logFilter === 'all' || ui.logFilter === 'note')
    for (const n of M.events(all, 'note', a, b)) items.push({ t: n.at, id: n.id, c: 'var(--note)', title: `📝 ${esc(n.text)}`, sub: M.fmtTime(n.at) + (n.who ? ` · ${esc(n.who)}` : ''), dur: '' });
  items.sort((x, y) => y.t - x.t);

  const nav = dayNav(a, d => { ui.logDay = d; render(); });
  const filters = [['all', 'All'], ['sleep', '🌙 Sleep'], ['feed', '🤱 Feed'], ['awake', '☀️ Awake'], ['nappy', '💧 Nappy'], ['note', '📝 Note']];
  const view = $('#view');
  view.innerHTML = `${nav.html}
    <div class="filters">${filters.map(([k, l]) => `<button class="chip${ui.logFilter === k ? ' on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    ${items.length ? `<div class="list">${items.map(it => `<button class="item${it.live ? ' live' : ''}" style="--c:${it.c}" data-id="${it.id}"><span class="bar"></span><span class="main"><div class="t">${it.title}</div><div class="s">${it.sub}</div></span><span class="dur num">${it.dur}</span></button>`).join('')}</div>`
      : '<div class="empty">Nothing logged for this day.</div>'}
    <p class="small-note" style="text-align:center;margin-top:12px">Tap any entry to edit or delete it.</p>
    <button class="fab" id="addBtn">＋ Add</button>`;
  nav.bind(view);
  $$('[data-f]', view).forEach(b => (b.onclick = () => { ui.logFilter = b.dataset.f; render(); }));
  $$('[data-id]', view).forEach(b => (b.onclick = () => editSheet(store.map.get(b.dataset.id))));
  $('#addBtn').onclick = addSheet;
}

// datetime helpers for inputs
const pad = n => String(n).padStart(2, '0');
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = s => (s ? new Date(s).getTime() : null);
const toTimeInput = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function addSheet() {
  const kinds = [['sleep', '🌙', 'Sleep', 'var(--sleep)'], ['feed', '🤱', 'Feed', 'var(--feed)'], ['awake', '☀️', 'Awake', 'var(--awake)'],
    ['wee', '💧', 'Wee', 'var(--wee)'], ['poo', '💩', 'Poo', 'var(--poo)'], ['both', '💧💩', 'Both', 'var(--poo)']];
  openSheet(`<h3>Add an entry</h3><p class="hint">For something you forgot to log.</p>
    <div class="big-choices cols-3">${kinds.map(([k, i, l, c]) => `<button class="choice" style="--c:${c}" data-k="${k}"><span class="ico">${i}</span>${l}</button>`).join('')}</div>
    <div class="btn-row" style="margin-top:12px"><button class="btn" data-k="note">📝 Note</button><button class="btn" data-close>Cancel</button></div>`, el => {
    $$('[data-k]', el).forEach(b => (b.onclick = () => {
      const k = b.dataset.k;
      const base = ui.tab === 'log' && ui.logDay !== M.dayStart(Date.now()) ? M.atHour(ui.logDay, 12) : Date.now();
      if (TYPES[k]) {
        const start = base - 30 * MIN;
        const v = k === 'sleep' ? M.lastPlace(recs()) : k === 'feed' ? 'L' : null;
        editSheet({ kind: 'state', type: k, start, end: base, parts: v ? [{ at: start, v }] : [] }, true);
      } else if (k === 'note') editSheet({ kind: 'note', at: base, text: '' }, true);
      else editSheet({ kind: 'nappy', type: k, at: base }, true);
    }));
  });
}

function editSheet(rec, isNew = false) {
  if (!rec) return;
  const r = JSON.parse(JSON.stringify(rec));
  const all = recs();
  if (r.kind === 'state') {
    const segs = M.segments(all);
    const isLast = !isNew && segs.at(-1)?.id === r.id;
    const draw = () => {
      const optsFor = type => type === 'feed' ? [['L', 'Left'], ['R', 'Right']] : M.PLACES.map(p => [p.v, p.label]);
      const parts = (r.parts || []).slice().sort((a, b) => a.at - b.at);
      const partsHTML = r.type === 'awake' ? '' : `<div class="field"><span>${r.type === 'feed' ? 'Sides (switch times)' : 'Where (move times)'}</span>
        ${parts.map((p, i) => `<div class="part-row"><input type="time" data-pt="${i}" value="${toTimeInput(i === 0 ? r.start : p.at)}" ${i === 0 ? 'disabled' : ''}>
          <select data-pv="${i}">${optsFor(r.type).map(([v, l]) => `<option value="${v}" ${p.v === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <button data-pdel="${i}" ${parts.length < 2 ? 'disabled' : ''}>✕</button></div>`).join('')}
        <button class="btn" id="addPart" style="padding:10px">＋ Add ${r.type === 'feed' ? 'side switch' : 'move'}</button></div>`;
      openSheet(`<h3>${isNew ? 'Add' : 'Edit'} ${TYPES[r.type].label.toLowerCase()}</h3><p class="hint">${r.who ? 'Logged by ' + esc(r.who) : '&nbsp;'}</p>
        <div class="form">
          <label class="field"><span>Type</span><select id="eType">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${r.type === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
          <label class="field"><span>Start</span><input type="datetime-local" id="eStart" value="${toLocalInput(r.start)}"></label>
          ${isLast ? `<label class="check"><input type="checkbox" id="eOngoing" ${r.end == null ? 'checked' : ''}> Still going</label>` : ''}
          <label class="field" id="eEndWrap" ${r.end == null && isLast ? 'hidden' : ''}><span>End</span><input type="datetime-local" id="eEnd" value="${toLocalInput(r.end ?? Date.now())}"></label>
          ${partsHTML}
          <div class="btn-row">${isNew ? '' : '<button class="btn danger" id="eDel">Delete</button>'}<button class="btn" data-close>Cancel</button><button class="btn primary" id="eSave">Save</button></div>
        </div>`, el => {
        const readForm = () => {
          r.start = fromLocalInput($('#eStart', el).value) ?? r.start;
          const ongoing = $('#eOngoing', el)?.checked;
          r.end = ongoing ? null : fromLocalInput($('#eEnd', el).value);
          const ps = (r.parts || []).slice().sort((a, b) => a.at - b.at);
          ps.forEach((p, i) => {
            const sel = $(`[data-pv="${i}"]`, el); if (sel) p.v = sel.value;
            const ti = $(`[data-pt="${i}"]`, el);
            if (i === 0) p.at = r.start;
            else if (ti?.value) {
              const [hh, mm] = ti.value.split(':').map(Number);
              const d = new Date(r.start); let t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).getTime();
              if (t < r.start) t = M.addDays(t, 1);
              p.at = t;
            }
          });
          r.parts = ps;
        };
        $('#eType', el).onchange = e => {
          readForm(); r.type = e.target.value;
          r.parts = r.type === 'awake' ? [] : [{ at: r.start, v: r.type === 'feed' ? 'L' : M.lastPlace(all) }];
          draw();
        };
        const og = $('#eOngoing', el);
        if (og) og.onchange = () => ($('#eEndWrap', el).hidden = og.checked);
        $$('[data-pdel]', el).forEach(b => (b.onclick = () => { readForm(); r.parts.splice(+b.dataset.pdel, 1); draw(); }));
        const ap = $('#addPart', el);
        if (ap) ap.onclick = () => {
          readForm();
          const last = r.parts.at(-1);
          const opts = optsFor(r.type).map(o => o[0]);
          const nextV = opts.find(v => v !== last?.v) || opts[0];
          const endT = r.end ?? Date.now();
          r.parts.push({ at: Math.round((Math.max(last?.at ?? r.start, r.start) + endT) / 2), v: nextV });
          draw();
        };
        $('#eSave', el).onclick = () => {
          readForm();
          if (r.end != null && r.end <= r.start) return toast('End must be after start');
          if (r.start > Date.now() + MIN) return toast('Start is in the future');
          r.parts = (r.parts || []).filter(p => p.at >= r.start && (r.end == null || p.at < r.end)).sort((a, b) => a.at - b.at);
          if (r.type !== 'awake' && !r.parts.length) r.parts = [{ at: r.start, v: r.type === 'feed' ? 'L' : 'bassinet' }];
          store.batch(() => {
            if (r.end == null) {
              // only one ongoing state at a time
              for (const o of recs()) if (o.kind === 'state' && o.end == null && o.id !== r.id) store.put({ ...o, end: Math.max(o.start, Math.min(r.start, Date.now())) });
            }
            store.put(r);
          });
          closeSheet();
          toast(isNew ? 'Added' : 'Saved');
        };
        const del = $('#eDel', el);
        if (del) del.onclick = () => { closeSheet(); withUndo('Deleted', () => store.put({ ...store.map.get(r.id), deleted: true })); };
      });
    };
    draw();
    return;
  }
  if (r.kind === 'nappy' || r.kind === 'note') {
    const isNote = r.kind === 'note';
    openSheet(`<h3>${isNew ? 'Add' : 'Edit'} ${isNote ? 'note' : 'nappy'}</h3><p class="hint">${r.who ? 'Logged by ' + esc(r.who) : '&nbsp;'}</p>
      <div class="form">
        ${isNote ? `<label class="field"><span>Note</span><textarea id="eText">${esc(r.text)}</textarea></label>`
        : `<label class="field"><span>Type</span><select id="eNap">${Object.entries(NAPPY).map(([k, n]) => `<option value="${k}" ${r.type === k ? 'selected' : ''}>${n.label}</option>`).join('')}</select></label>`}
        <label class="field"><span>Time</span><input type="datetime-local" id="eAt" value="${toLocalInput(r.at)}"></label>
        <div class="btn-row">${isNew ? '' : '<button class="btn danger" id="eDel">Delete</button>'}<button class="btn" data-close>Cancel</button><button class="btn primary" id="eSave">Save</button></div>
      </div>`, el => {
      $('#eSave', el).onclick = () => {
        r.at = fromLocalInput($('#eAt', el).value) ?? r.at;
        if (isNote) { r.text = $('#eText', el).value.trim(); if (!r.text) return toast('Note is empty'); }
        else r.type = $('#eNap', el).value;
        store.put(r);
        closeSheet();
        toast(isNew ? 'Added' : 'Saved');
      };
      const del = $('#eDel', el);
      if (del) del.onclick = () => { closeSheet(); withUndo('Deleted', () => store.put({ ...store.map.get(r.id), deleted: true })); };
    });
  }
}

// ───────────────────────── Insights ─────────────────────────
function splitBar(parts) {
  const total = parts.reduce((x, p) => x + p.v, 0);
  if (!total) return '<div class="split"></div>';
  return `<div class="split">${parts.filter(p => p.v > 0).map(p => `<div style="width:${(p.v / total) * 100}%;background:${p.c}" data-tip="${esc(`<b>${p.l}</b> · ${p.fmt ? p.fmt(p.v) : M.fmtDur(p.v)}`)}"></div>`).join('')}</div>
    <div class="split-legend">${parts.map(p => `<span><i style="background:${p.c}"></i>${p.l} ${p.fmt ? p.fmt(p.v) : M.fmtDur(p.v)}</span>`).join('')}</div>`;
}

function renderDayInsights(view) {
  const now = Date.now();
  const a = ui.insDay;
  const st = M.dayStats(recs(), a, S(), now);
  const nav = dayNav(a, d => { ui.insDay = d; render(); });
  const sideTot = st.sideL + st.sideR;
  view.innerHTML += `${nav.html}
    <section class="card">${simsBar(a, { now })}${legend()}</section>

    <section class="card"><div class="card-h"><h2>🌙 Sleep</h2><span class="aside">night = ${hourLabel(S().nightStart)}–${hourLabel(S().nightEnd)}</span></div>
      <div class="stats">
        <div class="stat"><b class="num">${M.fmtDur(st.sleep)}</b><small>total sleep</small></div>
        <div class="stat"><b class="num">${M.fmtDur(st.longest)}</b><small>longest stretch${st.longestBlock ? ` · ${M.fmtTime(st.longestBlock.start)}` : ''}</small></div>
        <div class="stat"><b class="num">${M.fmtDur(st.sleepNight)}</b><small>night sleep</small></div>
        <div class="stat"><b class="num">${M.fmtDur(st.sleepDay)}</b><small>day sleep · ${st.naps} nap${st.naps === 1 ? '' : 's'}</small></div>
        <div class="stat wide"><small>Where baby slept</small>${splitBar([
          { l: 'Bassinet', v: st.place.bassinet, c: 'var(--sleep)' }, { l: 'Co-sleep', v: st.place.cosleep, c: 'var(--sleep-co)' }, { l: 'Carrier', v: st.place.carrier, c: 'var(--sleep-ca)' }])}</div>
      </div></section>

    <section class="card"><div class="card-h"><h2>🤱 Feeds</h2><span class="aside">gaps measured start → start</span></div>
      <div class="stats">
        <div class="stat"><b class="num">${st.feeds}</b><small>feeds · ${M.fmtDur(st.feed)} total</small></div>
        <div class="stat"><b class="num">${M.fmtDur(st.avgFeed)}</b><small>average feed</small></div>
        <div class="stat"><b class="num">${M.fmtDur(st.avgGap)}</b><small>average gap</small></div>
        <div class="stat"><b class="num">${M.fmtDur(st.maxGap)}</b><small>longest gap</small></div>
        <div class="stat wide"><small>Left / right balance${sideTot ? ` · ${Math.round((st.sideL / sideTot) * 100)}% L` : ''}</small>${splitBar([
          { l: 'Left', v: st.sideL, c: 'var(--feed)' }, { l: 'Right', v: st.sideR, c: 'var(--feed-2)' }])}</div>
      </div></section>

    <section class="card"><div class="card-h"><h2>☀️ Wake windows</h2><span class="aside">target ~${S().wakeWindowMin}m</span></div>
      <div class="stats">
        <div class="stat"><b class="num">${M.fmtDur(st.avgWake)}</b><small>average window</small></div>
        <div class="stat"><b class="num">${M.fmtDur(st.maxWake)}</b><small>longest window</small></div>
        <div class="stat"><b class="num">${M.fmtDur(st.awake)}</b><small>awake (not feeding)</small></div>
        <div class="stat"><b class="num">${st.wakeCount}</b><small>windows completed</small></div>
      </div></section>

    <section class="card"><div class="card-h"><h2>💧 Nappies</h2></div>
      <div class="stats">
        <div class="stat"><b class="num">${st.wees}</b><small>wet</small></div>
        <div class="stat"><b class="num">${st.poos}</b><small>dirty</small></div>
      </div></section>

    ${st.notes.length ? `<section class="card"><div class="card-h"><h2>📝 Notes</h2></div><div class="notes-list">${st.notes.map(n => `<div class="note-item"><small>${M.fmtTime(n.at)}${n.who ? ' · ' + esc(n.who) : ''}</small>${esc(n.text)}</div>`).join('')}</div></section>` : ''}
    <button class="btn" style="width:100%" id="csvBtn">Export this day (CSV)</button>`;
  nav.bind(view);
  $('#csvBtn').onclick = () => exportCSV(a, M.addDays(a, 1));
}


// Small single-series line chart (hand-rolled SVG). points: [{x: dayMs, y: number|null}] oldest → newest.
function lineChart(points, { color, fmt = v => String(Math.round(v)), tipLabel, markBest = false }) {
  const W = 326, H = 116, L = 40, R = 10, T = 16, B = 20;
  const vals = points.map(p => p.y).filter(v => v != null);
  if (vals.length < 2) return '<div class="empty" style="padding:14px">Needs at least two full days of data.</div>';
  const max = Math.max(...vals) * 1.12 || 1;
  const x = i => L + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - L - R));
  const y = v => T + (1 - v / max) * (H - T - B);
  let grid = '';
  const top = Math.max(...vals);
  for (const f of [0, 0.5, 1]) {
    const gy = y(f * top);
    grid += `<line x1="${L}" x2="${W - R}" y1="${gy}" y2="${gy}" class="g"/><text x="${L - 6}" y="${gy + 3.5}" text-anchor="end" class="yl">${f === 0 ? '0' : fmt(f * top)}</text>`;
  }
  let d = '', pen = false;
  points.forEach((p, i) => {
    if (p.y == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`; pen = true;
  });
  const showDots = points.length <= 14;
  const bestI = markBest ? points.reduce((bi, p, i) => (p.y != null && (bi < 0 || p.y > points[bi].y) ? i : bi), -1) : -1;
  let dots = '', hits = '';
  const colW = (W - L - R) / Math.max(1, points.length - 1);
  points.forEach((p, i) => {
    if (p.y == null) return;
    const isLast = i === points.length - 1 || points.slice(i + 1).every(q => q.y == null);
    if (showDots || i === bestI || isLast) dots += `<circle cx="${x(i)}" cy="${y(p.y)}" r="${i === bestI ? 4.5 : 3.5}" class="dot" style="fill:${color}"/>`;
    hits += `<rect x="${x(i) - colW / 2}" y="0" width="${colW}" height="${H}" fill="transparent" data-tip="${esc(`<b>${M.fmtDay(p.x, { weekday: 'short', day: 'numeric', month: 'short' })}</b><br>${tipLabel}: ${fmt(p.y)}`)}"/>`;
  });
  let ann = '';
  if (bestI >= 0) {
    const bx = Math.min(Math.max(x(bestI), L + 30), W - R - 30);
    ann = `<text x="${bx}" y="${Math.max(10, y(points[bestI].y) - 9)}" text-anchor="middle" class="ann">best ${fmt(points[bestI].y)}</text>`;
  }
  const xl = [0, Math.floor((points.length - 1) / 2), points.length - 1].map((i, k) =>
    `<text x="${x(i)}" y="${H - 4}" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}" class="xl">${M.fmtDay(points[i].x, { day: 'numeric', month: 'short' })}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${grid}<path d="${d}" style="stroke:${color}" class="ln"/>${dots}${ann}${xl}${hits}</svg>`;
}

function trendsCard(days, stats, today) {
  const done = days.map((d, i) => ({ d, s: stats[i] })).filter(o => o.d !== today).reverse(); // oldest → newest, completed days
  const has = o => o.s.tracked > 2 * HOUR;
  const pts = f => done.map(o => ({ x: o.d, y: has(o) ? f(o.s) : null }));
  const hm = v => M.fmtDur(v, { short: true });
  const avg = arr => { const v = arr.filter(p => p.y != null).map(p => p.y); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const longest = pts(s => s.longest), total = pts(s => s.sleep), feeds = pts(s => s.feeds), night = pts(s => s.sleepNight);
  const block = (title, p, opts, avgFmt) => `<div class="trend"><div class="trend-h"><b>${title}</b><span>avg ${avg(p) == null ? '–' : avgFmt(avg(p))}</span></div>${lineChart(p, opts)}</div>`;
  return `<section class="card"><div class="card-h"><h2>Trends</h2><span class="aside">completed days</span></div>
    ${block('Longest sleep stretch', longest, { color: 'var(--sleep-co)', fmt: hm, tipLabel: 'Longest', markBest: true }, hm)}
    ${block('Night sleep', night, { color: 'var(--sleep)', fmt: hm, tipLabel: 'Night sleep' }, hm)}
    ${block('Total sleep', total, { color: 'var(--sleep-ca)', fmt: hm, tipLabel: 'Total sleep' }, hm)}
    ${block('Feeds per day', feeds, { color: 'var(--feed)', fmt: v => String(Math.round(v * 10) / 10), tipLabel: 'Feeds' }, v => fmtNum(v))}
  </section>`;
}

function renderRangeInsights(view, n) {
  const now = Date.now();
  const today = M.dayStart(now);
  const days = Array.from({ length: n }, (_, i) => M.addDays(today, -i)); // newest first
  const all = recs();
  const stats = days.map(d => M.dayStats(all, d, S(), now));
  const withData = stats.filter(s => s.tracked > 0 || s.nappies > 0);
  const complete = withData.filter(s => s.day !== today);
  const base = complete.length ? complete : withData;
  const av = f => (base.length ? base.reduce((x, s) => x + (f(s) ?? 0), 0) / base.length : null);
  const avN = f => { const v = base.map(f).filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };

  const hl = [['all', 'All'], ['sleep', '🌙 Sleep'], ['feed', '🤱 Feed'], ['awake', '☀️ Awake'], ['nappy', '💧 Nappies']];
  const rows = days.map(d => {
    const lab = d === today ? 'Today' : M.fmtDay(d, { weekday: 'short' });
    return `<button class="dl rowbtn${d === today ? ' today' : ''}" data-day="${d}"><b>${lab}</b>${M.fmtDay(d, { day: 'numeric', month: 'short' })}</button><div>${simsBar(d, { compact: true, axis: false, highlight: ui.insHighlight, now, nightBands: false })}</div>`;
  }).join('');
  const axis = `<div></div><div class="sims-axis" style="margin:0 0 2px">${[0, 6, 12, 18, 24].map(hh => `<span style="left:${(hh / 24) * 100}%">${hourLabel(hh % 24)}</span>`).join('')}</div>`;

  // sortable table
  const cols = [
    ['day', 'Date', s => s.day, s => (s.day === today ? 'Today' : M.fmtDay(s.day, { weekday: 'short', day: 'numeric' }))],
    ['sleep', 'Sleep', s => s.sleep, s => M.fmtDur(s.sleep, { short: true })],
    ['sleepNight', 'Night', s => s.sleepNight, s => M.fmtDur(s.sleepNight, { short: true })],
    ['longest', 'Longest', s => s.longest, s => M.fmtDur(s.longest, { short: true })],
    ['feeds', 'Feeds', s => s.feeds, s => s.feeds],
    ['avgGap', 'Gap', s => s.avgGap ?? -1, s => M.fmtDur(s.avgGap, { short: true })],
    ['avgWake', 'Wake', s => s.avgWake ?? -1, s => M.fmtDur(s.avgWake, { short: true })],
    ['wees', 'Wees', s => s.wees, s => s.wees],
    ['poos', 'Poos', s => s.poos, s => s.poos],
  ];
  const col = cols.find(c => c[0] === ui.sort.key) || cols[0];
  const sorted = withData.slice().sort((x, y) => (col[2](x) - col[2](y)) * ui.sort.dir);

  view.innerHTML += `
    <div class="filters">${hl.map(([k, l]) => `<button class="chip${ui.insHighlight === k ? ' on' : ''}" data-hl="${k}">${l}</button>`).join('')}</div>
    <section class="card">
      <div class="multi">${axis}${rows}</div>${legend()}</section>

    ${trendsCard(days, stats, today)}

    <section class="card"><div class="card-h"><h2>Daily averages</h2><span class="aside">${base.length} day${base.length === 1 ? '' : 's'}${complete.length ? ', excl. today' : ''}</span></div>
      <div class="stats">
        <div class="stat"><b class="num">${M.fmtDur(av(s => s.sleep))}</b><small>sleep / day</small></div>
        <div class="stat"><b class="num">${M.fmtDur(av(s => s.sleepNight))}</b><small>night sleep</small></div>
        <div class="stat"><b class="num">${M.fmtDur(avN(s => s.longest || null))}</b><small>longest stretch</small></div>
        <div class="stat"><b class="num">${fmtNum(av(s => s.feeds))}</b><small>feeds / day</small></div>
        <div class="stat"><b class="num">${M.fmtDur(avN(s => s.avgWake))}</b><small>wake window</small></div>
        <div class="stat"><b class="num">${M.fmtDur(avN(s => s.avgGap))}</b><small>feed gap</small></div>
        <div class="stat"><b class="num">${fmtNum(av(s => s.wees))}</b><small>wees / day</small></div>
        <div class="stat"><b class="num">${fmtNum(av(s => s.poos))}</b><small>poos / day</small></div>
      </div></section>

    <section class="card"><div class="card-h"><h2>By day</h2><span class="aside">tap a column to sort</span></div>
      ${sorted.length ? `<div class="tbl-wrap"><table><thead><tr>${cols.map(c => `<th data-sort="${c[0]}" class="${c[0] === ui.sort.key ? 'sorted' : ''}" data-dir="${ui.sort.dir > 0 ? '↑' : '↓'}">${c[1]}</th>`).join('')}</tr></thead>
      <tbody>${sorted.map(s => `<tr data-day="${s.day}">${cols.map(c => `<td class="num">${c[3](s)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="empty">No data in this range yet.</div>'}
    </section>
    <button class="btn" style="width:100%" id="csvBtn">Export ${n} days (CSV)</button>`;

  $$('[data-hl]', view).forEach(b => (b.onclick = () => { ui.insHighlight = b.dataset.hl; render(); }));
  $$('[data-day]', view).forEach(b => (b.onclick = () => { ui.insDay = +b.dataset.day; ui.insMode = 'day'; render(); window.scrollTo(0, 0); }));
  $$('[data-sort]', view).forEach(th => (th.onclick = () => {
    const k = th.dataset.sort;
    ui.sort = ui.sort.key === k ? { key: k, dir: -ui.sort.dir } : { key: k, dir: -1 };
    render();
  }));
  $('#csvBtn').onclick = () => exportCSV(M.addDays(today, -(n - 1)), M.addDays(today, 1));
}
const fmtNum = v => (v == null ? '–' : (Math.round(v * 10) / 10).toString());

function renderInsights() {
  const view = $('#view');
  const modes = [['day', 'Day'], ['7', '7 days'], ['14', '14 days'], ['30', '30 days']];
  view.innerHTML = `<div class="segctl">${modes.map(([k, l]) => `<button data-mode="${k}" class="${ui.insMode === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (ui.insMode === 'day') renderDayInsights(view);
  else renderRangeInsights(view, +ui.insMode);
  $$('[data-mode]', view).forEach(b => (b.onclick = () => { ui.insMode = b.dataset.mode; render(); }));
}

async function exportCSV(a, b) {
  const csv = M.toCSV(recs(), a, b);
  const name = `baby-${toLocalInput(a).slice(0, 10)}_to_${toLocalInput(b - 1).slice(0, 10)}.csv`;
  try {
    const file = new File([csv], name, { type: 'text/csv' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const aEl = document.createElement('a');
  aEl.href = url; aEl.download = name; document.body.appendChild(aEl); aEl.click(); aEl.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ───────────────────────── Settings ─────────────────────────
function syncStatusText() {
  const m = store.meta;
  if (!store.configured) return { t: 'Not connected — data is saved on this phone only. Add your GitHub details below to sync between phones.', err: false };
  if (store.status === 'error' || m.lastError) return { t: '⚠️ ' + (m.lastError || 'Sync error'), err: true };
  if (store.status === 'offline') return { t: 'Offline — changes are saved on this phone and will sync when back online.', err: false };
  return { t: m.lastSync ? `Synced ${M.fmtTime(m.lastSync)}${m.dirty.length ? ' · changes waiting' : ''}` : 'Not synced yet', err: false };
}

function settingsSheet() {
  const s = S();
  const st = syncStatusText();
  const hours = Array.from({ length: 24 }, (_, i) => i);
  openSheet(`<h3>Settings</h3><p class="hint">Saved on this phone.</p>
    <div class="set-section"><h4>Sync</h4>
      <div class="status-box${st.err ? ' err' : ''}" id="stBox">${esc(st.t)}</div>
      <div class="btn-row"><button class="btn" id="syncNow">Sync now</button></div>
    </div>
    <div class="set-section"><h4>Quick setup (2nd phone)</h4>
      <div class="form">
        <label class="field"><span>Paste setup code</span><input id="sCode" placeholder="BT1:…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        <div class="btn-row"><button class="btn" id="applyCode">Use code</button><button class="btn" id="copyCode" ${store.configured ? '' : 'disabled'}>Copy my code</button></div>
        <p class="small-note">The code contains your token — share it only by AirDrop or a private message, then delete the message.</p>
      </div>
    </div>
    <div class="set-section"><h4>GitHub data repo</h4>
      <div class="form">
        <label class="field"><span>GitHub username (owner)</span><input id="sOwner" value="${esc(s.owner)}" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
        <label class="field"><span>Private data repo name</span><input id="sRepo" value="${esc(s.repo)}" placeholder="baby-data" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
        <label class="field"><span>Fine-grained token</span><input id="sToken" type="password" value="${esc(s.token)}" placeholder="github_pat_…" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
        <label class="field"><span>Branch</span><input id="sBranch" value="${esc(s.branch)}" autocapitalize="off"></label>
        <div class="btn-row"><button class="btn primary" id="saveGh">Save &amp; test</button></div>
      </div>
    </div>
    <div class="set-section"><h4>Preferences</h4>
      <div class="form">
        <label class="field"><span>Your name (shows who logged what)</span><input id="sWho" value="${esc(s.who)}" placeholder="e.g. Mum"></label>
        <label class="field"><span>Wake window target (minutes)</span><input id="sWake" type="number" inputmode="numeric" min="30" max="300" value="${s.wakeWindowMin}"></label>
        <div class="row">
          <label class="field"><span>Night sleep from</span><select id="sNs">${hours.map(h => `<option value="${h}" ${h === s.nightStart ? 'selected' : ''}>${hourLabel(h)}</option>`).join('')}</select></label>
          <label class="field"><span>until</span><select id="sNe">${hours.map(h => `<option value="${h}" ${h === s.nightEnd ? 'selected' : ''}>${hourLabel(h)}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Theme</span><select id="sTheme">
          <option value="auto" ${s.themeMode === 'auto' ? 'selected' : ''}>Auto (dim 7pm–7am)</option>
          <option value="light" ${s.themeMode === 'light' ? 'selected' : ''}>Always light</option>
          <option value="dark" ${s.themeMode === 'dark' ? 'selected' : ''}>Always dim</option></select></label>
        <label class="check"><input type="checkbox" id="sRed" ${s.redLight ? 'checked' : ''}> Red-light mode 12am–5am <span class="small-note">(gentlest on eyes at night)</span></label>
        <div class="btn-row"><button class="btn primary" id="savePrefs">Save preferences</button></div>
      </div>
    </div>
    <div class="set-section"><h4>Data</h4>
      <div class="btn-row"><button class="btn" id="exportAll">Export everything (CSV)</button></div>
      <p class="small-note" style="margin-top:8px">${store.all().length} entries on this phone · device ${store.device.slice(-4)}</p>
    </div>
    <div class="btn-row"><button class="btn" data-close>Done</button></div>`, el => {
    const setBox = () => { const x = syncStatusText(); const b = $('#stBox', el); if (b) { b.textContent = x.t; b.classList.toggle('err', x.err); } };
    $('#syncNow', el).onclick = async () => { $('#stBox', el).textContent = 'Syncing…'; await store.sync(); setBox(); };
    $('#saveGh', el).onclick = async () => {
      store.saveSettings({ owner: $('#sOwner', el).value.trim(), repo: $('#sRepo', el).value.trim(), token: $('#sToken', el).value.trim(), branch: $('#sBranch', el).value.trim() || 'main' });
      const b = $('#stBox', el); b.textContent = 'Testing…'; b.classList.remove('err');
      try { b.textContent = await store.testConnection(); await store.sync(); setBox(); $('#copyCode', el).disabled = false; }
      catch (e) { b.textContent = '⚠️ ' + e.message; b.classList.add('err'); }
    };
    $('#applyCode', el).onclick = async () => {
      try { store.applySetupCode($('#sCode', el).value); settingsSheet(); toast('Connected ✓'); await store.sync(); }
      catch (e) { toast(e.message); }
    };
    $('#copyCode', el).onclick = async () => {
      const code = store.setupCode();
      try { await navigator.clipboard.writeText(code); toast('Setup code copied'); }
      catch { $('#sCode', el).value = code; $('#sCode', el).select(); toast('Select & copy the code above'); }
    };
    $('#savePrefs', el).onclick = () => {
      store.saveSettings({
        who: $('#sWho', el).value.trim(),
        wakeWindowMin: Math.max(20, Math.min(360, +$('#sWake', el).value || DEFAULT_SETTINGS.wakeWindowMin)),
        nightStart: +$('#sNs', el).value, nightEnd: +$('#sNe', el).value,
        themeMode: $('#sTheme', el).value,
        redLight: $('#sRed', el).checked,
      });
      applyTheme(); render(); toast('Preferences saved');
    };
    $('#exportAll', el).onclick = () => {
      const t = store.all().map(r => r.start ?? r.at);
      if (!t.length) return toast('Nothing to export yet');
      exportCSV(M.dayStart(Math.min(...t)), M.addDays(M.dayStart(Date.now()), 1));
    };
  });
}

// ───────────────────────── Render loop ─────────────────────────
function render() {
  try { renderInner(); }
  catch (e) {
    console.error(e);
    window.__bdShowError?.('Something went wrong drawing this screen', e, { retry: true });
  }
}
function renderInner() {
  const titles = { today: 'Today', log: 'Log', insights: 'Insights' };
  $('#title').textContent = titles[ui.tab];
  $('#subtitle').textContent = ui.tab === 'today' ? M.fmtDay(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === ui.tab));
  $('#view').className = 'view-' + ui.tab;
  if (ui.tab === 'today') renderToday();
  else if (ui.tab === 'log') renderLog();
  else renderInsights();
}

function tick() {
  const now = Date.now();
  for (const el of $$('[data-t0]')) {
    const v = (+el.dataset.acc || 0) + (now - +el.dataset.t0);
    el.textContent = el.dataset.fmt === 'timer' ? M.fmtTimer(v) : M.fmtDur(v);
  }
  updateWakeMeters(now);
}

function renderSyncDot() {
  const dot = $('#syncDot');
  const s = !store.configured ? 'local' : store.status === 'idle' ? (store.meta.lastError ? 'error' : 'ok') : store.status;
  dot.className = 'sync-dot ' + s;
}

$$('.tab').forEach(t => (t.onclick = () => {
  ui.tab = t.dataset.tab;
  if (ui.tab === 'log') ui.logDay = Math.min(ui.logDay, M.dayStart(Date.now()));
  render(); window.scrollTo(0, 0);
}));
$('#settingsBtn').onclick = settingsSheet;
$('#syncBtn').onclick = async () => {
  if (!store.configured) return settingsSheet();
  await store.sync();
  const s = syncStatusText();
  toast(s.t);
};

store.on(kind => {
  if (kind === 'data') render();
  if (kind === 'status' || kind === 'settings') renderSyncDot();
});

applyTheme();
render();
renderSyncDot();
setInterval(tick, 1000);
let lastMin = new Date().getMinutes();
setInterval(() => {
  const m = new Date().getMinutes();
  if (m !== lastMin) { lastMin = m; applyTheme(); if (ui.tab === 'today' && $('#sheetWrap').hidden) render(); }
}, 5000);

// Sync: on open, when returning to the app, every 30s while visible, and after each change.
store.sync();
setInterval(() => { if (document.visibilityState === 'visible') store.sync(); }, 30_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { ui.barMode = null; applyTheme(); render(); store.sync(); } });
window.addEventListener('online', () => store.sync());
window.addEventListener('pageshow', () => store.sync());
window.__bdStarted = true;
if (!store.configured && !store.all().length) setTimeout(() => toast('Tip: tap ⚙️ to connect GitHub sync', { ms: 5000 }), 1200);
