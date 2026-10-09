export const pad = n => String(n).padStart(2, '0');

export function dkey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(k, n) {
  const d = parseDay(k);
  d.setDate(d.getDate() + n);
  return dkey(d);
}

// Тиждень починається з понеділка
export function weekStart(k) {
  const d = parseDay(k);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dkey(d);
}

export function hm(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function mmss(ms) {
  const s = Math.ceil(ms / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function dur(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} хв`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} год ${r} хв` : `${h} год`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function fmtDayLong(k) {
  return parseDay(k).toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
}

const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
export function monthLabel(k) {
  const d = parseDay(k);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Індекс = Date.getDay() (0 — неділя)
export const WD_SHORT = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
