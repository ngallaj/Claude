'use strict';
/* Bəxtim.az single-page frontend (no build step). Hash routes: #/, #/r/:id, #/new, #/me, #/how, #/verify/:id, #/admin */

const CAT_ICON = { electronics: '🎧', phones: '📱', computers: '💻', home: '🛋️', appliances: '🧺', fashion: '👗', kids: '🧸', sports: '⚽', hobby: '🎨', auto_parts: '🔧', jewelry: '💍', other: '📦' };
const CAT_BG = { electronics: '#e8f0ff', phones: '#e9f7ef', computers: '#eef0ff', home: '#fff3e6', appliances: '#e9f6f8', fashion: '#fdeef4', kids: '#fff7d6', sports: '#eaf6e9', hobby: '#f3ecff', auto_parts: '#eceff3', jewelry: '#fff0e1', other: '#f0f1f4' };

const state = { meta: null, user: null, lang: 'az' };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

try { state.lang = localStorage.getItem('lang') || 'az'; } catch { /* storage unavailable */ }

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dict = () => window.I18N[state.lang] || window.I18N.az;
function t(key, vars = {}) {
  const s = key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict()) ?? key.split('.').reduce((o, k) => (o == null ? o : o[k]), window.I18N.az) ?? key;
  return typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : s;
}
const azn = (q) => `${(q / 100).toLocaleString('en-US', { minimumFractionDigits: q % 100 ? 2 : 0, maximumFractionDigits: 2 })} ₼`;
const date = (ms) => new Date(ms).toLocaleDateString(state.lang === 'en' ? 'en-GB' : state.lang === 'ru' ? 'ru-RU' : 'az-Latn-AZ');
const dateTime = (ms) => new Date(ms).toLocaleString(state.lang === 'en' ? 'en-GB' : state.lang === 'ru' ? 'ru-RU' : 'az-Latn-AZ', { dateStyle: 'short', timeStyle: 'short' });
function timeLeft(ends) {
  const ms = ends - Date.now();
  if (ms <= 0) return t('ended');
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return t('ends_in', { t: d ? `${d}${t('d')} ${h}${t('h')}` : h ? `${h}${t('h')} ${m}${t('m')}` : `${m}${t('m')}` });
}
function toast(msg, error = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = 'toast'; }, 3500);
}
const errorText = (err) => t(`errors.${err.error || 'server_error'}`);
function goLogin() {
  state.returnTo = location.hash;
  location.hash = '#/login';
}

async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({ error: 'server_error' }));
  if (!res.ok) throw data;
  return data;
}
async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
    return r;
  } catch (err) {
    if (err.error === 'auth_required') { goLogin(); return; }
    toast(errorText(err), true);
    throw err;
  }
}
async function refreshUser() {
  state.user = (await api('/api/me')).user;
  renderNav();
}

function thumb(r, cls = 'thumb') {
  const img = r.images?.[0];
  return `<div class="${cls}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<div class="placeholder" style="background:${CAT_BG[r.category]}">${CAT_ICON[r.category]}</div>`}`;
}
function progressBar(r, lg = false) {
  const pct = (r.tickets_sold / r.ticket_count) * 100;
  const min = (r.min_tickets / r.ticket_count) * 100;
  return `<div class="progress${lg ? ' lg' : ''}" title="${esc(t('sold_of', { a: r.tickets_sold, b: r.ticket_count }))}">
    <div class="fill" style="width:${pct}%"></div>${r.min_tickets < r.ticket_count ? `<div class="min" style="left:calc(${min}% - 1px)" title="${esc(t('progress_min'))}: ${r.min_tickets}"></div>` : ''}</div>`;
}
function card(r) {
  return `<a class="card" href="#/r/${r.id}">
    ${thumb(r)}${r.featured ? `<span class="badge">${t('featured')}</span>` : ''}${r.status !== 'active' ? `<span class="badge status">${t(`st_${r.status}`)}</span>` : ''}</div>
    <div class="card-body">
      <div class="price-row"><span class="ticket-price">${azn(r.ticket_price)}</span><span class="muted small">${t('per_ticket')}</span><span class="muted small" style="margin-left:auto">${t('item_value')}: ${azn(r.price_total)}</span></div>
      <div class="card-title">${esc(r.title)}</div>
      ${progressBar(r)}
      <div class="meta"><span>${t('sold_of', { a: r.tickets_sold, b: r.ticket_count })}</span><span>${t('min_short', { n: r.min_tickets })}</span></div>
      <div class="meta"><span>${esc(t(`city.${r.city}`))}</span>${r.status === 'active' ? `<span data-ends="${r.ends_at}">${timeLeft(r.ends_at)}</span>` : ''}</div>
    </div></a>`;
}

// ---------- chrome ----------
function renderNav() {
  const u = state.user;
  $('#nav').innerHTML = `
    <a class="hide-sm" href="#/how">${t('nav_how')}</a>
    <a class="btn gold" href="#/new">${t('nav_create')}</a>
    ${u ? `
      <a class="balance-pill" href="#/me/wallet">${azn(u.balance)}</a>
      <a href="#/me">${t('nav_my')}</a>
      ${u.is_admin ? `<a href="#/admin">${t('nav_admin')}</a>` : ''}
      <button class="link" id="logoutBtn">${t('nav_logout')}</button>`
    : `<a href="#/login">${t('nav_login')}</a><a href="#/register" class="hide-sm">${t('nav_register')}</a>`}`;
  $('#logoutBtn')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    await refreshUser();
    location.hash = '#/';
  });
  $('#searchInput').placeholder = t('search_ph');
  $('#searchBtn').textContent = t('search_btn');
  $('#footer').innerHTML = `<div class="row-between"><span>${t('footer')}</span><span>${t('brand_tag')}</span></div>`;
  document.documentElement.lang = state.lang;
}

$('#lang').value = state.lang;
$('#lang').addEventListener('change', (e) => {
  state.lang = e.target.value;
  try { localStorage.setItem('lang', state.lang); } catch { /* ignore */ }
  renderNav();
  route();
});
$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  location.hash = `#/?${new URLSearchParams(q ? { q } : {})}`;
});
setInterval(() => $$('[data-ends]').forEach((el) => { el.textContent = timeLeft(Number(el.dataset.ends)); }), 30000);

