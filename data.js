// ============================================================
// 設定檔 — 兩個欄位需要你填入：
//   1. SCRIPT_URL：部署 Code.gs 後的網址
//   2. accommodations：飯店名稱、地址、Agoda 連結
// ============================================================

const CONFIG = {

  // Google Sheet ID（勿更動）
  SHEET_ID: '1Y89FFVQtJtiLWRVNIm14njHesQe1WMZpBFtIBTFreSc',

  // ↓ 部署 Apps Script 後，將網址貼在這裡（引號內）
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzIxpi4-HlyKgjnvERPkTTsRkNi0I1rwSVtuwI6_2CaHN6hsHsSeSohV96_jITdBAeK0w/exec',

  // 成員名單
  members: ['Tracy', 'Kate', 'Vicky', 'Michelle', 'Eyleen', 'Hong'],

  // 住宿資訊
  accommodations: [
    {
      name: '【待填入】檳城飯店',
      nights: ['5/20', '5/21'],
      city: '檳城',
      checkIn: '15:00',
      checkOut: '12:00',
      address: '【待填入】飯店地址',
      agodaUrl: '',
      notes: '訂房確認號：待填入'
    },
    {
      name: '【待填入】吉隆坡飯店',
      nights: ['5/22', '5/23'],
      city: '吉隆坡',
      checkIn: '15:00',
      checkOut: '12:00',
      address: '【待填入】飯店地址',
      agodaUrl: '',
      notes: '訂房確認號：待填入'
    }
  ],

  // 天氣連結
  weather: {
    penang: {
      city: '檳城',
      emoji: '🌴',
      acuUrl: 'https://www.accuweather.com/en/my/george-town/228143/weather-forecast/228143',
      tip: '5月為西南季風期，早晚偶有陣雨，平均氣溫 27–33°C，建議備帶輕便雨具。'
    },
    kl: {
      city: '吉隆坡',
      emoji: '🏙️',
      acuUrl: 'https://www.accuweather.com/en/my/kuala-lumpur/215854/weather-forecast/215854',
      tip: '5月氣溫約 27–34°C，濕度較高，午後常有雷陣雨，記得帶防曬和雨傘。'
    }
  }
};

// ============================================================
// CSV 工具函式
// ============================================================

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], nx = text[i + 1];
    if (inQ) {
      if (ch === '"' && nx === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && nx === '\n') i++;
        row.push(field); field = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else field += ch;
    }
  }
  if (field || row.length) { row.push(field); if (row.some(c => c !== '')) rows.push(row); }
  return rows;
}

