/* Simple EPUB Reader — 纯本地零依赖网页版阅读器(EPUB/TXT)。
   格式解析层在 engine.js(ZIP/XML/EPUB/TXT), 本文件是 UI 编排与渲染管线。 */
const $ = (id) => document.getElementById(id);
/* 防御式绑定: 资产混载/解析时序导致元素暂缺时, 延迟到DOMContentLoaded重试, 避免单点异常中断后续全部初始化 */
function bindEl(id, fn) {
  const el = document.getElementById(id);
  if (el) { fn(el); return; }
  const retry = () => { const e2 = document.getElementById(id); if (e2) fn(e2); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", retry);
  else setTimeout(retry, 0);
}


const BOOK_CSP = `default-src 'none'; img-src blob: data:; style-src blob: data: 'unsafe-inline'; font-src blob: data:; media-src blob: data:; form-action 'none'`;
const LAZY_PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const BAD_URL = /^\s*(javascript|vbscript)\s*:|^data\s*:\s*text\/html/i;
const URL_ATTRS = /^(href|src|xlink:href|action|formaction|poster|background|cite|longdesc|usemap|data)$/i;

function sanitizeDoc(doc) {
  doc.querySelectorAll("script,iframe,object,embed,frame,frameset,base,meta").forEach(el => el.remove());
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      if (n.startsWith("on")) { el.removeAttribute(attr.name); continue; }
      if (n === "srcset") {
        if (attr.value.split(",").some(u => BAD_URL.test(u.trim()))) el.removeAttribute(attr.name);
      } else if (URL_ATTRS.test(n) && BAD_URL.test(attr.value)) {
        el.setAttribute(attr.name, "#");
      }
    }
  }
}

const THEMES = {
  light: { bg: "#fbfaf7", fg: "#292725" },
  white: { bg: "#ffffff", fg: "#292725" },
  sepia: { bg: "#f4ecd8", fg: "#4a3b2a" },
  green: { bg: "#d9edd9", fg: "#26332b" },
  dark:  { bg: "#211f1d", fg: "#ddd8cf" }
};
function currentCustom() { return state.customSlots[state.customSlotIdx] || null; }
function readerColors() {
  if (state.theme === "custom") {
    const ct = currentCustom();
    if (ct) return { bg: ct.bg, fg: ct.fg };
  }
  return THEMES[state.theme] || THEMES.light;
}
function fontFamilyCss() {
  return state.fontFamily === "sans"
    ? "'Noto Sans CJK SC','PingFang SC','Microsoft YaHei',sans-serif"
    : "Georgia,'Noto Serif CJK SC','SimSun',serif";
}

function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || "");
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex);
  const target = f > 0 ? 255 : 0, p = Math.abs(f);
  const c = x => Math.round(x + (target - x) * p).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}
/* 自定义主题槽读取+规范化(启动初始化与导入备份共用同一份逻辑) */
function loadCustomSlots() {
  const DEF = { bg: "#fbfaf7", fg: "#292725" };
  const HEX = v => /^#[0-9a-f]{6}$/i.test(v);
  /* 高级覆盖项白名单(其余外壳色全部由纸面色派生) */
  const ADV_KEYS = ["ui","fg","muted","border","button","accent"];
  let arr = null;
  try { arr = JSON.parse(localStorage.getItem("customThemes") || "null"); } catch {}
  /* 槽位名不持久化(按语言派生); 界面配色全部由纸面色联动派生, adv为二次接管 */
  const norm = s => {
    const slot = (s && HEX(s.bg) && HEX(s.fg)) ? { bg: s.bg, fg: s.fg } : { ...DEF };
    slot.adv = {};
    for (const k of ADV_KEYS) if (HEX(s?.adv?.[k])) slot.adv[k] = s.adv[k];
    slot.base = { bg: slot.bg, fg: slot.fg, adv: {} };
    return slot;
  };
  return [0, 1, 2].map(i => norm(Array.isArray(arr) ? arr[i] : null));
}
const state = {
  zip: null, opfPath: "", chapterPath: "", book: null, urls: new Map(), chapterIndex: 0,
  fontSize: (() => { const v = Number(localStorage.getItem("fontSize")); return v >= 10 && v <= 36 ? v : 18; })(),
  lineHeight: Math.min(2.4, Math.max(1.4, Number(localStorage.getItem("lineHeight")) || 1.75)),
  fontFamily: localStorage.getItem("fontFamily") === "sans" ? "sans" : "serif",
  bookFontFirst: localStorage.getItem("bookFontFirst") !== "0",
  /* 外挂注音是会话级功能: 不读持久化状态, 每次启动默认关(高级功能分页可再开)
     annotate: 注音模式 off/pinyin/pinyinOnly/romaji(日语罗马音); showPinyin 为派生活动布尔供旧链路使用 */
  showPinyin: false,
  annotate: "off",
  /* 打字模式: 会话级, 照书打字驱动阅读(typing.js) */
  typing: false,
  /* 逐字阅读(刮刮乐)模式: 会话级, 正文涂层隐藏鼠标划过逐字显现(scratch.js);
     抹黑比例 0-100 持久化偏好, 0=关闭涂层 100=全部涂层, 默认50 */
  scratch: false,
  scratchRatio: Math.min(100, Math.max(0, Number(localStorage.getItem("scratchRatio") ?? 50))),
  /* 马克笔高亮: 会话级开关 + 记忆的颜色(划词标记, 导图联动); once=单击进入的单次模式 */
  marker: false,
  markerOnce: false,
  markerColor: localStorage.getItem("mkColor") || "#ffe066",
  /* 打字音效: 默认开, 持久化偏好 */
  typingSound: localStorage.getItem("typingSound") !== "0",
  /* 中文打字方式: false=拼音对照(默认) / true=输入法真打(上屏字面对比) */
  twReal: localStorage.getItem("twReal") === "1",
  theme: ["light","white","sepia","green","dark","custom"].includes(localStorage.getItem("theme")) ? localStorage.getItem("theme") : "light",
  customSlots: loadCustomSlots(),
  customSlotIdx: Math.min(2, Math.max(0, Number(localStorage.getItem("customSlot")) || 0)),
  tocEntries: [],
  navUnits: [],
  unitIdx: 0,
  auto: false,
  readMode: localStorage.getItem("readMode") === "paged" ? "paged" : "scroll",
  vertical: localStorage.getItem("vertical") === "1",
  shelfView: localStorage.getItem("shelfView") === "list" ? "list" : "grid",
  renderWhole: false,
  wholeLoaded: false,
  pageIdx: 0,
  filePages: 0,
  speed: Math.min(10, Math.max(1, Number(localStorage.getItem("autoSpeed")) || 4)),
  autoSpeedMult: [0.5, 0.75, 1, 1.5, 2].includes(Number(localStorage.getItem("autoSpeedMult"))) ? Number(localStorage.getItem("autoSpeedMult")) : 1,
  autoScrollSpeed: (() => { const v = Number(localStorage.getItem("autoScrollSpeed")); return v >= 0.01 && v <= 5 ? v : 0.8; })(),
  autoPageInterval: (() => { const v = Number(localStorage.getItem("autoPageInterval")); return v >= 500 && v <= 15000 ? v : 3500; })(),
  contentMax: (() => {
    const v = Number(localStorage.getItem("contentMax"));
    if (Number.isFinite(v) && v >= 480) return Math.min(1920, Math.round(v));
    return (Number(localStorage.getItem("sideWidth")) || 0) > 0 ? 1100 : 700;
  })(),
  contentLimited: (() => {
    if (localStorage.getItem("contentLimited") != null) return localStorage.getItem("contentLimited") === "1";
    return true;
  })(),
  settingsPinned: localStorage.getItem("settingsPinned") === "1",
  sidebarPinned: localStorage.getItem("sidebarPinned") === "1"
};

