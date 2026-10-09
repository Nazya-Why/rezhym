import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import * as S from './store.js';

export const enabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let sb = null;
let user = null;
let pushTimer = null;
let queue = Promise.resolve();
const status = { state: enabled ? 'init' : 'local', at: null, error: '' };
const subs = new Set();

export const getStatus = () => ({ ...status, email: user?.email || '' });
export const onStatus = fn => (subs.add(fn), () => subs.delete(fn));

function set(state, error = '') {
  status.state = state;
  status.error = error;
  if (state === 'synced') status.at = Date.now();
  subs.forEach(fn => fn(getStatus()));
}

const run = fn => (queue = queue.then(fn).catch(e => set('error', humanError(e))));

// Стабільне порівняння: порядок ключів не важливий
const canon = v => JSON.stringify(v, (k, val) =>
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.keys(val).sort().reduce((o, key) => (o[key] = val[key], o), {})
    : val);

export async function init() {
  if (!enabled) return;
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    sb = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  } catch {
    set('error', 'Немає звʼязку із сервером. Дані збережено на пристрої.');
    return;
  }
  const { data } = await sb.auth.getSession();
  user = data.session?.user || null;

  sb.auth.onAuthStateChange((_event, session) => {
    const prev = user?.id;
    user = session?.user || null;
    if (user && user.id !== prev) setTimeout(() => run(pull), 0);
    if (!user) set('signedout');
  });

  S.onLocalChange(schedule);
  if (user) run(pull); else set('signedout');

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && user) run(pull);
  });
  addEventListener('online', () => user && run(push));
  setInterval(() => { if (user && document.visibilityState === 'visible') run(pull); }, 60_000);
}

async function fetchRemote() {
  const { data, error } = await sb.from('user_state').select('data').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  return data?.data || null;
}

async function upload(data) {
  const { error } = await sb.from('user_state').upsert({ user_id: user.id, data, updated_at: new Date().toISOString() });
  if (error) throw error;
}

async function pull() {
  if (!user) return;
  set('syncing');
  const remote = await fetchRemote();
  const local = S.serialize();
  const merged = remote ? S.merge(local, remote) : local;
  if (canon(merged) !== canon(local)) S.replaceState(merged);
  if (!remote || canon(merged) !== canon(S.normalize(remote))) await upload(merged);
  set('synced');
}

async function push() {
  if (!user) return;
  clearTimeout(pushTimer);
  set('syncing');
  const remote = await fetchRemote();
  const local = S.serialize();
  const merged = remote ? S.merge(local, remote) : local;
  if (canon(merged) !== canon(local)) S.replaceState(merged);
  await upload(merged);
  set('synced');
}

function schedule() {
  if (!user) return;
  set('pending');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => run(push), 1200);
}

export const syncNow = () => user && run(push);

// Після «скинути все»: перезаписати хмару замість злиття
export const overwriteRemote = () => user && run(async () => { set('syncing'); await upload(S.serialize()); set('synced'); });

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(humanError(error));
}

// true — увійшли одразу; false — треба підтвердити пошту
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw new Error(humanError(error));
  return Boolean(data.session);
}

export async function signOut() {
  await sb.auth.signOut();
  user = null;
  set('signedout');
}

function humanError(e) {
  const m = (e?.message || String(e)).toLowerCase();
  if (m.includes('invalid login')) return 'Невірний email або пароль';
  if (m.includes('already registered')) return 'Такий акаунт уже є — просто увійди';
  if (m.includes('email not confirmed')) return 'Підтверди email: лист уже в пошті';
  if (m.includes('password should be')) return 'Пароль має бути щонайменше 6 символів';
  if (m.includes('rate limit')) return 'Забагато спроб. Спробуй за хвилину';
  if (m.includes('fetch') || m.includes('network')) return 'Немає інтернету. Дані збережено на пристрої';
  if (m.includes('relation') || m.includes('does not exist')) return 'Таблицю не створено — виконай supabase.sql';
  return e?.message || 'Щось пішло не так';
}
