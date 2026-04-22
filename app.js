// ============================================================
// App State
// ============================================================
const state = {
  activeTab:      'itinerary',
  activeDay:      0,
  days:           [],
  places:         {},
  editingExpId:   null,   // id of expense being edited (null = add mode)
  expenses:    [],
  selections:  JSON.parse(localStorage.getItem('trip-selections') || '{}'),
  loading:     true,
  loadError:   null,
};

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupModal();
  setupExpenseForm();
  renderWeather();
  renderAccommodation();
  showLoading(true);

  try {
    const data = await loadAllData();
    state.days   = data.days;
    state.places = data.places;
    state.loading = false;
    showLoading(false);

    renderItinerary();
    renderPlaces();
    setupPlaceSearch();
  } catch (err) {
    state.loadError = err.message;
    showLoading(false);
    showLoadError(err.message);
  }

  state.expenses = await apiGetExpenses();
  renderExpenses();
});

// ============================================================
// Loading / Error states
// ============================================================
function showLoading(on) {
  ['tab-itinerary', 'tab-places'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const existing = el.querySelector('.loading-state');
    if (on && !existing) {
      const div = document.createElement('div');
      div.className = 'loading-state';
      div.innerHTML = `<div class="spinner"></div><div>載入行程資料中…</div>`;
      el.prepend(div);
    } else if (!on && existing) {
      existing.remove();
    }
  });
}

function showLoadError(msg) {
  ['tab-itinerary', 'tab-places'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const existing = el.querySelector('.loading-state');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'loading-state error';
    div.innerHTML = `
      <div style="font-size:32px">⚠️</div>
      <div>載入失敗：${msg}</div>
      <button class="btn-retry" onclick="location.reload()">重試</button>`;
    el.prepend(div);
  });
}

