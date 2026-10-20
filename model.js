// ─────────────────────────────────────────────────────────────
// Pure model: timeline + statistics (no DOM). Testable in Node.
// Record shapes:
//   state: { kind:'state', type:'sleep'|'feed'|'awake', start, end|null, parts:[{at, v}] }
//          parts.v = 'L'|'R' for feed, 'bassinet'|'cosleep'|'carrier' for sleep
//   nappy: { kind:'nappy', type:'wee'|'poo'|'both', at }
//   note:  { kind:'note', at, text }
// ─────────────────────────────────────────────────────────────

export const MIN = 60_000;
export const HOUR = 60 * MIN;

export const PLACES = [
  { v: 'bassinet', label: 'Bassinet' },
  { v: 'cosleep', label: 'Co-sleep' },
  { v: 'carrier', label: 'Carrier' },
];
export const placeLabel = v => PLACES.find(p => p.v === v)?.label || 'Sleep';

export function dayStart(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
export function addDays(ms, n) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); }
export function atHour(day, h) { const d = new Date(day); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime(); }

/** Live state segments, sorted, with effective end (capped by next start / now). */
export function segments(records, now = Date.now()) {
  const st = records.filter(r => r.kind === 'state' && !r.deleted).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  const out = [];
  for (let i = 0; i < st.length; i++) {
    const r = st[i];
    const next = st[i + 1];
    let end = r.end ?? now;
    if (next && next.start < end) end = next.start;
    if (end < r.start) end = r.start;
    out.push({ id: r.id, rec: r, type: r.type, start: r.start, end, open: r.end == null && !next });
  }
  return out;
}

export function currentSegment(records, now = Date.now()) {
  const segs = segments(records, now);
  const last = segs[segs.length - 1];
  return last && last.open ? last : null;
}

/** Sub-intervals of a segment by part value (feed side / sleep place). */
export function subIntervals(seg) {
  const parts = (seg.rec.parts || []).slice().sort((a, b) => a.at - b.at);
  if (!parts.length) return [{ v: null, start: seg.start, end: seg.end }];
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const s = Math.max(seg.start, i === 0 ? seg.start : parts[i].at);
    const e = Math.min(seg.end, i + 1 < parts.length ? parts[i + 1].at : seg.end);
    if (e > s) {
      const prev = out[out.length - 1];
      if (prev && prev.v === parts[i].v) prev.end = e; else out.push({ v: parts[i].v, start: s, end: e });
    }
  }
  if (!out.length) out.push({ v: parts[parts.length - 1].v, start: seg.start, end: seg.end });
  return out;
}

export function overlap(s, e, a, b) { return Math.max(0, Math.min(e, b) - Math.max(s, a)); }

/** Bar pieces for a day [a,b): [{type, v, start, end}] — sleep split by place. */
export function barPieces(records, a, b, now = Date.now()) {
  const out = [];
  for (const seg of segments(records, now)) {
    if (seg.end <= a || seg.start >= b) continue;
    const subs = seg.type === 'sleep' ? subIntervals(seg) : [{ v: null, start: seg.start, end: seg.end }];
    for (const s of subs) {
      const ps = Math.max(a, s.start), pe = Math.min(b, s.end);
      if (pe > ps) out.push({ type: seg.type, v: s.v, start: ps, end: pe, segId: seg.id });
    }
  }
  return out;
}

export function events(records, kind, a = -Infinity, b = Infinity) {
  return records.filter(r => r.kind === kind && !r.deleted && r.at >= a && r.at < b).sort((x, y) => x.at - y.at);
}

