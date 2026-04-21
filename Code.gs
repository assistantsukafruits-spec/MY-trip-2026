// ============================================================
// ⚠️ 這個檔案是 Google Apps Script，不是網頁程式碼
//
// 部署步驟：
//   1. 打開 Google Sheet → 上方選單「擴充功能」→「Apps Script」
//   2. 刪除預設內容，將此檔案全部內容貼上
//   3. 儲存（Ctrl+S 或 Cmd+S）
//   4. 點「部署」→「新增部署」
//      - 類型：網頁應用程式
//      - 執行身分：我（Eyleen 的帳號）
//      - 誰可以存取：所有人（包括匿名使用者）
//   5. 授權後，複製「部署網址」
//   6. 將網址貼到 data.js 的 SCRIPT_URL 欄位
//
// 每次修改 Code.gs 後，需「管理部署」→「編輯」→「新版本」才會生效
// ============================================================

const EXPENSE_SHEET_NAME = '費用記錄';

function doGet(e) {
  const p = e.parameter;
  let result;

  try {
    switch (p.action) {
      case 'getExpenses':
        result = { ok: true, data: getExpenses() };
        break;
      case 'addExpense':
        result = { ok: true, data: addExpense(JSON.parse(p.payload)) };
        break;
      case 'deleteExpense':
        result = { ok: true, data: deleteExpense(p.id) };
        break;
      default:
        result = { ok: true, msg: 'MY Trip 2026 backend ready ✅' };
    }
  } catch (err) {
    result = { ok: false, error: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 取得或建立費用分頁 ──────────────────────────────────────
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(EXPENSE_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(EXPENSE_SHEET_NAME);
    sh.appendRow(['id', 'date', 'desc', 'amount', 'currency', 'paidBy', 'splitAmong', 'createdAt']);
    sh.getRange(1, 1, 1, 8)
      .setFontWeight('bold')
      .setBackground('#0D9488')
      .setFontColor('white');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ── 讀取所有費用 ───────────────────────────────────────────
function getExpenses() {
  const vals = getSheet_().getDataRange().getValues();
  if (vals.length <= 1) return [];
  return vals.slice(1)
    .filter(r => r[0])
    .map(r => ({
      id:         String(r[0]),
      date:       String(r[1]),
      desc:       String(r[2]),
      amount:     Number(r[3]),
      currency:   String(r[4]),
      paidBy:     String(r[5]),
      splitAmong: String(r[6]).split(',')
    }));
}

// ── 新增費用 ───────────────────────────────────────────────
function addExpense(exp) {
  getSheet_().appendRow([
    exp.id,
    exp.date,
    exp.desc,
    Number(exp.amount),
    exp.currency,
    exp.paidBy,
    exp.splitAmong.join(','),
    new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' })
  ]);
  return getExpenses();
}

// ── 刪除費用 ───────────────────────────────────────────────
function deleteExpense(id) {
  const sh = getSheet_();
  const vals = sh.getDataRange().getValues();
  for (let i = vals.length - 1; i >= 1; i--) {
    if (String(vals[i][0]) === String(id)) {
      sh.deleteRow(i + 1);
      break;
    }
  }
  return getExpenses();
}