// ============================================================
// Navigation
// ============================================================
function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelector(`.nav-item[data-tab="${tab}"]`).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ============================================================
// Itinerary
// ============================================================
function renderItinerary() {
  const tabsEl = document.getElementById('day-tabs');
  const wrapEl = document.getElementById('timeline-wrap');
  if (!tabsEl || !wrapEl) return;
  tabsEl.innerHTML = '';

  if (!state.days.length) {
    wrapEl.innerHTML = '<div class="loading-state">尚無行程資料</div>';
    return;
  }

  state.days.forEach((day, i) => {
    const btn = document.createElement('button');
    btn.className = `day-tab${i === state.activeDay ? ' active' : ''}`;
    btn.innerHTML = `<span>${day.date}</span> <span style="font-weight:400;opacity:.7">${day.weekday}</span>`;
    btn.addEventListener('click', () => {
      state.activeDay = i;
      document.querySelectorAll('.day-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderDayTimeline(state.days[i], wrapEl);
    });
    tabsEl.appendChild(btn);
  });

  renderDayTimeline(state.days[state.activeDay], wrapEl);
}

function renderDayTimeline(day, container) {
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'day-header';
  header.innerHTML = `
    <div class="day-header-badge">${day.city}</div>
    <div class="day-header-title">${day.title || day.city}</div>`;
  container.appendChild(header);

  const timeline = document.createElement('div');
  timeline.className = 'timeline';

  day.items.forEach((item, idx) => {
    if (!item.name && item.type === 'single') return;
    const slotKey = `day-${day.date}-slot-${idx}`;
    const el = document.createElement('div');
    el.className = 'timeline-item';

    if (item.type === 'single') {
      el.innerHTML = renderSingleItem(item);
    } else {
      el.innerHTML = renderMultiItem(item, slotKey);
      setupMultiItemEvents(el, item, slotKey, day);
    }
    timeline.appendChild(el);
  });

  container.appendChild(timeline);
}

function renderSingleItem(item) {
  const key = item.placeKey;
  const place = key && state.places[key];
  const nameEN = place && place.nameEN
    ? `<div class="timeline-name-en">${place.nameEN}</div>` : '';
  return `
    <div class="timeline-dot"></div>
    <div class="timeline-card">
      <div class="timeline-main">
        <div class="timeline-time">${item.time || '—'}</div>
        <div class="timeline-info">
          <div class="timeline-name">${item.name}</div>
          ${nameEN}
          ${item.note ? `<div class="timeline-note">${item.note}</div>` : ''}
          ${item.mapsUrl ? `<a href="${item.mapsUrl}" target="_blank" rel="noopener" class="timeline-link-btn">📍 地圖</a>` : ''}
          ${place ? `<button class="timeline-link-btn" data-place="${key}">查看詳情 →</button>` : ''}
        </div>
      </div>
    </div>`;
}

function renderMultiItem(item, slotKey) {
  const selectedIdx = state.selections[slotKey] ?? -1;
  const isDecided = selectedIdx >= 0;

  const optionsHtml = (item.options || []).map((opt, i) => {
    const isSel = selectedIdx === i;
    const key = opt.placeKey;
    const place = key && state.places[key];
    const nameEN = place && place.nameEN
      ? `<div class="option-name-en">${place.nameEN}</div>` : '';
    return `
      <div class="option-item${isSel ? ' selected' : ''}">
        <div class="option-dot"></div>
        <div class="option-info">
          <div class="option-name">${opt.name}</div>
          ${nameEN}
        </div>
        <div class="option-actions">
          ${opt.mapsUrl ? `<a href="${opt.mapsUrl}" target="_blank" rel="noopener" class="btn-view-place">📍</a>` : ''}
          ${place ? `<button class="btn-view-place" data-place="${key}">詳情</button>` : ''}
          <button class="btn-select${isSel ? ' selected' : ''}" data-opt-idx="${i}">
            ${isSel ? '✓ 選定' : '選定'}
          </button>
        </div>
      </div>`;
  }).join('');

  const noteHtml = item.note ? `<div class="option-note">${item.note}</div>` : '';

  return `
    <div class="timeline-dot multi"></div>
    <div class="timeline-card">
      <div class="multi-header">
        <div class="multi-label">
          <div class="multi-time">${item.time}</div>
          <div class="multi-label-text">${item.label || ''}</div>
          <div class="multi-badge${isDecided ? ' decided' : ''}">
            ${isDecided
              ? `✓ ${(item.options[selectedIdx].name || '').split('（')[0].substring(0, 12)}`
              : `${(item.options || []).length} 個選項`}
          </div>
        </div>
        <div class="multi-chevron">⌄</div>
      </div>
      <div class="multi-options${isDecided ? ' collapsed' : ''}">
        ${noteHtml}${optionsHtml}
      </div>
    </div>`;
}

function setupMultiItemEvents(el, item, slotKey, day) {
  const header  = el.querySelector('.multi-header');
  const options = el.querySelector('.multi-options');
  const chevron = el.querySelector('.multi-chevron');

  header.addEventListener('click', () => {
    const collapsed = options.classList.toggle('collapsed');
    chevron.style.transform = collapsed ? '' : 'rotate(180deg)';
  });

  el.querySelectorAll('.btn-select').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.optIdx);
      const cur = state.selections[slotKey] ?? -1;
      state.selections[slotKey] = cur === idx ? -1 : idx;
      localStorage.setItem('trip-selections', JSON.stringify(state.selections));
      const wrapEl = document.getElementById('timeline-wrap');
      renderDayTimeline(day, wrapEl);
    });
  });

  el.querySelectorAll('.btn-view-place[data-place]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openPlaceModal(btn.dataset.place);
    });
  });
}

// ============================================================
// Places
// ============================================================
function renderPlaces(filter = '') {
  const optEl  = document.getElementById('cards-optional');
  const optSec = document.getElementById('places-optional');
  if (!optEl) return;

  optEl.innerHTML = '';

  const q = filter.trim().toLowerCase();
  const opt = [];

  Object.entries(state.places).forEach(([key, p]) => {
    if (p.category !== 'optional') return;
    if (q) {
      const hay = `${p.name}${p.intro || ''}${p.tag || ''}`.toLowerCase();
      if (!hay.includes(q)) return;
    }
    opt.push({ key, ...p });
  });

  opt.forEach(p => optEl.appendChild(createPlaceCard(p)));
  if (optSec) optSec.style.display = opt.length ? '' : 'none';
}