/* 动态切换的内联图标(静态图标直接写在HTML里) */
const svgOpen = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const ICONS = {
  play: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none" aria-hidden="true"><rect x="7" y="5.5" width="3.4" height="13" rx="1.2"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1.2"/></svg>',
  scroll: `${svgOpen}<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/></svg>`,
  paged: `${svgOpen}<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/></svg>`,
  delX: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`
};

function progressKey(title, size) { return `progress:${title}:${size ?? ""}`; }
function loadProgress(title, size) {
  try {
    const raw = localStorage.getItem(progressKey(title, size));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v && typeof v.i === "number") return {
      i: Math.max(0, v.i),
      u: Number.isInteger(v.u) && v.u >= 0 ? v.u : null,
      r: Math.min(0.999, Math.max(0, Number(v.r) || 0))
    };
  } catch {}
  return null;
}
let progSaveTimer = 0;
function scheduleProgressSave() {
  if (progSaveTimer) return;
  progSaveTimer = setTimeout(() => { progSaveTimer = 0; saveProgress(); }, 1000);
}
function flushProgress() {
  if (progSaveTimer) { clearTimeout(progSaveTimer); progSaveTimer = 0; }
  saveProgress();
  updateProgress();
}
function currentRatio() {
  return pagedActive() ? (state.pageIdx + 0.5) / Math.max(1, pagedCtx.pages) : currentScrollRatio();
}
function saveProgress() {
  if (!state.book) return;
  const r = currentRatio();
  try {
    localStorage.setItem(progressKey(state.book.title, state.book.fileSize),
      JSON.stringify({ i: state.chapterIndex, u: state.unitIdx, r }));
  } catch {}
  idbTouchProgress(bookId(state.book.title, state.book.fileSize), state.chapterIndex, state.unitIdx, r);
}

function bookId(title, size) { return `${title}\u0000${size}`; }

let idbPromise = null;
function idbOpen() {
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("epubreader-db", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    idbPromise.catch(() => { idbPromise = null; });
  }
  return idbPromise;
}
async function idbPut(storeName, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(val);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(storeName, id) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, "readonly");
    const rq = tx.objectStore(storeName).get(id);
    tx.oncomplete = () => res(rq.result);
    tx.onerror = () => rej(tx.error);
  });
}
async function idbAll(storeName) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, "readonly");
    const rq = tx.objectStore(storeName).getAll();
    tx.oncomplete = () => res(rq.result || []);
    tx.onerror = () => rej(tx.error);
  });
}
async function idbKeys(storeName) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, "readonly");
    const rq = tx.objectStore(storeName).getAllKeys();
    tx.oncomplete = () => res(rq.result || []);
    tx.onerror = () => rej(tx.error);
  });
}
async function idbDel(storeName, id) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function idbTouchProgress(id, i, u, r) {
  try {
    const m = await idbGet("meta", id);
    if (!m) return;
    m.i = i; m.u = u; m.r = r;
    await idbPut("meta", m);
  } catch {}
}
const SHELF_LIMIT = 30;
/* 彻底移除一本书: IndexedDB 两表记录与对应 localStorage 进度键一并清理 */
async function purgeBook(id) {
  let meta = null;
  try { meta = await idbGet("meta", id); } catch {}
  try { await idbDel("files", id); } catch {}
  try { await idbDel("meta", id); } catch {}
  if (meta && meta.title != null) {
    try { localStorage.removeItem(progressKey(meta.title, meta.size)); } catch {}
  }
}
/* 启动清扫: 历史版本只清 IndexedDB 不清进度键, 删除书架中已不存在书的 progress:* 残留 */
async function sweepOrphanProgress() {
  try {
    const live = new Set((await idbAll("meta")).filter(m => m && m.title).map(m => m.id));
    const dead = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("progress:")) continue;
      const rest = k.slice(9);
      const si = rest.lastIndexOf(":");
      const title = si >= 0 ? rest.slice(0, si) : rest;
      const rawSize = si >= 0 ? rest.slice(si + 1) : "";
      if (!live.has(bookId(title, rawSize))) dead.push(k);
    }
    for (const k of dead) localStorage.removeItem(k);
  } catch {}
}
async function pruneShelf() {
  try {
    const metas = (await idbAll("meta")).filter(m => m && m.title)
      .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
    for (const m of metas.slice(SHELF_LIMIT)) await purgeBook(m.id);
  } catch {}
}
async function registerBook(file, title, chapters) {
  try {
    const id = bookId(title, file.size);
    await idbPut("files", { id, file });
    await idbPut("meta", {
      id, name: file.name, title, size: file.size,
      lastOpened: Date.now(), chapters, i: state.chapterIndex, u: state.unitIdx, r: currentRatio(),
      cover: state.book?.coverBlob instanceof Blob ? state.book.coverBlob : null
    });
    await pruneShelf();   /* 超出上限按最旧清理, 防止IndexedDB无限累积占满配额 */
  } catch {}
}

/* ---------- 数据备份: 设置偏好+阅读进度+书目元数据(不含书籍文件本体) ----------
   导出的书目为"待关联"记录, 导入后重新打开同名同大小文件即自动回填并续读 */
const BACKUP_PREF_KEYS = ["lang","theme","customThemes","customSlot","fontSize","lineHeight","fontFamily","bookFontFirst","readMode","vertical","shelfView","settingsPinned","sidebarPinned","autoSpeed","autoSpeedMult","autoScrollSpeed","autoPageInterval","contentMax","contentLimited","typingSound","twReal","scratchRatio"];
async function exportBackup() {
  flushProgress();
  const prefs = {};
  for (const k of BACKUP_PREF_KEYS) {
    const v = localStorage.getItem(k);
    if (v != null) prefs[k] = v;
  }
  let metas = [];
  try {
    metas = (await idbAll("meta")).filter(m => m && m.title).map(m => ({
      name: m.name || m.title, title: m.title, size: m.size,
      lastOpened: m.lastOpened || 0, chapters: m.chapters || 0,
      i: m.i ?? 0, u: Number.isInteger(m.u) && m.u >= 0 ? m.u : null, r: Math.min(.999, Math.max(0, Number(m.r) || 0))
    }));
  } catch {}
  const payload = { app: "epubreader-web", v: 1, exportedAt: new Date().toISOString(), prefs, books: metas };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const a = document.createElement("a");
  const d = new Date(), pad = n => String(n).padStart(2, "0");
  a.href = URL.createObjectURL(blob);
  a.download = `epubreader-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(t("backupExported"));
}
async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { alert(t("backupBad")); return; }
  if (!data || data.app !== "epubreader-web" || typeof data.prefs !== "object" || !Array.isArray(data.books)) {
    alert(t("backupBad"));
    return;
  }
  let prefCount = 0;
  for (const k of BACKUP_PREF_KEYS) {
    const v = data.prefs[k];
    if (typeof v === "string") {
      try { localStorage.setItem(k, v); prefCount++; } catch {}
    }
  }
  let bookCount = 0;
  for (const b of data.books.slice(0, SHELF_LIMIT)) {
    if (!b || typeof b.title !== "string" || !b.title || !Number.isFinite(b.size)) continue;
    const i = Math.max(0, Number(b.i) || 0);
    const u = Number.isInteger(b.u) && b.u >= 0 ? b.u : null;
    const r = Math.min(.999, Math.max(0, Number(b.r) || 0));
    const id = bookId(b.title, b.size);
    const exist = await idbGet("meta", id).catch(() => null);
    if (exist) continue;   /* 本机已有同名书记录, 以本机为准不覆盖 */
    await idbPut("meta", {
      id, name: typeof b.name === "string" && b.name ? b.name : b.title, title: b.title, size: b.size,
      lastOpened: Number(b.lastOpened) || 0, chapters: Math.max(0, Number(b.chapters) || 0), i, u, r
    });
    try { localStorage.setItem(progressKey(b.title, b.size), JSON.stringify({ i, u, r })); } catch {}
    bookCount++;
  }
  restorePrefsFromStorage();
  syncAllPrefsUI();
  toast(t("backupDone", prefCount, bookCount));
}
/* 从 localStorage 重读全部偏好到运行时 state(state 初始化逻辑的复用版, 导入备份后调用) */
function restorePrefsFromStorage() {
  const numOk = (k, min, max) => { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v >= min && v <= max ? v : null; };
  state.fontSize = numOk("fontSize", 10, 36) ?? 18;
  state.lineHeight = Math.min(2.4, Math.max(1.4, Number(localStorage.getItem("lineHeight")) || 1.75));
  state.fontFamily = localStorage.getItem("fontFamily") === "sans" ? "sans" : "serif";
  state.vertical = localStorage.getItem("vertical") === "1";
  state.bookFontFirst = localStorage.getItem("bookFontFirst") !== "0";
  state.theme = ["light","white","sepia","green","dark","custom"].includes(localStorage.getItem("theme")) ? localStorage.getItem("theme") : "light";
  state.customSlots = loadCustomSlots();
  state.customSlotIdx = Math.min(2, Math.max(0, Number(localStorage.getItem("customSlot")) || 0));
  state.speed = Math.min(10, Math.max(1, Number(localStorage.getItem("autoSpeed")) || 4));
  state.autoSpeedMult = [0.5, 0.75, 1, 1.5, 2].includes(Number(localStorage.getItem("autoSpeedMult"))) ? Number(localStorage.getItem("autoSpeedMult")) : 1;
  state.autoScrollSpeed = (() => { const v = Number(localStorage.getItem("autoScrollSpeed")); return v >= 0.01 && v <= 5 ? v : 0.8; })();
  state.autoPageInterval = (() => { const v = Number(localStorage.getItem("autoPageInterval")); return v >= 500 && v <= 15000 ? v : 3500; })();
  state.contentMax = (() => {
    const v = Number(localStorage.getItem("contentMax"));
    if (Number.isFinite(v) && v >= 480) return Math.min(1920, Math.round(v));
    return (Number(localStorage.getItem("sideWidth")) || 0) > 0 ? 1100 : 700;
  })();
  state.contentLimited = localStorage.getItem("contentLimited") != null ? localStorage.getItem("contentLimited") === "1" : true;
  state.settingsPinned = localStorage.getItem("settingsPinned") === "1";
  state.typingSound = localStorage.getItem("typingSound") !== "0";
  state.twReal = localStorage.getItem("twReal") === "1";
  state.scratchRatio = (() => { const v = Number(localStorage.getItem("scratchRatio")); return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 50; })();
  syncPin("pinSettings", state.settingsPinned, "settingsPanel");
  state.readMode = localStorage.getItem("readMode") === "paged" ? "paged" : "scroll";
  state.shelfView = localStorage.getItem("shelfView") === "list" ? "list" : "grid";
  syncViewChips();
}
function syncAllPrefsUI() {
  syncTypingSound();
  syncTwModeSeg();
  $("fontFamilySel").value = state.fontFamily;
  $("bookFontToggle").checked = state.bookFontFirst;
syncAnnotateSeg();
/* 词典预热: 曾开启过注音的设备启动时静默预拉(SW缓存命中, 几乎零开销), 首次点击开启零等待 */
if (localStorage.getItem("pinyinWarmed") === "1") ensurePinyinLib().catch(() => {});
  $("contentMaxToggle").checked = state.contentLimited;
  syncSpeedBtns();
  $("autoScrollSpeedNum").value = state.autoScrollSpeed;
  $("autoPageIntervalNum").value = state.autoPageInterval;
  $("modeBtn").innerHTML = state.readMode === "paged" ? ICONS.paged : ICONS.scroll;
  $("modeBtn").setAttribute("aria-pressed", String(state.readMode === "paged"));
  syncContentInputs();
  syncFontSize();
  syncLineHeight();
  syncContentMax();
  syncScrRatio();
  syncCustomPickers();
  syncPin("pinSettings", state.settingsPinned, "settingsPanel");
  applySide();
  applyTheme();
  applyI18n();
}
async function openFromShelf(id, anchor) {
  try {
    const rec = await idbGet("files", id);
    if (!rec?.file) {
      /* 文件未随备份保存: 就地弹出文件选择器, 选对同名同大小文件即回填并打开 */
      await relinkGhostBook(id, anchor);
      return;
    }
    await openBookFile(rec.file);
  } catch (err) { alert(err.message); }
}
/* 幽灵书目重链接: File Handling API 选择器优先, 无该 API 环境退回 input[type=file] */
async function relinkGhostBook(id, anchor) {
  const meta = await idbGet("meta", id).catch(() => null);
  if (!meta) return;
  toast(t("lostFileRelink"), { anchor });
  const tryFile = async file => {
    if (!file || file.size !== meta.size || !/\.(epub|txt)$/i.test(file.name)) {
      toast(t("relinkMismatch"), { anchor });
      return;
    }
    await idbPut("files", { id, file });
    await openFromShelf(id, anchor);
  };
  if (typeof window.showOpenFilePicker === "function") {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "EPUB / TXT", accept: { "application/epub+zip": [".epub"], "text/plain": [".txt"] } }],
        multiple: false
      });
      await tryFile(await handle.getFile());
    } catch (e) {
      if (e?.name === "AbortError") return;   /* 用户取消选择 */
      alert(e.message);
    }
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".epub,application/epub+zip,.txt,text/plain";
  input.onchange = async () => { await tryFile(input.files[0]); };
  input.click();
}
/* 批量重链接: 多选文件按字节大小精确匹配幽灵书目(扩展名须合法), 同尺寸撞车的条目跳过计为未匹配 */
async function batchRelink() {
  let metas = [];
  try {
    const keys = new Set(await idbKeys("files"));
    metas = (await idbAll("meta")).filter(m => m?.title && !keys.has(m.id));
  } catch { return; }
  if (!metas.length) return;
  const pickFiles = async () => {
    if (typeof window.showOpenFilePicker === "function") {
      try {
        const handles = await window.showOpenFilePicker({
          types: [{ description: "EPUB / TXT", accept: { "application/epub+zip": [".epub"], "text/plain": [".txt"] } }],
          multiple: true
        });
        return Promise.all(handles.map(h => h.getFile()));
      } catch (e) {
        if (e?.name === "AbortError") return null;
        alert(e.message);
        return null;
      }
    }
    return new Promise(res => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = ".epub,application/epub+zip,.txt,text/plain";
      input.onchange = () => res([...input.files]);
      input.oncancel = () => res(null);
      input.click();
    });
  };
  const files = await pickFiles();
  if (!files || !files.length) return;
  /* size -> [meta...]: 字节大小是主匹配键, 命中多条视为歧义跳过 */
  const bySize = new Map();
  for (const m of metas) {
    if (!bySize.has(m.size)) bySize.set(m.size, []);
    bySize.get(m.size).push(m);
  }
  let restored = 0, unmatched = 0;
  for (const f of files) {
    if (!/\.(epub|txt)$/i.test(f.name)) { unmatched++; continue; }
    const hits = bySize.get(f.size);
    if (!hits || hits.length !== 1) { unmatched++; continue; }
    await idbPut("files", { id: hits[0].id, file: f });
    restored++;
  }
  toast(t("relinkResult", restored, unmatched), { anchor: $("relinkBtn") });
  renderShelf();
}
/* 撤销式移除: 点×先从列表隐藏并挂起5秒, 期间可撤销, 超时才真正清除数据 */
const pendingRemove = new Map();
function requestRemoveShelf(id, anchor) {
  if (pendingRemove.has(id)) return;
  pendingRemove.set(id, setTimeout(() => {
    pendingRemove.delete(id);
    purgeBook(id);
  }, 5000));
  renderShelf();
  toast(t("shelfRemoved"), { action: { label: t("undo"), fn: () => {
    const tmr = pendingRemove.get(id);
    if (tmr) { clearTimeout(tmr); pendingRemove.delete(id); }
    renderShelf();
  } }, anchor });
}
/* ---------- 书架编辑模式: 多选/全选/批量移除(同样走5秒撤销期) ---------- */
let shelfEditMode = false;
const shelfSel = new Set();
let shelfRenderedIds = [];
let shelfCoverUrls = [];   /* 网格封面 objectURL, 每次渲染统一回收 */

function setShelfEditMode(on) {
  if (shelfEditMode === on) return;
  shelfEditMode = on;
  shelfSel.clear();
  $("shelfIdleBtns").hidden = on;
  $("shelfEditBtns").hidden = !on;
  renderShelf();
}
function toggleSelAll() {
  const allSel = shelfRenderedIds.length > 0 && shelfRenderedIds.every(id => shelfSel.has(id));
  if (allSel) shelfRenderedIds.forEach(id => shelfSel.delete(id));
  else shelfRenderedIds.forEach(id => shelfSel.add(id));
  renderShelf();
}
/* 批量移除选中书籍: 与单条×一致, 挂起5秒可整体撤销, 超时逐本真正清除 */
function batchRemoveSel() {
  const ids = [...shelfSel];
  if (!ids.length) return;
  for (const id of ids) {
    if (pendingRemove.has(id)) continue;
    pendingRemove.set(id, setTimeout(() => {
      pendingRemove.delete(id);
      purgeBook(id);
    }, 5000));
  }
  shelfSel.clear();
  renderShelf();
  toast(t("batchRemoved", ids.length), { anchor: $("delSelBtn"), action: { label: t("undo"), fn: () => {
    for (const id of ids) {
      const tmr = pendingRemove.get(id);
      if (tmr) { clearTimeout(tmr); pendingRemove.delete(id); }
    }
    renderShelf();
  } } });
}

/* 书架视图切换: 网格(默认)/列表, 持久化+随备份走 */
function syncViewChips() {
  for (const b of document.querySelectorAll(".viewChip")) {
    const on = b.dataset.view === state.shelfView;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  }
}
function setShelfView(v) {
  v = v === "list" ? "list" : "grid";
  if (v === state.shelfView) return;
  state.shelfView = v;
  try { localStorage.setItem("shelfView", v); } catch {}
  syncViewChips();
  if (!$("welcome").hidden) renderShelf();
}

async function renderShelf() {
  const wrap = $("shelf"), list = $("shelfList");
  let metas = [], fileKeys = [];
  try { metas = await idbAll("meta"); } catch {}
  try { fileKeys = await idbKeys("files"); } catch {}
  const linked = new Set(fileKeys);
  const allMetas = metas.filter(m => m && m.title && !pendingRemove.has(m.id));
  /* 幽灵条目: 有书目元数据但文件本体缺失(备份导入), 视觉降级+徽章提示 */
  const ghostCount = allMetas.filter(m => !linked.has(m.id)).length;
  $("relinkBtn").hidden = ghostCount === 0 || shelfEditMode;
  if (ghostCount && !shelfEditMode) $("relinkBtn").textContent = `${t("relinkBtn")} (${ghostCount})`;
  metas = allMetas.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0)).slice(0, 15);
  /* 编辑模式下即使列表暂空(全部处于撤销挂起期)也保持面板可见, 否则完成/全选按钮消失且撤销后无法继续编辑 */
  wrap.hidden = metas.length === 0 && !shelfEditMode;
  const gridView = state.shelfView === "grid";
  list.classList.toggle("grid", gridView);
  list.textContent = "";
  for (const u of shelfCoverUrls) URL.revokeObjectURL(u);
  shelfCoverUrls = [];
  shelfRenderedIds = metas.map(m => m.id);
  for (const m of metas) {
    const isGhost = !linked.has(m.id);
    const pos = m.chapters ? t("shelfPos", ((m.u ?? m.i) || 0) + 1, m.chapters) : "";
    const dateStr = new Date(m.lastOpened || Date.now()).toLocaleDateString(currentLang() === "en" ? "en-US" : "zh-CN");
    /* 卡片复用 .shelfItem 基类(角色/选中态/测试选择器一致), 视觉差异全部走上下文CSS */
    const b = document.createElement("div");
    b.className = gridView ? "shelfItem shelfCard" : "shelfItem";
    if (isGhost) b.classList.add("ghost");
    b.setAttribute("role", "button");
    b.tabIndex = 0;
    let check = null;
    if (shelfEditMode) {
      check = document.createElement("span");
      check.className = "shelfCheck" + (shelfSel.has(m.id) ? " on" : "");
      check.setAttribute("aria-hidden", "true");
      b.classList.toggle("sel", shelfSel.has(m.id));
      b.setAttribute("aria-pressed", String(shelfSel.has(m.id)));
    }
    const titleEl = document.createElement("span");
    titleEl.className = "shelfTitle";
    titleEl.textContent = m.title;
    const info = document.createElement("span");
    info.className = "shelfInfo";
    info.textContent = pos + dateStr;
    const del = document.createElement("button");
    del.className = "shelfDel";
    del.title = t("shelfDelTip");
    del.setAttribute("aria-label", `${t("shelfDelTip")}: ${m.title}`);
    del.innerHTML = ICONS.delX;
    if (gridView) {
      /* 封面占位: 书名首字 + 由书名哈希出的固定色相; 底部细进度条 */
      let hue = 0;
      for (let i = 0; i < m.title.length; i++) hue = (hue * 31 + m.title.codePointAt(i)) % 360;
      const cover = document.createElement("span");
      cover.className = "cardCover";
      cover.style.setProperty("--ch", String(hue));
      cover.setAttribute("aria-hidden", "true");
      if (m.cover && typeof m.cover.arrayBuffer === "function") {
        const u = URL.createObjectURL(m.cover);
        shelfCoverUrls.push(u);
        const img = document.createElement("img");
        img.className = "cardCoverImg";
        img.alt = "";
        img.loading = "lazy";
        img.src = u;
        cover.appendChild(img);
      }
      const p = loadProgress(m.title, m.size);
      if (p && m.chapters) {
        const pct = Math.round(((p.i + (p.r || 0)) / m.chapters) * 100);
        if (pct > 0 && pct < 100) {
          const bar = document.createElement("i");
          bar.className = "cardProg";
          bar.style.width = `${Math.max(4, Math.min(100, pct))}%`;
          cover.appendChild(bar);
        }
      }
      b.appendChild(cover);
      /* 编辑模式卡片不渲染单删键(勾选即操作入口), 删除仅浏览态提供 */
      if (!shelfEditMode) b.appendChild(del);
    }
    let badge = null;
    if (isGhost) {
      badge = document.createElement("span");
      badge.className = "shelfBadge";
      badge.textContent = t("shelfGhost");
      b.title = t("ghostTip");
    }
    const open = () => openFromShelf(m.id, b);
    const toggle = () => { shelfSel.has(m.id) ? shelfSel.delete(m.id) : shelfSel.add(m.id); renderShelf(); };
    del.onclick = e => { e.stopPropagation(); requestRemoveShelf(m.id, del); };
    b.onclick = shelfEditMode ? toggle : open;
    b.onkeydown = e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      shelfEditMode ? toggle() : open();
    };
    b.setAttribute("aria-label", `${m.title}，${pos}${dateStr}${isGhost ? "，" + t("shelfGhost") : ""}${shelfEditMode && shelfSel.has(m.id) ? "，" + t("selOn") : ""}`);
    if (check) b.appendChild(check);
    if (gridView) b.append(titleEl, info);
    else b.append(titleEl, info, del);
    if (badge) b.appendChild(badge);
    list.appendChild(b);
  }
  /* 编辑态操作栏状态刷新(全选文案/删除计数), 语言切换后经 applyI18n→renderShelf 同样生效 */
  if (shelfEditMode) {
    const allSel = shelfRenderedIds.length > 0 && shelfRenderedIds.every(id => shelfSel.has(id));
    $("selAllBtn").textContent = allSel ? t("deselectAll") : t("selectAll");
    const n = shelfSel.size;
    $("delSelBtn").textContent = n ? `${t("delSelected")} (${n})` : t("delSelected");
    $("delSelBtn").disabled = n === 0;
  }
}

