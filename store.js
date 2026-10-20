// ─────────────────────────────────────────────────────────────
// Data store: local cache + GitHub sync (private data repo)
// Records are merged per-id, last-write-wins on updatedAt.
// Files: data/YYYY-MM.json  →  { "v": 1, "records": [...] }
// ─────────────────────────────────────────────────────────────

const LS_RECORDS = 'bt.records.v1';
const LS_META = 'bt.syncmeta.v1';
const LS_SETTINGS = 'bt.settings.v1';
const LS_DEVICE = 'bt.device.v1';

export const DEFAULT_SETTINGS = {
  owner: '',
  repo: '',
  token: '',
  branch: 'main',
  who: '',            // e.g. "Mum" / "Dad" – shown in the log
  wakeWindowMin: 75,  // on-screen wake-window cue
  nightStart: 20,     // 8pm  (day/night sleep split)
  nightEnd: 8,        // 8am
  themeMode: 'auto',  // auto | light | dark
  themeDarkFrom: 19,  // auto night theme 7pm–7am
  themeDarkTo: 7,
  backdateFrom: 0,    // "started X min ago" chips shown 12am–8am
  backdateTo: 8,
  redLight: true,    // red-light mode 12am–5am
  redFrom: 0,
  redTo: 5,
};

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('storage', e); }
}

export function uid() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Date.now().toString(36) + '-' + Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

export function monthKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ── base64 <-> UTF-8 (notes may contain emoji)
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Merge record b into a; returns the winner. */
export function pickNewer(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (b.updatedAt > a.updatedAt) return b;
  if (b.updatedAt < a.updatedAt) return a;
  return (b.by || '') > (a.by || '') ? b : a; // deterministic tie-break
}

export class Store {
  constructor({ fetchImpl } = {}) {
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.settings = { ...DEFAULT_SETTINGS, ...lsGet(LS_SETTINGS, {}) };
    this.device = lsGet(LS_DEVICE, null) || (() => { const d = uid(); lsSet(LS_DEVICE, d); return d; })();
    this.map = new Map();
    for (const r of lsGet(LS_RECORDS, [])) this.map.set(r.id, r);
    // meta: { sha: {path: sha}, dirty: [monthKey], lastSync: ms, lastError }
    this.meta = { sha: {}, dirty: [], lastSync: 0, lastError: null, ...lsGet(LS_META, {}) };
    this.listeners = new Set();
    this.syncing = false;
    this.syncAgain = false;
    this._dirtiedDuringPush = new Set();
    this.status = 'idle';
  }