function createPlaceCard(place) {
  const card = document.createElement('div');
  card.className = 'place-card';
  const tagBadge = place.tag ? `<span class="place-tag">${place.tag}</span>` : '';
  card.innerHTML = `
    <div class="place-card-name">${place.name}${tagBadge}</div>
    ${place.nameEN ? `<div class="place-card-name-en">${place.nameEN}</div>` : ''}
    ${place.address ? `<div class="place-address">📌 ${place.address}</div>` : ''}
    ${place.intro ? `<div class="place-intro">${place.intro}</div>` : ''}
    <a href="${place.mapsUrl}" target="_blank" rel="noopener" class="place-map-btn">
      🗺️ 在 Google Maps 開啟導航
    </a>`;
  return card;
}

function setupPlaceSearch() {
  const inp = document.getElementById('place-search');
  if (inp) inp.addEventListener('input', e => renderPlaces(e.target.value));
}

// ============================================================
// Place Modal
// ============================================================
function setupModal() {
  document.getElementById('modal-close')?.addEventListener('click', closePlaceModal);
  document.getElementById('modal-overlay')?.addEventListener('click', closePlaceModal);
}

function openPlaceModal(key) {
  const place = state.places[key];
  if (!place) return;
  const content = document.getElementById('modal-content');
  if (!content) return;

  const cityClass = (place.city || '').includes('吉隆坡') ? 'kl' : '';
  const enName = place.nameEN ? `<div class="modal-name-en">${place.nameEN}</div>` : '';
  content.innerHTML = `
    <div class="modal-name">${place.name}</div>
    ${enName}
    <div class="modal-city ${cityClass}">${place.city || ''}</div>
    ${place.address ? `<div class="modal-address">📌 <span>${place.address}</span></div>` : ''}
    ${place.intro ? `<div class="modal-intro">${place.intro}</div>` : ''}
    <a href="${place.mapsUrl}" target="_blank" rel="noopener" class="modal-map-btn">
      🗺️ 在 Google Maps 開啟導航
    </a>`;

  document.getElementById('place-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closePlaceModal() {
  document.getElementById('place-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.timeline-link-btn[data-place]');
  if (btn) openPlaceModal(btn.dataset.place);
});

// ============================================================
// Accommodation
// ============================================================
function renderAccommodation() {
  const list = document.getElementById('accommodation-list');
  if (!list) return;
  list.innerHTML = '';

  CONFIG.accommodations.forEach(a => {
    const nightLabel = a.nights.length === 1
      ? `${a.nights[0]} 入住`
      : `${a.nights[0]} – ${a.nights[a.nights.length - 1]} 入住`;
    const hasUrl = a.agodaUrl && a.agodaUrl !== '#' && a.agodaUrl !== '';

    const card = document.createElement('div');
    card.className = 'accom-card';
    card.innerHTML = `
      <div class="accom-header">
        <div>
          <div class="accom-city">${a.city}</div>
          <div class="accom-name">${a.name}</div>
        </div>
        <div class="accom-nights">${nightLabel}</div>
      </div>
      <div class="accom-body">
        <div class="accom-row">
          <div class="accom-icon">⏰</div>
          <div class="accom-times">
            <div class="accom-time-block"><span class="accom-label">入住</span><span class="accom-value">${a.checkIn}</span></div>
            <div class="accom-time-block"><span class="accom-label">退房</span><span class="accom-value">${a.checkOut}</span></div>
          </div>
        </div>
        <div class="accom-row">
          <div class="accom-icon">📍</div>
          <div><span class="accom-label">地址</span><span class="accom-value">${a.address}</span></div>
        </div>
        ${a.notes ? `
        <div class="accom-row">
          <div class="accom-icon">📝</div>
          <div><span class="accom-label">注意事項</span><span class="accom-value">${a.notes}</span></div>
        </div>` : ''}
        ${hasUrl
          ? `<a href="${a.agodaUrl}" target="_blank" rel="noopener" class="accom-agoda-btn">🏨 查看 Agoda 訂房</a>`
          : `<div class="accom-agoda-btn disabled">🏨 訂房連結（待填入）</div>`}
      </div>`;
    list.appendChild(card);
  });
}