function closeBook() {
  setAuto(false);
  /* 会话级模式随书关闭复位(打字/马克笔/逐字阅读), 避免残留状态吞掉后续快捷键 */
  if (state.typing) { state.typing = false; twReset(); syncTypingBtn(); $("typingBar").hidden = true; }
  if (state.scratch) { state.scratch = false; scratchReset(); syncScratchBtn(); }
  if (state.marker) { state.marker = false; state.markerOnce = false; syncMarkerUI(); }
  flushProgress();
  state.urls.forEach(u => URL.revokeObjectURL(u));
  state.urls.clear();
  state.book = null;
  state.tocEntries = [];
  state.navUnits = [];
  state.unitIdx = 0;
  pagedCtx = null;
  state.pageIdx = 0;
  state.filePages = 0;
  state.renderWhole = false;
  state.wholeLoaded = false;
  scrollMarks = [];
  $("pageInfo").hidden = true;
  $("reader").hidden = true;
  $("welcome").hidden = false;
  $("bookTitle").textContent = "EPUB Reader";
  $("chapterLabel").textContent = t("noBook");
  $("progress").textContent = "—";
  $("closeBookBtn").hidden = true;
  cancelSearchScan();
  clearSearchResults();
  switchSideTab("toc");
  renderShelf();
}

async function chapterText(i) {
  const book = state.book;
  if (!book.searchText) book.searchText = new Map();
  if (book.searchText.has(i)) return book.searchText.get(i);
  let text;
  if (book.isTxt) {
    text = book.txtChapters[i].lines.join("\n");
  } else {
    try {
      const path = resolvePath(state.opfPath, book.spine[i].href);
      const html = await state.zip.readText(path);
      const doc = parseHtmlDoc(html);
      sanitizeDoc(doc);
      doc.querySelectorAll("style,template").forEach(el => el.remove());
      text = doc.body?.textContent || "";
    } catch { text = ""; }
  }
  book.searchText.set(i, text);
  return text;
}

let searchToken = 0, searchTimer = 0;
const MAX_SEARCH_RESULTS = 200;
const CTX_R = 32;

/* 作废进行中的全书扫描: 换书/关书后旧扫描不得继续在新书 spine 上跑并追加结果 */
function cancelSearchScan() { searchToken++; clearTimeout(searchTimer); }

function clearSearchResults(msg) {
  $("searchResults").textContent = "";
  $("searchStatus").textContent = msg || "";
}

function clearSearchHighlights(doc) {
  const d = doc || $("bookFrame")?.contentDocument;
  if (!d || !d.body) return;
  let n = 0;
  for (const m of [...d.querySelectorAll("mark[data-srch]")]) {
    m.replaceWith(...m.childNodes);
    n++;
  }
  if (n) d.body.normalize();
}

async function runSearch(term) {
  const token = ++searchToken;
  if (!state.book || !term) { clearSearchResults(); clearSearchHighlights(); return; }
  const results = $("searchResults");
  results.textContent = "";
  const low = term.toLowerCase();
  let hits = 0, chaptersWithHits = 0;
  for (let i = 0; i < state.book.spine.length; i++) {
    if (token !== searchToken) return;
    $("searchStatus").textContent = t("scanned", i, state.book.spine.length);
    const text = await chapterText(i);
    if (token !== searchToken) return;
    const textLow = text.toLowerCase();
    let idx = textLow.indexOf(low);
    let inChapter = 0;
    const ctxCount = new Map();
    while (idx >= 0 && hits < MAX_SEARCH_RESULTS) {
      results.append(searchRow(text, idx, term, i, ctxCount));
      hits++; inChapter++;
      idx = textLow.indexOf(low, idx + term.length);
    }
    if (inChapter) chaptersWithHits++;
    if (hits >= MAX_SEARCH_RESULTS) break;
    await new Promise(r => setTimeout(r));
  }
  if (token !== searchToken) return;
  state.book.searchText?.clear();   /* 搜索完成, 释放章节文本缓存(下次搜索按需重建) */
  $("searchStatus").textContent = hits
    ? t("resultsMeta", hits, chaptersWithHits) + (hits >= MAX_SEARCH_RESULTS ? t("capNote") : "")
    : t("noResults");
}

function searchRow(text, idx, term, chapterIndex, ctxCount) {
  const b = document.createElement("button");
  b.className = "searchItem";
  const head = document.createElement("span");
  head.className = "searchChapter";
  head.textContent = state.tocEntries.find(x => x.chapterIndex === chapterIndex)?.label || t("chapterN", chapterIndex + 1);
  const snip = document.createElement("span");
  snip.className = "searchSnippet";
  const start = Math.max(0, idx - 25), end = Math.min(text.length, idx + term.length + 25);
  if (start > 0) snip.append("…");
  snip.append(text.slice(start, idx));
  const mark = document.createElement("mark");
  mark.textContent = text.slice(idx, idx + term.length);
  snip.append(mark);
  snip.append(text.slice(idx + term.length, end));
  if (end < text.length) snip.append("…");
  b.append(head, snip);
  const cs = Math.max(0, idx - CTX_R), ce = Math.min(text.length, idx + term.length + CTX_R);
  const ctx = text.slice(cs, ce);
  const hitNo = ctxCount.get(ctx) || 0;
  ctxCount.set(ctx, hitNo + 1);
  b.onclick = () => safeShow(chapterIndex, "", {
    highlightTerm: term,
    highlightOffset: idx,
    highlightCtx: ctx,
    highlightInner: idx - cs,
    highlightHitNo: hitNo
  });
  return b;
}

/* 在渲染后的文档中按字符偏移精确包裹 <mark>（与搜索文本同口径，支持跨节点匹配）
   口径规则: sanitizeDoc 后的 body 文本, 再排除 style/template 的文字(noscript 在禁脚本环境会渲染, 计入) */
const HL_SKIP = /^(script|style|template)$/i;
function filteredTextWalker(doc, root) {
  return doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let p = node.parentElement; p && p !== root; p = p.parentElement)
        if (HL_SKIP.test(p.localName || "")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
}
function filteredNodesOf(doc, root) {
  const w = filteredTextWalker(doc, root || doc.body || doc.documentElement);
  const arr = [];
  while (w.nextNode()) arr.push(w.currentNode);
  return arr;
}
/* 在过滤文本节点列表上从 start 字符处起包裹 len 个字符(可跨节点), 返回首个 <mark> */
function wrapSpan(doc, nodes, start, len) {
  let pos = 0, i = 0;
  for (; i < nodes.length; i++) {
    const l = nodes[i].nodeValue.length;
    if (pos + l > start) break;
    pos += l;
  }
  if (i >= nodes.length || len <= 0) return null;
  let remaining = len, firstMark = null, localStart = start - pos;
  for (let n = i; n < nodes.length && remaining > 0; n++) {
    const text = nodes[n].nodeValue;
    const take = Math.min(remaining, text.length - localStart);
    if (take <= 0) break;
    const frag = doc.createDocumentFragment();
    if (localStart > 0) frag.append(doc.createTextNode(text.slice(0, localStart)));
    const mark = doc.createElement("mark");
    mark.setAttribute("style", "background:#ffd54f;color:#111;border-radius:2px;");
    mark.setAttribute("data-srch", "1");
    mark.textContent = text.slice(localStart, localStart + take);
    frag.append(mark);
    if (localStart + take < text.length) frag.append(doc.createTextNode(text.slice(localStart + take)));
    nodes[n].replaceWith(frag);
    if (!firstMark) firstMark = mark;
    remaining -= take;
    localStart = 0;
  }
  return firstMark;
}

/* 整书模式下"文件内偏移"→"全文偏移": 目标文件段落 #sp{ci} 首个有效文本节点之前的字符数 */
function wholeFileBase(doc, ci) {
  if (!(state.renderWhole && ci > 0)) return -1;
  const sec = doc.getElementById(`sp${ci}`);
  const root = doc.body || doc.documentElement;
  if (!sec || !root) return -1;
  const sub = filteredNodesOf(doc, sec);
  if (!sub.length) return -1;
  const target = sub[0];
  let base = 0;
  for (const n of filteredNodesOf(doc, root)) {
    if (n === target) return base;
    base += n.nodeValue.length;
  }
  return -1;
}
/* 定位一次搜索命中: 优先用前后文指纹在目标文件范围内找第 k 次出现(自纠偏移漂移), 找不到退回纯偏移 */
function highlightSearchHit(doc, ci, opts) {
  const term = opts.highlightTerm;
  const root = doc.body || doc.documentElement;
  if (!root || !term) return null;
  clearSearchHighlights(doc);
  const nodes = filteredNodesOf(doc, root);
  let lo = 0, hi = -1;
  if (state.renderWhole) {
    lo = ci > 0 ? wholeFileBase(doc, ci) : 0;
    if (lo < 0) return null;
    hi = state.book && ci < state.book.spine.length - 1 ? wholeFileBase(doc, ci + 1) : -1;
  }
  const ftext = nodes.map(n => n.nodeValue).join("");
  if (hi < 0) hi = ftext.length;
  const ctx = opts.highlightCtx;
  if (ctx) {
    let from = lo, k = 0;
    while (true) {
      const p = ftext.indexOf(ctx, from);
      if (p < 0 || p + ctx.length > hi) break;
      if (k === (opts.highlightHitNo || 0)) return wrapSpan(doc, nodes, p + (opts.highlightInner || 0), term.length);
      k++;
      from = p + 1;
    }
  }
  return wrapSpan(doc, nodes, lo + (opts.highlightOffset || 0), term.length);
}

/* 公共开书流程: 状态复位与 UI 收尾两块与格式无关, EPUB/TXT 入口只保留各自解析 */
function initStateForBook(book, title, extras = {}) {
  flushProgress();   /* 旧书挂起的1秒延迟保存先落盘, 避免换书竞态丢进度 */
  state.zip = extras.zip || null;
  state.opfPath = extras.opfPath || "";
  state.book = book;
  state.mediaByPath = extras.mediaByPath || new Map();
  state.urls.forEach(u => URL.revokeObjectURL(u));
  state.urls.clear();
  state.chapterIndex = 0;
  state.chapterPath = "";
  state.unitIdx = 0;
  state.renderWhole = state.readMode === "scroll";
  state.wholeLoaded = false;
  state.bookHasRuby = false;   /* 原生注音书级标志, 换书重置(开书后由章节内容检测置位) */
  $("bookTitle").textContent = title;
}
async function finishOpenBook(file, title) {
  renderToc(state.tocEntries);
  $("welcome").hidden = true;
  $("reader").hidden = false;
  const saved = loadProgress(title, file.size);
  let start = 0;
  state.pageIdx = 0;
  const ropts = {};
  if (saved) {
    if (Number.isInteger(saved.u) && saved.u > 0 && saved.u < state.navUnits.length) start = saved.u;
    else if (saved.i > 0 && saved.i < state.book.spine.length) start = firstUnitOfFile(saved.i);
    if (saved.r) { ropts.initialRatio = saved.r; ropts.noAnchor = true; }
  }
  $("closeBookBtn").hidden = false;
  await showUnit(start, ropts);
  registerBook(file, title, state.navUnits.length);
}

async function openEpub(file) {
  setAuto(false);
  const zip = new ZipReader(await file.arrayBuffer());
  const parsed = await parseEpub(zip);
  if (!parsed) throw new Error(t("noOpf"));
  await setupFontDecrypt(zip, parsed.opfPath, parsed.opf);   /* encryption.xml字体反混淆: 注册后所有read透明还原 */
  const { opfPath, opf, manifest, spine } = parsed;
  if (!spine.length) throw new Error(t("noSpine"));
  const metaTitle = parsed.opfTitle || file.name.replace(/\.epub$/i, "");
  const mediaByPath = new Map();
  for (const item of manifest.values()) if (item.href) mediaByPath.set(resolvePath(opfPath, item.href), item.media);
  const book = { title: metaTitle, manifest, spine, opf, ncxPath: parsed.ncxPath, fileSize: file.size };
  book.coverBlob = await extractCover(zip, opfPath, parsed.coverItem);

  initStateForBook(book, metaTitle, { zip, opfPath, mediaByPath });
  state.tocEntries = await buildToc(zip, opfPath, opf, manifest, spine);
  state.navUnits = buildNavUnits(state.tocEntries, book);
  await finishOpenBook(file, metaTitle);
}

async function openText(file) {
  setAuto(false);
  const text = decodeTextFile(await file.arrayBuffer());
  const chapters = parseTxtChapters(text);
  const title = file.name.replace(/\.txt$/i, "");
  const book = {
    title,
    manifest: new Map(),
    spine: chapters.map((c, i) => ({ href: `txt:${i}` })),
    opf: null,
    ncxPath: "",
    isTxt: true,
    fileSize: file.size,
    txtChapters: chapters
  };
  initStateForBook(book, title);
  state.tocEntries = chapters.map((c, i) => ({
    label: c.title,
    path: `txt:${i}`,
    fragment: "",
    chapterIndex: i,
    depth: c.depth
  }));
  state.navUnits = buildNavUnits(state.tocEntries, state.book);
  await finishOpenBook(file, title);
}

async function openBookFile(file) {
  cancelSearchScan();
  clearSearchResults();
  if (/\.txt$/i.test(file.name)) await openText(file);
  else await openEpub(file);
}

async function makeResourceUrl(path) {
  if (state.urls.has(path)) return state.urls.get(path);
  const data = await state.zip.read(path);
  const type = state.mediaByPath?.get(path) || "application/octet-stream";
  const url = URL.createObjectURL(new Blob([data], {type}));
  state.urls.set(path, url);
  return url;
}

/* ---------- 整书模式媒体懒解压 ---------- */
function materializeResource(el) {
  const attr = el.getAttribute("data-rattr") || "src";
  const rpath = el.getAttribute("data-rpath");
  if (!rpath) return Promise.resolve();
  return makeResourceUrl(rpath)
    .then(u => {
      if (el.isConnected) el.setAttribute(attr, u);
      if (el.getAttribute("data-rpath") === rpath) {
        el.removeAttribute("data-rpath");
        el.removeAttribute("data-rattr");
      }
    })
    .catch(() => {});
}

function installLazyResources(win, doc) {
  if (!state.book || !state.zip || state.book.isTxt) return;
  const els = [...doc.querySelectorAll("[data-rpath]")];
  if (!els.length) return;
  const book = state.book;
  if (typeof win.IntersectionObserver !== "function") {
    els.forEach(el => materializeResource(el));   /* 兜底: 无 IO 环境退回全部加载 */
    return;
  }
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < 4 && queue.length) {
      const el = queue.shift();
      active++;
      materializeResource(el).then(() => { active--; pump(); });
    }
  };
  const io = new win.IntersectionObserver(entries => {
    if (state.book !== book) { io.disconnect(); return; }
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      queue.push(en.target);
    }
    pump();
  }, { rootMargin: "600px 0px" });
  els.forEach(el => io.observe(el));
}