  // ── observers
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind) { for (const fn of this.listeners) fn(kind); }

  get configured() { const s = this.settings; return !!(s.owner && s.repo && s.token); }

  saveSettings(patch) {
    const old = this.settings;
    this.settings = { ...this.settings, ...patch };
    lsSet(LS_SETTINGS, this.settings);
    if (old.owner !== this.settings.owner || old.repo !== this.settings.repo || old.branch !== this.settings.branch) {
      // new repo: forget remote shas and push everything we have
      this.meta.sha = {};
      this.meta.dirty = [...new Set([...this.all(true)].map(r => r.mk))];
      this.persistMeta();
    }
    this.emit('settings');
  }

  persist() { lsSet(LS_RECORDS, [...this.map.values()]); }
  persistMeta() { lsSet(LS_META, this.meta); }

  /** All records (live only unless includeDeleted). */
  all(includeDeleted = false) {
    const out = [];
    for (const r of this.map.values()) if (includeDeleted || !r.deleted) out.push(r);
    return out;
  }

  /** Create or update a record. */
  put(rec) {
    const now = Date.now();
    const r = { ...rec };
    if (!r.id) r.id = uid();
    if (!r.mk) r.mk = monthKey(r.start ?? r.at ?? now);
    r.updatedAt = Math.max(now, (this.map.get(r.id)?.updatedAt || 0) + 1);
    r.by = this.device;
    if (this.settings.who) r.who = this.settings.who;
    this.map.set(r.id, r);
    if (!this.meta.dirty.includes(r.mk)) this.meta.dirty.push(r.mk);
    if (this.syncing) this._dirtiedDuringPush.add(r.mk);
    this.persist(); this.persistMeta();
    this.emit('data');
    this.scheduleSync();
    return r;
  }

  remove(id) {
    const r = this.map.get(id);
    if (r) this.put({ ...r, deleted: true });
  }

  /** Apply many puts at once (single emit). */
  batch(fn) {
    const origEmit = this.emit.bind(this);
    let fired = false;
    this.emit = (k) => { if (k === 'data') fired = true; else origEmit(k); };
    try { fn(); } finally { this.emit = origEmit; }
    if (fired) this.emit('data');
  }

  mergeRemote(records) {
    let changed = false;
    for (const rr of records) {
      const cur = this.map.get(rr.id);
      const win = pickNewer(cur, rr);
      if (win !== cur) { this.map.set(rr.id, win); changed = true; }
    }
    if (changed) { this.persist(); this.emit('data'); }
    return changed;
  }

  // ── GitHub API
  api(path, opts = {}) {
    const s = this.settings;
    const url = `https://api.github.com/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}${path}`;
    return this.fetch(url, {
      cache: 'no-store',
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${s.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
    });
  }

  async listRemote() {
    const res = await this.api(`/contents/data?ref=${encodeURIComponent(this.settings.branch)}&t=${Date.now()}`);
    if (res.status === 404) return [];
    if (!res.ok) throw await apiError(res);
    const arr = await res.json();
    return Array.isArray(arr) ? arr.filter(f => /^\d{4}-\d{2}\.json$/.test(f.name)) : [];
  }

  async fetchBlob(sha) {
    const res = await this.api(`/git/blobs/${sha}`);
    if (!res.ok) throw await apiError(res);
    const j = await res.json();
    return JSON.parse(b64decode(j.content));
  }

  async fetchFile(path) {
    const res = await this.api(`/contents/${path}?ref=${encodeURIComponent(this.settings.branch)}&t=${Date.now()}`);
    if (res.status === 404) return { sha: null, data: { records: [] } };
    if (!res.ok) throw await apiError(res);
    const j = await res.json();
    const data = j.content ? JSON.parse(b64decode(j.content)) : await this.fetchBlob(j.sha);
    return { sha: j.sha, data };
  }

  fileContent(mk) {
    const recs = this.all(true).filter(r => r.mk === mk)
      .sort((a, b) => (a.start ?? a.at) - (b.start ?? b.at) || (a.id < b.id ? -1 : 1));
    return JSON.stringify({ v: 1, month: mk, records: recs }, null, 0).replace(/},{/g, '},\n{');
  }

  async pushMonth(mk) {
    const path = `data/${mk}.json`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const body = {
        message: `log ${mk} (${this.settings.who || 'device ' + this.device.slice(-4)})`,
        content: b64encode(this.fileContent(mk)),
        branch: this.settings.branch,
      };
      if (this.meta.sha[path]) body.sha = this.meta.sha[path];
      const res = await this.api(`/contents/${path}`, { method: 'PUT', body: JSON.stringify(body) });
      if (res.ok) {
        const j = await res.json();
        this.meta.sha[path] = j.content.sha;
        return;
      }
      if (res.status === 409 || res.status === 422) {
        // someone else wrote first – fetch, merge, retry
        const { sha, data } = await this.fetchFile(path);
        this.meta.sha[path] = sha || undefined;
        if (!sha) delete this.meta.sha[path];
        this.mergeRemote(data.records || []);
        continue;
      }
      throw await apiError(res);
    }
    throw new Error('Could not save after several retries (conflict).');
  }

  scheduleSync(delay = 700) {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.sync(), delay);
  }

  setStatus(s, err) {
    this.status = s;
    if (err !== undefined) this.meta.lastError = err;
    this.emit('status');
  }

  async sync() {
    if (!this.configured) { this.setStatus('local'); return; }
    if (this.syncing) { this.syncAgain = true; return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.setStatus('offline'); return; }
    this.syncing = true;
    this._dirtiedDuringPush = new Set();
    this.setStatus('syncing');
    try {
      // 1) pull changed files
      const files = await this.listRemote();
      for (const f of files) {
        if (this.meta.sha[f.path] !== f.sha) {
          const data = await this.fetchBlob(f.sha);
          this.mergeRemote(data.records || []);
          this.meta.sha[f.path] = f.sha;
        }
      }
      // 2) push dirty months
      const dirty = [...this.meta.dirty];
      for (const mk of dirty) {
        await this.pushMonth(mk);
        this.meta.dirty = this.meta.dirty.filter(m => m !== mk || this._dirtiedDuringPush.has(m));
      }
      if (this._dirtiedDuringPush.size) this.syncAgain = true;
      this.meta.lastSync = Date.now();
      this.persistMeta();
      this.setStatus('ok', null);
    } catch (e) {
      console.error(e);
      this.persistMeta();
      this.setStatus('error', e.message || String(e));
    } finally {
      this.syncing = false;
      if (this.syncAgain) { this.syncAgain = false; this.scheduleSync(300); }
    }
  }

  async testConnection() {
    const res = await this.api('');
    if (!res.ok) throw await apiError(res);
    const j = await res.json();
    if (!j.permissions?.push) throw new Error('Token can read but not write. Give it "Contents: Read and write".');
    if (!j.private) return 'Connected — warning: this repo is PUBLIC. Make it private.';
    return 'Connected to private repo ✓';
  }

  /** Setup code to copy to another phone (owner/repo/token). */
  setupCode() {
    const { owner, repo, token, branch } = this.settings;
    return 'BT1:' + b64encode(JSON.stringify({ owner, repo, token, branch }));
  }
  applySetupCode(code) {
    const m = String(code).trim().match(/^BT1:(.+)$/);
    if (!m) throw new Error('That doesn\'t look like a setup code.');
    const j = JSON.parse(b64decode(m[1]));
    this.saveSettings({ owner: j.owner, repo: j.repo, token: j.token, branch: j.branch || 'main' });
  }
}

async function apiError(res) {
  let msg = `GitHub ${res.status}`;
  try { const j = await res.json(); if (j.message) msg += `: ${j.message}`; } catch {}
  if (res.status === 401) msg = 'Token rejected (401). Check or renew the token in Settings.';
  if (res.status === 403) msg += ' — check the token has Contents: Read and write on this repo.';
  if (res.status === 404) msg = 'Repo not found (404). Check owner/repo name and token access.';
  return new Error(msg);
}