// ============================================================
// Weather (Open-Meteo)
// ============================================================

const WEATHER_CITIES = {
  penang: { name: '檳城', emoji: '🌴', lat: 5.4141, lon: 100.3288,
            dates: ['5/20','5/21','5/22'], tripStart: '2026-05-20', tripEnd: '2026-05-22' },
  kl:     { name: '吉隆坡', emoji: '🏙️', lat: 3.1390, lon: 101.6869,
            dates: ['5/23','5/24'],       tripStart: '2026-05-23', tripEnd: '2026-05-24' }
};

function wmoEmoji(code) {
  if (code === 0)  return ['☀️','晴天'];
  if (code <= 2)   return ['⛅','局部多雲'];
  if (code === 3)  return ['☁️','陰天'];
  if (code <= 48)  return ['🌫️','霧'];
  if (code <= 55)  return ['🌦️','毛毛雨'];
  if (code <= 67)  return ['🌧️','雨'];
  if (code <= 82)  return ['🌦️','陣雨'];
  return                  ['⛈️','雷雨'];
}

function getActiveCityKey() {
  const now = new Date();
  const key = `${now.getMonth()+1}/${now.getDate()}`;
  for (const [id, c] of Object.entries(WEATHER_CITIES)) {
    if (c.dates.includes(key)) return id;
  }
  return now < new Date(2026, 4, 20) ? 'penang' : 'kl';
}

function getWeatherDateRange(cityKey) {
  const c = WEATHER_CITIES[cityKey];
  const today = new Date();
  const tripStart = new Date(2026, 4, 20);
  const daysToTrip = Math.ceil((tripStart - today) / 86400000);
  const todayKey = `${today.getMonth()+1}/${today.getDate()}`;
  if (c.dates.includes(todayKey) || (daysToTrip >= 0 && daysToTrip <= 16))
    return { start: c.tripStart, end: c.tripEnd, isTripDate: true };
  const s = today.toISOString().slice(0,10);
  const e = new Date(today.getTime() + 2*86400000).toISOString().slice(0,10);
  return { start: s, end: e, isTripDate: false };
}

async function fetchWeatherData(cityKey) {
  const range = getWeatherDateRange(cityKey);
  const cacheKey = `weather-${cityKey}-${range.start}-v1`;
  const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
  if (cached && Date.now() - cached.ts < 3 * 60 * 60 * 1000) return cached.data;
  const c = WEATHER_CITIES[cityKey];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}`
    + `&hourly=temperature_2m,apparent_temperature,precipitation_probability,weathercode,windspeed_10m,relativehumidity_2m`
    + `&timezone=Asia%2FKuala_Lumpur&start_date=${range.start}&end_date=${range.end}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('weather fetch failed');
  const data = await r.json();
  localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
  return data;
}