// ---------- pages ----------
async function pageHome(params) {
  const f = Object.fromEntries(params);
  const setParam = (k, v) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    location.hash = `#/?${p}`;
  };
  $('#searchInput').value = f.q || '';
  app.innerHTML = `
    ${!f.q && !f.category ? `<section class="hero">
      <div><h1>${t('hero_title')}</h1><p>${t('hero_sub')}</p><a class="btn gold" href="#/new">${t('nav_create')}</a></div>
      <div class="steps">${[1, 2, 3].map((n) => `<div class="step"><div class="n">${n}</div><b>${t(`step${n}_t`)}</b><span>${t(`step${n}_d`)}</span></div>`).join('')}</div>
    </section>` : '<div style="height:16px"></div>'}
    <div class="cats">${state.meta.categories.map((c) => `<div class="cat ${f.category === c ? 'active' : ''}" data-cat="${c}"><span class="ico">${CAT_ICON[c]}</span>${t(`cat.${c}`)}</div>`).join('')}</div>
    <div class="filters">
      <div class="tabs"><button data-st="" class="${f.status !== 'finished' ? 'active' : ''}">${t('tab_active')}</button><button data-st="finished" class="${f.status === 'finished' ? 'active' : ''}">${t('tab_finished')}</button></div>
      <select id="fCity"><option value="">${t('all_cities')}</option>${state.meta.cities.map((c) => `<option value="${c}" ${f.city === c ? 'selected' : ''}>${t(`city.${c}`)}</option>`).join('')}</select>
      <select id="fSort">${['', 'ending', 'newest', 'cheap_ticket', 'progress'].map((s) => `<option value="${s}" ${(f.sort || '') === s ? 'selected' : ''}>${t(`sort_${s || 'default'}`)}</option>`).join('')}</select>
      <input id="fMaxTicket" type="number" min="0" step="0.5" placeholder="${esc(t('max_ticket'))}" value="${esc(f.max_ticket || '')}" style="width:170px">
      <input id="fMin" type="number" min="0" placeholder="${esc(t('price_from'))}" value="${esc(f.min_price || '')}">
      <input id="fMax" type="number" min="0" placeholder="${esc(t('price_to'))}" value="${esc(f.max_price || '')}">
      <span class="count" id="count"></span>
    </div>
    <div class="cards" id="cards"></div>`;

  $$('.cat').forEach((el) => el.addEventListener('click', () => setParam('category', f.category === el.dataset.cat ? '' : el.dataset.cat)));
  $$('.tabs button').forEach((el) => el.addEventListener('click', () => setParam('status', el.dataset.st)));
  $('#fCity').addEventListener('change', (e) => setParam('city', e.target.value));
  $('#fSort').addEventListener('change', (e) => setParam('sort', e.target.value));
  [['#fMaxTicket', 'max_ticket'], ['#fMin', 'min_price'], ['#fMax', 'max_price']].forEach(([sel, key]) => $(sel).addEventListener('change', (e) => setParam(key, e.target.value)));

  const data = await api(`/api/raffles?${params}`);
  $('#count').textContent = `${data.total} ${t('results')}`;
  $('#cards').innerHTML = data.items.length ? data.items.map(card).join('') : `<div class="empty" style="grid-column:1/-1">${t('nothing_found')}</div>`;
}