function slugify(str) {
  return str.trim()
    .replace(/\s+/g, '-')
    .replace(/[^\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ffa-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .substring(0, 40);
}

function parseDateKey(s) {
  const m = s.match(/(\d+)月(\d+)日/);
  return m ? `${m[1]}/${m[2]}` : s;
}

function parseWeekday(s) {
  const map = { '一':'週一','二':'週二','三':'週三','四':'週四','五':'週五','六':'週六','日':'週日','天':'週日' };
  const m = s.match(/[（(]([一二三四五六日天])[）)]/);
  return m ? (map[m[1]] || '') : '';
}

function normalizeTime(s) {
  const m = s.match(/(\d+):(\d+)\s*(上午|下午)?/);
  if (!m) return s;
  let h = parseInt(m[1]);
  const mn = m[2], p = m[3] || '';
  if (p === '下午' && h < 12) h += 12;
  if (p === '上午' && h === 12) h = 0;
  return `${String(h).padStart(2,'0')}:${mn}`;
}

// ============================================================
// 行程表 CSV 解析
// 欄位順序：日期 | 星期 | 時間 | 城市 | 類別 | 名稱 | 說明 | Maps URL | [選項1] [選項2] ...
// ============================================================

function parseItineraryCSV(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return [];

  const days = [];
  let curDay = null, curSlot = null;
  let lastDateKey = '', lastWeekday = '';

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const col = n => (r[n] || '').trim();

    const date     = col(0);
    const weekday  = col(1);
    const time     = col(2);
    const city     = col(3);
    const category = col(4);
    const name     = col(5);
    const note     = col(6);
    const mapsUrl  = col(7);
    const extras   = r.slice(8).map(c => (c||'').trim()).filter(Boolean);

    if (!date && !time && !name) continue;

    if (date) { lastDateKey = parseDateKey(date); lastWeekday = parseWeekday(weekday); }

    // New day
    if (!curDay || curDay.date !== lastDateKey) {
      curDay = {
        date: lastDateKey,
        weekday: lastWeekday,
        city: city || '',
        _firstCity: city || '',
        _lastCity: city || '',
        title: '',
        items: []
      };
      days.push(curDay);
      curSlot = null;
    }

    if (city) {
      if (!curDay._firstCity) curDay._firstCity = city;
      curDay._lastCity = city;
    }

    if (time) {
      const t = normalizeTime(time);

      if (extras.length > 0) {
        // 格式A：選項列在同一行 col 8+
        curSlot = {
          time: t,
          type: 'multi',
          label: name,
          note,
          options: extras.map(o => ({ name: o, note: '', mapsUrl: '' }))
        };
      } else {
        curSlot = { time: t, type: 'single', name, note, mapsUrl, category };
      }
      curDay.items.push(curSlot);

    } else if (name && curSlot) {
      // 格式B：延續行 = 上一個時段的另一個選項
      if (curSlot.type === 'single') {
        curSlot.type = 'multi';
        curSlot.label = curSlot.name;
        curSlot.options = [{ name: curSlot.name, note: curSlot.note, mapsUrl: curSlot.mapsUrl }];
        delete curSlot.name;
      }
      if (curSlot.type === 'multi') {
        curSlot.options.push({ name, note, mapsUrl });
      }
    }
  }

  // 後處理：設定城市、標題、清除暫存欄
  days.forEach(d => {
    d.city = (d._firstCity === d._lastCity || !d._lastCity)
      ? (d._firstCity || '')
      : `${d._firstCity} → ${d._lastCity}`;
    d.title = d.city;
    delete d._firstCity; delete d._lastCity;

    // 為每個 item 加上 placeKey
    d.items.forEach(item => {
      if (item.type === 'single' && item.name) {
        item.placeKey = slugify(item.name);
      }
      if (item.type === 'multi' && item.options) {
        item.options.forEach(o => { if (o.name) o.placeKey = slugify(o.name); });
      }
    });
  });

  return days;
}

// ============================================================
// 行程景點：從行程資料中提取（有說明或 Maps URL 的地點）
// ============================================================

function extractPlacesFromItinerary(days) {
  const places = {};
  days.forEach(day => {
    const dayCity = (day.city || '').split(' → ')[0];
    day.items.forEach(item => {
      const addPlace = (name, note, mapsUrl) => {
        if (!name) return;
        const key = slugify(name);
        if (places[key]) return;
        places[key] = {
          name,
          city: dayCity,
          address: '',
          intro: note || '',
          mapsUrl: mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(name + ' ' + dayCity)}`,
          category: 'itinerary'
        };
      };
      if (item.type === 'single') addPlace(item.name, item.note, item.mapsUrl);
      if (item.type === 'multi') item.options.forEach(o => addPlace(o.name, o.note, o.mapsUrl));
    });
  });
  return places;
}

// ============================================================
// 備選景點（檳城景點分頁）CSV 解析
// 欄位：類別 | 中文名 | 英文名 | 道路 | 說明 | Maps URL | ...
// ============================================================

function parseOptionalPlacesCSV(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return {};
  const places = {};

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const col = n => (r[n] || '').trim();
    const tag     = col(0);
    const nameCN  = col(1);
    const nameEN  = col(2);
    const area    = col(3);
    const intro   = col(4);
    const mapsUrl = [col(5), col(6), col(7), col(8)]
      .find(u => u.startsWith('http')) || '';

    if (!nameCN) continue;
    const key = slugify(nameCN);
    places[key] = {
      name: nameCN,
      nameEN,
      city: '檳城',
      address: area,
      intro: intro || tag,
      mapsUrl: mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(nameCN + ' Penang')}`,
      category: 'optional',
      tag
    };
  }
  return places;
}

// ============================================================
// 資料載入（供 app.js 呼叫）
// ============================================================

async function loadAllData() {
  const base = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=`;

  const [csvItinerary, csvOptional] = await Promise.all([
    fetch(base + encodeURIComponent('行程表')).then(r => {
      if (!r.ok) throw new Error('無法載入行程表');
      return r.text();
    }),
    fetch(base + encodeURIComponent('檳城景點')).then(r => {
      if (!r.ok) throw new Error('無法載入景點資料');
      return r.text();
    })
  ]);

  const days   = parseItineraryCSV(csvItinerary);
  const itinPlaces = extractPlacesFromItinerary(days);
  const optPlaces  = parseOptionalPlacesCSV(csvOptional);

  return {
    days,
    places: { ...itinPlaces, ...optPlaces }
  };
}

// ============================================================
// 費用 API（Apps Script 優先，失敗時 fallback localStorage）
// ============================================================

const LS_KEY = 'trip-expenses-v2';

async function apiGetExpenses() {
  if (!CONFIG.SCRIPT_URL) return lsGetExpenses();
  try {
    const r = await fetch(`${CONFIG.SCRIPT_URL}?action=getExpenses`);
    const j = await r.json();
    if (j.ok) return j.data;
  } catch (_) {}
  return lsGetExpenses();
}

async function apiAddExpense(exp) {
  if (!CONFIG.SCRIPT_URL) return lsAddExpense(exp);
  try {
    const params = new URLSearchParams({ action: 'addExpense', payload: JSON.stringify(exp) });
    const r = await fetch(`${CONFIG.SCRIPT_URL}?${params}`);
    const j = await r.json();
    if (j.ok) { lsSave(j.data); return j.data; }
  } catch (_) {}
  return lsAddExpense(exp);
}

async function apiDeleteExpense(id) {
  if (!CONFIG.SCRIPT_URL) return lsDeleteExpense(id);
  try {
    const params = new URLSearchParams({ action: 'deleteExpense', id });
    const r = await fetch(`${CONFIG.SCRIPT_URL}?${params}`);
    const j = await r.json();
    if (j.ok) { lsSave(j.data); return j.data; }
  } catch (_) {}
  return lsDeleteExpense(id);
}

// localStorage 備援
function lsGetExpenses() { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
function lsSave(arr)      { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }
function lsAddExpense(exp) {
  const arr = lsGetExpenses();
  arr.push(exp);
  lsSave(arr);
  return arr;
}
function lsDeleteExpense(id) {
  const arr = lsGetExpenses().filter(e => e.id !== id);
  lsSave(arr);
  return arr;
}