async function renderWeather() {
  const wrap = document.getElementById('weather-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<div class="wx-loading"><div class="spinner"></div><div>載入天氣資料…</div></div>`;

  const cityKey = getActiveCityKey();
  const city    = WEATHER_CITIES[cityKey];
  const range   = getWeatherDateRange(cityKey);
  let data;
  try {
    data = await fetchWeatherData(cityKey);
  } catch(_) {
    // Fallback: AccuWeather links
    wrap.innerHTML = '';
    Object.values(CONFIG.weather).forEach(w => {
      const card = document.createElement('div');
      card.className = 'weather-card';
      card.innerHTML = `
        <div class="weather-city-row">
          <div class="weather-emoji">${w.emoji}</div>
          <div class="weather-city-name">${w.city}</div>
        </div>
        <div class="weather-tip">${w.tip}</div>
        <a href="${w.acuUrl}" target="_blank" rel="noopener" class="weather-btn">
          🌤️ 查看 AccuWeather 天氣預報
        </a>`;
      wrap.appendChild(card);
    });
    return;
  }

  wrap.innerHTML = '';
  const hourlyTimes = data.hourly.time;
  const dateSet = [...new Set(hourlyTimes.map(t => t.slice(0,10)))];
  const todayStr = new Date().toISOString().slice(0,10);
  let activeDate = dateSet.includes(todayStr) ? todayStr : dateSet[0];

  if (!range.isTripDate) {
    const notice = document.createElement('div');
    notice.className = 'wx-notice';
    notice.textContent = '📅 目前顯示即時天氣，5/4 起自動切換行程預報';
    wrap.appendChild(notice);
  }

  const cityBadge = document.createElement('div');
  cityBadge.className = 'wx-city-header';
  cityBadge.textContent = `${city.emoji} ${city.name}`;
  wrap.appendChild(cityBadge);

  const tabsEl = document.createElement('div');
  tabsEl.className = 'wx-date-tabs';
  wrap.appendChild(tabsEl);

  const WD = ['日','一','二','三','四','五','六'];

  function renderDateContent(dateStr) {
    wrap.querySelectorAll('.wx-main-card,.wx-hourly-wrap').forEach(el => el.remove());
    const indices = hourlyTimes.map((t,i) => t.startsWith(dateStr) ? i : -1).filter(i => i >= 0);
    if (!indices.length) return;
    const noonIdx = indices.find(i => hourlyTimes[i].includes('T12:')) ?? indices[Math.floor(indices.length/2)];
    const H = data.hourly;
    const temp  = Math.round(H.temperature_2m[noonIdx]);
    const feels = Math.round(H.apparent_temperature[noonIdx]);
    const rain  = H.precipitation_probability[noonIdx];
    const wind  = Math.round(H.windspeed_10m[noonIdx]);
    const humid = H.relativehumidity_2m[noonIdx];
    const [wEmoji, wDesc] = wmoEmoji(H.weathercode[noonIdx]);

    const main = document.createElement('div');
    main.className = 'wx-main-card';
    main.innerHTML = `
      <div class="wx-temp-row">
        <div class="wx-temp-big">${temp}°</div>
        <div>
          <div class="wx-emoji-big">${wEmoji}</div>
          <div class="wx-condition">${wDesc}</div>
        </div>
      </div>
      <div class="wx-meta-grid">
        <div class="wx-meta-item"><div class="wx-meta-label">體感溫度</div><div class="wx-meta-val">${feels}°C</div></div>
        <div class="wx-meta-item"><div class="wx-meta-label">降雨機率</div><div class="wx-meta-val">${rain}%</div></div>
        <div class="wx-meta-item"><div class="wx-meta-label">濕度</div><div class="wx-meta-val">${humid}%</div></div>
        <div class="wx-meta-item"><div class="wx-meta-label">風速</div><div class="wx-meta-val">${wind} km/h</div></div>
      </div>`;
    wrap.appendChild(main);

    const nowHour = new Date().toISOString().slice(0,13);
    const hourlyWrap = document.createElement('div');
    hourlyWrap.className = 'wx-hourly-wrap';
    const row = document.createElement('div');
    row.className = 'wx-hourly-row';
    indices.forEach(i => {
      const t = hourlyTimes[i];
      const hour = t.slice(11,16);
      const isNow = t.slice(0,13) === nowHour;
      const [hEmoji] = wmoEmoji(H.weathercode[i]);
      const item = document.createElement('div');
      item.className = 'wx-hour-item' + (isNow ? ' now' : '');
      item.innerHTML = `
        <div class="wx-hour-time">${hour}</div>
        <div class="wx-hour-emoji">${hEmoji}</div>
        <div class="wx-hour-temp">${Math.round(H.temperature_2m[i])}°</div>
        <div class="wx-hour-rain">💧${H.precipitation_probability[i]}%</div>`;
      row.appendChild(item);
    });
    hourlyWrap.appendChild(row);
    wrap.appendChild(hourlyWrap);
    if (dateStr === todayStr) {
      setTimeout(() => {
        const nowEl = row.querySelector('.now');
        if (nowEl) nowEl.scrollIntoView({ inline: 'center', behavior: 'smooth' });
      }, 100);
    }
  }

  dateSet.forEach(dateStr => {
    const d = new Date(dateStr + 'T12:00:00');
    const tab = document.createElement('div');
    tab.className = 'wx-date-tab' + (dateStr === activeDate ? ' active' : '');
    if (range.isTripDate) {
      tab.innerHTML = `${d.getMonth()+1}/${d.getDate()}<br><span style="font-size:10px;font-weight:400">${WD[d.getDay()]}</span>`;
    } else {
      const diff = Math.round((d - new Date(todayStr+'T12:00:00')) / 86400000);
      tab.textContent = ['今天','明天','後天'][diff] ?? `${d.getMonth()+1}/${d.getDate()}`;
    }
    tab.addEventListener('click', () => {
      tabsEl.querySelectorAll('.wx-date-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeDate = dateStr;
      renderDateContent(dateStr);
    });
    tabsEl.appendChild(tab);
  });

  renderDateContent(activeDate);
}

// ============================================================
// Expense Form Setup
// ============================================================
function setupExpenseForm() {
  const payerSel = document.getElementById('exp-payer');
  const splitEl  = document.getElementById('split-members');
  if (!payerSel || !splitEl) return;

  CONFIG.members.forEach(m => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = m;
    payerSel.appendChild(opt);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'member-chip selected';
    chip.textContent = m;
    chip.dataset.member = m;
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
    splitEl.appendChild(chip);
  });

  document.getElementById('btn-add-expense')?.addEventListener('click', handleAddExpense);
}

// ============================================================
// Expense CRUD
// ============================================================
async function handleAddExpense() {
  const date      = document.getElementById('exp-date').value;
  const currency  = document.getElementById('exp-currency').value;
  const desc      = document.getElementById('exp-desc').value.trim();
  const amount    = parseFloat(document.getElementById('exp-amount').value);
  const paidBy    = document.getElementById('exp-payer').value;
  const splitAmong = Array.from(document.querySelectorAll('#split-members .member-chip.selected'))
                          .map(c => c.dataset.member);

  if (!desc)                { alert('請填寫項目說明'); return; }
  if (!amount || amount <= 0) { alert('請填寫有效金額'); return; }
  if (!splitAmong.length)   { alert('請至少選擇一位分攤對象'); return; }

  const btn = document.getElementById('btn-add-expense');
  btn.disabled = true;
  btn.textContent = '儲存中…';

  const isEditing = !!state.editingExpId;

  try {
    if (isEditing) {
      // Delete old record first, then add updated one with same id
      const oldId = state.editingExpId;
      await apiDeleteExpense(oldId);
      const exp = { id: oldId, date, desc, amount, currency, paidBy, splitAmong };
      state.expenses = await apiAddExpense(exp);
    } else {
      const exp = { id: Date.now().toString(), date, desc, amount, currency, paidBy, splitAmong };
      state.expenses = await apiAddExpense(exp);
    }

    // Reset form
    document.getElementById('exp-desc').value   = '';
    document.getElementById('exp-amount').value = '';
    document.querySelectorAll('#split-members .member-chip').forEach(c => c.classList.add('selected'));

    // Exit edit mode if needed
    if (isEditing) {
      state.editingExpId = null;
      btn.style.background = '';
      document.getElementById('btn-cancel-expense')?.remove();
    }

    renderExpenses();
  } catch (e) {
    alert('儲存失敗，請重試');
  } finally {
    btn.disabled = false;
    btn.textContent = isEditing && state.editingExpId ? '💾 儲存修改' : '＋ 新增';
  }
}

function startEditExpense(exp) {
  state.editingExpId = exp.id;

  // Pre-fill form fields
  document.getElementById('exp-date').value     = normalizeExpDate(exp.date);
  document.getElementById('exp-currency').value = exp.currency;
  document.getElementById('exp-desc').value     = exp.desc;
  document.getElementById('exp-amount').value   = exp.amount;
  document.getElementById('exp-payer').value    = exp.paidBy;

  // Set split members
  document.querySelectorAll('#split-members .member-chip').forEach(chip => {
    chip.classList.toggle('selected', exp.splitAmong.includes(chip.dataset.member));
  });

  // Change button label
  const addBtn = document.getElementById('btn-add-expense');
  if (addBtn) {
    addBtn.textContent = '💾 儲存修改';
    addBtn.style.background = 'var(--accent)';
  }

  // Add cancel button if not already present
  if (!document.getElementById('btn-cancel-expense')) {
    const cancelBtn = document.createElement('button');
    cancelBtn.id        = 'btn-cancel-expense';
    cancelBtn.type      = 'button';
    cancelBtn.className = 'btn-cancel-expense';
    cancelBtn.textContent = '✕ 取消編輯';
    cancelBtn.addEventListener('click', cancelEdit);
    addBtn?.insertAdjacentElement('afterend', cancelBtn);
  }

  // Scroll to form
  document.querySelector('.expense-form-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Refresh list to highlight editing row
  renderExpenseList();
}

function cancelEdit() {
  state.editingExpId = null;

  // Reset form
  document.getElementById('exp-desc').value   = '';
  document.getElementById('exp-amount').value = '';
  document.querySelectorAll('#split-members .member-chip').forEach(c => c.classList.add('selected'));

  // Restore add button
  const addBtn = document.getElementById('btn-add-expense');
  if (addBtn) {
    addBtn.textContent   = '＋ 新增';
    addBtn.style.background = '';
  }

  // Remove cancel button
  document.getElementById('btn-cancel-expense')?.remove();

  // Refresh list to remove highlight
  renderExpenseList();
}

async function handleDeleteExpense(id) {
  try {
    state.expenses = await apiDeleteExpense(id);
    renderExpenses();
  } catch (_) {
    state.expenses = state.expenses.filter(e => e.id !== id);
    renderExpenses();
  }
}

// ============================================================
// Expense List & Settlement
// ============================================================
function renderExpenses() {
  renderExpenseList();
  renderSettlement();
}

// Normalize expense date to "5/21" format regardless of how it was stored
function normalizeExpDate(d) {
  if (!d) return '';
  if (/^\d+\/\d+$/.test(String(d))) return String(d);   // already "5/21"
  const dt = new Date(d);
  if (!isNaN(dt.getTime())) return `${dt.getMonth() + 1}/${dt.getDate()}`;
  return String(d);
}

function renderExpenseList() {
  const daysEl  = document.getElementById('expense-days');
  const noEl    = document.getElementById('no-expenses');
  const badgeEl = document.getElementById('expense-total-badge');
  if (!daysEl) return;
  daysEl.innerHTML = '';

  const WEEKDAYS = { '5/20':'週三','5/21':'週四','5/22':'週五','5/23':'週六','5/24':'週日' };
  const DATE_ORDER = ['5/20','5/21','5/22','5/23','5/24'];

  if (!state.expenses.length) {
    noEl?.classList.remove('hidden');
    if (badgeEl) badgeEl.textContent = '';
    return;
  }
  noEl?.classList.add('hidden');

  const grouped = {};
  state.expenses.forEach(e => {
    const key = normalizeExpDate(e.date);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ ...e, _normDate: key });
  });

  let totals = { RM: 0, TWD: 0 };

  const buildGroup = (date, label) => {
    if (!grouped[date]) return;
    const grp = document.createElement('div');
    grp.className = 'expense-day-group';
    grp.innerHTML = `<div class="expense-day-label">📅 ${label}</div>`;
    grouped[date].forEach(exp => {
      totals[exp.currency] = (totals[exp.currency] || 0) + exp.amount;
      const isEditing = state.editingExpId === exp.id;
      const row = document.createElement('div');
      row.className = `expense-row${isEditing ? ' editing' : ''}`;
      row.innerHTML = `
        <div class="expense-row-main">
          <div class="expense-desc">${exp.desc}</div>
          <div class="expense-right">
            <span class="expense-amount">${exp.currency} ${exp.amount.toFixed(2)}</span>
            <button class="btn-edit-expense" title="編輯"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487z"/><line x1="4" y1="22" x2="20" y2="22"/></svg></button>
            <button class="btn-delete-expense" title="刪除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </div>
        <div class="expense-meta">💳 <strong>${exp.paidBy}</strong> 付款 &nbsp;|&nbsp; ${exp.splitAmong.length} 人</div>`;
      row.querySelector('.btn-edit-expense').addEventListener('click', () => startEditExpense(exp));
      row.querySelector('.btn-delete-expense').addEventListener('click', () => {
        if (confirm(`確定刪除「${exp.desc}」？`)) handleDeleteExpense(exp.id);
      });
      grp.appendChild(row);
    });
    daysEl.appendChild(grp);
  };

  DATE_ORDER.forEach(date => buildGroup(date, `${date}（${WEEKDAYS[date] || ''}）`));

  // 顯示非標準日期（如「其他」）
  Object.keys(grouped).filter(k => !DATE_ORDER.includes(k)).forEach(date => {
    buildGroup(date, date === 'other' ? '其他' : date);
  });

  const parts = [];
  if (totals.RM  > 0) parts.push(`RM ${totals.RM.toFixed(2)}`);
  if (totals.TWD > 0) parts.push(`TWD ${totals.TWD.toFixed(0)}`);
  if (badgeEl) { badgeEl.textContent = parts.join(' + '); badgeEl.className = 'expense-total-badge'; }
}

