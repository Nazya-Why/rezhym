import { icon, HABIT_ICONS } from './icons.js';
import * as S from './store.js';
import * as Sync from './sync.js';
import { dkey, parseDay, addDays, weekStart, hm, mmss, plural, dur, esc, fmtDayLong, monthLabel, WD_SHORT, WEEK_ORDER } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const view = $('#view');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const haptic = (p = 8) => { try { navigator.vibrate?.(p); } catch {} };

const ROUTES = ['today', 'habits', 'focus', 'stats'];
let route = 'today';
let selDay = dkey();
let weekOf = weekStart(selDay);
let pop = null;
let sheetEl = null;
let lastFocus = null;
const ringMemo = new Map();

/* ================= допоміжне ================= */

function ring(value, { size = 120, stroke = 12, color = 'url(#g-main)', key = null, cls = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  const from = key && ringMemo.has(key) ? ringMemo.get(key) : (key ? 0 : v);
  if (key) ringMemo.set(key, v);
  const half = size / 2;
  return `<svg class="ring ${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${half}" cy="${half}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
    <circle class="ring-val" cx="${half}" cy="${half}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" style="stroke-dashoffset:${c * (1 - from)}" data-c="${c}" data-to="${c * (1 - v)}" transform="rotate(-90 ${half} ${half})" ${v === 0 ? 'opacity="0"' : ''}/>
  </svg>`;
}

function animateRings() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('.ring-val[data-to]').forEach(el => { el.style.strokeDashoffset = el.dataset.to; });
  }));
}