async function replaceAsync(str, re, fn) {
  const parts = [];
  let last = 0;
  str.replace(re, (...args) => {
    const offset = args[args.length - 2];
    parts.push(str.slice(last, offset), fn(...args));
    last = offset + args[0].length;
    return args[0];
  });
  parts.push(str.slice(last));
  return (await Promise.all(parts)).join("");
}

async function rewriteCss(cssText, basePath, depth = 0) {
  if (!cssText || depth > 3) return cssText;
  /* 竖排开关未开时剥除书籍自带 writing-mode(野生竖排书在横向约束下会被裁剪成白屏);
     用户开竖排后保留书籍声明与注入样式叠加 */
  if (!state.vertical) cssText = cssText.replace(/(?:-(?:webkit|moz|ms)-)?writing-mode\s*:[^;}{]+;?/gi, "");
  const resolveRef = async ref => {
    ref = ref.trim().replace(/^["']|["']$/g, "");
    if (!ref || /^(data:|blob:|https?:|about:|#)/i.test(ref)) return null;
    const path = resolvePath(basePath, ref);
    let url = null;
    try { url = await makeResourceUrl(path); } catch {}
    return { path, url };
  };
  cssText = await replaceAsync(cssText, /@import\s+(?:url\(\s*)?(['"]?)([^'")\s]+)\1\s*\)?\s*;/gi, async (m, _q, ref) => {
    const r = await resolveRef(ref);
    if (!r) return m;
    try {
      const inner = await state.zip.readText(r.path);
      return await rewriteCss(inner, r.path, depth + 1);
    } catch { return m; }
  });
  return replaceAsync(cssText, /url\(\s*(['"]?)([^'"]+?)\1\s*\)/gi, async (m, _q, ref) => {
    if (/^\s*(data:|blob:)/i.test(ref)) return m;
    const r = await resolveRef(ref);
    return r?.url ? `url("${r.url}")` : m;
  });
}

async function prepareSpineBody(item, fileIdx, whole) {
  const path = resolvePath(state.opfPath, item.href);
  const html = await state.zip.readText(path);
  const doc = parseHtmlDoc(html);
  sanitizeDoc(doc);
  const body = doc.body || doc.documentElement;

  const resources = new Set([
    ...body.querySelectorAll("img[src],image[href],image[xlink\\:href],audio[src],video[src],source[src],track[src],use[href],use[xlink\\:href]"),
    ...body.querySelectorAll("[poster]"),
    ...body.querySelectorAll("[srcset]"),
    /* XHTML按XML解析时Chrome的属性选择器匹配不到带前缀的xlink:href, 类型选择器兜底(svg image/use) */
    ...body.querySelectorAll("svg image, svg use")
  ]);
  const resolveRes = async val => {
    if (!val || val.startsWith("#") || /^(data:|https?:|blob:)/i.test(val)) return null;
    return await makeResourceUrl(resolvePath(path, val)).catch(() => null);
  };
  await Promise.all([...resources].map(async el => {
    /* srcset: 分章模式逐候选拼blob重写; 整书懒加载模式必须摘除——浏览器优先取srcset候选,
       相对URL裂图且会绕过data-rpath占位换源机制 */
    if (el.hasAttribute("srcset")) {
      if (whole) { el.removeAttribute("srcset"); }
      else {
        const out = [];
        for (const cand of el.getAttribute("srcset").split(",")) {
          const seg = cand.trim();
          if (!seg) continue;
          const sp = seg.search(/\s/);
          const u = sp < 0 ? seg : seg.slice(0, sp);
          const desc = sp < 0 ? "" : " " + seg.slice(sp + 1).trim();
          const url = await resolveRes(u);
          out.push((url || u) + desc);
        }
        el.setAttribute("srcset", out.join(", "));
      }
    }
    const attr = el.hasAttribute("src") ? "src" : el.hasAttribute("poster") ? "poster" : el.hasAttribute("href") ? "href" : "xlink:href";
    const val = el.getAttribute(attr);
    if (!val || val.startsWith("#") || val.startsWith("data:") || /^(https?:|blob:)/i.test(val)) return;
    const rpath = resolvePath(path, val);
    if (whole) {
      /* 整书模式: 不立即解压, 记录路径等进入视口再换真资源(installLazyResources) */
      el.setAttribute("data-rpath", rpath);
      el.setAttribute("data-rattr", attr);
      if (el.localName === "img" || el.localName === "image" || attr === "poster")
        el.setAttribute(attr, LAZY_PLACEHOLDER);
      else
        el.removeAttribute(attr);   /* audio/video/source/track/use 不占版面, 直接摘除 */
      return;
    }
    try { el.setAttribute(attr, await makeResourceUrl(rpath)); } catch {}
  }));
  let headCss = "";
  await Promise.all([...doc.querySelectorAll("link[href]")].map(async link => {
    const href = link.getAttribute("href");
    if (!href || /^(https?:|data:|blob:)/i.test(href)) return;
    const sig = `${link.getAttribute("rel") || ""} ${link.getAttribute("type") || ""}`;
    const isCss = /stylesheet|text\/css/i.test(sig);
    try {
      const cssPath = resolvePath(path, href);
      if (isCss) {
        const key = `css:${cssPath}`;
        let url = state.urls.get(key);
        if (!url) {
          const cssText = await state.zip.readText(cssPath);
          url = URL.createObjectURL(new Blob([await rewriteCss(cssText, cssPath)], { type: "text/css" }));
          state.urls.set(key, url);
        }
        link.setAttribute("href", url);
        if (link.closest("head")) headCss += link.outerHTML;
      } else {
        link.setAttribute("href", await makeResourceUrl(cssPath));
      }
    } catch {}
  }));
  await Promise.all([...doc.querySelectorAll("style")].map(async st => {
    st.textContent = await rewriteCss(st.textContent || "", path);
  }));
  for (const st of doc.querySelectorAll("head style")) headCss += st.outerHTML;

  if (whole) {
    for (const el of body.querySelectorAll("img,video")) {
      el.setAttribute("loading", "lazy");
      el.setAttribute("decoding", "async");
    }
    for (const el of body.querySelectorAll("[id]")) el.setAttribute("id", `${fileIdx}_${el.getAttribute("id")}`);
    for (const el of body.querySelectorAll("[name]")) el.setAttribute("name", `${fileIdx}_${el.getAttribute("name")}`);
    for (const a of body.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") || "";
      if (/^(https?:|blob:|data:|mailto:)/i.test(href)) continue;
      if (href.startsWith("#")) { a.setAttribute("href", `#${fileIdx}_${href.slice(1)}`); continue; }
      const hi = href.indexOf("#");
      const filePart = hi >= 0 ? href.slice(0, hi) : href;
      const frag = hi >= 0 ? href.slice(hi + 1) : "";
      try {
        const target = resolvePath(path, filePart);
        const idx = state.book.spine.findIndex(x => resolvePath(state.opfPath, x.href) === target);
        if (idx >= 0) a.setAttribute("href", frag ? `#${idx}_${frag}` : `#sp${idx}`);
      } catch {}
    }
  }
  return { path, headCss, bodyHtml: body.outerHTML };
}

async function renderChapter(item) {
  if (state.book.isTxt) {
    state.chapterPath = "";
    return renderTxtChapter(state.book.txtChapters[state.chapterIndex]);
  }
  const prep = await prepareSpineBody(item, state.chapterIndex, false);
  state.chapterPath = prep.path;
  const {bg, fg} = readerColors();
  return buildChapterDoc({bg, fg, headCss: prep.headCss, bodyHtml: prep.bodyHtml});
}

async function renderWholeBook() {
  const {bg, fg} = readerColors();
  if (state.book.isTxt) {
    state.chapterPath = "";
    const parts = state.book.txtChapters.map((ch, i) => {
      const title = ch.showTitle ? `<h2 id="sp${i}">${escTxt(ch.title)}</h2>` : `<div id="sp${i}" style="height:0"></div>`;
      return `${title}${txtLinesHtml(ch.lines)}`;
    });
    return buildChapterDoc({bg, fg, bodyHtml: parts.join("<hr>\n"),
      extraCss: `h2{font-size:1.35em;font-weight:700;text-align:center;margin:2em 0 1.5em;line-height:1.4;} .content{white-space:pre-wrap;} ${TXT_LN_CSS} hr{border:0;border-top:1px solid rgba(127,127,127,.25);margin:2.5em 0;}`});
  }
  const parts = [];
  let headCss = "";
  for (let i = 0; i < state.book.spine.length; i++) {
    let prep;
    try {
      prep = await prepareSpineBody(state.book.spine[i], i, true);
    } catch (err) {
      /* 整书模式逐节隔离: 坏节渲染占位, 不拖垮全书 */
      console.warn("整书模式章节失败", err);
      parts.push(`<section class="spinePart" id="sp${i}"><p>${escTxt(t("chapFailTitle"))}</p></section>`);
      continue;
    }
    headCss += prep.headCss;
    parts.push(`<section class="spinePart" id="sp${i}">${prep.bodyHtml}</section>`);
  }
  state.chapterPath = "";
  return buildChapterDoc({bg, fg, headCss, bodyHtml: parts.join("\n"),
    extraCss: `.spinePart + .spinePart{border-top:1px solid rgba(127,127,127,.25);margin-top:2em;padding-top:2em;}`});
}

let renderGen = 0;

function buildChapterDoc({bg, fg, headCss = "", bodyHtml, extraCss = ""}) {
  const paged = state.readMode === "paged";
  /* iframe不继承父页主题变量: 打字/高亮注入样式所需的派生色一并算好内联 */
  const muted = (() => {
    const pm = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : [136, 136, 136]; };
    const f = pm(fg), b = pm(bg);
    return "#" + [0, 1, 2].map(i => Math.round(f[i] * 0.55 + b[i] * 0.45).toString(16).padStart(2, "0")).join("");
  })();
  const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#e07a3f";
  const inner = paged ? `<div class="pgflow">${bodyHtml}</div>` : bodyHtml;
  const pagedStyle = paged ? pagedCss(pagedPageWidth()) : "";
  /* 竖排一期: 右起左行; pagedCss 的 height:100% 保留(多列分页依赖), 仅叠加 writing-mode;
     滚动模式(foliate-js 方案): 竖排下 width=块轴(列数), height=行内轴(列长);
     html,body 尺寸归零解除约束; body max-height 锁定行内轴为一屏; body>* max-width:none 放开块轴让内容自然扩展; overflow-x:auto 启用列间水平滚动 */
  const vertStyle = state.vertical
    ? (paged
        ? `body{writing-mode:vertical-rl;} .pgflow img,.pgflow svg,.pgflow video{max-width:calc(100% - 24px);}
           html{overflow-x:auto;overflow-y:hidden;} body{overflow:visible;}`
        : `html,body{height:auto;width:auto;min-height:0;} body{writing-mode:vertical-rl;max-height:100vh;overflow-x:auto;overflow-y:hidden;padding:48px 0;} body>*{max-width:none;} img,svg,video{max-width:calc(100vh - 80px);max-height:calc(100vw - 80px);}`)
    : `html,body{writing-mode:horizontal-tb !important;}`;   /* 兜底: 压制书籍内联竖排样式 */
  /* 书籍字体优先: 字体栈注入在书籍样式之前, 书籍任何字体声明(含@font-face内嵌)自然覆盖;
     强制模式: 注入回书籍样式之后并加!important做正文级替换(保留书籍标题专用字体与图标字体) */
  const preFont = state.bookFontFirst ? `<style>body{font-family:${fontFamilyCss()};}</style>` : "";
  const famDecl = state.bookFontFirst ? "" : `font-family:${fontFamilyCss()} !important;`;
  /* 拼音注音: 样式只作用于外挂产生的 ruby.py(书籍原生注音保持作者排版); 行高不足1.9时抬升避免上下行注音挤压 */
  if (!state.bookHasRuby && /<ruby[\s>]/i.test(bodyHtml)) state.bookHasRuby = true;   /* 书级标志: 开外挂时用于提醒 */
  const pinyinCss = state.showPinyin
    ? `<style>ruby.py{ruby-position:over;}ruby.py>rt{font-size:.55em;opacity:.7;user-select:none;}body{line-height:max(${state.lineHeight},1.9);}</style>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${BOOK_CSP}">${preFont}${headCss}<style>
    html,body{margin:0;padding:0;background:${bg};color:${fg};}
    body{${famDecl}font-size:${state.fontSize}px;line-height:${state.lineHeight};padding:48px max(24px,5vw);box-sizing:border-box;min-height:100vh;overflow-y:auto;overflow-x:hidden;}
    body>*{max-width:100%;} img,svg,video{max-width:100%;height:auto;} pre{white-space:pre-wrap;overflow:auto;}
    a{color:inherit;} p{text-align:justify;} h1,h2,h3,h4,h5,h6{break-after:avoid;}
    img,figure,table,pre,blockquote{break-inside:avoid;}
    /* 马克笔高亮(样式必须注入章节文档, 父页reader.css不作用于iframe) */
    mark.mkHl{background:var(--hlc,#ffe066);color:inherit;border-radius:2px;padding:0 1px;box-decoration-break:clone;-webkit-box-decoration-break:clone;}
    .mkMode,.mkMode *{cursor:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M3 21l2-6L16 4l4 4L9 19z" fill="%23ffe066" stroke="%23333" stroke-width="1.4"/></svg>') 4 20, text !important;}
    /* 打字模式token(同上须注入): 待打文本下划线强调, 不加灰底不压暗, 尽量不干扰阅读 */
    .twTok .twB{border-bottom:2px solid ${accent};}
    .twTok .twA{font-weight:600;}
    ruby.twTok{ruby-position:over;}
    ruby.twTok>rt{font-size:.55em;opacity:.7;user-select:none;}
    .twTok.twCur .twA{color:${fg};font-weight:600;}
    .twTok.twCur .twB{border-bottom:2px solid ${accent};}
    .twTok.twGot .twA,.twTok.twGot .twB{border-bottom:none;}
    .twTok.twErr{background:#b3402f !important;color:#fff !important;animation:twShake .2s ease;}
    .twTok.twErr .twA,.twTok.twErr .twB{color:#fff;}
    @keyframes twShake{0%,100%{transform:none}50%{transform:translateX(2px)}}
    @media (prefers-reduced-motion:reduce){.twTok.twErr{animation:none}}
    .twGrayBlock{cursor:default;}
    /* 纯拼音替换文本 */
    .pyRep{opacity:.92;}
    html{scroll-behavior:smooth;overscroll-behavior:contain;}
    @media (prefers-reduced-motion:reduce){html{scroll-behavior:auto;} .pgflow{transition:none !important;}}
    ${extraCss}
    ${pagedStyle}
    ${vertStyle}
    ${pinyinCss}
  </style></head><body>${inner}</body></html>`;
}

/* TXT正文渲染: 短章pre-wrap整块; 超过2000行逐行块化(.ln), 让拼音观察器可按行粒度调度 */
const escTxt = s => s.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
const TXT_SPLIT_LINES = 2000;
const TXT_LN_CSS = `.lnmode{white-space:normal;} .ln{min-height:1em;white-space:pre-wrap;}`;
function txtLinesHtml(lines) {
  if (lines.length <= TXT_SPLIT_LINES) {
    const ps = lines.map(l => l ? `<p>${escTxt(l)}</p>` : "").join("");
    return `<div class="content">${ps}</div>`;
  }
  return `<div class="content lnmode">` + lines.map(l => `<div class="ln">${escTxt(l)}</div>`).join("") + `</div>`;
}
function renderTxtChapter(ch) {
  const {bg, fg} = readerColors();
  const titleHtml = ch.showTitle ? `<h2>${escTxt(ch.title)}</h2>` : "";
  return buildChapterDoc({
    bg, fg,
    bodyHtml: `${titleHtml}${txtLinesHtml(ch.lines)}`,
    extraCss: `h2{font-size:1.35em;font-weight:700;text-align:center;margin:0 0 1.5em;line-height:1.4;} .content{white-space:pre-wrap;} .content p{margin:0;white-space:pre-wrap;} ${TXT_LN_CSS}`
  });
}

function buildNavUnits(entries, book) {
  const byFile = new Map();
  const seen = new Set();
  for (const e of entries) {
    const key = `${e.chapterIndex}|${e.fragment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!byFile.has(e.chapterIndex)) byFile.set(e.chapterIndex, []);
    byFile.get(e.chapterIndex).push({ i: e.chapterIndex, frag: e.fragment, label: e.label });
  }
  const units = [];
  for (let f = 0; f < book.spine.length; f++) {
    const list = byFile.get(f);
    if (list?.length) units.push(...list);
    else units.push({ i: f, frag: "", label: chapterTitle(book.spine[f], f) });
  }
  return units;
}
function unitKey(u) { return `${u.i}|${u.frag}`; }
function findUnit(i, frag) { const k = `${i}|${frag || ""}`; return state.navUnits.findIndex(u => unitKey(u) === k); }
function firstUnitOfFile(f) {
  const idx = state.navUnits.findIndex(u => u.i >= f);
  return idx >= 0 ? idx : Math.max(0, state.navUnits.length - 1);
}

async function showUnit(u, opts = {}) {
  if (!state.book || !state.navUnits.length) return;
  u = Math.max(0, Math.min(u, state.navUnits.length - 1));
  state.unitIdx = u;
  const unit = state.navUnits[u];
  await showChapter(unit.i, opts.noAnchor ? "" : unit.frag, opts);
  $("chapterLabel").textContent = unit.label;
}

async function showChapter(index, fragment = "", opts = {}) {
  if (!state.book) return;
  index = Math.max(0, Math.min(index, state.book.spine.length - 1));
  const gen = ++renderGen;
  autoJumping = true;
  clearTimeout(autoJumpTimer);
  autoJumpTimer = setTimeout(() => { autoJumping = false; }, 2000);
  state.chapterIndex = index;
  if (!opts.noAnchor) {
    const curUnit = state.navUnits[state.unitIdx];
    const matchesCur = curUnit && curUnit.i === index && (curUnit.frag || "") === (fragment || "");
    if (!matchesCur) {
      const exact = findUnit(index, fragment);
      state.unitIdx = exact >= 0 ? exact : firstUnitOfFile(index);
    }
  }
  const ratio = opts.initialRatio ?? (opts.restoreRatio ? currentScrollRatio() : 0);
  const frame = $("bookFrame");
  if (state.renderWhole && state.wholeLoaded) {
    runAfterLoad(frame.contentWindow, frame.contentDocument, fragment, opts, ratio);
    return;
  }
  let src;
  try {
    if (state.renderWhole) toast(t("layoutWhole"));
    src = state.renderWhole ? await renderWholeBook() : await renderChapter(state.book.spine[index]);
  } catch (err) {
    /* 单章损坏不拒开整本: 渲染错误占位页, 章节导航/进度照常(野生书常见个别文件缺失) */
    if (gen !== renderGen) return;   /* 已被更新的渲染取代, 静默丢弃, 交给当次调用方提示 */
    console.warn("章节加载失败", err);
    const { bg, fg } = readerColors();
    src = buildChapterDoc({ bg, fg,
      bodyHtml: `<div class="chapFail"><h2>${escTxt(t("chapFailTitle"))}</h2><p>${escTxt(t("chapFailBody"))}</p></div>`,
      extraCss: `.chapFail{max-width:34em;margin:16vh auto 0;text-align:center;opacity:.75;} .chapFail h2{font-size:1.25em;margin-bottom:.9em;}` });
  }
  if (gen !== renderGen) return;
  frame.srcdoc = src;
  frame.onload = () => {
    runAfterLoad(frame.contentWindow, frame.contentDocument, fragment, opts, ratio);
  };
  const unit = state.navUnits[state.unitIdx];
  const title = (unit && unit.i === index ? unit.label : "") ||
    state.tocEntries.find(x => x.chapterIndex === index)?.label || chapterTitle(state.book.spine[index], index);
  $("chapterLabel").textContent = title;
  try {
    localStorage.setItem(progressKey(state.book.title, state.book.fileSize), JSON.stringify({ i: index, u: state.unitIdx, r: ratio }));
  } catch {}
  updateToc();
}

function frameScrollHandler() {
  pyMarkMove();   /* 注音settle门控: 滚动中不出批 */
  scheduleProgressSave();
  scheduleScrollSync();
}

function runAfterLoad(win, doc, fragment, opts, ratio) {
  const frame = $("bookFrame");
  /* 外挂注音: romaji零依赖立即派发; pinyin库就绪立即派发, 未就绪(开书即带注音)则后台加载后补注 */
  if (state.showPinyin) {
    if (state.annotate === "romaji" || window.pinyinPro) pyDispatch(doc);
    else ensurePinyinLib().then(() => {
      if ($("bookFrame").contentDocument === doc) pyDispatch(doc);
    }).catch(() => {});
  }
  /* 打字模式: 新章节渲染完成后进入拾取态(点选段落开始) */
  if (state.typing && !doc.__twBound) {
    doc.__twBound = true;
    twEnterPick(doc);
  }
  /* 逐字阅读: 新章节涂覆+逐字显现(scratchEnter 幂等: 每文档只绑一次监听) */
  if (state.scratch) scratchEnter(doc);
  /* 马克笔: 模式光标 + 已存高亮回贴 + 划选/点击处理(每文档绑一次) */
  if (state.marker) doc.body.classList.add("mkMode");
  hlApplyAll(doc);
  if (!doc.__mkBound) {
    doc.__mkBound = true;
    doc.addEventListener("mouseup", () => setTimeout(() => hlFromSelection(win), 0));
    doc.addEventListener("click", e => {
      const mk = e.target.closest?.("mark.mkHl");
      if (mk && !state.marker) hlDelete(mk.dataset.hl, mk);
    });
  }
  autoJumping = false;
  clearTimeout(autoJumpTimer);
  autoChapterStart = performance.now();
  /* 键盘事件只派发给持焦文档: 开书/翻章后主动把焦点交给iframe, 免去先点一下阅读区 */
  try { win.focus(); } catch {}
  if (state.renderWhole) state.wholeLoaded = true;
  if (!doc.__readerBound) {
    doc.__readerBound = true;
    doc.addEventListener("keydown", handleKey);
    doc.addEventListener("scroll", frameScrollHandler, {passive:true});
    doc.addEventListener("click", onFrameClick);
    doc.addEventListener("click", closeOverlays);
    for (const ev of ["dragenter","dragover"]) doc.addEventListener(ev, dragHover);
    doc.addEventListener("dragleave", dragLeave);
    doc.addEventListener("drop", dropFile);
    /* 滚轮分发: 翻页模式→翻页手势; 竖排滚动→浏览器不映射垂直滚轮到块轴, 手动桥接; 横排滚动→原生 */
    doc.addEventListener("wheel", (e) => {
      if (pagedActive()) { pagedWheel(e); return; }
      if (!state.vertical || e.ctrlKey) return;
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      scrollByDelta(doc.defaultView, d);
    }, {passive:false});
    doc.addEventListener("touchstart", frameTouchStart, {passive:true});
    doc.addEventListener("touchmove", frameTouchMove, {passive:true});
    doc.addEventListener("touchend", frameTouchEnd, {passive:false});
  }
  if (doc.querySelector(".pgflow")) {
    setupPaged(doc);
    if (!pagedCtx) return;
    if (fragment) {
      const target = anchorElement(doc, state.chapterIndex, fragment);
      const pg = target && anchorToPage(target);
      gotoPage(pg == null ? 0 : pg, true);
    } else if (opts.highlightTerm) {
      const mark = highlightSearchHit(doc, state.chapterIndex, opts);
      const pg = mark && anchorToPage(mark);
      gotoPage(pg == null ? 0 : pg, true);
    } else if (opts.initialRatio > 0) {
      gotoPage(Math.round(ratio * (pagedCtx.pages - 1)), true);
    }
    updateProgress();
    return;
  }
  pagedCtx = null;
  $("pageInfo").hidden = true;
  if (opts.restoreRatio) {
    const max = scrollMax(win);
    scrollToPos(win, max > 0 ? Math.round(ratio * max) : 0);
  } else if (fragment) {
    const target = anchorElement(doc, state.chapterIndex, fragment);
    if (target) target.scrollIntoView({block:"start"});
    else scrollToPos(win, 0);
  } else if (opts.highlightTerm) {
    const mark = highlightSearchHit(doc, state.chapterIndex, opts);
    if (mark) mark.scrollIntoView({block:"center"});
    else scrollToPos(win, 0);
  } else if (opts.initialRatio != null) {
    const max = scrollMax(win);
    scrollToPos(win, max > 0 ? Math.round(ratio * max) : 0);
  } else if (state.renderWhole) {
    const sec = anchorElement(doc, state.chapterIndex, "");
    if (sec) sec.scrollIntoView({block:"start"});
    else scrollToPos(win, 0);
  } else {
    scrollToPos(win, 0);
  }
  if (state.renderWhole) installLazyResources(win, doc);
  buildScrollMarks(doc);
  syncScrollUnit();
  updateProgress();
}

function onFrameClick(e) {
  const a = e.target?.closest?.("a[href]");
  if (!a || !state.book) return;
  const href = a.getAttribute("href");
  if (!href) return;
  if (/^https?:/i.test(href)) {
    e.preventDefault();
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  if (/^(blob:|data:)/i.test(href)) return;
  if (href.startsWith("#")) {
    e.preventDefault();
    const doc = $("bookFrame").contentDocument;
    let id = href.slice(1);
    try { id = decodeURIComponent(id); } catch {}
    const target = resolveAnchor(doc, id);
    if (!target) return;
    if (pagedActive()) gotoPage(anchorToPage(target));   /* 多列布局纵向滚动无效, 按列翻页 */
    else target.scrollIntoView({behavior: REDUCED_MOTION ? "instant" : "smooth", block:"start"});
    return;
  }
  e.preventDefault();
  const path = resolvePath(state.chapterPath || "", href);
  const frag = hrefFragment(href);
  const idx = state.book.spine.findIndex(x => resolvePath(state.opfPath, x.href) === path);
  if (idx < 0) { toast(t("linkOutsideSpine", href.split("#")[0])); return; }
  if (idx !== state.chapterIndex) safeShow(idx, frag);
  else if (frag) {
    const target = resolveAnchor($("bookFrame").contentDocument, frag);
    if (!target) return;
    if (pagedActive()) gotoPage(anchorToPage(target));
    else target.scrollIntoView({block:"start"});
  }
}

let toastTimer = 0;
function toast(msg, opts = {}) {
  let el = $("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  clearTimeout(toastTimer);
  const prevAct = el.querySelector(".toastAct");
  if (prevAct) prevAct.remove();
  let msgSpan = el.querySelector(".toastMsg");
  if (!msgSpan) {
    msgSpan = document.createElement("span");
    msgSpan.className = "toastMsg";
    el.textContent = "";
    el.appendChild(msgSpan);
  }
  msgSpan.textContent = msg;
  el.classList.toggle("hasAction", !!opts.action);
  if (opts.action) {
    const b = document.createElement("button");
    b.className = "toastAct";
    b.textContent = opts.action.label;
    b.onclick = () => {
      clearTimeout(toastTimer);
      el.classList.remove("show");
      opts.action.fn();
    };
    el.appendChild(b);
  }
  /* 锚定模式: 出现在触发元素附近(优先上方, 放不下换下方, 视口内钳位), 无锚点回落屏幕底部居中 */
  const anchor = opts.anchor;
  if (anchor && anchor.isConnected) {
    el.classList.add("anchored");
    el.style.left = "0px";
    el.style.top = "0px";
    const r = anchor.getBoundingClientRect();
    const tr = el.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2;
    let y = r.top - tr.height - 8;
    if (y < 8) y = r.bottom + 8;
    x = Math.max(8, Math.min(window.innerWidth - tr.width - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - tr.height - 8, y));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  } else {
    el.classList.remove("anchored");
    el.style.left = "";
    el.style.top = "";
  }
  el.classList.add("show");
  toastTimer = setTimeout(() => el.classList.remove("show"), opts.action ? 5200 : 2400);
}

function closeOverlays() {
  if (!state.sidebarPinned) $("sidebar").classList.remove("open");
  if (!state.settingsPinned) setSettingsOpen(false);
  syncOverlayAria();
}

function getPageHeight() {
  const frame = $("bookFrame");
  /* 竖排: 一屏的块轴尺寸是物理宽度(列间滚动方向); 横排: 物理高度 */
  return Math.max(1, (state.vertical ? frame.clientWidth : frame.clientHeight) - 96);
}

function updateProgress() {
  if (!state.book) { $("progress").textContent = "—"; return; }
  $("progress").textContent = state.navUnits.length
    ? t("progressLabel", state.unitIdx + 1, state.navUnits.length)
    : "—";
}

function renderToc(entries) {
  const toc = $("toc");
  toc.textContent = "";
  for (const entry of entries) {
    const b = document.createElement("button");
    b.className = "tocItem";
    b.dataset.chapter = entry.chapterIndex;
    b.dataset.path = entry.path;
    b.dataset.fragment = entry.fragment;
    b.dataset.ukey = `${entry.chapterIndex}|${entry.fragment}`;
    if (entry.depth > 0) {
      b.classList.add("tocSub");
      b.style.paddingLeft = `${10 + entry.depth * 18}px`;
    }
    const title = document.createElement("span");
    title.className = "tocTitle";
    title.textContent = entry.label;
    b.append(title);
    b.onclick = () => {
      const ui = findUnit(entry.chapterIndex, entry.fragment);
      if (ui >= 0) safeShowUnit(ui);
      else safeShow(entry.chapterIndex, entry.fragment);
      $("sidebar").classList.remove("open");
    };
    toc.appendChild(b);
  }
  updateToc();
}

function updateToc() {
  const cur = state.navUnits[state.unitIdx];
  const ck = cur ? unitKey(cur) : null;
  [...$("toc").children].forEach(x => x.classList.toggle("active", x.dataset.ukey === ck));
}

function safeShow(index, fragment = "", opts = {}) {
  showChapter(index, fragment, opts).catch(err => alert(t("chapterFail", err.message)));
}
function safeShowUnit(u, opts = {}) { showUnit(u, opts).catch(err => alert(t("chapterFail", err.message))); }
function jumpToUnit(to) {
  const from = state.unitIdx;
  to = Math.max(0, Math.min(to, state.navUnits.length - 1));
  const frame = $("bookFrame");
  const doc = frame.contentDocument;
  state.unitIdx = to;
  const unit = state.navUnits[to];
  state.chapterIndex = unit.i;
  $("chapterLabel").textContent = unit.label;
  updateProgress();
  updateToc();
  const el = doc && anchorElement(doc, unit.i, unit.frag);
  if (el) el.scrollIntoView({behavior:"instant", block:"start"});
  else if (doc && frame.contentWindow) {
    const win = frame.contentWindow;
    const end = to > from ? scrollMax(win) : 0;
    scrollToPos(win, end);
  }
}
function nextChapter() {
  if (!state.book) return;
  if (state.renderWhole) { jumpToUnit(state.unitIdx + 1); return; }
  if (state.unitIdx < state.navUnits.length - 1) safeShowUnit(state.unitIdx + 1);
}
function prevChapter() {
  if (!state.book) return;
  if (state.renderWhole) { jumpToUnit(state.unitIdx - 1); return; }
  if (state.unitIdx > 0) safeShowUnit(state.unitIdx - 1);
}

let autoRafId = 0, autoLast = 0, autoJumping = false, autoJumpTimer = 0, autoChapterStart = 0;

function autoTick(ts) {
  if (!state.auto) return;
  const dt = Math.min(0.1, (ts - (autoLast || ts)) / 1000);
  autoLast = ts;
  const win = $("bookFrame").contentWindow;
  try {
    if (win?.document && !autoJumping && state.readMode === "paged") {
      const delay = Math.max(500, state.autoPageInterval / state.autoSpeedMult);
      if (pagedCtx
          && performance.now() - autoChapterStart >= delay
          && performance.now() - lastAutoFlip >= delay) {
        lastAutoFlip = performance.now();
        const atEnd = state.chapterIndex >= state.book.spine.length - 1
          && state.pageIdx >= pagedCtx.pages - 1;
        if (atEnd) { setAuto(false); return; }
        flipPage(1);
      }
    } else if (win?.document && !autoJumping) {
      /* 竖排: 自动滚动前进=物理向左(负left); 横排: 物理向下 */
      const autoDelta = state.autoScrollSpeed * win.innerHeight * state.autoSpeedMult * dt;
      if (state.vertical) win.scrollBy({ left: -autoDelta, behavior: "instant" });
      else win.scrollBy({ top: autoDelta, behavior: "instant" });
      const docEl = win.document.documentElement;
      const atEnd = state.vertical
        ? -(win.scrollX || 0) + (win.innerWidth || 0) >= (docEl.scrollWidth || 0) - 2
        : (win.scrollY || 0) + (win.innerHeight || 0) >= (docEl.scrollHeight || 0) - 2;
      if (atEnd && !autoJumping
          && performance.now() - autoChapterStart >= 1500) {
        if (state.renderWhole) { setAuto(false); return; }
        if (state.chapterIndex < state.book.spine.length - 1) {
          showUnit(firstUnitOfFile(state.chapterIndex + 1))
            .catch(err => { alert(t("autoFlipFail", err.message)); setAuto(false); });
        }
        else { setAuto(false); return; }
      }
    }
  } catch {}
  autoRafId = requestAnimationFrame(autoTick);
}

let lastAutoFlip = 0;

function setAuto(on) {
  state.auto = on;
  $("autoBtn").innerHTML = on ? ICONS.pause : ICONS.play;
  $("autoBtn").classList.toggle("active", on);
  $("autoBtn").setAttribute("aria-pressed", String(on));
  $("speedCtl").hidden = !on;
  cancelAnimationFrame(autoRafId);
  if (on) { autoLast = 0; lastAutoFlip = performance.now(); autoRafId = requestAnimationFrame(autoTick); }
  else updateProgress();
}

function handleKey(e) {
  const el = e.target;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName))) {
    if (e.key === "Escape") { el.blur?.(); if (!state.sidebarPinned) $("sidebar").classList.remove("open"); if (!state.settingsPinned) setSettingsOpen(false); syncOverlayAria(); }
    return;
  }
  /* 马克笔模式下Esc退出(打字模式优先消费自己的Esc) */
  if (state.marker && e.key === "Escape" && !state.typing) { setMarker(false); return; }
  /* 逐字阅读模式: Esc退出 */
  if (state.scratch && e.key === "Escape") { setScratch(false); return; }
  /* 打字模式优先: 字母键喂入引擎(输入条未聚焦时的兜底路径); 空格禁用(避免误触翻段); Esc退出, Tab跳词 */
  if (state.typing) {
    if (e.key === "Escape") { setTyping(false); return; }
    if (e.key === "Tab") {
      e.preventDefault();
      if (state.twReal) twSkipReal(); else twSkip();
      return;
    }
    if (e.key === " ") { e.preventDefault(); return; }
    /* 真打字模式: 字母属于IME组合, 不走keydown兜底(由input上屏事件处理) */
    if (state.twReal) return;
    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      /* 拾取态尚未点选段落: 提示而非静默吞掉 */
      if (twState?.phase === "pick") { twPickNudge(); return; }
      twFeed(e.key.toLowerCase());
      return;
    }
  }
  const paged = state.readMode === "paged";
  if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); paged ? flipPage(1) : nextPage(); }
  else if (e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); paged ? flipPage(-1) : prevPage(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); paged ? flipPage(state.vertical ? -1 : 1) : nextChapter(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); paged ? flipPage(state.vertical ? 1 : -1) : prevChapter(); }
  else if (e.key === "Escape") { closeOverlays(); setShelfEditMode(false); }
}

function applyTheme() {
  let dark = state.theme === "dark";
  if (state.theme === "custom") {
    const ct = currentCustom();
    if (ct) dark = lum(ct.bg) < 0.5;
  }
  document.body.classList.toggle("dark", dark);
  document.body.classList.toggle("sepia", state.theme === "sepia");
  document.body.classList.toggle("white", state.theme === "white");
  document.body.classList.toggle("green", state.theme === "green");
  applyCustomTheme();
  syncThemeChips();
  syncThemeColor();
  localStorage.setItem("theme", state.theme);
}
/* 浏览器/系统 UI 随主题变色: 取当前 --bg 计算值写入 theme-color meta */
function syncThemeColor() {
  const bg = getComputedStyle(document.body).getPropertyValue("--bg").trim();
  if (bg) document.querySelector('meta[name="theme-color"]').content = bg;
}

/* 用户偏好减少动效: 平滑滚动降级为瞬时跳转(过渡动画由 CSS media query 关闭) */
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- i18n ---------- */
function syncLangChips() {
  const saved = localStorage.getItem("lang");
  const active = saved === "zh" || saved === "en" ? saved : "";
  for (const b of document.querySelectorAll(".langChip")) {
    const on = b.dataset.lang === active;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  }
}
function applyI18n() {
  invalidateLangCache();
  document.documentElement.lang = currentLang() === "en" ? "en" : "zh-CN";
  applyI18nStatic();
  /* 标签文案随语言变化宽度, 重算激活tab下划线位置 */
  if (tabIndicator) moveTabIndicator(document.querySelector(".setTab.active"));
  /* 静态覆盖会重置章节标签, 开书状态下恢复为当前单元标题 */
  if (state.book) {
    const u = state.navUnits[state.unitIdx];
    if (u) $("chapterLabel").textContent = u.label;
  }
  applySideMax();
  updateProgress();
  /* 切换语言时清空旧语言的搜索结果与状态(保留输入词) */
  if ($("searchStatus").textContent || $("searchResults").children.length) clearSearchResults();
  renderCustomSlots();
  syncLangChips();
  renderShelf();
}
function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return [h, s * 100, l * 100];
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const to = v => Math.round(f(v) * 255).toString(16).padStart(2, "0");
  return "#" + to(0) + to(8) + to(4);
}
/* 纸面为锚的全套外壳派生: 界面底色同色相深一档; 强调色微偏补色(+30°), 中性纸回落暖灰;
   饱和上限与明度窗放宽让强调色更鲜(仍保证与浅色文字的可读对比) */
function derivePalette(paperHex) {
  const [h, s, l] = hexToHsl(paperHex);
  const shell = hslToHex(h, Math.max(0, s - 4), Math.min(94, Math.max(8, l - 4)));
  const dk = lum(shell) < 0.5;
  const ah = (h + 30) % 360;
  return {
    ui: shell,
    border: shade(shell, dk ? 0.18 : -0.14),
    button: shade(shell, dk ? 0.13 : -0.08),
    muted: dk ? "#918b81" : "#77736c",
    accent: s < 8 ? (dk ? "#8a857b" : "#635b4f")
      : dk ? hslToHex(ah, Math.min(s + 26, 85), Math.min(l + 22, 72))
           : hslToHex(ah, Math.min(s + 26, 78), Math.max(34, Math.min(44, l - 42)))
  };
}
function applyCustomTheme() {
  /* 变量必须内联在 body 上: body.dark/.sepia 样式表块声明在 body 自身,
     按 CSS 级联规则会压过从 html 继承的值, 导致深色纸面被内置常量顶掉 */
  const rs = document.body.style;
  const VARS = ["--bg","--bar","--border","--button","--fg","--muted","--accent","--reader-bg"];
  for (const v of VARS) rs.removeProperty(v);
  if (state.theme !== "custom") return;
  const ct = currentCustom();
  if (!ct) return;
  const adv = ct.adv || {};
  const d = derivePalette(ct.bg);
  const ui = adv.ui || d.ui;
  const [r, g, b] = hexToRgb(ui);
  rs.setProperty("--bg", ui);
  /* 顶栏=界面底色的半透明形态, 不作为独立颜色暴露 */
  rs.setProperty("--bar", `rgba(${r},${g},${b},${lum(ui) < .5 ? .95 : .94})`);
  rs.setProperty("--border", adv.border || d.border);
  rs.setProperty("--button", adv.button || d.button);
  rs.setProperty("--fg", adv.fg || ct.fg);   /* 界面文字默认随阅读文字(内置主题同口径) */
  rs.setProperty("--muted", adv.muted || d.muted);
  rs.setProperty("--accent", adv.accent || d.accent);
  rs.setProperty("--reader-bg", ct.bg);
}
function syncThemeChips() {
  for (const b of document.querySelectorAll(".themeChip[data-theme]")) {
    const on = b.dataset.theme === state.theme;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  }
  for (const b of document.querySelectorAll(".slotChip")) {
    const on = state.theme === "custom" && Number(b.dataset.slot) === state.customSlotIdx;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  }
}
function saveCustomThemes() {
  try { localStorage.setItem("customThemes", JSON.stringify(state.customSlots)); } catch {}
  try { localStorage.setItem("customSlot", String(state.customSlotIdx)); } catch {}
}
const ADV_IDS = [["advUi","ui"],["advFg","fg"],["advMuted","muted"],["advBorder","border"],["advButton","button"],["advAccent","accent"]];
function syncCustomPickers() {
  const ct = currentCustom() || { bg: "#fbfaf7", fg: "#292725", adv: {} };
  $("ctBg").value = ct.bg;
  $("ctFg").value = ct.fg;
  ct.adv ||= {};
  const d = derivePalette(ct.bg);
  for (const [id, key] of ADV_IDS) {
    $(id).value = ct.adv[key] || d[key];
    $(id).closest(".advRow").classList.toggle("overridden", !!ct.adv[key]);
  }
}
function renderCustomSlots() {
  const wrap = $("slotChips");
  wrap.textContent = "";
  state.customSlots.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "themeChip slotChip";
    b.dataset.slot = i;
    b.textContent = t("customSlotN", i + 1);
    b.onclick = () => selectCustomSlot(i);
    wrap.appendChild(b);
  });
  syncThemeChips();
}
function selectCustomSlot(i) {
  state.customSlotIdx = i;
  saveCustomThemes();
  state.theme = "custom";
  applyTheme();
  applySide();
  syncCustomPickers();
  rerenderReader();
}
function applyFont() { localStorage.setItem("fontSize", String(state.fontSize)); }
function applyTypography() {
  localStorage.setItem("lineHeight", String(state.lineHeight));
  localStorage.setItem("fontFamily", state.fontFamily);
}
function rerenderReader() {
  if (!state.book || !state.navUnits.length) return;
  if (state.readMode === "paged") safeShowUnit(state.unitIdx, {});
  else if (state.renderWhole && state.wholeLoaded) restyleWholeDoc();
  else safeShowUnit(state.unitIdx, {restoreRatio:true});
}

function restyleWholeDoc() {
  const doc = $("bookFrame").contentDocument;
  const b = doc?.body;
  if (!b) return;
  const {bg, fg} = readerColors();
  b.style.fontSize = `${state.fontSize}px`;
  b.style.lineHeight = state.lineHeight;
  b.style.color = fg;
  b.style.background = bg;
  /* 字体不设内联(内联会压过书籍CSS): 由 buildChapterDoc 注入的样式块按"书籍字体优先"开关决定层叠结果 */
  b.style.fontFamily = "";
  doc.documentElement.style.background = bg;
}

function bindSetting(rangeId, numId, opts) {
  const r = $(rangeId), n = $(numId);
  const clamp = v => Math.min(opts.max, Math.max(opts.min, v));
  const toSlider = opts.toSlider || (v => String(v));
  const fromSlider = opts.fromSlider || (v => v);
  const show = opts.show || (v => String(v));
  const refresh = () => { r.value = toSlider(state[opts.key]); n.value = show(state[opts.key]); };
  const apply = v => {
    state[opts.key] = clamp(v);
    refresh();
    opts.onInput?.();
    opts.onChange?.();
  };
  const step = d => apply(state[opts.key] + d);
  r.addEventListener("input", () => {
    state[opts.key] = fromSlider(Number(r.value));
    n.value = show(state[opts.key]);
    opts.onInput?.();
  });
  r.addEventListener("change", () => opts.onChange?.());
  n.addEventListener("input", () => {
    const v = Number(n.value);
    if (!Number.isFinite(v)) return;
    state[opts.key] = clamp(v);
    r.value = toSlider(state[opts.key]);
    opts.onInput?.();
  });
  n.addEventListener("change", () => { refresh(); opts.onChange?.(); });
  refresh();
  return Object.assign(refresh, { clamp, step });
}

function applySide() {
  const rs = document.documentElement.style;
  rs.setProperty("--content-w", state.contentLimited ? state.contentMax + "px" : "9999px");
  localStorage.setItem("contentMax", String(state.contentMax));
  localStorage.setItem("contentLimited", state.contentLimited ? "1" : "0");
  syncPagedWidth();
}

$("closeBookBtn").onclick = () => closeBook();
$("tocBtn").onclick = () => {
  const sb = $("sidebar");
  if (sb.classList.contains("open")) { sb.classList.remove("open"); return; }
  const last = localStorage.getItem("sidebarLastTab") || "toc";
  switchSideTab(last);
  sb.classList.add("open");
  scrollTocToCurrent();
};
$("searchBtn").onclick = () => {
  const sb = $("sidebar");
  if (sb.classList.contains("open") && !$("searchPage").hidden) { sb.classList.remove("open"); return; }
  const last = localStorage.getItem("sidebarLastTab") || "search";
  switchSideTab(last);
  sb.classList.add("open");
  if (!$("searchPage").hidden) $("searchInput").focus();
};
/* 弹层开合状态同步到触发按钮的 aria-expanded(供屏幕阅读器播报) */
function syncOverlayAria() {
  const sbOpen = $("sidebar").classList.contains("open");
  $("tocBtn").setAttribute("aria-expanded", String(sbOpen && !$("toc").hidden));
  $("searchBtn").setAttribute("aria-expanded", String(sbOpen && !$("searchPage").hidden));
  $("settingsBtn").setAttribute("aria-expanded", String($("settingsPanel").classList.contains("open")));
}
function switchSideTab(tab) {
  $("tabToc").classList.toggle("active", tab === "toc");
  $("tabSearch").classList.toggle("active", tab === "search");
  $("tabMindMap").classList.toggle("active", tab === "mindmap");
  $("toc").hidden = tab !== "toc";
  $("searchPage").hidden = tab !== "search";
  $("mindMapPage").hidden = tab !== "mindmap";
  if (tab === "mindmap") renderMindMap();   /* 视图位置已按书记忆, 切换不重置 */
  try { localStorage.setItem("sidebarLastTab", tab); } catch {}
  syncOverlayAria();
}
$("tabToc").onclick = () => switchSideTab("toc");
$("tabSearch").onclick = () => { switchSideTab("search"); $("searchInput").focus(); };
$("tabMindMap").onclick = () => switchSideTab("mindmap");
$("openWelcome").onclick = () => $("fileInput").click();

/* ---- 侧边栏面板控制: 最大化 / 关闭 ---- */
const sideMaxBtn = $("maximizeSidebar");
const sideCloseBtn = $("closeSidebar");
const sideMaxIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
const sideRestoreIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="3" y="3" width="14" height="14" rx="2" fill="var(--bg)"/></svg>';
function applySideMax() {
  const sb = $("sidebar");
  const maximized = sb.classList.contains("maximized");
  sideMaxBtn.innerHTML = maximized ? sideRestoreIcon : sideMaxIcon;
  sideMaxBtn.title = maximized ? t("restoreTip") : t("maxTip");
  sideMaxBtn.setAttribute("aria-label", maximized ? t("restoreAria") : t("maxAria"));
}
sideMaxBtn.onclick = (e) => {
  e.stopPropagation();
  const sb = $("sidebar");
  sb.classList.toggle("maximized");
  applySideMax();
};
sideCloseBtn.onclick = (e) => {
  e.stopPropagation();
  $("sidebar").classList.remove("open", "maximized");
  applySideMax();
};
function syncPin(btnId, pinned, panelId) {
  $(btnId).classList.toggle("active", pinned);
  $(btnId).setAttribute("aria-pressed", String(pinned));
  $(btnId).title = pinned ? t("pinActiveTip") : t("pinTip");
  $(panelId).classList.toggle("pinned", pinned);
}
$("pinSidebar").onclick = () => {
  state.sidebarPinned = !state.sidebarPinned;
  try { localStorage.setItem("sidebarPinned", state.sidebarPinned ? "1" : "0"); } catch {}
  syncPin("pinSidebar", state.sidebarPinned, "sidebar");
};
applySideMax();
syncPin("pinSidebar", state.sidebarPinned, "sidebar");

/* ---- 侧边栏拖拽调宽 ---- */
(function() {
  const sb = $("sidebar"), handle = $("sidebarResize");
  if (!handle) return;
  const saved = parseInt(localStorage.getItem("sidebarWidth"), 10);
  if (saved >= 280) sb.style.width = Math.min(saved, window.innerWidth * 0.8) + "px";
  let dragging = false, startX = 0, startW = 0;
  handle.onmousedown = (e) => {
    if (e.button !== 0 || sb.classList.contains("maximized")) return;
    dragging = true; startX = e.clientX; startW = sb.offsetWidth;
    handle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  };
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const w = Math.max(280, Math.min(startW + e.clientX - startX, window.innerWidth * 0.8));
    sb.style.width = w + "px";
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    localStorage.setItem("sidebarWidth", sb.offsetWidth);
  });
})();

function scrollTocToCurrent() {
  const el = $("toc").querySelector(".tocItem.active");
  if (el) el.scrollIntoView({ block: "center" });
}
$("fileInput").onchange = async e => { const f=e.target.files[0]; e.target.value=""; if(f) try{await openBookFile(f)}catch(err){alert(err.message)} };
$("exportData").onclick = () => exportBackup().catch(err => alert(err.message));
$("importData").onclick = () => $("backupInput").click();
$("backupInput").onchange = async e => { const f=e.target.files[0]; e.target.value=""; if(f) try{await importBackup(f)}catch(err){alert(err.message)} };
$("relinkBtn").onclick = () => batchRelink();
/* PWA File Handling: 安装后从系统文件管理器/分享打开 .epub/.txt(Chromium桌面与Android) */
if ("launchQueue" in window) {
  launchQueue.setConsumer(async params => {
    const handle = params.files?.[0];
    if (!handle) return;
    try { await openBookFile(await handle.getFile()); }
    catch (err) { alert(err.message); }
  });
}
$("sbPrev").onclick = prevChapter;
$("sbNext").onclick = nextChapter;
$("modeBtn").innerHTML = state.readMode === "paged" ? ICONS.paged : ICONS.scroll;
$("modeBtn").setAttribute("aria-pressed", String(state.readMode === "paged"));
$("modeBtn").onclick = () => setReadMode(state.readMode === "paged" ? "scroll" : "paged");
$("searchInput").oninput = e => {
  clearTimeout(searchTimer);
  const term = e.target.value.trim();
  searchTimer = setTimeout(() => runSearch(term), 250);
};
$("searchInput").addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  e.stopPropagation();
  $("searchInput").value = "";
  clearSearchResults();
  clearSearchHighlights();
  closeOverlays();
});
for (const b of document.querySelectorAll(".themeChip[data-theme]")) {
  b.onclick = () => {
    state.theme = b.dataset.theme;
    applyTheme();
    applySide();
    rerenderReader();
  };
}
for (const b of document.querySelectorAll(".langChip")) {
  b.onclick = () => { localStorage.setItem("lang", b.dataset.lang); applyI18n(); };
}
$("ctReset").onclick = () => {
  const s = currentCustom();
  if (!s) return;
  s.bg = s.base.bg; s.fg = s.base.fg;
  s.adv = { ...(s.base.adv || {}) };
  saveCustomThemes();
  syncCustomPickers();
  applyTheme();
  rerenderReader();
};
for (const [id, key] of [["ctBg", "bg"], ["ctFg", "fg"]]) {
  $(id).addEventListener("input", e => {
    const s = currentCustom();
    if (!s) return;
    s[key] = e.target.value;
    saveCustomThemes();
    if (state.theme !== "custom") state.theme = "custom";
    applyTheme();
    applySide();
    syncCustomPickers();   /* 纸面色变了, 高级区派生预览同步刷新 */
  });
  $(id).addEventListener("change", () => rerenderReader());
}
/* 高级覆盖项: 选色即固定, ↺ 回到自动派生(仅影响外壳变量, 无需重建iframe) */
for (const [id, key] of ADV_IDS) {
  $(id).addEventListener("input", e => {
    const s = currentCustom();
    if (!s) return;
    (s.adv ||= {})[key] = e.target.value;
    saveCustomThemes();
    if (state.theme !== "custom") state.theme = "custom";
    applyTheme();
    syncCustomPickers();
  });
  $(id).closest(".advRow").querySelector(".advAuto").onclick = () => {
    const s = currentCustom();
    if (!s?.adv?.[key]) return;
    delete s.adv[key];
    saveCustomThemes();
    applyTheme();
    syncCustomPickers();
  };
}
$("advToggle").onclick = () => {
  const open = $("advBlock").hidden;
  $("advBlock").hidden = !open;
  $("advToggle").classList.toggle("open", open);
  $("advToggle").setAttribute("aria-expanded", String(open));
};
$("autoBtn").onclick = () => { if (state.book) setAuto(!state.auto); };
/* 速度倍数按钮 */
function syncSpeedBtns() {
  for (const b of document.querySelectorAll(".speedBtn")) b.classList.toggle("active", Number(b.dataset.mult) === state.autoSpeedMult);
}
for (const b of document.querySelectorAll(".speedBtn")) {
  b.onclick = () => {
    state.autoSpeedMult = Number(b.dataset.mult);
    localStorage.setItem("autoSpeedMult", String(state.autoSpeedMult));
    syncSpeedBtns();
  };
}
syncSpeedBtns();
/* 自动阅读高级设置: 键入即钳制state并持久化; 失焦时把规范化值写回输入框, 避免显示越界数字 */
$("autoScrollSpeedNum").value = state.autoScrollSpeed;
$("autoScrollSpeedNum").oninput = e => { state.autoScrollSpeed = Math.min(5, Math.max(0.01, Number(e.target.value) || 0.8)); localStorage.setItem("autoScrollSpeed", String(state.autoScrollSpeed)); };
$("autoScrollSpeedNum").onchange = e => { e.target.value = state.autoScrollSpeed; };
$("autoPageIntervalNum").value = state.autoPageInterval;
$("autoPageIntervalNum").oninput = e => { state.autoPageInterval = Math.min(15000, Math.max(500, Number(e.target.value) || 3500)); localStorage.setItem("autoPageInterval", String(state.autoPageInterval)); };
$("autoPageIntervalNum").onchange = e => { e.target.value = state.autoPageInterval; };
/* 设置抽屉开合(与目录侧栏同范式): .open类驱动, 固定态不受外点/Esc影响 */
function setSettingsOpen(on) {
  $("settingsPanel").classList.toggle("open", on);
  syncOverlayAria();
}
$("settingsBtn").onclick = e => {
  e.stopPropagation();
  setSettingsOpen(!$("settingsPanel").classList.contains("open"));
};
$("pinSettings").onclick = () => {
  state.settingsPinned = !state.settingsPinned;
  try { localStorage.setItem("settingsPinned", state.settingsPinned ? "1" : "0"); } catch {}
  syncPin("pinSettings", state.settingsPinned, "settingsPanel");
};
$("sideReset").onclick = () => {
  state.contentLimited = true; state.contentMax = 700; state.lineHeight = 1.75; state.fontFamily = "serif"; state.fontSize = 18; state.bookFontFirst = true;
  $("fontFamilySel").value = "serif";
  $("bookFontToggle").checked = true;
  localStorage.setItem("bookFontFirst", "1");
  applySide(); applyTypography(); rerenderReader();
  syncFontSize(); syncLineHeight(); syncContentMax();
};
$("fontFamilySel").onchange = e => { state.fontFamily = e.target.value; applyTypography(); rerenderReader(); };
$("verticalToggle").onchange = e => {
  if (e.target.checked && state.typing) {
    /* 打字模式暂不支持竖排: 拒绝切换并回滚开关, 否则重渲染会在竖排翻页文档里误入打字拾取态 */
    e.target.checked = false;
    toast(t("twNoVert"));
    return;
  }
  state.vertical = e.target.checked;
  localStorage.setItem("vertical", state.vertical ? "1" : "0");
  if (!state.book) return;
  /* 竖排开启且当前为滚动模式 → 自动切翻页(滚动竖排尚未完善) */
  if (state.vertical && state.readMode !== "paged") setReadMode("paged");
  else rerenderReader();
};
$("bookFontToggle").onchange = e => {
  state.bookFontFirst = e.target.checked;
  localStorage.setItem("bookFontFirst", state.bookFontFirst ? "1" : "0");
  if (state.renderWhole && state.wholeLoaded) {
    /* 字体优先级烙在文档样式块里, 必须整体重建; restoreRatio 保持阅读位置 */
    state.wholeLoaded = false;
    safeShowUnit(state.unitIdx, { restoreRatio: true });
  } else {
    rerenderReader();
  }
};
/* 注音模式分段控件: off/pinyin/romaji; ruby元素烙在iframe DOM里, 切换都走整体重建(restoreRatio保持阅读位置) */
function syncAnnotateSeg() {
  document.querySelectorAll("#annotateSeg [data-ann]").forEach(b => {
    const on = b.dataset.ann === state.annotate;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}
function setAnnotate(mode, btn) {
  if (mode === state.annotate) return;
  if (mode === "off") {
    state.annotate = "off";
    state.showPinyin = false;
    pyMode = "off";
    pyReset();
    forceRebuildForAnnotate();
    syncAnnotateSeg();
    return;
  }
  /* romaji 零依赖可即时生效; pinyin 需词典库 */
  const apply = () => {
    state.annotate = mode;
    state.showPinyin = true;
    pyMode = mode;
    try { localStorage.setItem("pinyinWarmed", "1"); } catch {}   /* 词典预热标记: 下次启动静默预拉 */
    /* 延迟弹出避开"全书排版中…"进度toast抢占(forceRebuild会触发整书渲染toast) */
    if (mode === "pinyin" && state.bookHasRuby) setTimeout(() => { if (state.annotate === "pinyin" && state.bookHasRuby) toast(t("pinyinNativeRuby")); }, 800);
    forceRebuildForAnnotate();
    syncAnnotateSeg();
  };
  if (mode === "romaji") { apply(); return; }
  ensurePinyinLib().then(apply).catch(() => {
    toast(t("pinyinLoadFail"));
  });
}
function forceRebuildReader() {
  if (state.renderWhole && state.wholeLoaded) {
    state.wholeLoaded = false;
    safeShowUnit(state.unitIdx, { restoreRatio: true });
  } else {
    rerenderReader();
  }
}
function forceRebuildForAnnotate() { forceRebuildReader(); }
$("annotateSeg").addEventListener("click", e => {
  const btn = e.target.closest("[data-ann]");
  if (btn) setAnnotate(btn.dataset.ann, btn);
});

/* ---- 打字模式开关 ---- */
function syncTypingBtn() {
  const b = $("typingBtn");
  b.classList.toggle("active", state.typing);
  b.setAttribute("aria-pressed", String(state.typing));
}
let twProcIdx = 0;
function setTyping(on) {
  if (!state.book) return;
  if (on === state.typing) return;
  if (on) {
    if (state.scratch) setScratch(false);   /* 与逐字阅读互斥 */
    if (state.vertical) { toast(t("twNoVert")); return; }
    state.typing = true;
    syncTypingBtn();
    $("typingBar").hidden = false;
    $("typingInput").value = "";
    twProcIdx = 0;
    toast(t("twPickHint"));
    ensurePinyinLib().catch(() => {}).then(() => {
      if (!state.typing) return;
      const doc = $("bookFrame").contentDocument;
      if (state.readMode !== "scroll" || !doc?.body) { setReadMode("scroll"); return; }   /* 重渲染后runAfterLoad接管 */
      twEnterPick(doc);
    });
  } else {
    state.typing = false;
    twReset();
    syncTypingBtn();
    $("typingBar").hidden = true;
    forceRebuildReader();   /* 整书模式下restyle不清DOM, 必须真重建才能带走打字span */
  }
}
$("typingBtn").onclick = () => setTyping(!state.typing);

/* ---- 逐字阅读(刮刮乐)开关 ---- */
function syncScratchBtn() {
  const b = $("scratchBtn");
  b.classList.toggle("active", state.scratch);
  b.setAttribute("aria-pressed", String(state.scratch));
}
function setScratch(on) {
  if (!state.book) { toast(t("scrNoBook")); return; }
  if (on === state.scratch) return;
  if (on) {
    if (state.typing) setTyping(false);   /* 与打字模式互斥 */
    state.scratch = true;
    syncScratchBtn();
    const doc = $("bookFrame")?.contentDocument;
    if (doc?.body) scratchEnter(doc);
  } else {
    state.scratch = false;
    scratchReset();
    syncScratchBtn();
  }
}
$("scratchBtn").onclick = () => setScratch(!state.scratch);
/* 输入条喂字: 兼容直接字母与中文IME拼音组合(组合中逐字符实时喂, 提交后清空缓冲) */
let twComposing = false;
bindEl("typingInput", el => {
  /* 真打字: 组合期内(原始拼音/quicker)一律不喂, 避免敲键盘过程误读报错音; 提交后按全字校对 */
  el.addEventListener("compositionstart", () => { twComposing = true; });
  el.addEventListener("compositionend", () => { twComposing = false; });
  el.addEventListener("input", e => {
    const inp = e.target;
    const v = inp.value;
    /* 真打字模式: 只消费已上屏文本(组合中的原始拼音会误配); 提交后清空缓冲 */
    if (state.twReal) {
      if (!e.isComposing && !twComposing && twState?.phase !== "pick") {
        const chunk = v.slice(twProcIdx).replace(/\s+/g, "");
        if (chunk) twFeedChunk(chunk);
      }
      if (!e.isComposing && !twComposing) { inp.value = ""; twProcIdx = 0; }
      return;
    }
    /* 注音拼音对照模式不进window兜底keydown; 组合中逐字符实时喂(拼音模式下可实时比对) */
    if (e.isComposing || twComposing) { el.value = v.replace(/\s/g, ""); twProcIdx = 0; return; }
    twProcIdx = Math.min(twProcIdx, v.length);
    while (twProcIdx < v.length) {
      const ch = v[twProcIdx].toLowerCase();
      if (/[a-z]/.test(ch)) {
        if (twState?.phase === "pick") twPickNudge();   /* 未点选段落: 提醒而非静默 */
        else twFeed(ch);
      }
      twProcIdx++;
    }
    if (!e.isComposing) { inp.value = ""; twProcIdx = 0; }
  });
});
$("typingInput").addEventListener("keydown", e => {
  /* 输入条内Enter/Tab/Esc统一处理, 防止落入表单默认行为 */
  if (e.key === "Escape") { setTyping(false); e.preventDefault(); }
  else if (e.key === "Tab" && !twComposing) { if (state.twReal) twSkipReal(); else twSkip(); e.preventDefault(); }
  else if (e.key === "Enter") e.preventDefault();
});
/* 打字期间输入条失焦(点击页面其他处)自动回焦: 保证持续可输入; Esc退出后不再抢焦 */
let twBlurTimer = 0;
$("typingInput").addEventListener("blur", () => {
  if (!state.typing) return;
  clearTimeout(twBlurTimer);
  twBlurTimer = setTimeout(() => {
    if (state.typing && document.activeElement !== $("typingInput")) $("typingInput").focus({ preventScroll: true });
  }, 180);
});


/* ---- 马克笔高亮: 划词标记 → 文本锚点持久化 → 导图子节点联动 ---- */
const MK_COLORS = ["#ffe066", "#a5f3a1", "#9bd7ff", "#ffb3d9", "#ffd39b"];
function hlKey() { return `highlights:${state.book.title}:${state.book.fileSize ?? ""}`; }
function hlLoad() {
  try { const v = JSON.parse(localStorage.getItem(hlKey()) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function hlSave(list) { try { localStorage.setItem(hlKey(), JSON.stringify(list)); } catch {} }
function syncMarkerUI() {
  const b = $("markerBtn");
  b.classList.toggle("active", state.marker);
  b.setAttribute("aria-pressed", String(state.marker));
  $("markerPalette").hidden = !state.marker;
}
function setMarker(on, opts = {}) {
  if (!state.book) return;
  state.marker = on;
  state.markerOnce = on && !!opts.once;
  syncMarkerUI();
  const d = $("bookFrame")?.contentDocument;
  d?.body?.classList.toggle("mkMode", on);
}
/* 单击=单次模式(标记一次自动退出), 双击=持续模式; 开启中单击图标=关闭 */
let mkClickTimer = 0;
$("markerBtn").addEventListener("click", () => {
  if (!state.book) return;
  if (state.marker) { setMarker(false); return; }
  clearTimeout(mkClickTimer);
  mkClickTimer = setTimeout(() => setMarker(true, { once: true }), 260);
});
$("markerBtn").addEventListener("dblclick", () => {
  if (!state.book) return;
  clearTimeout(mkClickTimer);
  setMarker(true, { once: false });
});

/* ---- 打字音效开关(高级功能页, 持久化偏好) ---- */
function syncTypingSound() {
  const t2 = $("typingSoundToggle");
  t2.checked = state.typingSound;
}
bindEl("typingSoundToggle", el => el.addEventListener("change", e => {
  state.typingSound = e.target.checked;
  try { localStorage.setItem("typingSound", e.target.checked ? "1" : "0"); } catch {}
}));

/* ---- 中文打字方式: 拼音对照 / 输入法真打 ---- */
function syncTwModeSeg() {
  document.querySelectorAll("#twModeSeg [data-twmode]").forEach(btn => {
    const on = (btn.dataset.twmode === "real") === !!state.twReal;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}
bindEl("twModeSeg", el => el.addEventListener("click", e => {
  const btn = e.target.closest("[data-twmode]");
  if (!btn) return;
  state.twReal = btn.dataset.twmode === "real";
  try { localStorage.setItem("twReal", state.twReal ? "1" : "0"); } catch {}
  syncTwModeSeg();
}));
/* 色板构建 */
(function() {
  const pal = $("markerPalette");
  for (const c of MK_COLORS) {
    const dot = document.createElement("button");
    dot.className = "mkDot" + (c === state.markerColor ? " active" : "");
    dot.style.setProperty("--c", c);
    dot.setAttribute("aria-label", c);
    dot.onclick = () => {
      state.markerColor = c;
      try { localStorage.setItem("mkColor", c); } catch {}
      [...pal.children].forEach(d2 => d2.classList.toggle("active", d2 === dot));
    };
    pal.appendChild(dot);
  }
})();
/* 文本锚点回贴: 在章节根内按 前缀+文本+后缀 定位并包裹 */
function hlWrapRange(doc, range, h) {
  const frag = range.extractContents();
  const mk = doc.createElement("mark");
  mk.className = "mkHl";
  mk.dataset.hl = h.id;
  mk.style.setProperty("--hlc", h.color);
  mk.appendChild(frag);
  range.insertNode(mk);
}
function hlApplyOne(doc, root, h) {
  if (root.querySelector(`[data-hl="${h.id}"]`)) return true;
  const nodes = [];
  let full = "";
  const w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement.closest("rt,rp,script,style,mark.mkHl") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  while (w.nextNode()) { nodes.push({ n: w.currentNode, s: full.length }); full += w.currentNode.nodeValue; }
  let tStart = full.indexOf(h.prefix + h.text + h.suffix);
  if (tStart >= 0) tStart += h.prefix.length;
  else tStart = full.indexOf(h.text);   /* 上下文失配(如注音改排)退化为纯文本匹配 */
  if (tStart < 0) return false;
  const tEnd = tStart + h.text.length;
  for (const { n, s } of nodes) {
    const ns = s + n.nodeValue.length;
    if (ns <= tStart || s >= tEnd) continue;
    const a = Math.max(0, tStart - s), b = Math.min(n.nodeValue.length, tEnd - s);
    const r = doc.createRange();
    r.setStart(n, a);
    r.setEnd(n, b);
    hlWrapRange(doc, r, h);
  }
  return true;
}
function hlApplyAll(doc) {
  if (!doc?.body) return;
  for (const h of hlLoad()) {
    const root = doc.getElementById(`sp${h.spineIdx}`) || (h.spineIdx === state.chapterIndex ? doc.body : null);
    if (!root) continue;
    hlApplyOne(doc, root, h);
  }
}
/* 选区→记录: 章节定位+前后文+最近目录单元(导图挂载点/跳转用) */
function hlFromSelection(win) {
  if (!state.marker) return;
  const sel = win.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const txt = String(sel).replace(/\s+/g, " ").trim();
  const range = sel.getRangeAt(0);
  if (!txt || range.collapsed) return;
  const doc = win.document;
  const startEl = range.startContainer.parentElement || range.startContainer;
  const sec = startEl.closest?.(".spinePart");
  const spineIdx = sec ? Number(sec.id.slice(2)) : state.chapterIndex;
  const root = sec || doc.body;
  const pre = doc.createRange();
  pre.selectNodeContents(root);
  try { pre.setEnd(range.startContainer, range.startOffset); } catch { return; }
  const startOff = pre.toString().length;
  const fullText = root.textContent;
  const prefix = fullText.slice(Math.max(0, startOff - 16), startOff);
  const suffix = fullText.slice(startOff + txt.length, startOff + txt.length + 24);
  /* 最近单元: 同文件内片段锚点纵坐标 ≤ 选区中点者取最下 */
  let unitIdx = firstUnitOfFile(spineIdx);
  let bestTop = -Infinity;
  const rr = range.getBoundingClientRect();
  for (const [g, u] of state.navUnits.entries()) {
    if (u.i !== spineIdx || !u.frag) continue;
    const el = resolveAnchor(doc, u.frag);
    if (!el) continue;
    const top = absDocOffset(el);
    const mid = state.vertical ? rr.left : rr.top;
    const pos = state.vertical ? -top : top;   /* 阅读序坐标(竖排offsetLeft逆序) */
    if (pos <= mid + 40 && pos > bestTop) { bestTop = pos; unitIdx = g; }
  }
  const rec = {
    id: "hl" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    spineIdx, text: txt, prefix, suffix,
    color: state.markerColor, unitIdx,
    label: txt.slice(0, 14)
  };
  hlWrapRange(doc, range.cloneRange(), rec);
  const list = hlLoad();
  list.push(rec);
  hlSave(list);
  sel.removeAllRanges();
  if (state.markerOnce) setMarker(false);   /* 单次模式: 标记即退出 */
}
function hlDelete(id, anchorEl) {
  const list = hlLoad();
  const rec = list.find(h => h.id === id);
  if (!rec) return;
  toast(t("mkDel"), { action: { label: t("delSelected"), fn: () => {
    const d = $("bookFrame")?.contentDocument;
    d?.querySelectorAll(`[data-hl="${id}"]`).forEach(m => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      m.remove();
      parent.normalize();
    });
    hlSave(hlLoad().filter(h => h.id !== id));
    renderMindMap();
    toast(t("mkDeleted"));
  } } });
}

const syncFontSize = bindSetting("fontSizeRange", "fontSizeNum", {
  key: "fontSize", min: 10, max: 36,
  onInput: applyFont,
  onChange: rerenderReader
});
const syncLineHeight = bindSetting("lineHeightRange", "lineHeightNum", {
  key: "lineHeight", min: 1.4, max: 2.4,
  toSlider: v => String(Math.round(v * 100)),
  fromSlider: v => v / 100,
  show: v => v.toFixed(2),
  onInput: applyTypography,
  onChange: rerenderReader
});
const syncContentMax = bindSetting("contentMaxRange", "contentMaxNum", {
  key: "contentMax", min: 480, max: 1920,
  onInput: () => {
    if (!state.contentLimited) { state.contentLimited = true; $("contentMaxToggle").checked = true; }
    applySide();
  }
});
const syncScrRatio = bindSetting("scrRatioRange", "scrRatioNum", {
  key: "scratchRatio", min: 0, max: 100,
  onInput: () => { localStorage.setItem("scratchRatio", String(state.scratchRatio)); if (state.scratch) forceRebuildReader(); }
});
$("scrRatioMinus").onclick = () => syncScrRatio.step(-5);
$("scrRatioPlus").onclick = () => syncScrRatio.step(5);
$("fsMinus").onclick = () => syncFontSize.step(-1);
$("fsPlus").onclick = () => syncFontSize.step(1);
$("lhMinus").onclick = () => syncLineHeight.step(-0.05);
$("lhPlus").onclick = () => syncLineHeight.step(0.05);
$("cwMinus").onclick = () => syncContentMax.step(-10);
$("cwPlus").onclick = () => syncContentMax.step(10);
function syncContentInputs() {
  const off = !state.contentLimited;
  $("contentMaxRange").disabled = off;
  $("contentMaxNum").disabled = off;
}
$("contentMaxToggle").onchange = e => {
  state.contentLimited = e.target.checked;
  syncContentInputs();
  applySide();
};
document.addEventListener("click", e => {
  const p = $("settingsPanel");
  if (p.classList.contains("open") && !state.settingsPinned && !p.contains(e.target) && e.target !== $("settingsBtn")) setSettingsOpen(false);
  syncOverlayAria();
});
$("main").addEventListener("click", closeOverlays);

/* 键盘兜底: 焦点在父页(工具栏/书架/侧栏)时按键也能驱动阅读; 焦点在iframe内则由其文档上的handleKey接管
   (键盘事件不跨文档派发, 两处监听不会重复触发); handleKey 自带输入框守卫 */
/* 键盘兜底由 window.addEventListener("keydown", handleKey) 统一承担(冒泡路径覆盖document), 避免双触发 */

/* ---------- 书架编辑模式与设置分页绑定 ---------- */
$("editShelfBtn").onclick = () => setShelfEditMode(true);
$("doneEditBtn").onclick = () => setShelfEditMode(false);
$("selAllBtn").onclick = toggleSelAll;
$("delSelBtn").onclick = batchRemoveSel;
for (const b of document.querySelectorAll(".viewChip")) {
  b.onclick = () => setShelfView(b.dataset.view);
}
syncViewChips();

/* ---------- 设置面板分页: 外观/排版/备份 ---------- */
const tabIndicator = document.querySelector(".setTabIndicator");
function moveTabIndicator(tab) {
  if (!tabIndicator || !tab) return;
  tabIndicator.style.width = tab.offsetWidth + "px";
  tabIndicator.style.left = (tab.offsetLeft) + "px";
}
for (const b of document.querySelectorAll(".setTab")) {
  b.onclick = () => {
    for (const t of document.querySelectorAll(".setTab")) {
      const on = t === b;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
    }
    for (const pg of document.querySelectorAll(".setPage")) pg.hidden = pg.dataset.page !== b.dataset.tab;
    moveTabIndicator(b);
  };
}
moveTabIndicator(document.querySelector(".setTab.active"));

/* 全局键盘兜底: 唯一入口挂window(冒泡已覆盖document); 书架编辑模式的Esc也依赖它 */
window.addEventListener("keydown", handleKey);

function dragHover(e) { e.preventDefault(); $("dropOverlay").hidden = false; }
function dragLeave(e) { if (!e.relatedTarget) $("dropOverlay").hidden = true; }
async function dropFile(e) {
  e.preventDefault();
  $("dropOverlay").hidden = true;
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (!/\.(epub|txt)$/i.test(f.name)) { alert(t("badFileType")); return; }
  try { await openBookFile(f); } catch (err) { alert(err.message); }
}
window.addEventListener("dragenter", dragHover);
window.addEventListener("dragover", dragHover);
window.addEventListener("dragleave", dragLeave);
window.addEventListener("drop", dropFile);

window.addEventListener("pagehide", saveProgress);

/* 视口尺寸变化同步(排版引擎在 pager.js) */
let pagedResizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(pagedResizeTimer);
  pagedResizeTimer = setTimeout(syncPagedWidth, 150);
});
$("viewport").addEventListener("transitionend", e => {
  if (e.target === $("viewport")) syncPagedWidth();
});


$("fontFamilySel").value = state.fontFamily;
$("verticalToggle").checked = state.vertical;
$("bookFontToggle").checked = state.bookFontFirst;
syncAnnotateSeg();
syncTypingSound();
syncTwModeSeg();
$("contentMaxToggle").checked = state.contentLimited;
syncContentInputs();
syncCustomPickers();
applySide();
applyTheme();
applyI18n();
sweepOrphanProgress();