function renderSettlement() {
  const content = document.getElementById('settlement-content');
  if (!content) return;
  content.innerHTML = '';

  if (!state.expenses.length) {
    content.innerHTML = '<div class="settlement-empty">新增費用後，這裡將顯示誰欠誰多少錢。</div>';
    return;
  }

  const balances = {};
  CONFIG.members.forEach(m => { balances[m] = { RM: 0, TWD: 0 }; });

  state.expenses.forEach(exp => {
    const share = exp.amount / exp.splitAmong.length;
    if (!balances[exp.paidBy]) balances[exp.paidBy] = { RM: 0, TWD: 0 };
    balances[exp.paidBy][exp.currency] += exp.amount;
    exp.splitAmong.forEach(p => {
      if (!balances[p]) balances[p] = { RM: 0, TWD: 0 };
      balances[p][exp.currency] -= share;
    });
  });

  let hasAny = false;

  ['RM', 'TWD'].forEach(cur => {
    const nets = Object.entries(balances)
      .map(([name, b]) => ({ name, amount: Math.round(b[cur] * 100) / 100 }))
      .filter(b => Math.abs(b.amount) > 0.01);
    if (!nets.length) return;

    const creditors = nets.filter(b => b.amount >  0).sort((a,b) => b.amount - a.amount);
    const debtors   = nets.filter(b => b.amount <  0).sort((a,b) => a.amount - b.amount);
    const settlements = [];
    let ci = 0, di = 0;

    while (ci < creditors.length && di < debtors.length) {
      const c = creditors[ci], d = debtors[di];
      const amt = Math.min(c.amount, -d.amount);
      if (amt > 0.01) settlements.push({ from: d.name, to: c.name, amount: amt, currency: cur });
      c.amount -= amt; d.amount += amt;
      if (Math.abs(c.amount) < 0.01) ci++;
      if (Math.abs(d.amount) < 0.01) di++;
    }

    if (!settlements.length) return;
    hasAny = true;

    const grp = document.createElement('div');
    grp.className = 'settlement-currency-group';
    grp.innerHTML = `<div class="settlement-currency-label">${cur === 'RM' ? '馬幣（RM）' : '台幣（TWD）'}</div>`;

    const ARROW_SVG = `<svg width="22" height="10" viewBox="0 0 22 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="0" y1="5" x2="18" y2="5"/><polyline points="13,1 18,5 13,9"/></svg>`;

    settlements.forEach(s => {
      const row = document.createElement('div');
      row.className = 'settlement-row';
      row.innerHTML = `
        <div class="settlement-left">
          <span class="settlement-from">${s.from}</span>
          <span class="settlement-arrow">${ARROW_SVG}</span>
          <span class="settlement-to">${s.to}</span>
        </div>
        <span class="settlement-amount">${s.currency} ${s.amount.toFixed(2)}</span>`;
      grp.appendChild(row);
    });
    content.appendChild(grp);
  });

  if (!hasAny) {
    content.innerHTML = '<div class="settlement-all-clear">✅ 所有費用已平衡，無需轉帳！</div>';
  }
}