let liveTimer;
async function pageRaffle(id, { countView = true } = {}) {
  clearTimeout(liveTimer);
  const r = await api(`/api/raffles/${id}${countView ? '?view=1' : ''}`);
  // Live updates while the raffle is open: re-render when someone else buys tickets or the draw happens.
  const here = location.hash;
  const poll = () => {
    liveTimer = setTimeout(async () => {
      if (location.hash !== here) return;
      const fresh = await api(`/api/raffles/${id}`).catch(() => null);
      if (fresh && (fresh.tickets_sold !== r.tickets_sold || fresh.status !== r.status) && document.activeElement?.tagName !== 'TEXTAREA') {
        await refreshUser();
        pageRaffle(id, { countView: false });
      } else poll();
    }, 10000);
  };
  if (r.status === 'active' || r.status === 'drawn') poll();
  const left = r.ticket_count - r.tickets_sold;
  const u = state.user;
  const images = r.images.length ? r.images : null;
  const mineSet = new Set(r.my_tickets);
  const net = (n) => azn(n * r.ticket_price - Math.round(n * r.ticket_price * r.commission_rate));

  let side = '';
  if (r.status === 'active') {
    const maxBuy = left;
    side = `<div class="panel">
      <div class="row-between"><span class="big-price">${azn(r.ticket_price)}</span><span class="muted">${t('per_ticket')}</span></div>
      <div class="muted small" style="margin:4px 0 10px">${t('item_value')}: <b>${azn(r.price_total)}</b> · <span data-ends="${r.ends_at}">${timeLeft(r.ends_at)}</span></div>
      ${progressBar(r, true)}
      <div class="row-between small" style="margin-top:6px"><span>${t('sold_of', { a: r.tickets_sold, b: r.ticket_count })}</span><span class="muted">${t('left', { n: left })}</span></div>
      ${r.is_seller ? `
        <div class="note gold" style="margin-top:12px">${t('min_info', { n: r.min_tickets })}</div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn block" id="drawBtn" ${r.tickets_sold < r.min_tickets ? 'disabled' : ''}>${t('draw_now')}</button>
          ${r.tickets_sold === 0 ? `<button class="btn ghost" id="cancelBtn">${t('cancel_raffle')}</button>` : ''}
        </div>`
      : u ? `
        <div class="qty"><button type="button" data-d="-1">−</button><input class="input" id="qty" type="number" min="1" max="${maxBuy}" value="1"><button type="button" data-d="1">+</button></div>
        <div class="quick">${[5, 10, 25].filter((n) => n < maxBuy).map((n) => `<button data-q="${n}">${n}</button>`).join('')}<button data-q="${maxBuy}">${t('left', { n: maxBuy })}</button></div>
        <div class="row-between"><span>${t('total')}</span><b id="total">${azn(r.ticket_price)}</b></div>
        <div class="row-between small muted"><span>${t('your_balance')}</span><span>${azn(u.balance)} · <a href="#/me/wallet" style="color:var(--brand)">${t('top_up')}</a></span></div>
        <button class="btn block" id="buyBtn" style="margin-top:12px">${t('buy_btn')}</button>`
      : `<button class="btn block" id="loginToBuy" style="margin-top:14px">${t('login_to_buy')}</button>`}
      <div class="note" style="margin-top:12px">${r.min_tickets < r.ticket_count ? t('min_info', { n: r.min_tickets }) : t('soldout_info')}</div>
    </div>`;
  } else if (r.winner) {
    side = `<div class="panel">
      <div class="winner-box"><div class="muted">${t('winning_label')}</div><div class="num">№${r.winner.number}</div><div>${t('winner')}: <b>${esc(r.winner.name)}</b></div></div>
      ${r.is_winner && r.status === 'drawn' ? `
        <h3 style="margin-top:14px">${t('you_won')}</h3>
        <p class="small">${t('you_won_d', { p: esc(r.seller.phone), d: date(r.auto_release_at) })}</p>
        <button class="btn block" id="confirmBtn">${t('confirm_receipt')}</button>
        <details style="margin-top:10px"><summary class="small" style="cursor:pointer">${t('open_dispute')}</summary>
          <textarea class="input" id="disputeText" rows="3" style="margin-top:8px" placeholder="${esc(t('dispute_ph'))}"></textarea>
          <button class="btn danger sm" id="disputeBtn" style="margin-top:6px">${t('send')}</button></details>` : ''}
      ${r.is_seller && r.status === 'drawn' ? `<div class="note gold" style="margin-top:12px">${t('seller_drawn', { p: esc(r.winner.phone), amount: net(r.tickets_sold) })}</div>` : ''}
      ${r.status === 'completed' && r.is_seller ? `<div class="note" style="margin-top:12px">${t('seller_completed')}</div>` : ''}
      ${r.status === 'disputed' ? `<div class="note red" style="margin-top:12px">${t('dispute_open')}${r.dispute_reason ? `<br><i>${esc(r.dispute_reason)}</i>` : ''}</div>` : ''}
      <div class="muted small" style="margin-top:10px">${t(`st_${r.status}`)} · ${dateTime(r.drawn_at)}</div>
    </div>`;
  } else {
    side = `<div class="panel"><b>${t(`st_${r.status}`)}</b>${r.status === 'refunded' ? `<p class="small">${t('refunded_info')}</p>` : ''}</div>`;
  }

  app.innerHTML = `
    <div class="detail">
      <div class="d-top">
        <div class="gallery">
          <div class="main">${images ? `<img id="mainImg" src="${esc(images[0])}" alt="">` : `<div class="placeholder" style="background:${CAT_BG[r.category]};font-size:120px">${CAT_ICON[r.category]}</div>`}</div>
          ${images && images.length > 1 ? `<div class="thumbs">${images.map((src, i) => `<img src="${esc(src)}" class="${i ? '' : 'active'}" alt="">`).join('')}</div>` : ''}
        </div>
        <h1>${esc(r.title)}</h1>
        <div class="props">
          <div><span>${t('category')}</span><span>${t(`cat.${r.category}`)}</span></div>
          <div><span>${t('city_label')}</span><span>${t(`city.${r.city}`)}</span></div>
          <div><span>${t('condition')}</span><span>${t(`cond.${r.item_condition}`)}</span></div>
          <div><span>${t('delivery')}</span><span>${t(`deliv.${r.delivery}`)}</span></div>
          <div><span>${t('seller')}</span><span>${esc(r.seller.name)}</span></div>
          <div><span>${t('views')}</span><span>${r.views}</span></div>
        </div>
      </div>
      <div class="d-bottom">
        <div class="panel"><h3>${t('description')}</h3><div class="desc">${esc(r.description)}</div></div>
        <div class="panel" style="margin-top:14px">
          <h3>${t('fairness')}</h3><p class="small muted">${t('fairness_d')}</p>
          <div class="small">${t('seed_hash')}</div><div class="mono">${esc(r.seed_hash)}</div>
          ${r.server_seed ? `<div class="small" style="margin-top:8px">${t('server_seed')}</div><div class="mono">${esc(r.server_seed)}</div>
            <a class="btn ghost sm" href="#/verify/${r.id}" style="margin-top:10px">${t('verify')}</a>` : ''}
        </div>
      </div>
      <aside class="side">
        ${side}
        ${r.my_tickets.length ? `<div class="panel"><h3>${t('your_tickets')} (${r.my_tickets.length})</h3>
          <div class="chips">${r.my_tickets.map((n) => `<span class="chip ${r.winner?.number === n ? 'win' : ''}">№${n}</span>`).join('')}</div>
          ${r.status === 'active' && r.tickets_sold ? `<div class="small muted" style="margin-top:8px">${t('win_chance')}: <b>${((r.my_tickets.length / r.tickets_sold) * 100).toFixed(1)}%</b></div>` : ''}</div>` : ''}
        <div class="panel"><h3>${t('participants')} (${r.participants.length})</h3>
          ${r.participants.length ? `<div class="participants"><table>${r.participants.slice().reverse().map((p) => `<tr><td><span class="chip ${r.winner?.number === p.number ? 'win' : ''}">№${p.number}</span></td><td>${esc(p.name)}${mineSet.has(p.number) ? ' ★' : ''}</td><td class="muted small">${dateTime(p.at)}</td></tr>`).join('')}</table></div>`
          : `<p class="muted small">${t('no_participants')}</p>`}
        </div>
      </aside>
    </div>`;

  // gallery
  $$('.thumbs img').forEach((img) => img.addEventListener('click', () => {
    $('#mainImg').src = img.src;
    $$('.thumbs img').forEach((i) => i.classList.toggle('active', i === img));
  }));
  // buying
  const qty = $('#qty');
  if (qty) {
    const sync = () => {
      const n = Math.max(1, Math.min(left, Number(qty.value) || 1));
      qty.value = n;
      $('#total').textContent = azn(n * r.ticket_price);
    };
    qty.addEventListener('input', sync);
    $$('.qty button').forEach((b) => b.addEventListener('click', () => { qty.value = Number(qty.value) + Number(b.dataset.d); sync(); }));
    $$('.quick button').forEach((b) => b.addEventListener('click', () => { qty.value = b.dataset.q; sync(); }));
    $('#buyBtn').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await act(() => api(`/api/raffles/${r.id}/buy`, { method: 'POST', body: { quantity: Number(qty.value) } }),
          (res) => t('bought_ok', { n: res.numbers.length > 3 ? `№${res.numbers[0]}–${res.numbers.at(-1)}` : res.numbers.map((n) => `№${n}`).join(', ') }));
        await refreshUser();
        pageRaffle(r.id, { countView: false });
      } catch { e.target.disabled = false; }
    });
  }
  const post = (path, body, msg) => async () => {
    if (path !== 'confirm' && path !== 'dispute' && !confirm(t('confirm_q'))) return;
    await act(() => api(`/api/raffles/${r.id}/${path}`, { method: 'POST', body: body?.() ?? {} }), msg).catch(() => {});
    await refreshUser();
    pageRaffle(r.id, { countView: false });
  };
  $('#loginToBuy')?.addEventListener('click', goLogin);
  $('#drawBtn')?.addEventListener('click', post('draw'));
  $('#cancelBtn')?.addEventListener('click', post('cancel'));
  $('#confirmBtn')?.addEventListener('click', post('confirm'));
  $('#disputeBtn')?.addEventListener('click', post('dispute', () => ({ reason: $('#disputeText').value })));
}