/** Merge consecutive sleep segments (e.g. stop/start without a real wake). gap ≤ 2 min */
export function sleepBlocks(segs) {
  const out = [];
  for (const s of segs) {
    if (s.type !== 'sleep') continue;
    const prev = out[out.length - 1];
    if (prev && s.start - prev.end <= 2 * MIN) prev.end = Math.max(prev.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** Wake windows: time between consecutive sleep blocks (includes feeds). */
export function wakeWindows(segs) {
  const blocks = sleepBlocks(segs);
  const out = [];
  for (let i = 1; i < blocks.length; i++) out.push({ start: blocks[i - 1].end, end: blocks[i].start });
  return out.filter(w => w.end > w.start);
}

/** Next side to offer: opposite of the side the last feed STARTED on. */
export function feedSideInfo(records, now = Date.now()) {
  const feeds = segments(records, now).filter(s => s.type === 'feed');
  const last = feeds[feeds.length - 1];
  if (!last) return { last: null, next: 'L', lastStart: null, sides: [] };
  const subs = subIntervals(last);
  const first = subs[0]?.v;
  return {
    last,
    lastStart: last.start,
    sides: subs.map(s => s.v).filter(Boolean),
    next: first === 'L' ? 'R' : first === 'R' ? 'L' : 'L',
  };
}

/** Current wake window (ms since last sleep ended) if baby isn't asleep. */
export function currentWake(records, now = Date.now()) {
  const segs = segments(records, now);
  const cur = segs[segs.length - 1];
  if (!cur || !cur.open || cur.type === 'sleep') return null;
  const blocks = sleepBlocks(segs);
  const lastSleep = blocks[blocks.length - 1];
  if (!lastSleep) return { since: segs.find(s => s.type !== 'sleep')?.start ?? cur.start, ms: now - cur.start, approx: true };
  return { since: lastSleep.end, ms: now - lastSleep.end };
}

export function lastPlace(records) {
  const sl = records.filter(r => r.kind === 'state' && r.type === 'sleep' && !r.deleted).sort((a, b) => b.start - a.start)[0];
  const p = sl?.parts?.length ? sl.parts.slice().sort((a, b) => a.at - b.at).at(-1).v : null;
  return p || 'bassinet';
}

const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sum = a => a.reduce((x, y) => x + y, 0);

/** Statistics for one calendar day [a, a+1day). */
export function dayStats(records, a, settings, now = Date.now()) {
  const b = addDays(a, 1);
  const segs = segments(records, now);
  const inDay = segs.filter(s => s.end > a && s.start < b);
  const nightRanges = [[a, atHour(a, settings.nightEnd)], [atHour(a, settings.nightStart), b]];
  const isNightTime = t => nightRanges.some(([x, y]) => t >= x && t < y);

  const tot = { sleep: 0, feed: 0, awake: 0 };
  let sleepNight = 0;
  const place = { bassinet: 0, cosleep: 0, carrier: 0, other: 0 };
  const side = { L: 0, R: 0 };
  let tracked = 0;
  for (const s of inDay) {
    const d = overlap(s.start, s.end, a, b);
    tot[s.type] += d; tracked += d;
    if (s.type === 'sleep') {
      for (const [x, y] of nightRanges) sleepNight += overlap(s.start, s.end, x, y);
      for (const sub of subIntervals(s)) place[sub.v in place ? sub.v : 'other'] += overlap(sub.start, sub.end, a, b);
    }
    if (s.type === 'feed') for (const sub of subIntervals(s)) if (sub.v in side) side[sub.v] += overlap(sub.start, sub.end, a, b);
  }

  // Sleep blocks touching the day; longest uses full length (incl. across midnight)
  const blocks = sleepBlocks(segs).filter(bk => bk.end > a && bk.start < b);
  const longest = blocks.reduce((m, bk) => Math.max(m, bk.end - bk.start), 0);
  const longestBlock = blocks.find(bk => bk.end - bk.start === longest) || null;
  const naps = blocks.filter(bk => bk.start >= a && bk.start < b && !isNightTime(bk.start));

  // Feeds that START in the day
  const feeds = segs.filter(s => s.type === 'feed' && s.start >= a && s.start < b);
  const allFeeds = segs.filter(s => s.type === 'feed');
  const gaps = [];
  for (const f of feeds) {
    const i = allFeeds.indexOf(f);
    if (i > 0) gaps.push(f.start - allFeeds[i - 1].start); // start-to-start (clinical convention)
  }

  // Wake windows that END in the day (completed only)
  const ww = wakeWindows(segs).filter(w => w.end > a && w.end <= b).map(w => w.end - w.start);

  const nap = events(records, 'nappy', a, b);
  const wees = nap.filter(n => n.type === 'wee' || n.type === 'both').length;
  const poos = nap.filter(n => n.type === 'poo' || n.type === 'both').length;

  return {
    day: a,
    tracked,
    sleep: tot.sleep, sleepNight, sleepDay: tot.sleep - sleepNight,
    feed: tot.feed, awake: tot.awake,
    longest, longestBlock, naps: naps.length,
    feeds: feeds.length,
    avgFeed: avg(feeds.map(f => f.end - f.start)),
    avgGap: avg(gaps), maxGap: gaps.length ? Math.max(...gaps) : null,
    sideL: side.L, sideR: side.R,
    avgWake: avg(ww), maxWake: ww.length ? Math.max(...ww) : null, wakeCount: ww.length,
    place,
    wees, poos, nappies: nap.length,
    notes: events(records, 'note', a, b),
  };
}

export function fmtDur(ms, { short = false } = {}) {
  if (ms == null || isNaN(ms)) return '–';
  const m = Math.max(0, Math.round(ms / MIN)); // clamp: phones' clocks can disagree slightly
  const h = Math.floor(m / 60), mm = m % 60;
  if (h && short) return `${h}h${mm ? ' ' + mm + 'm' : ''}`;
  if (h) return `${h}h ${String(mm).padStart(2, '0')}m`;
  return `${mm}m`;
}

export function fmtTimer(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

export function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP]M)/i, (m, p) => p.toLowerCase());
}

