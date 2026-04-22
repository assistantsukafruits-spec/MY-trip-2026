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
    renderKnowMore();
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

  // "其他景點" tab at the end
  const placesTab = document.createElement('button');
  placesTab.className = 'day-tab places-tab';
  placesTab.textContent = '📍 其他景點';
  placesTab.addEventListener('click', () => {
    state.activeDay = -1;
    document.querySelectorAll('.day-tab').forEach(b => b.classList.remove('active'));
    placesTab.classList.add('active');
    renderItineraryPlaces(wrapEl);
  });
  tabsEl.appendChild(placesTab);

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

function renderItineraryPlaces(container) {
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'day-header';
  header.innerHTML = `
    <div class="day-header-badge">景點</div>
    <div class="day-header-title">其他景點</div>`;
  container.appendChild(header);

  const searchWrap = document.createElement('div');
  searchWrap.className = 'itin-places-search';
  searchWrap.innerHTML = `<input type="text" id="itin-place-search" placeholder="搜尋景點…" autocomplete="off">`;
  container.appendChild(searchWrap);

  const grid = document.createElement('div');
  grid.className = 'cards-grid itin-places-grid';
  container.appendChild(grid);

  function renderGrid(filter) {
    grid.innerHTML = '';
    const q = (filter || '').trim().toLowerCase();
    Object.entries(state.places).forEach(([key, p]) => {
      if (p.category !== 'optional') return;
      if (q) {
        const hay = `${p.name}${p.intro || ''}${p.tag || ''}`.toLowerCase();
        if (!hay.includes(q)) return;
      }
      grid.appendChild(createPlaceCard({ key, ...p }));
    });
  }

  renderGrid('');
  const inp = searchWrap.querySelector('#itin-place-search');
  if (inp) inp.addEventListener('input', e => renderGrid(e.target.value));
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
// 知多點 — Static Cultural Guide Data
// ============================================================
const KNOW_MORE_DATA = {
  sections: [
    {
      id: 'city',
      icon: '🏙️',
      title: '城市簡介',
      color: 'teal',
      cards: [
        {
          type: 'story',
          title: '吉隆坡',
          nameEN: 'Kuala Lumpur',
          icon: '🏙️',
          body: '「Kuala」是河口，「Lumpur」是泥濘——**吉隆坡，就是「泥濘的河口」**。1857 年，廣東礦工沿河溯入，在鞏河與鵝麥河交匯處登岸開採錫礦，什麼都沒有，只有雨林和泥。\n\n葉亞來（Yap Ah Loy）在多次內戰與大火後重建聚落，奠定城市雛形。英殖民時期，吉隆坡成為馬來聯邦首都，鐵路、礦業、行政機構陸續進駐，城市才真正成形。\n\n今天的吉隆坡是一座充滿層次的城市：茨廠街是廣東移民後代的根，百年老店與粵語叫賣聲從未改變；小印度（Brickfields）是南印度移民的聚落；布吉免登（Bukit Bintang）是購物與夜生活核心；雙峰塔（KLCC）周邊是現代金融中心，也是馬來西亞向世界宣示自己的地標。摩天大樓與廟宇並排，是 KL 獨有的城市景觀。'
        },
        {
          type: 'story',
          title: '檳城',
          nameEN: 'Pulau Pinang',
          icon: '🌴',
          body: '馬來語全名 **Pulau Pinang**——「Pulau」是島，「Pinang」是檳榔樹，島上曾長滿而得名。1786 年，英國東印度公司的法蘭西斯・萊特（Francis Light）取得島嶼，建立喬治市，宣告自由貿易港開張——不收稅、誰都能來。\n\n人潮湧至：閩南商人、印度穆斯林、阿拉伯商人全都落腳。閩南人（主要來自泉州、漳州）數量最多，語言、廟宇、飲食逐漸成為喬治市華人社群的主體。今天走在亞美尼亞街，一條街可以同時看到清真寺、興都廟和福建會館——不是刻意規劃的，是兩百年人口流動自然堆疊的結果。\n\n在地華人說的是福建話，「你好」是「Lí hó」。如果你在街上聽到廣東話，對方多半是從 KL 來的遊客。\n\n2008 年，喬治市列入 UNESCO 世界文化遺產。你今天看到的壁畫、姓氏橋、殖民騎樓，都是這段歷史的有形遺留。'
        },
        {
          type: 'highlight',
          tag: '文化深讀',
          title: '峇峇娘惹：在地生根的融合之道',
          icon: '🏮',
          body: '15 世紀起，大批閩南、廣東商人沿著貿易路線落腳馬來半島，與當地馬來女性成婚，後代在兩種文化之間長大，逐漸形成獨特的「峇峇娘惹（Peranakan）」身分認同——男性稱峇峇（Baba），女性稱娘惹（Nyonya）。\n\n他們保留了中文姓氏、祖先崇拜與農曆節慶，卻以馬來語為日常語言，穿著馬來式服飾，並將馬來香料融入中式烹調，創造出獨樹一幟的飲食文化。娘惹的標誌性服飾是鑲蕾絲的 Kebaya 上衣搭配蠟染紗籠（Batik Sarong），極為精緻；傳統婚禮儀式長達 12 天，是文化融合最華麗的表達。他們甚至發展出一種混合閩南語與馬來語的「峇峇馬來語（Baba Malay）」，今天已幾近失傳。',
          ctaText: '📍 檳城娘惹博物館（Pinang Peranakan Mansion），教堂街，喬治市'
        },
        {
          type: 'highlight',
          tag: '歷史連結',
          title: '孫中山與檳城：革命的海外基地',
          icon: '✊',
          body: '孫中山選擇檳城作為南洋革命基地，並非偶然。英殖民管治下的檳城對政治活動管控相對寬鬆；島上閩南、客家富商對中國現代化抱有強烈的情感認同，也有足夠的財力支持革命。\n\n1910 年，孫中山在亞美尼亞街 120 號召開秘密會議，策劃廣州起義（黃花崗之役）並大規模籌款。同一棟建築，《光華日報》也在此時創刊——東南亞最早公開支持革命的華文媒體。這批南洋華僑的捐款，成為 1911 年辛亥革命成功的重要資金來源之一。\n\n對台灣旅客來說，這是教科書裡找不到、卻真實存在的歷史連結。',
          ctaText: '📍 孫中山紀念館（Sun Yat-sen\'s Penang Base），亞美尼亞街 120 號，喬治市'
        }
      ]
    },
    {
      id: 'language',
      icon: '💬',
      title: '馬來文速成',
      color: 'amber',
      intro: '馬來西亞官方語言是馬來語（Bahasa Malaysia），但華人區多數人也說中文。會幾句馬來語，服務立刻不同——當地人會對你多一份親切感。',
      cards: [
        {
          type: 'flashcards',
          groups: [
            {
              groupLabel: '基本禮貌',
              groupColor: 'green',
              words: [
                { malay: 'Terima kasih', chinese: '謝謝',     pronunciation: '得力嗎・卡西', scene: '任何時候道謝都用這句' },
                { malay: 'Sama-sama',    chinese: '不客氣',   pronunciation: '沙嗎・沙嗎',   scene: '對方說謝謝時這樣回' },
                { malay: 'Tolong',       chinese: '請、麻煩', pronunciation: '托龍',          scene: '開口請人幫忙時先說' },
                { malay: 'Maaf',         chinese: '對不起',   pronunciation: '馬阿夫',        scene: '不小心碰到人時說' }
              ]
            },
            {
              groupLabel: '點餐必備',
              groupColor: 'orange',
              words: [
                { malay: 'Kurang manis', chinese: '少糖',     pronunciation: '古浪・馬尼',    scene: '怕甜必說，否則預設超甜' },
                { malay: 'Makan sini',   chinese: '內用',     pronunciation: '馬幹・西尼',    scene: '在店裡吃時說（vs. Bungkus 外帶）' },
                { malay: 'Bungkus',      chinese: '外帶打包', pronunciation: '崩姑',          scene: '不想在店裡吃說這字' },
                { malay: 'Satu lagi',    chinese: '再來一份', pronunciation: '沙都・拉吉',    scene: '太好吃想加點' },
                { malay: 'Sedap',        chinese: '好吃！',   pronunciation: '些搭',          scene: '稱讚食物讓攤販很開心' },
                { malay: 'Air',          chinese: '水',       pronunciation: '阿依',          scene: '注意：不念 air，念阿依' },
                { malay: 'Pedas',        chinese: '辣',       pronunciation: '北搭',          scene: '點餐前確認是否 pedas' }
              ]
            },
            {
              groupLabel: '生活用語',
              groupColor: 'purple',
              words: [
                { malay: 'Boleh',               chinese: '可以、沒問題', pronunciation: '玻勒',             scene: '萬能詞，什麼都能「boleh」' },
                { malay: 'Tak apa / Tidak apa', chinese: '沒關係',       pronunciation: '打阿怕 / 滴搭阿怕', scene: '口語用 tak apa 較自然' },
                { malay: 'Mahal',               chinese: '貴',           pronunciation: '馬哈',             scene: '殺價前說這字老闆就懂' },
                { malay: 'Murah sikit',         chinese: '便宜一點',     pronunciation: '木拉・西基',       scene: '殺價時用，比單說 murah 更實用' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'food',
      icon: '🍜',
      title: '舌尖上的故事',
      color: 'green',
      cards: [
        {
          type: 'story',
          title: '咖啡店／茶餐室文化',
          nameEN: 'Kopitiam',
          icon: '☕',
          body: '「Kopitiam」由馬來語「Kopi」（咖啡）加閩南語「店」（tiam）組成，泛指傳統咖啡店或茶餐室。一杯咖啡、一份烤吐司配半熟蛋，坐上一個早上——這是馬來西亞人幾十年如一日的早晨節奏，也是各族共享的生活空間。點飲料有一套暗語你必須知道：',
          table: [
            { code: 'Kopi',                 desc: '咖啡 + 糖 + 煉乳（預設版）' },
            { code: 'Kopi-O',               desc: '黑咖啡 + 糖，不加奶' },
            { code: 'Kopi-C',               desc: '咖啡 + 淡奶（鮮奶）+ 糖' },
            { code: 'Kopi Peng / Kopi Ais', desc: '加冰（Peng 是閩南語，Ais 是馬來語）' },
            { code: 'Kopi-O Kosong',        desc: '黑咖啡，不加糖不加奶' }
          ],
          tip: 'Teh（紅茶）用法與 Kopi 完全相同。推薦台灣朋友試試 Teh Ais Limau（檸檬冰紅茶），清爽解膩。'
        },
        {
          type: 'story',
          title: '檳城福建蝦麵',
          nameEN: 'Penang Hokkien Mee',
          icon: '🦐',
          body: '早期漁民把賣剩的蝦頭蝦殼和豬骨下鍋熬煮，鮮甜的湯汁出乎意料地濃郁迷人。一碗由「廢料」誕生的美食，搭配各種麵類、豬肉片、蝦子，湯頭鮮甜濃郁，成了 CNN Travel 票選「全球最美味食物」之一。在檳城，清晨五點就有人排隊，為的就是那鍋從不熄火的蝦湯。'
        },
        {
          type: 'story',
          title: '吉隆坡福建麵',
          nameEN: 'KL Hokkien Mee',
          icon: '🍜',
          body: '同樣叫「福建麵」，在吉隆坡端上桌的卻是完全不同的東西——**乾炒版**，大量黑醬油大火翻炒粗黃麵，加豬肉片、魷魚、豬油渣，顏色深黑、鑊氣十足。初次點餐請認清楚：「福建蝦麵」是湯麵，「福建炒麵」是乾炒，兩者根本是兩道菜。'
        },
        {
          type: 'story',
          title: '椰漿飯',
          nameEN: 'Nasi Lemak',
          icon: '🥥',
          body: '「Lemak」在馬來語是「肥美、香濃」——用椰漿和香蘭葉煮出來的米飯，配 Sambal 辣醬、江魚仔、花生、水煮蛋，香蕉葉一包，RM 2 起跳。全馬都吃，各族都愛，是馬來西亞非正式的「國菜」，也是最日常的早晨味道。'
        },
        {
          type: 'story',
          title: '肉骨茶',
          nameEN: 'Bak Kut Teh',
          icon: '🍖',
          body: '閩南語直譯「肉骨茶」。早期碼頭苦力用豬骨加藥材熬湯補身，後來演變成全馬家喻戶曉的名菜。主要兩派：**馬來西亞版**藥材味濃、湯色深香；**新加坡版**以胡椒為主、湯色清亮。配白飯、油條，沾醬油蒜泥，是在地人的週末早餐儀式。'
        },
        {
          type: 'story',
          title: '叻沙',
          nameEN: 'Laksa',
          icon: '🌶️',
          body: '同一個名字，各地版本截然不同。**檳城亞參叻沙**以羅望子魚湯為底，酸辣無椰漿，第一口奇怪、第二口上癮；**咖哩叻沙（Curry Laksa）**用椰漿咖哩湯底，濃郁香辣。點之前記得確認是哪種，兩者是完全不同的宇宙。'
        },
        {
          type: 'story',
          title: '娘惹料理',
          nameEN: 'Nyonya Cuisine',
          icon: '🌿',
          body: '中國移民與馬來人世代通婚後代（峇峇娘惹）的飲食結晶：中式烹調手法，融入馬來香料（香茅、班蘭葉、黃薑）與椰漿，既不純中式、也不純馬來式。代表菜：**亞參魚（Ikan Asam）**，羅望子酸汁燒魚，酸香開胃；**小金杯（Kueh Pie Tee）**，酥脆薄杯填入炒薯絲與蝦，一口一個；**娘惹糕點（Nyonya Kueh）**，班蘭葉染色的彩色糕點，軟糯香甜。'
        },
        {
          type: 'story',
          title: 'Mamak 文化',
          icon: '🌙',
          body: '馬來裔印度穆斯林開設的餐館，24 小時不打烊，全馬遍布。拋餅（Roti Canai）配咖哩、Teh Tarik 在空中高沖出泡沫——凌晨兩點走進任何一家 Mamak，仍然座無虛席。工人看足球直播，大學生趕功課，一家人吃消夜，三大族群都在這裡相遇。這是馬來西亞多元社會最接地氣的縮影。'
        }
      ]
    },
    {
      id: 'culture',
      icon: '🤝',
      title: '尊重在地',
      color: 'purple',
      intro: '馬來西亞是多元文化、多元宗教並存的社會。帶著好奇心與基本尊重，你會得到意想不到的溫暖回應。',
      cards: [
        {
          type: 'tips',
          tips: [
            {
              icon: '🕌',
              title: '參觀清真寺',
              body: '進入前須脫鞋，女性需包頭巾及覆蓋手臂和腿部（清真寺入口通常備有免費借用的袍服）。男性也需著長褲。請勿在祈禱時段進入禮拜大廳，並保持安靜。清真寺是活躍的宗教場所，不是單純的觀光景點。'
            },
            {
              icon: '👍',
              title: '用大拇指指路，不用食指',
              body: '在馬來西亞，用食指直接指向他人或物品被認為不禮貌，帶有指責意味。當地人習慣以右手大拇指（整隻手呈握拳狀，拇指向前）指引方向。你在街頭問路時，留意看——本地人基本上都這樣做。'
            },
            {
              icon: '💵',
              title: '小費文化',
              body: '馬來西亞整體不盛行給小費。高檔餐廳帳單通常已含 10% 服務費與 6% SST 稅，此時不必另外給。普通餐廳、Kopitiam、路邊攤則沒有給小費的習慣。若服務特別好（如行李員、導遊），RM 5–10 是適當的感謝。'
            },
            {
              icon: '🤲',
              title: '接遞物品用右手（或雙手）',
              body: '在馬來及印度文化中，左手被視為不潔，因此遞送物品、付錢、接受食物時，習慣使用右手或雙手。對年長者雙手遞送是最恭敬的方式。'
            },
            {
              icon: '🐄',
              title: '印度人不吃牛肉',
              body: '馬來西亞的印度裔居民多為印度教徒，牛在印度教中是神聖的動物，因此不食用牛肉。在印度餐館用餐，菜單上通常不會出現牛肉。若想吃牛肉，華人餐廳或清真認證（Halal）餐廳都提供。多族群社會裡，了解彼此的飲食禁忌，是最基本的尊重。'
            },
            {
              icon: '🐷',
              title: '在清真餐廳不問豬肉和酒',
              body: 'Mamak 餐廳、馬來餐廳均屬清真（Halal）場所，不提供豬肉及酒精。在這些地方詢問「有沒有豬肉？」是失禮的。若想吃豬肉，去華人 Kopitiam 或非清真中餐館，一眼就能判斷。'
            }
          ]
        }
      ]
    }
  ]
};

// ============================================================
// 知多點 — Renderer
// ============================================================
function renderKnowMore() {
  const wrap = document.getElementById('know-more-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const pageHeader = document.createElement('div');
  pageHeader.className = 'km-page-header';
  pageHeader.innerHTML = `
    <div class="km-page-title">📖 知多點</div>
    <div class="km-page-sub">出發前，先認識這片土地</div>`;
  wrap.appendChild(pageHeader);

  KNOW_MORE_DATA.sections.forEach(section => {
    const sectionEl = document.createElement('div');
    sectionEl.className = `km-section km-section--${section.color}`;

    const sectionHeader = document.createElement('button');
    sectionHeader.className = 'km-section-header';
    sectionHeader.setAttribute('aria-expanded', 'true');
    sectionHeader.innerHTML = `
      <div class="km-section-left">
        <span class="km-section-icon">${section.icon}</span>
        <span class="km-section-title">${section.title}</span>
      </div>
      <span class="km-section-chevron">⌄</span>`;

    const sectionBody = document.createElement('div');
    sectionBody.className = 'km-section-body';

    sectionHeader.addEventListener('click', () => {
      const isNowCollapsed = sectionBody.classList.toggle('km-collapsed');
      sectionHeader.setAttribute('aria-expanded', String(!isNowCollapsed));
      sectionHeader.querySelector('.km-section-chevron').style.transform =
        isNowCollapsed ? '' : 'rotate(180deg)';
    });

    if (section.intro) {
      const introEl = document.createElement('p');
      introEl.className = 'km-section-intro';
      introEl.textContent = section.intro;
      sectionBody.appendChild(introEl);
    }

    section.cards.forEach(card => {
      if      (card.type === 'comparison') sectionBody.appendChild(renderKmComparison(card));
      else if (card.type === 'highlight')  sectionBody.appendChild(renderKmHighlight(card));
      else if (card.type === 'flashcards') sectionBody.appendChild(renderKmFlashcards(card));
      else if (card.type === 'story')      sectionBody.appendChild(renderKmStory(card));
      else if (card.type === 'tips')       sectionBody.appendChild(renderKmTips(card));
    });

    sectionEl.appendChild(sectionHeader);
    sectionEl.appendChild(sectionBody);
    wrap.appendChild(sectionEl);
  });
}

function renderKmComparison(card) {
  const el = document.createElement('div');
  el.className = 'km-card km-card--comparison';
  const compareHtml = (card.compare || []).map(c => `
    <div class="km-compare-item">
      <div class="km-compare-emoji">${c.icon}</div>
      <div class="km-compare-city">${c.city}</div>
      <div class="km-compare-tag">${c.tag}</div>
      <div class="km-compare-note">${c.note}</div>
    </div>`).join('');
  el.innerHTML = `
    <div class="km-card-title">${card.title}</div>
    <div class="km-card-body">${kmFormatBody(card.body)}</div>
    ${compareHtml ? `<div class="km-compare-row">${compareHtml}</div>` : ''}`;
  return el;
}

function renderKmHighlight(card) {
  const el = document.createElement('div');
  el.className = 'km-card km-card--highlight';
  el.innerHTML = `
    ${card.tag ? `<div class="km-highlight-tag">${card.tag}</div>` : ''}
    <div class="km-card-title">${card.icon ? card.icon + ' ' : ''}${card.title}</div>
    <div class="km-card-body">${kmFormatBody(card.body)}</div>
    ${card.ctaText ? `<div class="km-highlight-cta">${card.ctaText}</div>` : ''}`;
  return el;
}

function renderKmFlashcards(card) {
  const el = document.createElement('div');
  el.className = 'km-flashcards-wrap';
  (card.groups || []).forEach(group => {
    const groupEl = document.createElement('div');
    groupEl.className = 'km-flashcard-group';
    groupEl.innerHTML = `<div class="km-flashcard-group-label km-fc-label--${group.groupColor}">${group.groupLabel}</div>`;
    const grid = document.createElement('div');
    grid.className = 'km-flashcard-grid';
    group.words.forEach(w => {
      const fc = document.createElement('div');
      fc.className = `km-flashcard km-fc--${group.groupColor}`;
      fc.innerHTML = `
        <div class="km-fc-malay">${w.malay}</div>
        <div class="km-fc-chinese">${w.chinese}</div>
        <div class="km-fc-pronunciation">🔉 ${w.pronunciation}</div>
        <div class="km-fc-scene">${w.scene}</div>`;
      grid.appendChild(fc);
    });
    groupEl.appendChild(grid);
    el.appendChild(groupEl);
  });
  return el;
}

function renderKmStory(card) {
  const el = document.createElement('div');
  el.className = 'km-card km-card--story';
  let tableHtml = '';
  if (card.table) {
    tableHtml = `<div class="km-kopi-table">${
      card.table.map(r =>
        `<div class="km-kopi-row"><span class="km-kopi-code">${r.code}</span><span class="km-kopi-desc">${r.desc}</span></div>`
      ).join('')
    }</div>`;
  }
  el.innerHTML = `
    <div class="km-card-title">
      ${card.icon ? card.icon + ' ' : ''}${card.title}
      ${card.nameEN ? `<span class="km-card-title-en">${card.nameEN}</span>` : ''}
    </div>
    <div class="km-card-body">${kmFormatBody(card.body)}</div>
    ${tableHtml}
    ${card.tip ? `<div class="km-story-tip">💡 ${card.tip}</div>` : ''}`;
  return el;
}

function renderKmTips(card) {
  const el = document.createElement('div');
  el.className = 'km-tips-wrap';
  (card.tips || []).forEach(tip => {
    const tipEl = document.createElement('div');
    tipEl.className = 'km-tip-card';
    tipEl.innerHTML = `
      <div class="km-tip-header">
        <span class="km-tip-icon">${tip.icon}</span>
        <span class="km-tip-title">${tip.title}</span>
      </div>
      <div class="km-tip-body">${tip.body}</div>`;
    el.appendChild(tipEl);
  });
  return el;
}

function kmFormatBody(text) {
  return text
    .split('\n\n')
    .map(p => `<p>${p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`)
    .join('');
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
