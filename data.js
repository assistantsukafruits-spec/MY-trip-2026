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
// 欄位：日期 | 星期 | 時間 | 城市 | 類別 | 名稱 | 說明 | Maps URL | [col8+]
// 同一時段多行 → 自動合併為多選項
// col7 有 URL 且 col8+ 有內容 → 附加說明（非選項）
// col7 空且 col8+ 有內容 → Format A 選項
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
    const rawNote  = col(6);
    const mapsUrl  = col(7);
    const extras   = r.slice(8).map(c => (c||'').trim()).filter(Boolean);

    if (!date && !time && !name) continue;
    if (!name) continue;

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

    // col8+ 是附加說明（有 mapsUrl）或選項（無 mapsUrl）
    const isFormatA   = !mapsUrl && extras.length > 0;
    const extraNoteTxt = (mapsUrl && extras.length > 0) ? extras.join(' · ') : '';
    const note = extraNoteTxt
      ? `${rawNote}${rawNote ? ' · ' : ''}${extraNoteTxt}`
      : rawNote;

    if (time) {
      const t = normalizeTime(time);

      if (isFormatA) {
        // Format A：同一行 col8+ 就是選項名稱
        curSlot = {
          time: t, type: 'multi', label: name, note,
          options: extras.map(o => ({ name: o, note: '', mapsUrl: '' }))
        };
        curDay.items.push(curSlot);

      } else if (curSlot && curSlot.time === t) {
        // 同時段 → 合併為多選項
        if (curSlot.type === 'single') {
          curSlot.type    = 'multi';
          curSlot.label   = curSlot.category || category || '';
          curSlot.options = [{ name: curSlot.name, note: curSlot.note, mapsUrl: curSlot.mapsUrl }];
          delete curSlot.name; delete curSlot.note; delete curSlot.mapsUrl;
        }
        curSlot.options.push({ name, note, mapsUrl });

      } else {
        // 新的單一時段
        curSlot = { time: t, type: 'single', name, note, mapsUrl, category };
        curDay.items.push(curSlot);
      }

    } else {
      // 無時間 → 獨立項目（如「抵達機場」「紫妹們回台灣」）
      curSlot = { time: '', type: 'single', name, note, mapsUrl, category };
      curDay.items.push(curSlot);
    }
  }

  // 後處理
  days.forEach(d => {
    d.city = (d._firstCity === d._lastCity || !d._lastCity)
      ? (d._firstCity || '')
      : `${d._firstCity} → ${d._lastCity}`;
    d.title = d.city;
    delete d._firstCity; delete d._lastCity;

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
        const enrich = PLACE_ENRICHMENT[name] || {};
        places[key] = {
          name,
          nameEN:  enrich.nameEN  || '',
          city:    dayCity,
          address: enrich.address || '',
          intro:   enrich.intro   || note || '',
          mapsUrl: mapsUrl || enrich.mapsUrl
                || `https://maps.google.com/?q=${encodeURIComponent(name + ' ' + dayCity)}`,
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
    const enrich = PLACE_ENRICHMENT[nameCN] || {};
    places[key] = {
      name: nameCN,
      nameEN:  nameEN  || enrich.nameEN  || '',
      city: '檳城',
      address: area    || enrich.address || '',
      intro:   enrich.intro || intro || tag,
      mapsUrl: mapsUrl || enrich.mapsUrl
            || `https://maps.google.com/?q=${encodeURIComponent(nameCN + ' Penang')}`,
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

// ============================================================
// 景點詳細資料庫（英文名 + 歷史背景介紹）
// key 與 Google Sheet「景點或餐廳」欄位完全對應
// ============================================================

const PLACE_ENRICHMENT = {

  // ── 吉隆坡 ────────────────────────────────────────────────
  'Ali, Muthu & Ah Hock @ Dang Wangi': {
    nameEN: 'Ali, Muthu & Ah Hock Restaurant',
    intro: '店名本身就是一幅馬來西亞縮影：馬來人 Ali、印度人 Muthu 與華人 Ah Hock，三種族共事一室，象徵國家精神。供應道地早餐，包括椰漿飯（Nasi Lemak）、各式咖椰吐司與半熟蛋，是感受多元飲食文化的最佳起點。'
  },
  'Yut Kee Restaurant': {
    nameEN: 'Yut Kee Restaurant',
    intro: '創立於 1928 年的老字號海南茶室，是吉隆坡歷史最悠久的早餐名店之一，近百年來口味幾乎未曾改變。招牌豬肉卷（Roti Babi）以麵包裹豬肉餡油炸而成，外酥內嫩；薄煎餅（Hainanese Toast）與海南咖啡亦是必點，感受老吉隆坡的平靜晨間氛圍。'
  },
  'Ho Kow Hainam Kopitiam': {
    nameEN: 'Ho Kow Hainam Kopitiam',
    intro: '1927 年開業的百年海南咖啡館，位於舊茨廠街附近老巷弄中。以炭烤咖椰吐司（Kaya Toast）與海南咖啡聞名，炭火香氣濃郁，是感受老吉隆坡生活節奏的必訪之地。'
  },
  '吉隆坡飛禽公園': {
    nameEN: 'KL Bird Park',
    intro: '建於 1991 年，佔地 8.5 英畝，是金氏世界紀錄認可的世界最大全覆式自由放飛鳥園。園內飼養超過 3,000 隻、200 多個品種的鳥類，包括犀鳥、孔雀與火烈鳥，全在模擬熱帶雨林的環境中自由活動。遊客可以近距離餵食，亦設有每日定時的鳥類表演秀。緊鄰吉隆坡湖濱公園（Lake Gardens），可與植物園一同遊覽。'
  },
  'KLCC': {
    nameEN: 'KLCC / Petronas Twin Towers',
    intro: '由阿根廷建築師 César Pelli 設計，1998 年落成時是全球最高建築，高達 452 公尺，至今仍是世界最高雙塔。外觀以伊斯蘭幾何美學為靈感，88 層玻璃帷幕在陽光下熠熠生輝。41、42 樓間的空中天橋（Skybridge）是熱門打卡點。地面層的 Suria KLCC 是頂級購物商場，戶外的 KLCC 公園有大型噴泉水舞，每晚定時演出，白天與夜晚景致截然不同，各有精彩。'
  },
  'KL Forest Eco Park': {
    nameEN: 'KL Forest Eco Park',
    intro: '鬧市中的原始熱帶雨林保護區，歷史追溯至 1906 年英殖民時期，是全球少數位於首都市中心的原生林。園內設有高架樹冠步道，行走林間可同步俯瞰 KLCC 雙峰塔矗立眼前，自然與現代都市的強烈對比是最獨一無二的拍攝角度。常見松鼠、蜥蜴與各式熱帶植物，免費入園，步行即可抵達。'
  },
  '粉紅清真寺': {
    nameEN: 'Putra Mosque (Masjid Putra), Putrajaya',
    intro: '建於 1997–1999 年，以粉紅色玫瑰花崗岩砌成，是馬來西亞最夢幻的清真寺，也是首都布城（Putrajaya）最著名地標。主圓頂直徑 22 公尺，可同時容納 15,000 名信眾，外觀融合伊斯蘭、摩爾與馬來建築風格。清真寺前的普特拉廣場（Dataran Putra）直面普特拉湖，日出日落時粉牆映入湖面呈現粉橘倒影，是全馬最美的清真寺景觀。進入需著長袖長褲，入口提供免費借用袍服。'
  },
  '黑風洞': {
    nameEN: 'Batu Caves',
    intro: '距市區約 13 公里，是馬來西亞最著名的印度教聖地，石灰岩洞穴歷史超過 4 億年。入口處矗立著高達 42.7 公尺的金色黑天神（Lord Murugan）雕像，為全球最高穆魯干神像。攀上 272 級彩虹階梯後可進入主洞「神廟洞」，洞頂天然採光孔透入光柱，神廟供奉各路印度神祇。每年農曆一月大寶森節（Thaipusam），逾百萬信眾聚集扛起「卡瓦地」（Kavadi）朝聖遊行，場面震撼。'
  },
  '獨立廣場': {
    nameEN: 'Merdeka Square (Dataran Merdeka)',
    intro: '1957 年 8 月 31 日，馬來亞首任首相東姑阿都拉曼在此高呼七聲「Merdeka（獨立）！」，宣告脫離英國統治。廣場中央旗桿高達 95 公尺，是全球最高旗桿之一。周邊的蘇丹阿都沙末大廈（Sultan Abdul Samad Building）以摩爾式圓頂與鐘樓聞名，夜間燈光映照下構成吉隆坡最雄偉的歷史天際線。附近亦有國家紡織博物館與馬來西亞最古老的英式露天板球場遺址。'
  },
  '生命之河': {
    nameEN: 'River of Life',
    intro: '政府耗資逾 40 億馬幣的城市河濱改造計畫，將鵝麥河（Sungai Gombak）與巴生河（Sungai Klang）交匯處打造成亮藍色發光水道，夜晚燈光璀璨，被票選為全球十大最美城市河濱步道之一。步道沿岸設有精品咖啡廳、文青餐廳與藝術裝置，融合了古老的茨廠街與伊斯蘭藝術博物館街區，是感受新舊吉隆坡並存魅力的最佳散步路線。'
  },
  '中央美術坊': {
    nameEN: 'Central Market (Pasar Seni)',
    intro: '建於 1888 年的殖民地建築，原為生鮮市場，1986 年改建為藝術工藝品交易中心。Art Deco 風格的藍白相間外牆已列為國家文物。室內販售馬來西亞各族傳統工藝：蠟染布（Batik）、錫器、民族服飾、手工藝品與伴手禮，是最集中也最有文化氣息的採購地點。'
  },
  '鬼仔巷/茨廠街': {
    nameEN: 'Petaling Street / Chinatown & Petaling Street Art Lane',
    intro: '茨廠街（Petaling Street）自 1880 年代起就是廣東閩南移民礦工的聚居地，有超過 140 年歷史。現在以販售仿名牌、香料、乾貨與各式街頭小吃聞名，紅燈籠高掛、商販叫賣，充滿老市集熱鬧氛圍。毗鄰的鬼仔巷（Petaling Street Art Lane）近年由藝術家將老建築外牆繪成反映早期華人移民生活的大型彩色壁畫群，是 IG 熱門打卡點，日夜各有風情。'
  },
  '阿羅街黃亞華': {
    nameEN: 'Jalan Alor (Wong Ah Wah Chicken Wings)',
    intro: '金馬路（Jalan Alor）是 Bukit Bintang 最著名的美食街，每逢傍晚攤位出沒、烤爐火光沖天、香氣瀰漫整條街。黃亞華（Wong Ah Wah）自 1985 年起在此立攤，以炭火烤雞翼與烤魔鬼魚（魟魚）馳名全馬，成為外國遊客必造訪的宵夜地標。整條街的燒烤、炒粿條、蝦麵、冷飲攤位豐富多元，是感受馬來西亞夜晚飲食文化最直接的地方。'
  },
  'Bukit Bintang': {
    nameEN: 'Bukit Bintang Entertainment District',
    intro: '武吉免登（Bukit Bintang）是吉隆坡的精華娛樂商業核心，聚集了 Pavilion KL、Lot 10、Fahrenheit88 等多座購物商場。Changkat Bukit Bintang 一帶入夜後酒吧、餐廳林立，是吉隆坡最熱鬧的夜生活地帶；Jalan Alor 美食街緊鄰其旁。造型別緻的人行步道、露天咖啡廳與街頭表演，展現這座城市最國際化的面貌。'
  },

  // ── 檳城 ──────────────────────────────────────────────────
  '牛干冬雲吞麵': {
    nameEN: 'Kimberley Street Wonton Noodle',
    intro: '牛干冬（Kimberley Street）是喬治市最著名的深夜美食街，雲吞麵是其中招牌。檳城版雲吞麵以沙爹辣醬取代廣式豉油調味，麵條彈牙、雲吞餡料紮實，口味層次豐富，有別於香港或台灣版本。凌晨才開始最熱鬧，是在地宵夜文化的縮影。'
  },
  '汕頭街鴨肉粿汁': {
    nameEN: 'Swatow Lane Duck Kway Chap',
    intro: '粿汁（Kway Chap）是潮州傳統美食，以扁平的米粉皮浸泡在清甜藥膳鹵湯中，搭配滷鴨肉、豆腐、腸粉等配料。汕頭街（Swatow Lane）版本被列為檳城四大天王宵夜之一，湯頭帶有八角、桂皮的溫潤香氣，風味古樸深厚。'
  },
  '青屋蝦麵': {
    nameEN: 'Green House Prawn Mee',
    intro: '檳城蝦麵（Penang Hokkien Mee）以大量蝦頭熬煮的濃郁紅湯著稱，配上新鮮蝦仁、豬肉片與空心菜，湯頭鮮甜強烈。青屋版本被認為是檳城最具代表性的宵夜版蝦麵之一，深夜開攤，常吸引人潮排隊。'
  },
  '大路後咖哩麵': {
    nameEN: 'Dato Kramat Curry Mee',
    intro: '在地人深夜最愛的咖哩麵攤，以椰奶、辣椒、蝦膏與香料慢火熬製的濃郁湯底為特色，配上燙熟的米線、豆腐卜、蛤蜊與炸豆皮，份量紮實，深夜吃來格外滿足。'
  },
  'Mamak': {
    nameEN: 'Mamak (Indian-Muslim Stall)',
    intro: 'Mamak 是馬來西亞印度穆斯林餐廳的通稱，24 小時全年無休，提供拋餅（Roti Canai）、煎蕊（Mee Goreng Mamak）、拉茶（Teh Tarik）等庶民美食，是各族馬來西亞人深夜相聚的共同回憶。點一杯泡沫豐厚的拉茶，體驗最道地的 MY 宵夜文化。'
  },
  '多春茶室': {
    nameEN: 'Toh Soon Cafe',
    intro: '喬治市最受歡迎的早餐名攤，僅擺設在老巷弄騎樓下，座位有限。以炭烤咖椰吐司與滑嫩半熟蛋著稱，海南咖啡以傳統炭火烘焙豆子、加煉乳調製，香濃醇厚，一杯入魂。早上 7 點多即開始大排長龍，建議趁早前往。'
  },
  '廣泰來茶室': {
    nameEN: 'Kwong Thye Lai Kopitiam',
    intro: '百年歷史的老字號海南茶室，黑白磁磚地板、大理石桌面與木椅營造出濃厚復古氛圍，彷彿走進上個世紀的喬治市。供應炭烤土司、半熟蛋與傳統白咖啡，是感受老城慢活早晨的最佳場所。'
  },
  '喬治市壁畫街': {
    nameEN: 'George Town Street Art & Heritage Trail',
    intro: '2012 年立陶宛藝術家 Ernest Zacharevic 受邀為喬治市建城 221 週年繪製一系列街頭壁畫，其中《姐弟騎鐵馬》（Children on Bicycle）迅速成為全球最知名的街頭藝術作品之一，並帶動此後數百幅壁畫在全城各角落誕生。喬治市於 2008 年獲列 UNESCO 世界文化遺產，壁畫與姓氏橋、老廟宇、殖民建築共同構成獨一無二的文化景觀。建議步行探索，途中會不斷發現驚喜。'
  },
  '銀行街': {
    nameEN: 'Lebuh Pantai / Beach Street',
    intro: '19 世紀初英國東印度公司在此建立金融核心，沿街新古典主義與 Art Deco 建築群至今保存完整，包括昔日滙豐銀行（1900 年代）、渣打銀行與霸菱銀行等歷史建物，是東南亞最完整的殖民地金融街之一。厚重的石柱廊道（Five-Foot Way / 五腳基）是南洋建築特色，遮陽擋雨兼具，如今成為歷史攝影的絕佳背景。'
  },
  '娘惹博物館': {
    nameEN: 'Pinang Peranakan Mansion',
    intro: '建於 19 世紀末的土生華人（Peranakan / 峇峇娘惹）貴族豪宅，館內展示逾 1,000 件珍貴器物：鑲嵌金箔的酸枝木家具、英國維多利亞式彩色玻璃、廣彩瓷器與精緻刺繡。峇峇娘惹文化源自 15 世紀馬六甲王朝，中國移民與馬來人通婚後形成獨特族群，其飲食、語言（峇峇馬來語）、服飾（娘惹衫 Kebaya）與儀禮皆自成一格，是馬來西亞最珍貴的文化遺產之一。強烈建議參加每日導覽，深度了解這段精彩歷史。'
  },
  '潮州路頭煎蕊': {
    nameEN: 'Teochew Lane Cendol',
    intro: '煎蕊（Cendol）是馬來西亞最受歡迎的傳統甜品，以綠色香蘭汁染色的軟糯米粉條，加上刨冰、椰奶與濃郁黑糖漿調製而成，口感清涼甜蜜。潮州路頭版本是喬治市老饕推薦的必吃，旁邊攤位的炒粿條亦被認為是全檳之冠，邊吃邊比，別有趣味。'
  },
  '藍屋（張弼士故居）': {
    nameEN: 'Cheong Fatt Tze Mansion – The Blue Mansion',
    intro: '建於 1880–1904 年間，主人張弼士（1840–1916）出身廣東梅州客家貧農，隻身南下後成為亞洲首富之一，商業版圖橫跨南洋與中國，曾任清廷駐新加坡總領事及泰國副外相，同時也是張裕酒業創辦人。豪宅融合中西建築精髓：中式四合院格局、英式鑄鐵圍欄、蘇格蘭彩色玻璃窗渾然天成，外牆以靛藍灰泥粉刷，在陽光下光彩奪目。1995 年獲 UNESCO 亞太區文化遺產卓越大獎，現提供每日定時導覽，深度揭開傳奇主人的生平故事。'
  },
  '唐人厝': {
    nameEN: 'Clan House Heritage Café (Khoo Kongsi Area)',
    intro: '老屋改建的特色咖啡廳，保留百年歷史磨石子地板、彩繪玻璃與木樑天花板，融入現代設計元素，是喬治市下午茶的人氣打卡場所。以蛋糕種類多且色彩繽紛著稱，各式口味的棉花糖蛋糕、班蘭蛋糕搭配咖椰咖啡，適合在走訪藍屋導覽後就近停憩。'
  },
  '姓氏橋': {
    nameEN: 'Clan Jetties (Chew Jetty / Tan Jetty)',
    intro: '19 世紀末福建移民在喬治市海濱搭建的水上棧道聚落，按姓氏群聚（鄭姓橋、林姓橋、陳姓橋等），迄今仍有數十戶家庭世代居住其上，是馬來西亞碩果僅存的華人水上聚落之一。細長的木棧道向海面延伸，傍晚夕陽映照時呈現金橙溫暖色調，是喬治市最有歲月感的地標。鄭姓橋（Chew Jetty）規模最大、保存最完整，有小廟、老店與水邊人家的日常生活景象。'
  },
  '升旗山纜車': {
    nameEN: 'Penang Hill (Bukit Bendera) Funicular',
    intro: '升旗山（Bukit Bendera）海拔 830 公尺，是馬來西亞最古老的山岳觀光地，英殖民時期（1897 年）即開發為避暑勝地。現代化纜車全程約 5 分鐘，是東南亞最陡的軌道電車之一，斜度達 42 度。山頂氣溫比山下低約 5°C，天氣晴朗時可俯瞰整個喬治市、檳城橋與遠處的吉打州。設有步行道、觀景台與咖啡廳，傍晚夜景尤為壯觀。'
  },
  'The Habitat': {
    nameEN: 'The Habitat Penang Hill',
    intro: '升旗山山頂的生態體驗步道，穿越超過 130 年歷史的原始山頂雲霧林，全長約 1.6 公里。最大亮點是「Curtis Crest」——全馬最高的樹冠吊橋，懸掛於地面 8 公尺上方，在微風搖晃中踏行林冠之上，視野一望無際，既震撼又療癒。步道沿途可觀察珍稀植物、昆蟲與山鳥，是升旗山最值得加購的自然體驗。'
  },
  '阿依淡福建麵': {
    nameEN: 'Air Itam Hokkien Mee (Prawn Mee)',
    intro: '阿依淡（Air Itam）位於極樂寺山腳，其福建麵（Penang Hokkien Mee）以大量蝦頭、豬骨慢火熬製的濃郁紅湯為靈魂，湯頭鮮甜強烈，配上鮮蝦、豬肉片、空心菜與豆芽，口味深厚紮實。CNN Travel 曾評選檳城蝦麵為全球必吃美食，阿依淡版本被許多老饕認為是全檳之最，午餐時間常大排長龍。'
  },
  '阿依淡亞參叻沙': {
    nameEN: 'Air Itam Assam Laksa',
    intro: '亞參叻沙（Assam Laksa）是檳城最具代表性的美食，以酸辣鯖魚湯搭配粗米線，佐以薄荷葉、鳳梨片、洋蔥絲、小黃瓜與黑醬蝦膏，口味酸辣刺激開胃。CNN Travel 評選為「全球最美味食物」第 7 名，阿依淡版本被公認為全檳城最正宗，每逢午餐人潮大排長龍，必嚐。'
  },
  '姐妹咖哩麵': {
    nameEN: 'Sisters Curry Mee',
    intro: '「姐妹咖哩麵」由兩位老奶奶姐妹共同經營數十年，是檳城口碑最佳的古早味咖哩麵之一。至今堅持以傳統煤炭爐熬煮湯底，椰奶、辣椒與香料的比例恰到好處，湯頭濃郁芳香。配料有豆腐卜、豬血、蛤蜊，份量紮實，是愈來愈珍稀的老派功夫料理。'
  },
  '極樂寺': {
    nameEN: 'Kek Lok Si Temple',
    intro: '興建於 1891 年的極樂寺，是東南亞規模最大的佛教寺廟，依阿依淡山丘層疊而建，從山腳至山頂分成三層佛境。山頂矗立著高達 30.2 公尺的青銅觀音菩薩像（1998 年落成），是全馬最高觀音像。寺廟群融合中式、緬甸式與泰式佛塔建築，舉世罕見。每逢農曆新年掛起數萬盞彩燈，從山下遠觀如同燈海瀑布傾洩而下，壯觀震撼。'
  },
  '關仔角夜市': {
    nameEN: 'Gurney Drive Hawker Centre',
    intro: '關仔角（Gurney Drive）海濱小食中心擁有逾 60 年歷史，是檳城最著名的露天美食廣場，緊鄰 Gurney Plaza 購物中心。攤位逾 60 家，囊括炒粿條（Char Kway Teow）、煎蕊（Cendol）、燒肉串（Satay）、椰漿飯（Nasi Lemak）等超過 20 種在地小吃。傍晚海風輕拂，面海而食，是感受檳城悠閒生活氣息的最佳方式。'
  },
  '峇都丁宜沙灘': {
    nameEN: 'Batu Ferringhi Beach',
    intro: '峇都丁宜（Batu Ferringhi）是檳城島最著名的海灘度假區，北岸沙岸線長達數公里，老牌國際飯店與小型渡假村並立，海水清澈、棕櫚樹成蔭。傍晚夕陽西下沙灘呈橘紅暖調，是拍照最美的時段；天黑後夜市攤位出沒，販售手工藝品與各式小食，呈現截然不同的熱鬧夜晚景象。'
  },
  'Bora': {
    nameEN: 'Bora Ombak Bar & Restaurant',
    intro: '峇都丁宜沙灘邊的知名沙灘酒吧，戶外座位直面海景，可聽海浪聲用餐。氛圍輕鬆隨性（chill out），供應西式輕食與各式雞尾酒，是日落後放鬆身心的絕佳場所，夜間燭光搖曳格外浪漫。'
  },
  'The': {
    nameEN: 'The Ship Restaurant (Batu Ferringhi)',
    intro: '檳城老牌西餐廳，以巨型木製帆船外觀聞名，是峇都丁宜沙灘的地標性建築之一。供應牛排、海鮮與各式西式料理，環境寬敞、氣氛復古，曾是許多本地人慶祝紀念日的首選。'
  },
  "Andrew's": {
    nameEN: "Andrew's Kitchen",
    intro: '隱藏在峇都丁宜街邊的平價在地餐廳，以正宗馬來風味料理著稱，包括椰奶燉牛肉（Rendang）、沙爹串燒與各式馬來咖哩，份量大且價格親民，是遊客口耳相傳的隱藏版好去處。'
  },
  '興巴士藝文倉庫': {
    nameEN: 'Hin Bus Depot Art Centre',
    intro: '由廢棄公車停車場改建而成的文創藝術空間，保留工業感的高挑鋼架屋頂，內外牆面佈滿國際知名街頭藝術家的巨幅壁畫。現為文創市集、藝術展覽、獨立咖啡廳與精釀酒吧的複合場所，週末有市集與現場音樂，是喬治市最具活力的文青聚集地。'
  },
  'Auntie': {
    nameEN: "Auntie Gaik Lean's Old House (Michelin 1-Star)",
    intro: '米其林一星娘惹菜餐廳，主廚 Gaik Lean 以傳承自外婆的家傳秘方烹製土生華人（Peranakan）料理，包括娘惹叻沙、豬蹄醋（Pig Trotter Vinegar）與各式娘惹糕點，風味正宗且精緻。餐廳設於老式店屋中，每日食材限量，建議提早訂位。'
  },
  'Kimberley Lane 漫遊': {
    nameEN: 'Kimberley Street Heritage Walk',
    intro: '金邊里（Kimberley Street）是喬治市夜晚最熱鬧的美食與文化街道之一，一端是著名的牛干冬宵夜攤群，另一端延伸至老廟宇與彩繪牆弄。傍晚散步其中，可以同時感受老居民的日常、攤販的煙火氣與藝術塗鴉的創意，是喬治市夜遊的精華路線。'
  },
  '愛情巷': {
    nameEN: 'Love Lane',
    intro: '喬治市老城的一條短窄小巷，相傳得名於英殖民官員藏匿情人之所。現為背包客文化與夜生活的中心，兩旁特色酒吧、青年旅舍與小館林立，牆壁佈滿各國旅客留下的塗鴉與藝術創作。夜幕後人聲鼎沸，是感受喬治市年輕自由氣息的最佳去處。'
  },
  '檳島市政廳（碼頭）': {
    nameEN: 'Penang City Hall & Fort Cornwallis Waterfront',
    intro: '1786 年英國船長 Francis Light 在此登陸，建立了馬來亞第一個英國殖民地。康沃利斯堡（Fort Cornwallis）是當時建造的城堡，為全馬保存最完整的英式星形城堡。旁邊的市政廳（City Hall，1903 年）與市議會（Town Hall，1880 年）以白色新古典主義風格屹立海濱，是殖民地遺產的最佳見證。傍晚散步至海濱廣場（Esplanade），可見本地居民乘涼、馬來夜市不定期舉行，充滿在地生活氣息。'
  },
  'Gurney Plaza': {
    nameEN: 'Gurney Plaza Shopping Mall',
    intro: '關仔角（Gurney Drive）旁的大型購物商場，是檳城購物與娛樂的重要地標，設有百貨、超市、電影院與各式餐廳。緊鄰海濱小食中心，逛街與吃小吃可一次完成，是下午消暑購物的熱門去處。'
  },

  // ── 檳城：文青選物 ──────────────────────────────────────────
  '遺產貓': {
    nameEN: 'The Heritage Cat',
    address: '60 Lebuh Acheh (亞齊街), George Town',
    intro: '以檳城街貓為主題的特色選物店，位於喬治市最古老的街道之一亞齊街，周遭環繞著世界文化遺產建築群。店內販售手工陶瓷、插畫明信片、T 恤等貓咪相關商品，是喬治市最具辨識度的在地創意品牌之一，也是愛貓旅人的朝聖地。',
    mapsUrl: 'https://maps.google.com/?q=The+Heritage+Cat+60+Lebuh+Acheh+Penang'
  },
  '本土幻想': {
    nameEN: 'Local Fantasy',
    address: 'George Town, Penang',
    intro: '以馬來西亞在地文化為靈感的文創選物店，主打本土設計師的插畫、文具、布製品與生活小物，每件商品都承載著對這片土地的詮釋與想像。比起量產觀光紀念品，這裡更像是讓旅人真正帶走「一片馬來西亞」的地方，是喬治市新生代設計力量的縮影。',
    mapsUrl: 'https://maps.google.com/?q=Local+Fantasy+George+Town+Penang'
  },
  '第六感': {
    nameEN: 'Sixth Sense Stores',
    address: '157 Lebuh Pantai (Beach Street), George Town',
    intro: '喬治市最具代表性的生活風格概念店，由本地設計師創立，以「低調而永恆的美學」為核心，販售精選服飾、家居器皿、Aesop 護膚品與質感選書。旗下 Warehouse 129 更定期舉辦文化講座、工作坊及藝術展覽，是喬治市文青社群的重要聚集據點。',
    mapsUrl: 'https://maps.google.com/?q=Sixth+Sense+157+Lebuh+Pantai+Penang'
  },
  '檳城之好': {
    nameEN: 'Penang Good',
    address: 'George Town, Penang',
    intro: '以「展示檳城最美好的一切」為理念的策展型選物店，從在地手工食品、特色醬料、設計文具到創意伴手禮，每樣商品都經嚴選，代表著檳城最值得帶走的那一份好。對想一次打包最道地紀念品的旅人而言，這裡是最有誠意的選擇。',
    mapsUrl: 'https://maps.google.com/?q=Penang+Good+George+Town'
  },
  '潮人居': {
    nameEN: 'Jetty 35 — 潮人居 Life & Arts Space',
    address: '35 Jalan Pengkalan Weld, George Town',
    intro: '潮人居位於檳城海墘碼頭一帶，是集藝廊、文創攤位、咖啡廳與本地藝術品販售於一體的複合式文化空間。老建築的歷史肌理在這裡與新生代創作者的活力交融，不定期舉辦小型展覽與創意活動，是了解當代檳城創意文化最生動的窗口之一。',
    mapsUrl: 'https://maps.google.com/?q=Jetty+35+Jalan+Pengkalan+Weld+Penang'
  },
  '義香餅店': {
    nameEN: 'Ghee Hiang (義香)',
    address: '216 Jalan Macalister, George Town',
    intro: '義香創立於 1856 年，是馬來西亞歷史逾 165 年的傳奇老字號，以手工淡汶餅（Tambun Piah，豆沙酥餅）及純正麻油馳名全馬。餡料以綠豆沙精製，餅皮酥脆化口，配方百年不變，是許多檳城人心目中無可取代的家鄉味，也是最具歷史分量的在地伴手禮。',
    mapsUrl: 'https://maps.google.com/?q=Ghee+Hiang+216+Jalan+Macalister+Penang'
  },
  '萬香餅家': {
    nameEN: 'Ban Heang (萬香餅家)',
    address: '200 Jalan Macalister, George Town',
    intro: '萬香是檳城第一家研發多口味淡汶餅的創新餅家，除傳統豆沙外，更研發出橙味、香草、咖啡、蝦米等多種獨家口味，打破老字號的框架。從家庭式小作坊成長至在機場與商場設立分店，但老舖現烤的焦香氣息依舊令人沉醉，招牌鹹切酥也廣受好評。',
    mapsUrl: 'https://maps.google.com/?q=Ban+Heang+200+Jalan+Macalister+Penang'
  },
  '景香餅家': {
    nameEN: 'Kheng Heang Pastry (景香餅家)',
    address: 'George Town, Penang',
    intro: '景香與義香、萬香並稱檳城三大傳統餅家，以招牌手工豆沙酥餅（Tambun Piah）為核心，餅皮以豬油起酥，層次分明、入口即化，口感在三家中各有千秋。延續數十年的傳統配方與製法，讓每一口都充滿古早味，是許多老檳城人記憶深處難以取代的家鄉滋味。',
    mapsUrl: 'https://maps.google.com/?q=Kheng+Heang+Pastry+Penang'
  },

  // ── 檳城：休閒漫旅 ──────────────────────────────────────────
  '興公司': {
    nameEN: 'Hin Bus Depot Art Centre',
    address: '31A Jalan Gurdwara, George Town',
    intro: '興公司前身是建於 1947 年、Art Deco 風格的藍巴士車廠（Blue Bus Company），廢棄後於 2014 年活化為藝術文化基地，並由立陶宛街頭藝術家 Ernest Zacharevic 在此舉辦首個個展，揭開新生命的序幕。如今園區設有展覽空間、戶外表演台與多間咖啡館，定期舉辦音樂演出、市集與工作坊，是喬治市最具活力的創意聚落。',
    mapsUrl: 'https://maps.google.com/?q=Hin+Bus+Depot+31A+Jalan+Gurdwara+Penang'
  },
  '丹絨武雅隱藏海灘': {
    nameEN: 'Hidden Beach, Tanjung Bungah',
    address: 'Tanjung Bungah, Penang',
    intro: '丹絨武雅（Tanjung Bungah，意為「花角」）位於喬治市與峇都丁宜之間，這片隱藏小海灘鮮少出現在主流旅遊指南，需循著岩石小徑才能抵達。日落時從礁岩高點俯瞰海面的橙紅晚霞，被公認為檳城北海岸最美的落日視角之一，清幽環境讓人暫時脫離觀光人潮，是在地人私藏的秘境。',
    mapsUrl: 'https://maps.google.com/?q=Hidden+Beach+Tanjung+Bungah+Penang'
  },

  // ── 檳城：古蹟建築 ──────────────────────────────────────────
  '龍山堂邱公司': {
    nameEN: 'Leong San Tong Khoo Kongsi',
    address: '18 Cannon Square, George Town',
    intro: '現存建築完成於 1906 年（原建於 1901 年因火災重建），龍山堂是馬來西亞規模最大、裝飾最精緻的華人宗族祠堂，由來自福建廈門海滄的邱氏族人所建。宗祠融合宮殿式屋脊、精雕石獅、鎏金磚雕與彩繪壁畫，傳說最初規格過於宏偉、僭越皇室，天降雷擊迫使降規重建。至今仍是活躍的宗族組織，為 UNESCO 喬治市世界文化遺產的重要組成。',
    mapsUrl: 'https://maps.google.com/?q=Khoo+Kongsi+18+Cannon+Square+Penang'
  },
  '孫中山紀念館': {
    nameEN: 'Sun Yat-Sen Museum Penang',
    address: '120 Lebuh Armenian (亞美尼亞街), George Town',
    intro: '這棟建於 1880 年的百年老店屋見證了中國近代革命史上的關鍵時刻——1910 年孫中山先生在此設立中國同盟會南洋總部，同年策劃第二次廣州起義並為其籌款，《光華日報》亦於同年在此創刊。館內以「孫中山在檳城」為主題設有常設展覽，透過史料、文物與互動裝置，重現南洋華僑支持革命的動人歷史。',
    mapsUrl: 'https://maps.google.com/?q=Sun+Yat+Sen+Museum+120+Armenian+Street+Penang'
  },
  '世德堂謝公司': {
    nameEN: 'Seh Tek Tong Cheah Kongsi',
    address: '8 Lebuh Armenian (亞美尼亞街), George Town',
    intro: '世德堂謝公司由謝氏族人於 1810 年代創立，是喬治市五大宗族祠堂之一，也是現存最古老的宗族會館之一，用地早在 1828 年即已購置。與龍山堂的金碧輝煌相比，謝公司風格更為典雅素淨，保留了清代閩南建築特色，2015 年整修後煥然一新，彩繪壁畫、精雕木屏風與傳統器物完整呈現早期移民的精神信仰。',
    mapsUrl: 'https://maps.google.com/?q=Cheah+Kongsi+8+Lebuh+Armenian+Penang'
  },
  '七間茶室': {
    nameEN: 'Seven Terraces',
    address: '8 Stewart Lane, George Town',
    intro: '史都華巷上七棟 19 世紀末聯排店屋，由甲必丹曹仁貴家族開發，是喬治市早期高級住宅建築的典範，後由酒店業者 Chris Ong 精心修復成精品旅館。室內陳設融合娘惹古董傢俱、手繪花磚與英式彩色玻璃，獲 UNESCO 亞太文化遺產保護獎。即使不住宿，庭院咖啡廳同樣對外開放，是老城最具貴族氛圍的下午茶場所。',
    mapsUrl: 'https://maps.google.com/?q=Seven+Terraces+8+Stewart+Lane+Penang'
  },
  '康華麗斯堡': {
    nameEN: 'Fort Cornwallis',
    address: 'Jalan Tun Syed Sheh Barakbah, George Town',
    intro: '1786 年英國船長法蘭西斯·萊特登陸檳城後以木樁築起最初的堡壘，1810 年改建為磚造星形城堡，是馬來西亞現存最大的砲台要塞。城堡以印度總督康華麗斯侯爵命名，諷刺的是，它從建成至今從未真正開炮抵禦外敵。堡內著名的「斯里蘭拜砲」相傳具有保佑求子的靈力，吸引已婚婦女前來插花祈禱，是探索檳城開埠歷史的重要起點。',
    mapsUrl: 'https://maps.google.com/?q=Fort+Cornwallis+Penang'
  },
  '一條路頂樓': {
    nameEN: 'Sphere Rooftop Bar (Wow Hotel)',
    address: '406 Jalan Penang (一條路), George Town',
    intro: '「一條路」是檳城人對 Jalan Penang（檳城路）的暱稱，Wow Hotel 頂層的 Sphere 露天酒吧提供了難得的城市鳥瞰制高點，可俯瞰喬治市 UNESCO 世遺老城的低矮瓦屋屋頂與教堂尖塔。夕陽西沉時橙紅晚霞映照百年殖民地建築，是白天走訪古蹟後、傍晚放鬆欣賞城市輪廓的理想角落。',
    mapsUrl: 'https://maps.google.com/?q=Sphere+Rooftop+Bar+406+Jalan+Penang'
  },

  // ── 檳城：美食品味 ──────────────────────────────────────────
  '大路後著名魚頭米粉': {
    nameEN: 'Famous Fish Head Bee Hoon, Jalan Dato Keramat',
    address: 'Jalan Dato Keramat (大路後), George Town',
    intro: '大路後（Jalan Dato Keramat）是檳城在地人私藏的美食聚落，這攤魚頭米粉以新鮮魚頭熬製乳白濃湯見稱——魚骨與薑片大火翻炒後小火慢燉數小時，湯頭才能達到奶白醇厚的境界。搭配嫩滑米粉、豆腐與青蔬，鮮甜不腥，是本地街坊每天報到的療癒早午餐。',
    mapsUrl: 'https://maps.google.com/?q=fish+head+bee+hoon+Jalan+Dato+Keramat+Penang'
  },
  '曼谷巷印度炒麵': {
    nameEN: 'Bangkok Lane Mee Goreng (Now at New World Park)',
    address: 'New World Park Food City, Jalan Burma (緬甸路), George Town',
    intro: '傳承自 1941 年的穆斯林炒麵老攤，父子兩代以大火鑊氣翻炒粗黃麵，加入馬鈴薯、豆腐、雞蛋與特製辣醬，鑊氣十足、香辣帶甜，被美食評論公認為全馬最佳印度炒麵之一。注意：原攤已從曼谷巷遷至緬甸路新世界美食城，勿前往舊址。',
    mapsUrl: 'https://maps.google.com/?q=Bangkok+Lane+Mee+Goreng+New+World+Park+Penang'
  },
  '七條路巴剎 (下午茶)': {
    nameEN: 'Kimberley Street (七條路) Afternoon Snacks',
    address: 'Lebuh Kimberley (七條路), George Town',
    intro: '每天下午起，牛干冬（Kimberley Street）一帶攤販陸續出現，五顏六色的傳統糕點——班蘭煎餅（Apom Balik）、娘惹糕（Nyonya Kueh）與各式糖水堆滿檔口，是道地檳城人的日常下午茶儀式。入夜後更化身為熱鬧夜市，炒粿條、蠔煎等名攤獲米其林必比登推薦，白天與夜晚各有精彩。',
    mapsUrl: 'https://maps.google.com/?q=Kimberley+Street+George+Town+Penang'
  },
  '金龍大路後炸香蕉': {
    nameEN: 'Golden Dragon Fried Banana, Dato Keramat',
    address: 'Jalan Dato Keramat (大路後), George Town',
    intro: '大路後街邊的炸香蕉名攤，以外皮薄脆金黃、內餡香甜軟糯的炸大蕉（Pisang Goreng）聞名全檳，每逢出攤便大排長龍，往往午後便已售罄。炸漿以麵粉、米粉與椰漿特調，炸出的外衣入口即碎、蕉肉焦糖香氣四溢，是大路後美食聚落中絕對不能錯過的下午點心。',
    mapsUrl: 'https://maps.google.com/?q=fried+banana+Jalan+Dato+Keramat+Penang'
  },
  'Narrow Marrow': {
    nameEN: 'Narrow Marrow',
    address: '312 Lebuh Pantai (Beach Street), George Town',
    intro: '由本地藝術家 Alvin 與 Jamie 於 2014 年創立，從一個讓創意朋友聚會的小空間，逐漸成為喬治市文青圈最知名的咖啡甜點小館。招牌 Espresso Kahlua Tiramisu、椰糖鹹焦糖烤乾酪蛋糕皆融入在地食材風味，店內定期舉辦藝術展覽、現場音樂與詩歌朗誦，是感受喬治市當代創意氛圍的必訪空間。',
    mapsUrl: 'https://maps.google.com/?q=Narrow+Marrow+312+Lebuh+Pantai+Penang'
  },

  // ── 怡保 ──────────────────────────────────────────────────
  '霹靂洞': {
    nameEN: 'Gua Perak / Perak Cave Temple',
    intro: '怡保南部著名的石灰岩洞佛廟，洞內供奉逾 40 尊大小佛像，鐘乳石與石筍在香火燈光映照下呈現神秘氛圍。洞口有一座三層樓高的老虎雕像，頗具特色。洞後設有登山步道，可俯瞰怡保城市景色，是探索怡保石灰岩地形的好起點。'
  },
  '老黃/安記芽菜雞': {
    nameEN: 'Lou Wong / Onn Kee Bean Sprout Chicken (Nga Choy Kai)',
    intro: '怡保芽菜雞（Nga Choy Kai）是全馬最受推崇的在地美食之一，關鍵在於怡保特有的甘甜地下水——豆芽因此水分飽滿脆嫩，雞肉油滑鮮嫩得恰到好處。老黃（Lou Wong）與安記（Onn Kee）兩家名店相距不到百米，數十年來食客爭論不休各有擁護，建議各點一份親自評判。通常搭配白飯與怡保白咖啡，是此行不可錯過的組合。'
  },
  '南香白咖啡（must 外帶）': {
    nameEN: 'Nam Heong White Coffee (Must Take Away)',
    intro: '白咖啡（White Coffee）由怡保發明，以低溫烘焙咖啡豆加淡奶和糖調製，口感甘醇少苦澀。南香（Nam Heong）創立於 1952 年，是怡保最古老的白咖啡店之一，蛋塔（Dan Tat）外皮酥脆、內餡嫩滑，與白咖啡是絕配，建議外帶一杯在路上慢慢喝。'
  },
  '天津茶室燉蛋（must 外帶）': {
    nameEN: 'Thean Chun Kopitiam – Steamed Egg Custard & Chicken Noodle',
    intro: '天津茶室（Thean Chun）的焦糖燉蛋（Custard Egg）是怡保代表性甜品，以新鮮雞蛋、牛奶與糖慢火蒸製，表面呈琥珀焦糖色，口感如布丁般細滑，甜而不膩。招牌雞絲河粉（Kai Si Hor Fun）以清雞湯搭配手撕嫩雞絲，湯底清鮮，是怡保早餐的另一代表。人氣極旺，可能需等候。'
  }
};

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