export function fmtDay(ms, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(ms).toLocaleDateString(undefined, opts);
}

/** CSV of all records whose time falls in [a,b). */
export function toCSV(records, a, b, now = Date.now()) {
  const rows = [['date', 'event', 'detail', 'start', 'end', 'duration_min', 'logged_by']];
  const segs = segments(records, now).filter(s => s.start < b && s.end > a);
  const iso = ms => { const d = new Date(ms); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const items = [];
  for (const s of segs) {
    const subs = subIntervals(s).filter(x => x.v);
    const detail = s.type === 'feed' ? subs.map(x => `${x.v} ${Math.round((x.end - x.start) / MIN)}m`).join(' / ')
      : s.type === 'sleep' ? subs.map(x => `${placeLabel(x.v)} ${Math.round((x.end - x.start) / MIN)}m`).join(' / ') : '';
    items.push([s.start, s.type, detail, iso(s.start), s.open ? '(ongoing)' : iso(s.end), Math.round((s.end - s.start) / MIN), s.rec.who || '']);
  }
  for (const n of events(records, 'nappy', a, b)) items.push([n.at, 'nappy', n.type, iso(n.at), '', '', n.who || '']);
  for (const n of events(records, 'note', a, b)) items.push([n.at, 'note', n.text, iso(n.at), '', '', n.who || '']);
  items.sort((x, y) => x[0] - y[0]);
  for (const it of items) rows.push([it[3].slice(0, 10), ...it.slice(1)]);
  return rows.map(r => r.map(c => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const minuteOfDay = ms => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const circDist = (a, b) => { const d = Math.abs(a - b) % 1440; return Math.min(d, 1440 - d); };

/**
 * Predict the next feed (start-to-start). Uses the median gap of recent feeds that started at a
 * similar time of day (±90 min) — night gaps are longer than day gaps. Falls back to the last 6 gaps.
 */
export function predictNextFeed(records, now = Date.now()) {
  const feeds = segments(records, now).filter(s => s.type === 'feed');
  if (feeds.length < 3) return null;
  const last = feeds[feeds.length - 1];
  const gaps = [];
  for (let i = 1; i < feeds.length; i++) gaps.push({ from: feeds[i - 1].start, gap: feeds[i].start - feeds[i - 1].start });
  const recent = gaps.filter(g => g.from >= now - 4 * 24 * HOUR && g.gap > 30 * MIN && g.gap < 8 * HOUR);
  const lastMin = minuteOfDay(last.start);
  const similar = recent.filter(g => circDist(minuteOfDay(g.from), lastMin) <= 90);
  const basis = similar.length >= 3 ? similar : recent.slice(-6);
  const gap = median(basis.map(g => g.gap));
  if (!gap) return null;
  return { at: last.start + gap, gap, from: last.start, n: basis.length, similar: similar.length >= 3 };
}

/** All-time longest sleep block, and whether it's a new record set recently. */
export function sleepRecord(records, now = Date.now(), { withinMs = 18 * HOUR, minHistoryDays = 3 } = {}) {
  const segs = segments(records, now);
  if (!segs.length) return null;
  const blocks = sleepBlocks(segs).filter(b => !(segs.at(-1).open && segs.at(-1).type === 'sleep' && b.end >= now - 1000)); // completed only
  if (blocks.length < 2) return null;
  const sorted = blocks.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const best = sorted[0], prev = sorted[1];
  const historyDays = (now - segs[0].start) / (24 * HOUR);
  const isNew = historyDays >= minHistoryDays && now - best.end <= withinMs && (best.end - best.start) - (prev.end - prev.start) >= MIN;
  return { best, len: best.end - best.start, prevLen: prev.end - prev.start, isNew };
}