function toast(msg, { action, onAction, tone = '' } = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast glass ${tone}`;
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn" type="button">${esc(action)}</button>` : ''}`;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const kill = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); };
  if (action) el.querySelector('button').onclick = () => { onAction(); kill(); };
  setTimeout(kill, action ? 5000 : 2600);
}

let actx;
function audio() {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch {}
  return actx;
}
function chime() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  [880, 1318.5, 1760].forEach((f, i) => {
    const o = a.createOscillator(), g = a.createGain();
    const s = t + i * 0.11;
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(0.16, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, s + 0.7);
    o.connect(g).connect(a.destination);
    o.start(s);
    o.stop(s + 0.75);
  });
}
addEventListener('pointerdown', audio, { once: true });

function applyTheme() {
  const t = S.state.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function daysLabel(days = []) {
  const set = new Set(days);
  if (set.size === 7) return 'Щодня';
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'Будні';
  if (set.size === 2 && set.has(6) && set.has(0)) return 'Вихідні';
  return WEEK_ORDER.filter(d => set.has(d)).map(d => WD_SHORT[d]).join(', ');
}

/* ================= рендер ================= */

function render(enter = false) {
  view.innerHTML = route === 'today' ? viewToday()
    : route === 'habits' ? viewHabits()
    : route === 'focus' ? viewFocus()
    : viewStats();
  if (enter && !reduceMotion.matches) {
    view.classList.remove('enter');
    void view.offsetWidth;
    view.classList.add('enter');
  }
  animateRings();
  $$('.tabbar a').forEach(a => a.setAttribute('aria-current', a.dataset.route === route ? 'page' : 'false'));
  pop = null;
}

function header(eyebrow, title, addAct) {
  const st = Sync.getStatus().state;
  return `<header class="top">
    <div class="top-text"><p class="eyebrow">${esc(eyebrow)}</p><h1 class="large-title">${esc(title)}</h1></div>
    <div class="top-actions">
      ${addAct ? `<button class="icon-btn glass" data-act="${addAct}" aria-label="Додати">${icon('plus', 22)}</button>` : ''}
      <button class="icon-btn glass" data-act="settings" aria-label="Акаунт і налаштування">${icon('user', 22)}<span class="sync-dot" data-sync="${st}"></span></button>
    </div>
  </header>`;
}

/* ---------- Сьогодні ---------- */

function viewToday() {
  const now = Date.now(), today = dkey(), day = selDay;
  const st = S.dayStats(day, now);
  const items = S.itemsFor(day);
  const isToday = day === today, isPast = day < today;
  const { current } = S.streaks(now);
  const title = isToday ? 'Сьогодні'
    : day === addDays(today, -1) ? 'Вчора'
    : day === addDays(today, 1) ? 'Завтра'
    : isPast ? 'Минулий день' : 'План';
  return header(fmtDayLong(day), title, 'add')
    + weekStrip(now)
    + hero(st, current, isToday)
    + (isToday ? nowCard(items, now) : '')
    + (isPast ? `<div class="banner glass">${icon('lock', 16)}<span>Минулий день зафіксовано. Змінити результат уже не можна.</span></div>` : '')
    + dayList(items, day, now);
}

function weekStrip(now) {
  const today = dkey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekOf, i));
  const cells = days.map(d => {
    const s = S.dayStats(d, now);
    const color = s.result === 'success' ? 'var(--green)' : s.result === 'fail' ? 'var(--red)' : 'var(--blue)';
    const label = `${fmtDayLong(d)}${s.items ? `, ${Math.round(s.score * 100)}%` : ''}`;
    return `<button class="wd ${d === selDay ? 'sel' : ''} ${d === today ? 'is-today' : ''}" data-act="day" data-d="${d}" aria-pressed="${d === selDay}" aria-label="${esc(label)}">
      <span class="wd-name">${WD_SHORT[parseDay(d).getDay()]}</span>
      <span class="wd-ring">${ring(s.score, { size: 38, stroke: 4, color })}<b>${parseDay(d).getDate()}</b></span>
    </button>`;
  }).join('');
  return `<section class="week glass" aria-label="Тиждень">
    <div class="week-head">
      <button class="icon-btn sm" data-act="week" data-d="-7" aria-label="Попередній тиждень">${icon('chevron-left', 18)}</button>
      <span class="week-label">${monthLabel(weekOf)}</span>
      ${selDay !== today ? `<button class="pill-btn" data-act="go-today">Сьогодні</button>` : ''}
      <button class="icon-btn sm" data-act="week" data-d="7" aria-label="Наступний тиждень">${icon('chevron-right', 18)}</button>
    </div>
    <div class="week-days">${cells}</div>
  </section>`;
}

function hero(st, streak, isToday) {
  const pct = Math.round(st.score * 100);
  const color = st.result === 'success' ? 'url(#g-success)' : st.result === 'fail' ? 'url(#g-fail)' : 'url(#g-main)';
  const left = st.must - st.mustDone;
  let line;
  if (!st.items) line = 'На цей день нічого не заплановано';
  else if (st.result === 'success') line = isToday ? 'День зараховано. Так тримати.' : 'День зараховано';
  else if (st.result === 'fail') line = st.must ? `Провалено ${left} з ${st.must} обовʼязкових` : 'День не зараховано';
  else if (st.result === 'future') line = 'Запланований день';
  else line = st.must
    ? `Ще ${left} ${plural(left, ['обовʼязкова справа', 'обовʼязкові справи', 'обовʼязкових справ'])} до зарахування дня`
    : 'Зроби 80% справ, щоб зарахувати день';
  return `<section class="hero glass r-${st.result}" aria-label="Прогрес дня ${pct}%">
    <div class="hero-ring">
      ${ring(st.score, { size: 132, stroke: 15, color, key: 'hero' })}
      <div class="hero-pct"><b>${pct}<small>%</small></b><span>${st.done} з ${st.items}</span></div>
    </div>
    <div class="hero-side">
      <div class="stat"><span class="stat-ico c-orange-t">${icon('flame', 18)}</span><div><b>${streak} ${plural(streak, ['день', 'дні', 'днів'])}</b><span>серія</span></div></div>
      <div class="stat"><span class="stat-ico c-red-t">${icon('target', 18)}</span><div><b>${st.mustDone} / ${st.must}</b><span>обовʼязкові</span></div></div>
      <p class="hero-line">${esc(line)}</p>
    </div>
  </section>`;
}

function nowCard(items, now) {
  const day = dkey();
  const stOf = it => S.statusOf(it, day, now);
  const over = items.filter(it => stOf(it) === 'overdue');
  if (over.length) {
    const names = over.slice(0, 3).map(i => esc(i.title)).join(', ') + (over.length > 3 ? '…' : '');
    return `<section class="now glass danger" role="status">
      <span class="now-ico">${icon('alert', 20)}</span>
      <div><p class="eyebrow">Прострочено · ${over.length}</p><p class="now-title">${names}</p><p class="now-sub">Без відмовок. Зроби це зараз.</p></div>
    </section>`;
  }
  const next = items.find(it => it.time && stOf(it) === 'pending');
  if (next) {
    const ms = S.deadline(day, next.time) - now;
    return `<section class="now glass">
      <span class="now-ico c-blue">${icon('clock', 20)}</span>
      <div><p class="eyebrow">Далі</p><p class="now-title">${esc(next.title)}</p><p class="now-sub">о ${next.time} · ${ms > 0 ? 'через ' + dur(ms) : 'зараз'}</p></div>
    </section>`;
  }
  if (items.length && items.every(it => ['done', 'late'].includes(stOf(it)))) {
    return `<section class="now glass win">
      <span class="now-ico c-green">${icon('check', 20)}</span>
      <div><p class="eyebrow">Все зроблено</p><p class="now-title">Сьогодні прокрастинація програла</p><p class="now-sub">Відпочинь і готуй завтрашній день.</p></div>
    </section>`;
  }
  return '';
}

function dayList(items, day, now) {
  if (!items.length) return emptyDay(day);
  const timed = items.filter(i => i.time), free = items.filter(i => !i.time);
  const sec = (title, arr) => arr.length
    ? `<section class="section"><h2 class="section-title">${title}</h2><ul class="rows" role="list">${arr.map(it => row(it, day, now)).join('')}</ul></section>`
    : '';
  return sec('Розклад', timed) + sec('Протягом дня', free);
}

function emptyDay(day) {
  if (!S.activeHabits().length) {
    return `<section class="empty glass">
      <span class="empty-ico">${icon('sparkle', 28)}</span>
      <h2>Збери свій режим</h2>
      <p>Додай звички, які мають бути щодня: підйом, спорт, вода, відбій. Обовʼязкові визначають, чи зараховано день.</p>
      <button class="btn primary" data-act="starter">Почати з готового режиму</button>
      <button class="btn" data-act="add-habit">Створити свою звичку</button>
    </section>`;
  }
  return `<section class="empty glass">
    <span class="empty-ico">${icon('today', 28)}</span>
    <h2>${day < dkey() ? 'Нічого не було' : 'Вільний день'}</h2>
    ${day >= dkey() ? `<p>Додай задачі, які обовʼязково треба закрити цього дня.</p><button class="btn primary" data-act="add-task">Додати задачу</button>` : ''}
  </section>`;
}

function row(it, day, now) {
  const today = dkey();
  const st = S.statusOf(it, day, now);
  const isDone = st === 'done' || st === 'late';
  const editable = day === today;
  const canEdit = day >= today;
  const meta = [];
  if (it.time) meta.push(`<span class="m">${icon('clock', 13)}${it.time}</span>`);
  if (it.must) meta.push(`<span class="tag must">Обовʼязково</span>`);
  const stText = {
    done: it.doneAt ? `Виконано о ${hm(it.doneAt)}` : 'Виконано',
    late: `Із запізненням · ${it.doneAt ? hm(it.doneAt) : ''}`,
    overdue: it.time ? `Прострочено на ${dur(now - S.deadline(day, it.time))}` : '',
    missed: 'Провалено',
    pending: it.target > 1 ? `${it.count} з ${it.target}${it.unit ? ' ' + esc(it.unit) : ''}` : '',
    planned: '',
  }[st];
  if (stText) meta.push(`<span class="st st-${st}">${stText}</span>`);

  let ctrl;
  if (it.target > 1) {
    ctrl = `${editable && it.count > 0 ? `<button class="mini-btn" data-act="dec" data-id="${it.id}" aria-label="${esc(it.title)}: мінус один">${icon('minus', 16)}</button>` : ''}
      <button class="counter ${isDone ? 'on' : ''} ${pop === it.id ? 'pop' : ''}" data-act="inc" data-id="${it.id}" ${editable ? '' : 'disabled'}
        aria-label="${esc(it.title)}: ${it.count} з ${it.target}${editable && !isDone ? '. Додати один' : ''}">
        ${ring(it.count / it.target, { size: 44, stroke: 4, color: `var(--${it.color})`, key: `c-${day}-${it.id}` })}
        <span>${isDone ? icon('check', 18) : it.count}</span>
      </button>`;
  } else {
    const cls = [isDone && 'on', st === 'late' && 'late', st === 'missed' && 'missed', st === 'overdue' && 'overdue', pop === it.id && 'pop'].filter(Boolean).join(' ');
    ctrl = `<button class="check ${cls}" data-act="toggle" data-kind="${it.kind}" data-id="${it.id}" ${editable ? '' : 'disabled'}
      aria-pressed="${isDone}" aria-label="${esc(it.title)}">${icon(st === 'missed' ? 'x' : 'check', 18)}</button>`;
  }
  const inner = `<span class="tile c-${it.color}">${icon(it.icon, 20)}</span>
    <span class="row-text"><span class="row-title">${esc(it.title)}</span><span class="row-meta">${meta.join('')}</span></span>`;
  const body = canEdit
    ? `<button class="row-body" data-act="edit" data-kind="${it.kind}" data-id="${it.id}" aria-label="Змінити: ${esc(it.title)}">${inner}</button>`
    : `<div class="row-body">${inner}</div>`;
  return `<li class="row glass st-${st} ${isDone ? 'is-done' : ''}">${body}<div class="row-ctrl">${ctrl}</div></li>`;
}

/* ---------- Звички ---------- */

function viewHabits() {
  const hs = S.activeHabits();
  const now = Date.now();
  const groups = [
    ['Ранок', h => h.time && h.time < '12:00'],
    ['День', h => h.time && h.time >= '12:00' && h.time < '18:00'],
    ['Вечір', h => h.time && h.time >= '18:00'],
    ['Будь-коли', h => !h.time],
  ];
  const body = hs.length
    ? groups.map(([t, f]) => {
        const arr = hs.filter(f);
        return arr.length ? `<section class="section"><h2 class="section-title">${t}</h2><ul class="rows" role="list">${arr.map(h => habitRow(h, now)).join('')}</ul></section>` : '';
      }).join('')
    : `<section class="empty glass">
        <span class="empty-ico">${icon('repeat', 28)}</span>
        <h2>Поки жодної звички</h2>
        <p>Звичка повторюється за розкладом. Познач обовʼязкові, і пропуск будь-якої з них обнулить серію.</p>
        <button class="btn primary" data-act="starter">Почати з готового режиму</button>
        <button class="btn" data-act="add-habit">Створити свою звичку</button>
      </section>`;
  const sub = hs.length ? `${hs.length} ${plural(hs.length, ['звичка', 'звички', 'звичок'])} · ${hs.filter(h => h.must).length} обовʼязкових` : 'Твій режим';
  return header(sub, 'Звички', 'add-habit') + body;
}

function habitRow(h, now) {
  const hs = S.habitStats(h, now);
  return `<li class="row glass">
    <button class="row-body" data-act="edit" data-kind="habit" data-id="${h.id}" aria-label="Змінити: ${esc(h.title)}">
      <span class="tile c-${h.color}">${icon(h.icon, 20)}</span>
      <span class="row-text">
        <span class="row-title">${esc(h.title)}</span>
        <span class="row-meta">
          <span class="m">${daysLabel(h.days)}</span>
          ${h.time ? `<span class="m">${icon('clock', 13)}${h.time}</span>` : ''}
          ${h.target > 1 ? `<span class="m">${h.target} ${esc(h.unit || 'разів')}</span>` : ''}
          ${h.must ? '<span class="tag must">Обовʼязково</span>' : ''}
        </span>
      </span>
      <span class="row-streak" title="Серія">${icon('flame', 15)}<span>${hs.streak}</span><span class="sr-only"> днів поспіль</span></span>
      ${icon('chevron-right', 18, 'chev')}
    </button>
  </li>`;
}

/* ---------- Фокус (Pomodoro) ---------- */

const TKEY = 'rezhym:timer';
let timer = (() => {
  try { const t = JSON.parse(localStorage.getItem(TKEY)); if (t && t.dur) return t; } catch {}
  const d = S.state.settings.focusMin * 60000;
  return { mode: 'focus', dur: d, left: d, endAt: null, label: '' };
})();
let wakeLock = null;

const saveTimer = () => { try { localStorage.setItem(TKEY, JSON.stringify(timer)); } catch {} };
const timerLeft = () => timer.endAt ? Math.max(0, timer.endAt - Date.now()) : timer.left;

async function holdScreen(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch {}
}

function setMode(mode, min) {
  const s = S.state.settings;
  timer.mode = mode;
  timer.dur = (min ?? (mode === 'focus' ? s.focusMin : s.breakMin)) * 60000;
  timer.left = timer.dur;
  timer.endAt = null;
  saveTimer();
  holdScreen(false);
}

function checkTimer() {
  if (!timer.endAt || Date.now() < timer.endAt) return;
  const wasFocus = timer.mode === 'focus';
  if (wasFocus) S.addFocus({ minutes: Math.round(timer.dur / 60000), at: timer.endAt, label: timer.label });
  chime();
  haptic([20, 60, 20]);
  toast(wasFocus ? 'Сесію завершено. Перерва.' : 'Перерва скінчилась. До роботи.', { tone: 'ok' });
  setMode(wasFocus ? 'break' : 'focus');
  if (route === 'focus') render();
}

function viewFocus() {
  const left = timerLeft();
  const running = Boolean(timer.endAt);
  const today = dkey();
  const sessions = S.focusFor(today);
  const mins = sessions.reduce((a, f) => a + f.minutes, 0);
  const presets = timer.mode === 'focus' ? [15, 25, 45, 60] : [5, 10, 15];
  const sub = running ? (timer.mode === 'focus' ? 'Не відволікайся' : 'Відпочивай') : left < timer.dur ? 'Пауза' : 'Готовий?';
  return header('Глибока робота', 'Фокус')
    + `<section class="focus glass">
      <div class="seg" role="radiogroup" aria-label="Режим таймера">
        <button role="radio" aria-checked="${timer.mode === 'focus'}" data-act="tmode" data-v="focus">Фокус</button>
        <button role="radio" aria-checked="${timer.mode === 'break'}" data-act="tmode" data-v="break">Перерва</button>
      </div>
      <div class="focus-ring ${timer.mode}">
        ${ring(left / timer.dur, { size: 260, stroke: 16, color: timer.mode === 'focus' ? 'url(#g-main)' : 'url(#g-success)', cls: 'live' })}
        <div class="focus-center" role="timer" aria-live="off">
          <span class="focus-time" id="ftime">${mmss(left)}</span>
          <span class="focus-sub">${sub}</span>
        </div>
      </div>
      <label class="sr-only" for="flabel">Над чим працюєш</label>
      <input class="focus-label" id="flabel" placeholder="Над чим працюєш?" value="${esc(timer.label)}" maxlength="60" autocomplete="off">
      <div class="chips" role="group" aria-label="Тривалість">
        ${presets.map(m => `<button class="chip" aria-pressed="${timer.dur === m * 60000}" data-act="tpreset" data-v="${m}">${m} хв</button>`).join('')}
      </div>
      <div class="focus-ctrls">
        <button class="round-btn" data-act="treset" aria-label="Скинути">${icon('reset', 22)}</button>
        <button class="round-btn play ${timer.mode}" data-act="tplay" aria-label="${running ? 'Пауза' : 'Старт'}">${icon(running ? 'pause' : 'play', 30)}</button>
        <button class="round-btn" data-act="tskip" aria-label="Пропустити етап">${icon('skip', 22)}</button>
      </div>
    </section>
    <section class="section">
      <h2 class="section-title">Сьогодні: ${mins} хв фокусу</h2>
      ${sessions.length
        ? `<ul class="rows" role="list">${sessions.map(f => `<li class="row glass"><div class="row-body">
            <span class="tile c-indigo">${icon('timer', 20)}</span>
            <span class="row-text"><span class="row-title">${esc(f.label || 'Фокус-сесія')}</span><span class="row-meta"><span class="m">${icon('clock', 13)}${hm(f.at)}</span><span class="m">${f.minutes} хв</span></span></span>
          </div></li>`).join('')}</ul>`
        : `<p class="muted">Поки жодної сесії. Постав 25 хвилин і просто почни.</p>`}
    </section>`;
}

/* ---------- Прогрес ---------- */

function viewStats() {
  const now = Date.now(), today = dkey();
  const { current, best } = S.streaks(now);
  let succ = 0, fail = 0;
  for (let i = 0; i < 30; i++) {
    const r = S.dayStats(addDays(today, -i), now).result;
    if (r === 'success') succ++;
    else if (r === 'fail') fail++;
  }
  const rate = succ + fail ? Math.round(succ / (succ + fail) * 100) : 0;
  const ws = weekStart(today);
  const focusWeek = Object.values(S.state.focus).filter(f => f.day >= ws && f.day <= today).reduce((a, f) => a + f.minutes, 0);

  const tile = (ico, cls, val, lbl) => `<div class="stat-card glass"><span class="sc-ico ${cls}">${icon(ico, 18)}</span><b class="sc-val">${val}</b><span class="sc-lbl">${lbl}</span></div>`;
  const tiles = `<div class="stat-grid">
    ${tile('flame', 'c-orange', current, `${plural(current, ['день', 'дні', 'днів'])} поспіль`)}
    ${tile('target', 'c-red', best, 'рекорд серії')}
    ${tile('check', 'c-green', rate + '%', 'днів зараховано за 30 днів')}
    ${tile('timer', 'c-indigo', focusWeek >= 60 ? `${Math.floor(focusWeek / 60)}<small> год</small> ${focusWeek % 60}<small> хв</small>` : `${focusWeek}<small> хв</small>`, 'фокусу цього тижня')}
  </div>`;

  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const bars = last7.map(d => {
    const s = S.dayStats(d, now);
    const pct = Math.round(s.score * 100);
    return `<div class="bar-col" aria-label="${esc(fmtDayLong(d))}: ${pct}%">
      <span class="bar-val">${s.items ? pct : '–'}</span>
      <span class="bar-track"><span class="bar-fill r-${s.result}" style="--h:${s.score}"></span></span>
      <span class="bar-day ${d === today ? 'is-today' : ''}">${WD_SHORT[parseDay(d).getDay()]}</span>
    </div>`;
  }).join('');

  const WEEKS = 17;
  const start = addDays(weekStart(today), -7 * (WEEKS - 1));
  let heat = '';
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = addDays(start, i);
    if (d > today) { heat += '<span class="hc h-none"></span>'; continue; }
    const s = S.dayStats(d, now);
    const cls = s.result === 'success' ? 'h-s' : s.result === 'fail' ? 'h-f' : s.result === 'open' ? 'h-o' : 'h-n';
    heat += `<span class="hc ${cls}" title="${esc(fmtDayLong(d))}"></span>`;
  }

  const hs = S.activeHabits();
  const habitList = hs.length ? `<section class="card glass"><h3>Звички за 30 днів</h3>
    <ul class="hs-list" role="list">${hs.map(h => {
      const st = S.habitStats(h, now);
      return `<li class="hs-row">
        <div class="hs-top"><span class="hs-name"><span class="dot c-${h.color}"></span>${esc(h.title)}</span><span class="hs-pct">${st.pct}%</span></div>
        <span class="hs-track"><span class="hs-fill c-${h.color}" style="--w:${st.pct / 100}"></span></span>
        <span class="hs-sub">${st.done} з ${st.total} · серія ${st.streak}</span>
      </li>`;
    }).join('')}</ul></section>` : '';

  return header('Без самообману', 'Прогрес')
    + tiles
    + `<section class="card glass"><h3>Останні 7 днів</h3><div class="bars">${bars}</div></section>`
    + `<section class="card glass"><h3>Карта дисципліни</h3>
        <div class="heat-wrap"><div class="heat-days" aria-hidden="true">${WEEK_ORDER.map((d, i) => `<span>${i % 2 === 0 ? WD_SHORT[d] : ''}</span>`).join('')}</div>
        <div class="heat" role="img" aria-label="Результати за останні ${WEEKS} тижнів">${heat}</div></div>
        <div class="legend"><span><i class="hc h-s"></i>Зараховано</span><span><i class="hc h-f"></i>Провалено</span><span><i class="hc h-n"></i>Без плану</span></div>
      </section>`
    + habitList;
}

/* ================= шторки (bottom sheets) ================= */

function openSheet(html, onMount) {
  closeSheet(true);
  lastFocus = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="scrim" data-act="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="drag-zone"><div class="grabber" aria-hidden="true"></div></div>
      ${html}
    </div>`;
  document.body.appendChild(wrap);
  sheetEl = wrap;
  $('#app').inert = true;
  onMount?.(wrap);
  const title = wrap.querySelector('h2');
  if (title) wrap.querySelector('.sheet').setAttribute('aria-label', title.textContent);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  enableDrag(wrap.querySelector('.sheet'));
  if (matchMedia('(pointer: fine)').matches) setTimeout(() => wrap.querySelector('[data-autofocus]')?.focus(), 380);
}