function pageCreate() {
  if (!state.user) { goLogin(); return; }
  const m = state.meta;
  const opts = (list, prefix) => `<option value="">—</option>${list.map((v) => `<option value="${v}">${t(`${prefix}.${v}`)}</option>`).join('')}`;
  app.innerHTML = `
    <h1>${t('create_title')}</h1>
    <div class="create">
      <form class="panel" id="createForm" novalidate>
        <div class="field" data-f="title"><label>${t('f_title')}</label><input name="title" maxlength="80" placeholder="${esc(t('f_title_ph'))}"><div class="err"></div></div>
        <div class="grid2">
          <div class="field" data-f="category"><label>${t('category')}</label><select name="category">${opts(m.categories, 'cat')}</select><div class="err"></div></div>
          <div class="field" data-f="city"><label>${t('city_label')}</label><select name="city">${opts(m.cities, 'city')}</select><div class="err"></div></div>
          <div class="field" data-f="item_condition"><label>${t('condition')}</label><select name="item_condition">${opts(m.conditions, 'cond')}</select><div class="err"></div></div>
          <div class="field" data-f="delivery"><label>${t('delivery')}</label><select name="delivery">${opts(m.delivery, 'deliv')}</select><div class="err"></div></div>
        </div>
        <div class="field" data-f="description"><label>${t('f_desc')}</label><textarea name="description" maxlength="3000" placeholder="${esc(t('f_desc_ph'))}"></textarea><div class="err"></div></div>
        <div class="field" data-f="images"><label>${t('f_photos')}</label><input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple><div class="previews" id="previews"></div><div class="err"></div></div>
        <div class="grid2">
          <div class="field" data-f="price_total"><label>${t('f_price')}</label><input name="price_total" type="number" min="1" step="0.5" value="12"><div class="hint">${t('f_price_h')}</div><div class="err"></div></div>
          <div class="field" data-f="ticket_price"><label>${t('f_ticket')}</label><input name="ticket_price" type="number" min="0.5" step="0.5" value="1">
            <div class="preset">${[0.5, 1, 2, 5, 10, 20, 50].map((v) => `<button type="button" data-tp="${v}">${v} ₼</button>`).join('')}</div>
            <div class="hint">${t('f_ticket_h')}</div><div class="err"></div></div>
          <div class="field" data-f="min_tickets"><label>${t('f_min')}</label><input name="min_tickets" type="number" min="1" value="10"><div class="hint">${t('f_min_h')}</div><div class="err"></div></div>
          <div class="field" data-f="duration_days"><label>${t('f_days')}</label><select name="duration_days">${[1, 3, 5, 7, 10, 14, 21, 30].map((d) => `<option ${d === 7 ? 'selected' : ''}>${d}</option>`).join('')}</select><div class="err"></div></div>
        </div>
        <button class="btn block" type="submit">${t('f_submit')}</button>
      </form>
      <aside class="panel calc" id="calc"></aside>
    </div>`;

  const form = $('#createForm');
  const rate = m.commission_rate;
  const calc = () => {
    const price = Number(form.price_total.value), tp = Number(form.ticket_price.value);
    const n = tp > 0 ? price / tp : 0;
    const valid = Number.isInteger(n) && n >= 2;
    const min = Math.min(Number(form.min_tickets.value) || n, n);
    const net = (k) => azn(Math.round(k * tp * 100) - Math.round(k * tp * 100 * rate));
    $$('.preset button').forEach((b) => b.classList.toggle('active', Number(b.dataset.tp) === tp));
    $('#calc').innerHTML = valid ? `
      <h3>${t('calc_tickets', { n, p: tp })}</h3>
      <div class="tickets-vis">${Array.from({ length: Math.min(n, 120) }, (_, i) => `<i class="${i < min ? 'min' : ''}"></i>`).join('')}</div>
      <div class="line"><span>${t('f_min')}</span><b>${min}</b></div>
      <div class="line"><span>${t('calc_receive', { a: '' })}</span><b>${net(n)}</b></div>
      ${min < n ? `<div class="line"><span>${t('calc_receive_min', { a: '' })}</span><b>${net(min)}</b></div>` : ''}
      <div class="note ${rate ? 'gold' : ''}" style="margin-top:12px">${rate ? t('calc_commission', { r: +(rate * 100).toFixed(2) }) : t('calc_free')}</div>
      <p class="small muted">${t('min_info', { n: min })}</p>`
      : `<p class="bad">${t(n && !Number.isInteger(n) ? 'errors.not_divisible' : 'errors.ticket_count_range')}</p>`;
  };
  form.addEventListener('input', calc);
  $$('.preset button').forEach((b) => b.addEventListener('click', () => { form.ticket_price.value = b.dataset.tp; calc(); }));
  form.images.addEventListener('change', () => {
    $('#previews').innerHTML = [...form.images.files].slice(0, 8).map((f) => `<img src="${URL.createObjectURL(f)}" alt="">`).join('');
  });
  calc();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $$('.field', form).forEach((f) => { f.classList.remove('invalid'); $('.err', f).textContent = ''; });
    const fd = new FormData(form);
    fd.delete('images');
    [...form.images.files].slice(0, 8).forEach((f) => fd.append('images', f));
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const { id } = await api('/api/raffles', { method: 'POST', form: fd });
      location.hash = `#/r/${id}`;
    } catch (err) {
      btn.disabled = false;
      if (err.error === 'auth_required') { goLogin(); return; }
      Object.entries(err.details || {}).forEach(([k, v]) => {
        const f = $(`.field[data-f="${k}"]`, form);
        if (f) { f.classList.add('invalid'); $('.err', f).textContent = t(`errors.${v}`) || v; }
      });
      toast(errorText(err), true);
      $('.field.invalid', form)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

function pageAuth(mode) {
  const reg = mode === 'register';
  app.innerHTML = `
    <div class="panel auth-box">
      <h1>${t(reg ? 'register_title' : 'login_title')}</h1>
      <form id="authForm" novalidate>
        <div class="field" data-f="phone"><label>${t('phone')}</label><input name="phone" type="tel" placeholder="${t('phone_ph')}" autocomplete="tel"><div class="err"></div></div>
        ${reg ? `<div class="field" data-f="name"><label>${t('name')}</label><input name="name" autocomplete="name"><div class="err"></div></div>` : ''}
        <div class="field" data-f="password"><label>${t('password')}</label><input name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}"><div class="err"></div></div>
        <button class="btn block">${t(reg ? 'register_title' : 'login_title')}</button>
      </form>
      <p class="small muted" style="text-align:center">${t(reg ? 'have_account' : 'no_account')} <a href="#/${reg ? 'login' : 'register'}" style="color:var(--brand)">${t(reg ? 'login_title' : 'register_title')}</a></p>
    </div>`;
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    $$('.field', form).forEach((f) => { f.classList.remove('invalid'); $('.err', f).textContent = ''; });
    try {
      await api(`/api/auth/${mode}`, { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      await refreshUser();
      location.hash = state.returnTo || '#/';
      state.returnTo = null;
    } catch (err) {
      Object.entries(err.details || {}).forEach(([k, v]) => {
        const f = $(`.field[data-f="${k}"]`, form);
        if (f) { f.classList.add('invalid'); $('.err', f).textContent = t(`errors.${v}`); }
      });
      toast(errorText(err), true);
    }
  });
}

async function pageMe(tab = 'tickets') {
  if (!state.user) { goLogin(); return; }
  app.innerHTML = `
    <h1>${esc(state.user.name)} <span class="muted small">${esc(state.user.phone)}</span></h1>
    <div class="tabs" style="display:inline-flex;margin-bottom:14px">
      ${['tickets', 'raffles', 'wallet'].map((k) => `<button class="${tab === k ? 'active' : ''}" data-tab="${k}">${t(k === 'tickets' ? 'my_tickets' : k === 'raffles' ? 'my_raffles' : 'wallet')}</button>`).join('')}
    </div>
    <div class="panel" id="meBody"></div>`;
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/me/${b.dataset.tab}`; }));
  const body = $('#meBody');
  const row = (r, extra) => `<a class="list-row" href="#/r/${r.id}">${thumb(r)}</div>
    <div class="grow"><b>${esc(r.title)}</b>${progressBar(r)}<div class="meta"><span>${t('sold_of', { a: r.tickets_sold, b: r.ticket_count })} · ${azn(r.ticket_price)} ${t('per_ticket')}</span><span>${t(`st_${r.status}`)}</span></div>${extra || ''}</div></a>`;

  if (tab === 'tickets') {
    const list = await api('/api/me/tickets');
    body.innerHTML = list.length ? list.map((r) => row(r, `<div class="small">${t('my_count', { n: r.my_count, list: r.my_numbers.slice(0, 20).join(', ') + (r.my_numbers.length > 20 ? '…' : '') })} ${r.won ? `<span class="chip win">${t('won_badge')}</span>` : ''}</div>`)).join('') : `<div class="empty">${t('no_items')}</div>`;
  } else if (tab === 'raffles') {
    const list = await api('/api/me/raffles');
    body.innerHTML = list.length ? list.map((r) => row(r)).join('') : `<div class="empty">${t('no_items')} · <a href="#/new" style="color:var(--brand)">${t('nav_create')}</a></div>`;
  } else {
    await refreshUser();
    const txs = await api('/api/me/transactions');
    body.innerHTML = `
      <div class="row-between" style="flex-wrap:wrap"><div><div class="muted">${t('balance')}</div><div class="big-price">${azn(state.user.balance)}</div></div>
        <form id="walletForm" style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" name="amount" type="number" min="1" value="20" style="width:120px" aria-label="${esc(t('amount_azn'))}">
        <button class="btn gold" data-op="topup">${t('topup_btn')}</button><button class="btn ghost" data-op="withdraw">${t('withdraw_btn')}</button></form></div>
      <div class="note gold" style="margin:12px 0">${t('demo_payment')}</div>
      ${txs.map((x) => `<div class="tx"><div><b>${t(`tx_${x.type}`)}</b>${x.title ? ` · <a href="#/r/${x.raffle_id}">${esc(x.title)}</a>` : ''} ${x.note ? `<span class="muted small">${esc(x.note)}</span>` : ''}<div class="muted small">${dateTime(x.created_at)}</div></div><div class="${x.amount >= 0 ? 'plus' : 'minus'}">${x.amount >= 0 ? '+' : '−'}${azn(Math.abs(x.amount))}</div></div>`).join('') || `<div class="empty">${t('no_items')}</div>`}`;
    $$('#walletForm button').forEach((b) => b.addEventListener('click', async (e) => {
      e.preventDefault();
      await act(() => api(`/api/wallet/${b.dataset.op}`, { method: 'POST', body: { amount: Number($('#walletForm').amount.value) } }), t('saved')).catch(() => {});
      pageMe('wallet');
    }));
  }
}

function pageHow() {
  app.innerHTML = `<h1>${t('how_title')}</h1>
    <section class="hero" style="margin-top:0"><div><h1>${t('hero_title')}</h1><p>${t('hero_sub')}</p></div>
      <div class="steps">${[1, 2, 3].map((n) => `<div class="step"><div class="n">${n}</div><b>${t(`step${n}_t`)}</b><span>${t(`step${n}_d`)}</span></div>`).join('')}</div></section>
    <div class="how-grid">${t('how').map(([h, p]) => `<div class="panel"><h3>${esc(h)}</h3><p style="margin:0">${esc(p)}</p></div>`).join('')}</div>`;
}

// Recomputes the draw in the browser with Web Crypto, mirroring computeDraw() in src/raffle.js.
async function pageVerify(id) {
  const r = await api(`/api/raffles/${id}`);
  const enc = new TextEncoder();
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!r.server_seed) { app.innerHTML = `<div class="panel" style="margin-top:20px"><h1>${t('verify_title')}</h1><p>${t('verify_wait')}</p></div>`; return; }
  const seedHash = hex(await crypto.subtle.digest('SHA-256', enc.encode(r.server_seed)));
  const list = r.participants.map((p) => `${p.number}:${p.user_id}`).join('|');
  const digest = hex(await crypto.subtle.digest('SHA-256', enc.encode(list)));
  const message = `${r.id}:${r.participants.length}:${digest}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(r.server_seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hmac = hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  const index = parseInt(hmac.slice(0, 13), 16) % r.participants.length;
  const number = r.participants[index].number;
  const ok = seedHash === r.seed_hash && number === r.winner.number;
  app.innerHTML = `<div class="panel" style="margin-top:20px">
    <h1>${t('verify_title')}: <a href="#/r/${r.id}" style="color:var(--brand)">${esc(r.title)}</a></h1>
    <p class="${ok ? 'ok' : 'bad'}" style="font-size:20px">${t(ok ? 'verify_ok' : 'verify_bad')}</p>
    <p class="small muted">${t('verify_steps')}</p>
    <table class="admin">
      <tr><th>${t('server_seed')}</th><td class="mono">${esc(r.server_seed)}</td></tr>
      <tr><th>SHA-256(seed)</th><td class="mono">${seedHash} ${seedHash === r.seed_hash ? '<span class="ok">✔</span>' : '<span class="bad">✘</span>'}</td></tr>
      <tr><th>${t('seed_hash')}</th><td class="mono">${esc(r.seed_hash)}</td></tr>
      <tr><th>digest</th><td class="mono">${digest}</td></tr>
      <tr><th>message</th><td class="mono">${esc(message)}</td></tr>
      <tr><th>HMAC</th><td class="mono">${hmac}</td></tr>
      <tr><th>index</th><td>${index} → №${number} ${number === r.winner.number ? '<span class="ok">✔</span>' : '<span class="bad">✘</span>'}</td></tr>
    </table></div>`;
}

async function pageAdmin(status = 'disputed') {
  if (!state.user?.is_admin) { location.hash = '#/'; return; }
  const [s, raffles, users] = await Promise.all([api('/api/admin/stats'), api(`/api/admin/raffles?status=${status}`), api('/api/admin/users')]);
  const stat = (k, v) => `<div class="stat"><span class="muted small">${t(k)}</span><b>${v}</b></div>`;
  app.innerHTML = `
    <h1>${t('admin_title')}</h1>
    <div class="stats">${stat('s_users', s.users)}${stat('s_active', s.active)}${stat('s_completed', s.completed)}${stat('s_disputed', s.disputed)}
      ${stat('s_tickets', s.tickets_sold)}${stat('s_escrow', azn(s.escrow))}${stat('s_gmv', azn(s.gmv))}${stat('s_commission', azn(s.commission_earned))}</div>
    <div class="panel" style="margin-top:14px">
      <form id="commForm" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
        <div class="field" style="margin:0"><label>${t('commission')}</label><input name="percent" type="number" min="0" max="50" step="0.5" value="${+(s.commission_rate * 100).toFixed(2)}" style="width:120px"></div>
        <button class="btn">${t('save')}</button>
        <button class="btn ghost" type="button" id="tickBtn">${t('run_tick')}</button>
      </form>
      <p class="small muted">${t('commission_h')}</p>
    </div>
    <div class="row-between"><h2>${t('disputes')}</h2>
      <select id="stFilter" class="input" style="width:auto">${['disputed', 'active', 'drawn', 'completed', 'refunded', 'cancelled', 'all'].map((x) => `<option value="${x}" ${x === status ? 'selected' : ''}>${x === 'all' ? '*' : t(`st_${x}`)}</option>`).join('')}</select></div>
    <table class="admin"><tr><th>#</th><th>${t('f_title')}</th><th>${t('seller')}</th><th>${t('winner')}</th><th></th></tr>
      ${raffles.map((r) => `<tr><td>${r.id}</td><td><a href="#/r/${r.id}" style="color:var(--brand)">${esc(r.title)}</a><div class="small muted">${t(`st_${r.status}`)} · ${r.tickets_sold}/${r.ticket_count} (min ${r.min_tickets}) × ${azn(r.ticket_price)}</div>${r.dispute_reason ? `<div class="small bad">${esc(r.dispute_reason)}</div>` : ''}</td>
        <td>${esc(r.seller_name)}<div class="small muted">${esc(r.seller_phone)}</div></td><td>${esc(r.winner_name || '')}<div class="small muted">${esc(r.winner_phone || '')}</div></td>
        <td style="white-space:nowrap">${r.status === 'disputed' ? `<button class="btn sm" data-resolve="release" data-id="${r.id}">${t('resolve_release')}</button> <button class="btn sm danger" data-resolve="refund" data-id="${r.id}">${t('resolve_refund')}</button>` : ''}
          ${r.status === 'active' ? `<button class="btn sm ghost" data-feature="${r.id}">${r.featured ? '★ ' : ''}${t('feature')}</button> <button class="btn sm danger" data-cancel="${r.id}">${t('cancel_raffle')}</button>` : ''}</td></tr>`).join('')}
    </table>
    <h2>${t('users')}</h2>
    <table class="admin"><tr><th>#</th><th>${t('name')}</th><th>${t('phone')}</th><th>${t('balance')}</th><th></th></tr>
      ${users.map((u) => `<tr><td>${u.id}</td><td>${esc(u.name)}${u.is_admin ? ' (admin)' : ''}</td><td>${esc(u.phone)}</td><td>${azn(u.balance)}</td>
        <td>${u.is_admin ? '' : `<button class="btn sm ${u.is_blocked ? '' : 'ghost'}" data-block="${u.id}">${u.is_blocked ? '✓ ' : ''}${t('block')}</button>`}</td></tr>`).join('')}
    </table>`;
  const reload = () => pageAdmin(status);
  $('#stFilter').addEventListener('change', (e) => pageAdmin(e.target.value));
  $('#commForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await act(() => api('/api/admin/commission', { method: 'PUT', body: { percent: Number(e.target.percent.value) } }), t('saved')).catch(() => {});
    state.meta = await api('/api/meta');
    reload();
  });
  $('#tickBtn').addEventListener('click', async () => { await act(() => api('/api/admin/tick', { method: 'POST' }), (r) => JSON.stringify(r)); reload(); });
  const bind = (attr, path, body) => $$(`[data-${attr}]`).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('confirm_q'))) return;
    await act(() => api(path(b), { method: 'POST', body: body?.(b) ?? {} }), t('saved')).catch(() => {});
    reload();
  }));
  bind('resolve', (b) => `/api/admin/raffles/${b.dataset.id}/resolve`, (b) => ({ decision: b.dataset.resolve }));
  bind('feature', (b) => `/api/admin/raffles/${b.dataset.feature}/feature`);
  bind('cancel', (b) => `/api/admin/raffles/${b.dataset.cancel}/cancel`);
  bind('block', (b) => `/api/admin/users/${b.dataset.block}/block`);
}

// ---------- router ----------
async function route() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  window.scrollTo(0, 0);
  try {
    if (!parts.length) await pageHome(new URLSearchParams(query));
    else if (parts[0] === 'r') await pageRaffle(Number(parts[1]));
    else if (parts[0] === 'new') pageCreate();
    else if (parts[0] === 'login' || parts[0] === 'register') pageAuth(parts[0]);
    else if (parts[0] === 'me') await pageMe(parts[1]);
    else if (parts[0] === 'how') pageHow();
    else if (parts[0] === 'verify') await pageVerify(Number(parts[1]));
    else if (parts[0] === 'admin') await pageAdmin();
    else app.innerHTML = `<div class="empty">404</div>`;
  } catch (err) {
    app.innerHTML = `<div class="empty">${esc(errorText(err) || 'Error')}</div>`;
  }
}

(async function init() {
  [state.meta] = await Promise.all([api('/api/meta'), refreshUser()]);
  window.addEventListener('hashchange', route);
  route();
})();
