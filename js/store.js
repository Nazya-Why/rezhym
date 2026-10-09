import { dkey, parseDay, addDays, uid } from './util.js';

const KEY = 'rezhym:v1';

export const DEFAULT_SETTINGS = { grace: 15, strictLate: false, focusMin: 25, breakMin: 5, theme: 'auto', updatedAt: 0 };
export const COLORS = ['blue', 'indigo', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'mint', 'teal'];

const empty = () => ({ v: 1, habits: {}, tasks: {}, log: {}, focus: {}, settings: { ...DEFAULT_SETTINGS } });

export function normalize(s) {
  if (!s || typeof s !== 'object') return empty();
  return {
    v: 1,
    habits: s.habits || {},
    tasks: s.tasks || {},
    log: s.log || {},
    focus: s.focus || {},
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
  };
}

export let state = (() => {
  try { return normalize(JSON.parse(localStorage.getItem(KEY))); } catch { return empty(); }
})();

/* ---------- підписки і збереження ---------- */

const listeners = new Set();
let changeHook = null;
let cache = new Map();

export const subscribe = fn => (listeners.add(fn), () => listeners.delete(fn));
export const onLocalChange = fn => { changeHook = fn; };

function commit(local = true) {
  cache = new Map();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  listeners.forEach(fn => fn());
  if (local) changeHook?.();
}

export function replaceState(next) { state = normalize(next); commit(false); }
export function resetAll() { state = empty(); commit(false); }
export const serialize = () => JSON.parse(JSON.stringify(state));

/* ---------- злиття між пристроями: перемагає новіший запис ---------- */

function mergeMap(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (!out[k] || (v?.updatedAt || 0) > (out[k].updatedAt || 0)) out[k] = v;
  }
  return out;
}

export function merge(a, b) {
  a = normalize(a); b = normalize(b);
  return {
    v: 1,
    habits: mergeMap(a.habits, b.habits),
    tasks: mergeMap(a.tasks, b.tasks),
    log: mergeMap(a.log, b.log),
    focus: mergeMap(a.focus, b.focus),
    settings: (b.settings.updatedAt || 0) > (a.settings.updatedAt || 0) ? b.settings : a.settings,
  };
}

/* ---------- налаштування ---------- */

export function setSettings(patch) {
  state.settings = { ...state.settings, ...patch, updatedAt: Date.now() };
  commit();
}

/* ---------- звички ---------- */

const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.title.localeCompare(b.title, 'uk');

export const activeHabits = () => Object.values(state.habits).filter(h => !h.deletedAt).sort(byTime);

export function saveHabit(data) {
  const t = Date.now();
  let h = data.id && state.habits[data.id];
  if (!h) h = { id: uid(), createdAt: t, createdDay: dkey(), deletedAt: null, deletedDay: null };
  Object.assign(h, data, { id: h.id, updatedAt: t });
  state.habits[h.id] = h;
  commit();
  return h;
}

export function deleteHabit(id) {
  const h = state.habits[id];
  if (!h) return;
  Object.assign(h, { deletedAt: Date.now(), deletedDay: dkey(), updatedAt: Date.now() });
  commit();
}

export function restoreHabit(id) {
  const h = state.habits[id];
  if (!h) return;
  Object.assign(h, { deletedAt: null, deletedDay: null, updatedAt: Date.now() });
  commit();
}

export function habitApplies(h, day) {
  if (h.createdDay > day) return false;
  if (h.deletedDay && h.deletedDay <= day) return false;
  return (h.days || []).includes(parseDay(day).getDay());
}

const lk = (day, id) => `${day}|${id}`;
export const getCount = (day, id) => state.log[lk(day, id)]?.count || 0;

export function setHabitCount(day, id, count) {
  const h = state.habits[id];
  if (!h) return;
  const target = h.target || 1;
  count = Math.max(0, Math.min(count, target));
  const prev = state.log[lk(day, id)];
  const t = Date.now();
  const doneAt = count >= target ? (prev?.doneAt ?? t) : null;
  state.log[lk(day, id)] = { count, doneAt, updatedAt: t };
  commit();
}

/* ---------- задачі на день ---------- */

export function saveTask(data) {
  const t = Date.now();
  let k = data.id && state.tasks[data.id];
  if (!k) k = { id: uid(), done: false, doneAt: null, deleted: false, createdAt: t };
  Object.assign(k, data, { id: k.id, updatedAt: t });
  state.tasks[k.id] = k;
  commit();
  return k;
}

export function setTaskDone(id, done) {
  const k = state.tasks[id];
  if (!k) return;
  Object.assign(k, { done, doneAt: done ? Date.now() : null, updatedAt: Date.now() });
  commit();
}

export function deleteTask(id, deleted = true) {
  const k = state.tasks[id];
  if (!k) return;
  Object.assign(k, { deleted, updatedAt: Date.now() });
  commit();
}