function closeSheet(immediate = false) {
  if (!sheetEl) return;
  const w = sheetEl;
  sheetEl = null;
  $('#app').inert = false;
  if (immediate) { w.remove(); return; }
  const sheet = w.querySelector('.sheet');
  w.classList.add('closing');
  w.classList.remove('open');
  sheet.style.transform = '';
  setTimeout(() => w.remove(), 360);
  lastFocus?.focus?.({ preventScroll: true });
}

// Перетягування вниз з інерцією: закриття залежить від швидкості, а не лише від відстані
function enableDrag(sheet) {
  const zones = sheet.querySelectorAll('.drag-zone, .sheet-head');
  let y0 = 0, dy = 0, hist = [], active = false;
  const rubber = x => (x * 0.55 * 300) / (300 + 0.55 * x);
  zones.forEach(z => {
    z.addEventListener('pointerdown', e => {
      if (e.target.closest('button, input, select, textarea')) return;
      active = true; y0 = e.clientY; dy = 0; hist = [{ y: e.clientY, t: e.timeStamp }];
      sheet.style.transition = 'none';
      z.setPointerCapture(e.pointerId);
    });
    z.addEventListener('pointermove', e => {
      if (!active) return;
      dy = e.clientY - y0;
      sheet.style.transform = `translateY(${dy < 0 ? -rubber(-dy) : dy}px)`;
      hist.push({ y: e.clientY, t: e.timeStamp });
      if (hist.length > 6) hist.shift();
    });
    const end = () => {
      if (!active) return;
      active = false;
      sheet.style.transition = '';
      const a = hist[0], b = hist[hist.length - 1];
      const v = b && a && b.t > a.t ? (b.y - a.y) / (b.t - a.t) * 1000 : 0;
      const projected = dy + (v / 1000) * 0.998 / (1 - 0.998);
      if (dy > 0 && (projected > sheet.offsetHeight * 0.45 || v > 900)) closeSheet();
      else sheet.style.transform = '';
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  });
}

const sheetHead = (left, title, right) => `<div class="sheet-head">${left || '<span></span>'}<h2>${title}</h2>${right || '<span></span>'}</div>`;
const cancelBtn = `<button class="txt-btn" data-act="close-sheet">Скасувати</button>`;

function switchRow(id, title, hint, checked, extra = '') {
  return `<label class="g-row switch-row" for="${id}">
    <span class="sr-text"><b>${title}</b>${hint ? `<small>${hint}</small>` : ''}</span>
    <input type="checkbox" role="switch" class="switch" id="${id}" ${checked ? 'checked' : ''} ${extra}>
  </label>`;
}

/* ---------- вибір: задача чи звичка ---------- */

function addChooser() {
  return sheetHead(cancelBtn, 'Додати')
    + `<div class="sheet-scroll">
      <button class="choice" data-act="add-task">
        <span class="tile c-gray">${icon('list', 22)}</span>
        <span class="row-text"><span class="row-title">Задача на день</span><span class="choice-sub">Одноразова ціль: «Здати звіт», «Подзвонити мамі»</span></span>
        ${icon('chevron-right', 18, 'chev')}
      </button>
      <button class="choice" data-act="add-habit">
        <span class="tile c-blue">${icon('repeat', 22)}</span>
        <span class="row-text"><span class="row-title">Звичка</span><span class="choice-sub">Повторюється за розкладом: підйом, спорт, вода</span></span>
        ${icon('chevron-right', 18, 'chev')}
      </button>
    </div>`;
}

/* ---------- форма звички ---------- */

function habitForm(h) {
  const isNew = !h;
  h = h || { title: '', icon: 'target', color: 'blue', time: '', days: [0, 1, 2, 3, 4, 5, 6], must: true, target: 1, unit: '' };
  const days = new Set(h.days);
  return sheetHead(cancelBtn, isNew ? 'Нова звичка' : 'Звичка', `<button class="txt-btn strong" data-act="save-habit" data-id="${h.id || ''}">${isNew ? 'Додати' : 'Зберегти'}</button>`)
    + `<div class="sheet-scroll">
      <div class="preview"><span class="tile big c-${h.color}" id="pv">${icon(h.icon, 32)}</span></div>
      <label class="field"><span>Назва</span>
        <input id="f-title" value="${esc(h.title)}" placeholder="Напр., Підйом" maxlength="40" autocomplete="off" data-autofocus aria-describedby="f-title-err">
      </label>
      <p class="field-err" id="f-title-err" role="alert"></p>

      <div class="group-label">Іконка</div>
      <div class="icon-grid" role="radiogroup" aria-label="Іконка">
        ${HABIT_ICONS.map(n => `<button class="icon-opt" role="radio" aria-checked="${n === h.icon}" data-act="pick-icon" data-v="${n}" aria-label="${n}">${icon(n, 20)}</button>`).join('')}
      </div>
      <div class="group-label">Колір</div>
      <div class="color-row" role="radiogroup" aria-label="Колір">
        ${S.COLORS.map(c => `<button class="swatch c-${c}" role="radio" aria-checked="${c === h.color}" data-act="pick-color" data-v="${c}" aria-label="${c}"></button>`).join('')}
      </div>

      <div class="group-label">Правила</div>
      <div class="group">
        ${switchRow('f-must', 'Обовʼязкова', 'Без неї день не зараховується', h.must)}
        ${switchRow('f-has-time', 'Конкретний час', 'Після нього справа стає простроченою', Boolean(h.time))}
        <div class="g-row" id="time-row" ${h.time ? '' : 'hidden'}>
          <label class="sr-text" for="f-time"><b>Час</b></label>
          <input type="time" id="f-time" class="time-input" value="${h.time || '07:00'}">
        </div>
        <div class="g-row">
          <span class="sr-text"><b>Ціль на день</b><small>Напр., 8 склянок води</small></span>
          <div class="stepper">
            <button class="step-btn" data-act="step" data-d="-1" aria-label="Менше">${icon('minus', 16)}</button>
            <output id="f-target" aria-live="polite">${h.target || 1}</output>
            <button class="step-btn" data-act="step" data-d="1" aria-label="Більше">${icon('plus', 16)}</button>
          </div>
        </div>
        <div class="g-row" id="unit-row" ${(h.target || 1) > 1 ? '' : 'hidden'}>
          <label class="sr-text" for="f-unit"><b>Одиниця</b></label>
          <input id="f-unit" class="inline-input" value="${esc(h.unit)}" placeholder="склянок" maxlength="16" autocomplete="off">
        </div>
      </div>

      <div class="group-label">Дні</div>
      <div class="day-chips" role="group" aria-label="Дні тижня">
        ${WEEK_ORDER.map(d => `<button class="day-chip" data-act="day-chip" data-v="${d}" aria-pressed="${days.has(d)}">${WD_SHORT[d]}</button>`).join('')}
      </div>
      <div class="chips">
        <button class="chip" data-act="days-preset" data-v="all">Щодня</button>
        <button class="chip" data-act="days-preset" data-v="work">Будні</button>
        <button class="chip" data-act="days-preset" data-v="weekend">Вихідні</button>
      </div>
      <p class="field-err" id="f-days-err" role="alert"></p>
      ${isNew ? '' : `<button class="btn danger" data-act="delete-habit" data-id="${h.id}">${icon('trash', 18)} Видалити звичку</button>
        <p class="hint">Історія минулих днів залишиться.</p>`}
    </div>`;
}

function openHabit(h) {
  openSheet(habitForm(h), w => {
    w.dataset.icon = h?.icon || 'target';
    w.dataset.color = h?.color || 'blue';
  });
}

/* ---------- форма задачі ---------- */

function taskForm(t) {
  const isNew = !t;
  const today = dkey();
  const day = t?.day || (selDay >= today ? selDay : today);
  return sheetHead(cancelBtn, isNew ? 'Нова задача' : 'Задача', `<button class="txt-btn strong" data-act="save-task" data-id="${t?.id || ''}">${isNew ? 'Додати' : 'Зберегти'}</button>`)
    + `<div class="sheet-scroll">
      <label class="field"><span>Що треба зробити</span>
        <input id="f-title" value="${esc(t?.title || '')}" placeholder="Напр., Здати звіт" maxlength="60" autocomplete="off" data-autofocus aria-describedby="f-title-err">
      </label>
      <p class="field-err" id="f-title-err" role="alert"></p>
      <div class="group">
        <div class="g-row">
          <label class="sr-text" for="f-day"><b>День</b></label>
          <input type="date" id="f-day" class="time-input" value="${day}" min="${today}">
        </div>
        ${switchRow('f-must', 'Обовʼязково', 'Не зробив, і день не зараховано', t ? t.must : true)}
        ${switchRow('f-has-time', 'Дедлайн за часом', '', Boolean(t?.time))}
        <div class="g-row" id="time-row" ${t?.time ? '' : 'hidden'}>
          <label class="sr-text" for="f-time"><b>До</b></label>
          <input type="time" id="f-time" class="time-input" value="${t?.time || '12:00'}">
        </div>
      </div>
      ${isNew ? '' : `<button class="btn danger" data-act="delete-task" data-id="${t.id}">${icon('trash', 18)} Видалити задачу</button>`}
    </div>`;
}

/* ---------- налаштування ---------- */

function seg(key, values, labels, current) {
  return `<div class="seg" role="radiogroup">${values.map((v, i) =>
    `<button role="radio" aria-checked="${v === current}" data-act="set" data-k="${key}" data-v="${v}">${labels ? labels[i] : v}</button>`).join('')}</div>`;
}

function acctHTML() {
  const st = Sync.getStatus();
  if (!Sync.enabled) {
    return `<div class="group"><div class="g-row">
      <span class="tile sm c-gray">${icon('cloud', 18)}</span>
      <span class="sr-text"><b>Тільки на цьому пристрої</b><small>Хмара ще не підключена. Встав ключі Supabase у js/config.js, інструкція в README.</small></span>
    </div></div>`;
  }
  if (!st.email) {
    return `<form class="group auth" data-form="auth" novalidate>
      <label class="field in-group"><span>Email</span><input type="email" id="a-email" autocomplete="email" inputmode="email" required></label>
      <label class="field in-group"><span>Пароль</span><input type="password" id="a-pass" autocomplete="current-password" minlength="6" required></label>
      <p class="field-err" id="a-err" role="alert">${st.state === 'error' ? esc(st.error) : ''}</p>
      <div class="auth-btns">
        <button class="btn primary" type="submit">Увійти</button>
        <button class="btn" type="button" data-act="signup">Створити акаунт</button>
      </div>
      <p class="hint">Увійди на телефоні й компʼютері в той самий акаунт, і звички будуть синхронізуватися.</p>
    </form>`;
  }
  const label = { synced: `Синхронізовано${st.at ? ' о ' + hm(st.at) : ''}`, syncing: 'Синхронізація…', pending: 'Є зміни, зберігаю…', error: st.error, init: 'Підключення…' }[st.state] || '';
  return `<div class="group">
    <div class="g-row"><span class="tile sm c-blue">${icon('cloud', 18)}</span><span class="sr-text"><b>${esc(st.email)}</b><small class="${st.state === 'error' ? 'err' : ''}">${esc(label)}</small></span></div>
    <button class="g-row g-btn" data-act="syncnow">${icon('refresh', 18)}<span>Синхронізувати зараз</span></button>
    <button class="g-row g-btn red" data-act="signout">${icon('logout', 18)}<span>Вийти</span></button>
  </div>`;
}

function settingsSheet() {
  const s = S.state.settings;
  return sheetHead('', 'Налаштування', `<button class="txt-btn strong" data-act="close-sheet">Готово</button>`)
    + `<div class="sheet-scroll">
      <div class="group-label">Акаунт і синхронізація</div>
      <div id="acct">${acctHTML()}</div>

      <div class="group-label">Дисципліна</div>
      <div class="group">
        <div class="g-row col"><span class="sr-text"><b>Допуск на запізнення</b><small>Скільки хвилин після заданого часу ще вважається вчасно</small></span>${seg('grace', [0, 10, 15, 30], ['0', '10 хв', '15 хв', '30 хв'], s.grace)}</div>
        ${switchRow('s-strict', 'Запізнення = провал', 'Виконане із запізненням не зараховується', s.strictLate, 'data-setk="strictLate"')}
      </div>

      <div class="group-label">Фокус</div>
      <div class="group">
        <div class="g-row col"><span class="sr-text"><b>Сесія фокусу</b></span>${seg('focusMin', [15, 25, 45, 60], ['15', '25', '45', '60 хв'], s.focusMin)}</div>
        <div class="g-row col"><span class="sr-text"><b>Перерва</b></span>${seg('breakMin', [5, 10, 15], ['5', '10', '15 хв'], s.breakMin)}</div>
      </div>

      <div class="group-label">Вигляд</div>
      <div class="group"><div class="g-row col">${seg('theme', ['auto', 'light', 'dark'], ['Авто', 'Світла', 'Темна'], s.theme)}</div></div>

      <div class="group-label">Дані</div>
      <div class="group">
        <button class="g-row g-btn" data-act="export">${icon('download', 18)}<span>Зберегти резервну копію</span></button>
        <button class="g-row g-btn" data-act="import">${icon('upload', 18)}<span>Відновити з копії</span></button>
        <button class="g-row g-btn red" data-act="reset">${icon('trash', 18)}<span>Стерти всі дані</span></button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>

      <div class="group-label">На iPhone як застосунок</div>
      <div class="group"><div class="g-row">
        <span class="tile sm c-gray">${icon('share', 18)}</span>
        <span class="sr-text"><b>Safari → Поділитися → «На початковий екран»</b><small>Відкриватиметься на весь екран, як звичайний застосунок</small></span>
      </div></div>
      <p class="foot">Режим · 1.0</p>
    </div>`;
}

/* ================= готовий режим ================= */

const STARTER = [
  { title: 'Підйом', icon: 'sun', color: 'orange', time: '07:00', must: true, target: 1 },
  { title: 'Вода', icon: 'droplet', color: 'teal', time: null, must: false, target: 8, unit: 'склянок' },
  { title: 'Глибока робота 2 сесії', icon: 'timer', color: 'indigo', time: '12:00', must: true, target: 2, unit: 'сесій' },
  { title: 'Тренування', icon: 'dumbbell', color: 'red', time: '18:00', must: true, target: 1 },
  { title: 'Читання 20 хвилин', icon: 'book', color: 'purple', time: '21:00', must: false, target: 1 },
  { title: 'Телефон геть з ліжка', icon: 'phone-off', color: 'pink', time: '23:00', must: true, target: 1 },
  { title: 'Відбій', icon: 'moon', color: 'blue', time: '23:30', must: true, target: 1 },
];

/* ================= дії ================= */

function celebrateIfWon(before) {
  const after = S.dayStats(dkey()).result;
  if (before !== 'success' && after === 'success') {
    chime();
    haptic([12, 50, 12]);
    toast('День зараховано. Серія росте.', { tone: 'ok' });
    $('.hero')?.classList.add('glow');
  }
}

function fieldError(id, msg) {
  const w = sheetEl;
  const err = $(`#${id}-err`, w);
  if (err) err.textContent = msg;
  const input = $(`#${id}`, w);
  if (input) { input.setAttribute('aria-invalid', msg ? 'true' : 'false'); if (msg) input.focus(); }
}

const A = {
  'add': () => openSheet(addChooser()),
  'add-task': () => openSheet(taskForm()),
  'add-habit': () => openHabit(),
  'settings': () => openSheet(settingsSheet()),
  'close-sheet': () => closeSheet(),

  'day': el => { selDay = el.dataset.d; render(); },
  'week': el => { weekOf = addDays(weekOf, +el.dataset.d); render(); },
  'go-today': () => { selDay = dkey(); weekOf = weekStart(selDay); render(); },

  'toggle': el => {
    const day = dkey();
    if (selDay !== day) return;
    const before = S.dayStats(day).result;
    const id = el.dataset.id;
    pop = id;
    haptic();
    if (el.dataset.kind === 'task') S.setTaskDone(id, !S.state.tasks[id].done);
    else S.setHabitCount(day, id, S.getCount(day, id) >= 1 ? 0 : 1);
    celebrateIfWon(before);
  },
  'inc': el => {
    const day = dkey(), id = el.dataset.id;
    const before = S.dayStats(day).result;
    pop = id;
    haptic();
    S.setHabitCount(day, id, S.getCount(day, id) + 1);
    celebrateIfWon(before);
  },
  'dec': el => { const day = dkey(); haptic(); S.setHabitCount(day, el.dataset.id, S.getCount(day, el.dataset.id) - 1); },

  'edit': el => {
    if (el.dataset.kind === 'habit') openHabit(S.state.habits[el.dataset.id]);
    else openSheet(taskForm(S.state.tasks[el.dataset.id]));
  },

  'pick-icon': el => {
    const w = sheetEl;
    w.dataset.icon = el.dataset.v;
    $$('.icon-opt', w).forEach(b => b.setAttribute('aria-checked', b === el));
    $('#pv', w).innerHTML = icon(el.dataset.v, 32);
  },
  'pick-color': el => {
    const w = sheetEl;
    w.dataset.color = el.dataset.v;
    $$('.swatch', w).forEach(b => b.setAttribute('aria-checked', b === el));
    $('#pv', w).className = `tile big c-${el.dataset.v}`;
  },
  'day-chip': el => el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') !== 'true'),
  'days-preset': el => {
    const sets = { all: [0, 1, 2, 3, 4, 5, 6], work: [1, 2, 3, 4, 5], weekend: [0, 6] };
    const on = new Set(sets[el.dataset.v]);
    $$('.day-chip', sheetEl).forEach(b => b.setAttribute('aria-pressed', on.has(+b.dataset.v)));
  },
  'step': el => {
    const out = $('#f-target', sheetEl);
    const v = Math.max(1, Math.min(50, (+out.textContent || 1) + +el.dataset.d));
    out.textContent = v;
    $('#unit-row', sheetEl).hidden = v <= 1;
  },

  'save-habit': el => {
    const w = sheetEl;
    const title = $('#f-title', w).value.trim();
    if (!title) return fieldError('f-title', 'Дай звичці назву');
    fieldError('f-title', '');
    const days = $$('.day-chip[aria-pressed="true"]', w).map(b => +b.dataset.v);
    if (!days.length) { $('#f-days-err', w).textContent = 'Обери хоча б один день'; return; }
    const target = +$('#f-target', w).textContent || 1;
    S.saveHabit({
      id: el.dataset.id || undefined,
      title,
      icon: w.dataset.icon,
      color: w.dataset.color,
      must: $('#f-must', w).checked,
      time: $('#f-has-time', w).checked ? ($('#f-time', w).value || null) : null,
      target,
      unit: target > 1 ? $('#f-unit', w).value.trim() : '',
      days,
    });
    closeSheet();
    toast(el.dataset.id ? 'Збережено' : 'Звичку додано');
  },
  'delete-habit': el => {
    const id = el.dataset.id;
    S.deleteHabit(id);
    closeSheet();
    toast('Звичку видалено', { action: 'Скасувати', onAction: () => S.restoreHabit(id) });
  },

  'save-task': el => {
    const w = sheetEl;
    const title = $('#f-title', w).value.trim();
    if (!title) return fieldError('f-title', 'Напиши, що треба зробити');
    const day = $('#f-day', w).value || dkey();
    S.saveTask({
      id: el.dataset.id || undefined,
      title,
      day,
      must: $('#f-must', w).checked,
      time: $('#f-has-time', w).checked ? ($('#f-time', w).value || null) : null,
    });
    closeSheet();
    if (day !== selDay && route === 'today') { selDay = day; weekOf = weekStart(day); render(); }
    toast(el.dataset.id ? 'Збережено' : 'Задачу додано');
  },
  'delete-task': el => {
    const id = el.dataset.id;
    S.deleteTask(id);
    closeSheet();
    toast('Задачу видалено', { action: 'Скасувати', onAction: () => S.deleteTask(id, false) });
  },

  'starter': () => {
    const all = [0, 1, 2, 3, 4, 5, 6];
    STARTER.forEach(h => S.saveHabit({ ...h, days: all, unit: h.unit || '' }));
    toast(`Додано ${STARTER.length} звичок. Підлаштуй їх під себе.`, { tone: 'ok' });
  },

  'set': el => {
    const k = el.dataset.k;
    const v = k === 'theme' ? el.dataset.v : +el.dataset.v;
    S.setSettings({ [k]: v });
    $$(`[data-act="set"][data-k="${k}"]`, sheetEl).forEach(b => b.setAttribute('aria-checked', b === el));
    if (k === 'theme') applyTheme();
    if ((k === 'focusMin' && timer.mode === 'focus') || (k === 'breakMin' && timer.mode === 'break')) {
      if (!timer.endAt) setMode(timer.mode, v);
    }
  },

  'tmode': el => { if (timer.mode !== el.dataset.v) { setMode(el.dataset.v); render(); } },
  'tpreset': el => { setMode(timer.mode, +el.dataset.v); render(); },
  'tplay': () => {
    audio();
    haptic();
    if (timer.endAt) { timer.left = timerLeft(); timer.endAt = null; holdScreen(false); }
    else { timer.endAt = Date.now() + timer.left; holdScreen(true); }
    saveTimer();
    render();
  },
  'treset': () => { setMode(timer.mode, timer.dur / 60000); render(); },
  'tskip': () => { setMode(timer.mode === 'focus' ? 'break' : 'focus'); render(); },

  'export': () => {
    const blob = new Blob([JSON.stringify(S.serialize(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rezhym-${dkey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  'import': () => $('#import-file', sheetEl)?.click(),
  'reset': el => {
    if (el.dataset.armed !== '1') {
      el.dataset.armed = '1';
      el.querySelector('span').textContent = 'Точно? Натисни ще раз';
      setTimeout(() => { if (el.isConnected) { el.dataset.armed = ''; el.querySelector('span').textContent = 'Стерти всі дані'; } }, 3500);
      return;
    }
    S.resetAll();
    Sync.overwriteRemote();
    localStorage.removeItem(TKEY);
    closeSheet();
    applyTheme();
    toast('Усі дані стерто');
  },

  'signup': async el => {
    const email = $('#a-email', sheetEl).value.trim(), pass = $('#a-pass', sheetEl).value;
    const err = $('#a-err', sheetEl);
    if (!email || pass.length < 6) { err.textContent = 'Введи email і пароль від 6 символів'; return; }
    el.disabled = true;
    try {
      const in_ = await Sync.signUp(email, pass);
      if (in_) toast('Акаунт створено', { tone: 'ok' });
      else err.textContent = 'Підтверди email у листі, потім увійди тут';
    } catch (e) { err.textContent = e.message; }
    el.disabled = false;
  },
  'signout': async () => { await Sync.signOut(); },
  'syncnow': () => Sync.syncNow(),
};

/* ================= події ================= */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});

document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-form="auth"]');
  if (!form) return;
  e.preventDefault();
  const email = $('#a-email', form).value.trim(), pass = $('#a-pass', form).value;
  const err = $('#a-err', form);
  if (!email || !pass) { err.textContent = 'Введи email і пароль'; return; }
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  try { await Sync.signIn(email, pass); toast('Вхід виконано', { tone: 'ok' }); }
  catch (ex) { err.textContent = ex.message; }
  btn.disabled = false;
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'f-has-time') $('#time-row', sheetEl).hidden = !t.checked;
  if (t.dataset.setk) S.setSettings({ [t.dataset.setk]: t.checked });
  if (t.id === 'import-file' && t.files[0]) {
    t.files[0].text().then(txt => {
      S.replaceState(S.merge(S.serialize(), JSON.parse(txt)));
      Sync.syncNow();
      applyTheme();
      toast('Дані відновлено', { tone: 'ok' });
    }).catch(() => toast('Не вдалося прочитати файл', { tone: 'bad' }));
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'flabel') { timer.label = e.target.value; saveTimer(); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sheetEl) closeSheet();
});

addEventListener('hashchange', () => {
  const r = location.hash.slice(1);
  route = ROUTES.includes(r) ? r : 'today';
  render(true);
  scrollTo({ top: 0 });
});

S.subscribe(() => render());

Sync.onStatus(st => {
  $$('.sync-dot').forEach(d => { d.dataset.sync = st.state; });
  const acct = sheetEl && $('#acct', sheetEl);
  if (acct && !acct.contains(document.activeElement)) acct.innerHTML = acctHTML();
});

// Таймер фокусу й оновлення «через N хв» / прострочених
let lastMinute = Math.floor(Date.now() / 60000);
let lastDay = dkey();
setInterval(() => {
  checkTimer();
  const running = Boolean(timer.endAt);
  if (route === 'focus') {
    const left = timerLeft();
    const t = $('#ftime');
    if (t) t.textContent = mmss(left);
    const rv = $('.focus-ring .ring-val');
    if (rv) { rv.style.strokeDashoffset = rv.dataset.c * (1 - left / timer.dur); rv.setAttribute('opacity', left > 0 ? '1' : '0'); }
  }
  document.title = running ? `${mmss(timerLeft())} · ${timer.mode === 'focus' ? 'Фокус' : 'Перерва'}` : 'Режим';

  const d = dkey();
  if (d !== lastDay) {
    if (selDay === lastDay) { selDay = d; weekOf = weekStart(d); }
    lastDay = d;
  }
  const m = Math.floor(Date.now() / 60000);
  if (m !== lastMinute) {
    lastMinute = m;
    if (route === 'today' || route === 'stats') render();
  }
}, 250);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { checkTimer(); render(); if (timer.endAt) holdScreen(true); }
});

/* ================= старт ================= */

applyTheme();
{
  const r = location.hash.slice(1);
  route = ROUTES.includes(r) ? r : 'today';
}
render(true);
Sync.init();

if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
