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
    address: 'Lebuh Armenian, George Town',
    intro: '以檳城街貓為主題的特色選物店，將喬治市街頭隨處可見的流浪貓形象化作插畫、手作商品與明信片，成為喬治市最具辨識度的在地品牌之一。店內商品融合傳統南洋美學與現代插畫風格，是尋找有溫度的在地紀念品的必訪之地。',
    mapsUrl: 'https://maps.google.com/?q=The+Heritage+Cat+George+Town+Penang'
  },
  '本土幻想': {
    nameEN: 'Local Dream',
    address: 'George Town, Penang',
    intro: '以馬來西亞在地文化為靈感的創意選物店，販售本土設計師設計的文具、布袋、服飾與生活器物，每件商品都承載著對這片土地的詮釋與想像。比起量產的觀光紀念品，這裡更像是一個讓旅人真正帶走「一片馬來西亞」的地方。',
    mapsUrl: 'https://maps.google.com/?q=Local+Dream+George+Town+Penang'
  },
  '第六感': {
    nameEN: 'Sixth Sense',
    address: 'George Town, Penang',
    intro: '藏身喬治市老街的生活風格選品店，集結本地設計師作品，涵蓋家居小物、陶瓷器皿、文創印刷品與服飾配件。店內選品強調在地製造與手工質感，是喬治市設計創作力的縮影，也是淘出獨一無二紀念品的好地方。',
    mapsUrl: 'https://maps.google.com/?q=Sixth+Sense+George+Town+Penang'
  },
  '檳城之好': {
    nameEN: 'Penang Good',
    address: 'George Town, Penang',
    intro: '以「展示最好的檳城」為理念的策展型選物店，從手工食品、在地醬料、特色零食到設計文具，每樣商品都經嚴選，代表著檳城最值得帶走的那一份好。對想一次打包最道地伴手禮的旅人而言，這裡是最省力也最有誠意的選擇。',
    mapsUrl: 'https://maps.google.com/?q=Penang+Good+George+Town'
  },
  '潮人居': {
    nameEN: 'Chaoren Ju / Trendy Studio',
    address: 'George Town, Penang',
    intro: '結合娘惹復古美學與現代潮流設計的生活選物空間，販售印有喬治市街景、老招牌與多元文化元素的服飾、帆布包與印刷品。走進店裡，彷彿看見檳城老靈魂穿上了新衣裳，散發出獨特的南洋文青氣息。',
    mapsUrl: 'https://maps.google.com/?q=潮人居+George+Town+Penang'
  },
  '義香餅店': {
    nameEN: 'Yi Xiang Pastry',
    address: 'George Town, Penang',
    intro: '傳承多年的老字號廣式糕餅店，以手工製作的旺來酥（鳳梨酥）、老婆餅與各式傳統月餅著稱，餅皮酥脆、內餡紮實，是許多在地人回鄉必買的懷念滋味。每逢節慶前排隊人潮絡繹不絕，是了解南洋華人飲食文化的最佳窗口之一。',
    mapsUrl: 'https://maps.google.com/?q=義香餅店+George+Town+Penang'
  },
  '萬香餅家': {
    nameEN: 'Wan Heong Pastry',
    address: 'George Town, Penang',
    intro: '喬治市人氣極高的傳統餅家，以手工雞蛋卷（Heong Peng）與各式酥餅聞名，堅持以炭火慢烤，成就外層焦脆、蛋香四溢的獨特口感。超過數十年的老店資歷，讓它成為許多檳城人記憶中不可替代的味道，也是外地旅客採購手信的熱門首選。',
    mapsUrl: 'https://maps.google.com/?q=Wan+Heong+Biscuit+George+Town+Penang'
  },
  '景香餅家': {
    nameEN: 'Keng Heong Pastry',
    address: 'Lebuh Cintra, George Town, Penang',
    intro: '喬治市百年歷史的傳統餅店，以招牌香餅（Heong Peng）聞名，這種圓形酥餅以麥芽糖、芝麻與蔥油為餡，外皮薄如紙張、入口即化。「Heong」在閩南語意指「香」，恰如其分地形容了這款烤出來香氣撲鼻的老式糕餅，是喬治市最具代表性的在地零食之一。',
    mapsUrl: 'https://maps.google.com/?q=Keng+Heong+Biscuit+Penang'
  },

  // ── 檳城：休閒漫旅 ──────────────────────────────────────────
  '興公司': {
    nameEN: 'Hin Company (Hin Bus Depot Area)',
    address: 'Jalan Gurdwara, George Town, Penang',
    intro: '由廢棄公車總站活化再生的複合式文創空間，保留了工業感的高挑鋼架頂棚，內外牆面佈滿本地與國際藝術家的大型壁畫。平日有創意市集、藝廊展覽與獨立咖啡廳進駐，週末更有現場音樂與手作市場，是喬治市年輕創意能量最集中的地方。',
    mapsUrl: 'https://maps.google.com/?q=Hin+Bus+Depot+Penang'
  },
  '丹絨武雅隱藏海灘': {
    nameEN: 'Hidden Beach, Tanjung Bungah',
    address: 'Tanjung Bungah, Penang',
    intro: '丹絨武雅（Tanjung Bungah，意為「花角」）位於喬治市與峇都丁宜之間，這處隱藏小海灘鮮少出現在觀光地圖上，需循著小徑才能抵達。比起熱鬧的峇都丁宜，這裡安靜清幽、少有遊客，礁石遍布的小海灣在退潮時尤其迷人，是在地人私藏的半日遠離塵囂之所。',
    mapsUrl: 'https://maps.google.com/?q=Hidden+Beach+Tanjung+Bungah+Penang'
  },

  // ── 檳城：古蹟建築 ──────────────────────────────────────────
  '龍山堂邱公司': {
    nameEN: 'Khoo Kongsi Clan House',
    address: '18 Cannon Square, George Town, Penang',
    intro: '建於 1906 年的龍山堂，是東南亞規模最宏偉、裝飾最精緻的華人宗祠，由從福建遷移而來的邱氏家族歷代積累財富所建。宗祠外牆遍佈精雕石獅、鎏金磚雕與彩繪屋脊，正殿之富麗堪稱「皇宮級」，曾因規格過高而傳說遭天雷擊毀、迫使降規重建。現已列入 UNESCO 喬治市世界文化遺產範圍，至今仍是活躍的宗族組織，定期舉行祭祀儀式。',
    mapsUrl: 'https://maps.google.com/?q=Khoo+Kongsi+Penang'
  },
  '孫中山紀念館': {
    nameEN: 'Dr. Sun Yat-Sen Museum Penang',
    address: '120 Armenian Street, George Town, Penang',
    intro: '檳城是孫中山先生革命生涯中的重要基地，1910 年廣州起義（黃花崗之役的前身）即在此祕密策劃。這棟保存完好的老式店屋見證了孫中山多次來檳募款、聯絡同志的歷史，館內陳列珍貴照片、文件與當年的革命史料，深刻呈現南洋華僑對中國近代革命的重要貢獻。',
    mapsUrl: 'https://maps.google.com/?q=Sun+Yat+Sen+Museum+Penang'
  },
  '世德堂謝公司': {
    nameEN: 'Cheah Kongsi Clan House',
    address: '8 Lebuh Armenian, George Town, Penang',
    intro: '創立於 1820 年的謝氏宗祠，是檳城歷史最悠久的宗祠之一，供奉謝、楊、柯等姓氏先祖，族人皆源自福建漳州五大姓。與龍山堂的金碧輝煌相比，世德堂氣質更為沉靜典雅，精雕木屏風、傳統彩燈與木刻牌匾共同構成一個仍在運作的宗族生活空間，是喬治市保存最完整的宗祠文化縮影之一。',
    mapsUrl: 'https://maps.google.com/?q=Cheah+Kongsi+Penang'
  },
  '七間茶室': {
    nameEN: 'Seven Terraces Heritage Hotel',
    address: '14 Stewart Lane, George Town, Penang',
    intro: '由七棟相連的 19 世紀英荷式店屋精心修復而成的精品文物旅館，出自修復藍屋（張弼士故居）的同一位建築師之手，細節一絲不苟。室內陳設融合娘惹風格彩色瓷磚、古董柚木家具與英國維多利亞式彩色玻璃，打造出一個活生生的南洋歷史場景。即使不過夜，其庭院咖啡廳與走廊同樣對外開放，是喬治市最具氛圍的下午茶場所之一。',
    mapsUrl: 'https://maps.google.com/?q=Seven+Terraces+Penang'
  },
  '康華麗斯堡': {
    nameEN: 'Fort Cornwallis',
    address: 'Lebuh Light, George Town, Penang',
    intro: '1786 年英國船長法蘭西斯·萊特（Francis Light）登陸檳城後，在此興建最初的木造堡壘，1810 年改建為磚造星形城堡，是馬來西亞保存最完整的英式棱堡。堡內著名的「斯里蘭拜砲」（Seri Rambai）相傳具有保佑求子的靈驗，吸引無數已婚婦女前來插花祈禱。城堡四面環繞白色廊道，臨海側可眺望檳城海峽，是了解英殖民初期歷史的必訪之地。',
    mapsUrl: 'https://maps.google.com/?q=Fort+Cornwallis+Penang'
  },
  '一條路頂樓': {
    nameEN: 'Rooftop Bar at Penang Road',
    address: 'Lebuh Penang, George Town, Penang',
    intro: '位於檳城路（Lebuh Penang）建築頂層的露天酒吧，是俯瞰喬治市 UNESCO 世界遺產老城低矮屋頂的絕佳制高點。夕陽西沉時，百年殖民地建築的瓦頂與尖塔在橙紅晚霞中輪廓鮮明，視覺震撼令人難忘。提供精釀調酒與輕食，是白天走訪古蹟後，傍晚放鬆俯瞰這座城市最美一面的理想場所。',
    mapsUrl: 'https://maps.google.com/?q=rooftop+bar+Penang+Road+George+Town'
  },

  // ── 檳城：美食品味 ──────────────────────────────────────────
  '大路後著名魚頭米粉': {
    nameEN: 'Famous Fish Head Bee Hoon, Dato Keramat',
    address: 'Jalan Dato Keramat, George Town, Penang',
    intro: '檳城著名的魚頭米粉老攤，以新鮮鯛魚頭熬製乳白濃湯見稱——魚骨與薑片大火翻炒、小火慢燉數小時，湯頭才能達到奶白醇厚的境界。上桌時配上嫩滑魚片、豆腐、蔬菜與細滑米粉，口感鮮甜清爽，是本地人午餐必點的一道療癒美食。',
    mapsUrl: 'https://maps.google.com/?q=fish+head+bee+hoon+Dato+Keramat+Penang'
  },
  '曼谷巷印度炒麵': {
    nameEN: 'Bangkok Lane Mee Goreng',
    address: 'Lorong Bangkok, George Town, Penang',
    intro: '曼谷巷（Lorong Bangkok）的印度炒麵是檳城美食界的傳奇之一，攤主以大火鑊氣翻炒粗黃麵，加入番茄醬、辣椒醬、蝦膏與新鮮蝦仁，再覆上半熟蛋與豆芽，形成層次豐富的醬香與微辣口感。這種 Mamak 風格炒麵在檳城有其獨特的做法，與吉隆坡版本截然不同，被許多美食評論推選為全馬最佳印度炒麵。',
    mapsUrl: 'https://maps.google.com/?q=Bangkok+Lane+Mee+Goreng+Penang'
  },
  '七條路巴剎 (下午茶)': {
    nameEN: 'Kimberley Street Pasar (Afternoon Snacks)',
    address: 'Kimberley Street (Lebuh Kimberley), George Town, Penang',
    intro: '每天下午兩點開始，牛干冬（Kimberley Street）一帶的街邊攤位便陸續擺出五顏六色的傳統糕點：班蘭煎餅（Apom Balik）、釀豆腐（Yong Tau Foo）、娘惹糕（Nyonya Kueh）與各式糖水，是道地檳城人的日常下午茶儀式。比起遊客雲集的觀光小食攤，這裡的價格更親民、氣氛更真實，是感受老城慢活節奏最自然的方式。',
    mapsUrl: 'https://maps.google.com/?q=Kimberley+Street+Market+Penang'
  },
  '金龍大路後炸香蕉': {
    nameEN: 'Golden Dragon Fried Banana, Dato Keramat',
    address: 'Jalan Dato Keramat, George Town, Penang',
    intro: '大路後路邊的炸香蕉攤位，以外皮酥脆金黃、內餡香甜軟糯的炸大蕉（Pisang Goreng）聞名全檳，每逢出攤便吸引長龍排隊，往往不到午後便已售罄。炸漿以麵粉、米粉與椰漿調配，炸出來的外衣薄而酥脆，咬開後是烤焦糖香氣四溢的熱軟蕉肉，是路過絕對不能錯過的午後點心。',
    mapsUrl: 'https://maps.google.com/?q=fried+banana+Dato+Keramat+Penang'
  },
  'Narrow Marrow': {
    nameEN: 'Narrow Marrow',
    address: 'George Town, Penang',
    intro: '藏身喬治市老街區的現代創意小館，以融合馬來西亞多元飲食文化為靈魂——馬來香料、娘惹技法、華人食材與西式料理手法在這裡交織出獨特的菜單。空間保留了老店屋的細長格局與磨石子地板，搭配精心設計的用餐環境，是喬治市新生代飲食創作力的代表，也是尋找「不一樣的檳城味道」的必訪餐廳。',
    mapsUrl: 'https://maps.google.com/?q=Narrow+Marrow+Penang'
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