/* ---------- фокус-сесії ---------- */

export function addFocus({ minutes, at, label }) {
  const id = uid();
  state.focus[id] = { id, day: dkey(new Date(at)), minutes, at, label: label || '', updatedAt: Date.now() };
  commit();
}

export const focusFor = day => Object.values(state.focus).filter(f => f.day === day).sort((a, b) => a.at - b.at);

/* ---------- логіка дня ---------- */

export function itemsFor(day) {
  const items = [];
  for (const h of Object.values(state.habits)) {
    if (!habitApplies(h, day)) continue;
    const e = state.log[lk(day, h.id)];
    items.push({
      kind: 'habit', id: h.id, title: h.title, icon: h.icon, color: h.color,
      time: h.time || null, must: !!h.must, target: h.target || 1, unit: h.unit || '',
      count: e?.count || 0, doneAt: e?.doneAt || null,
    });
  }
  for (const t of Object.values(state.tasks)) {
    if (t.deleted || t.day !== day) continue;
    items.push({
      kind: 'task', id: t.id, title: t.title, icon: 'list', color: 'gray',
      time: t.time || null, must: !!t.must, target: 1, unit: '',
      count: t.done ? 1 : 0, doneAt: t.doneAt || null,
    });
  }
  return items.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || (b.must - a.must) || a.title.localeCompare(b.title, 'uk'));
}

export function deadline(day, time) {
  const [h, m] = time.split(':').map(Number);
  const d = parseDay(day);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// done | late | overdue | missed | pending | planned
export function statusOf(it, day, nowMs = Date.now()) {
  const today = dkey(new Date(nowMs));
  const grace = state.settings.grace * 60000;
  if (it.count >= it.target) {
    return it.time && it.doneAt && it.doneAt > deadline(day, it.time) + grace ? 'late' : 'done';
  }
  if (day < today) return 'missed';
  if (day > today) return 'planned';
  if (it.time && nowMs > deadline(day, it.time) + grace) return 'overdue';
  return 'pending';
}

// result: success | fail | open | future | neutral
export function dayStats(day, nowMs = Date.now()) {
  const today = dkey(new Date(nowMs));
  if (day < today && cache.has(day)) return cache.get(day);
  const strict = state.settings.strictLate;
  const items = itemsFor(day);
  let total = 0, got = 0, must = 0, mustDone = 0, done = 0;
  for (const it of items) {
    const w = it.must ? 2 : 1;
    const st = statusOf(it, day, nowMs);
    const ok = st === 'done' || (st === 'late' && !strict);
    let credit = Math.min(1, it.count / it.target);
    if (st === 'late') credit = strict ? 0 : 0.5;
    total += w;
    got += w * credit;
    if (st === 'done' || st === 'late') done++;
    if (it.must) { must++; if (ok) mustDone++; }
  }
  const score = total ? got / total : 0;
  let result;
  if (!items.length) result = 'neutral';
  else if (day > today) result = 'future';
  else if (must ? mustDone === must : score >= 0.8) result = 'success';
  else result = day < today ? 'fail' : 'open';
  const out = { items: items.length, done, score, must, mustDone, result };
  if (day < today) cache.set(day, out);
  return out;
}

export function firstDay() {
  let f = null;
  for (const h of Object.values(state.habits)) if (!f || h.createdDay < f) f = h.createdDay;
  for (const t of Object.values(state.tasks)) if (!t.deleted && (!f || t.day < f)) f = t.day;
  return f;
}

// Серія: дні без обов'язкових справ її не рвуть, сьогоднішній день рве тільки після завершення
export function streaks(nowMs = Date.now()) {
  const today = dkey(new Date(nowMs));
  const first = firstDay();
  if (!first) return { current: 0, best: 0 };
  let run = 0, best = 0;
  for (let d = first; d <= today; d = addDays(d, 1)) {
    const r = dayStats(d, nowMs).result;
    if (r === 'success') best = Math.max(best, ++run);
    else if (r === 'fail') run = 0;
  }
  return { current: run, best };
}

export function habitStats(h, nowMs = Date.now()) {
  const today = dkey(new Date(nowMs));
  const ok = d => getCount(d, h.id) >= (h.target || 1);
  let total = 0, done = 0, streak = 0, counting = true;
  for (let i = 0; i < 730; i++) {
    const d = addDays(today, -i);
    if (d < h.createdDay) break;
    if (!habitApplies(h, d)) continue;
    const good = ok(d);
    if (i < 30 && !(i === 0 && !good)) { total++; if (good) done++; }
    if (counting) {
      if (good) streak++;
      else if (i !== 0) counting = false;
    }
    if (!counting && i >= 30) break;
  }
  return { pct: total ? Math.round(done / total * 100) : 0, total, done, streak };
}
