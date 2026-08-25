/* pager.js — 排版引擎(翻页+滚动双模式): CSS columns 测排/翻页变换/滚动虚拟化/触摸与滚轮手势/沉浸模式/模式切换
   依赖契约(运行期全局, 经典脚本共享): reader.js 的 state/$/t/toast/pyMarkMove/showUnit/safeShowUnit/getPageHeight/updateProgress/REDUCED_MOTION;
   pinyin.js 的 pyMarkMove 打点; 引擎自身状态(pagedCtx/scrollMarks等)为本文件私有, 外部经函数API访问
   链序: engine → pager → reader (本文件顶层仅常量/let/函数声明, 无执行语句) */

const PG_GAP = 48, PG_PADX = 48;
function pagedPageWidth() {
  const readerW = $("reader").clientWidth || 800;
  const base = state.contentLimited ? Math.min(readerW, state.contentMax) : readerW;
  return Math.max(200, base - PG_PADX * 2);
}
function pagedCss(w) {
  return `
    html,body{overflow:hidden;height:100%;}
    body{min-height:0;padding:40px ${PG_PADX}px;overflow-y:hidden;}
    .pgflow{height:100%;column-width:${w}px;column-gap:${PG_GAP}px;column-fill:auto;will-change:transform;touch-action:pan-y;}
    .pgflow img,.pgflow svg,.pgflow video{max-height:calc(100% - 24px);}
  `;
}

function currentScrollRatio() {
  const win = $("bookFrame").contentWindow;
  const docEl = win?.document?.documentElement;
  if (!win || !docEl) return 0;
  const max = docEl.scrollHeight - win.innerHeight;
  return max > 0 ? win.scrollY / max : 0;
}

/* ---------- 翻页模式 ---------- */
let pagedCtx = null;

function pagedActive() { return state.readMode === "paged" && !!pagedCtx; }

function measurePaged() {
  if (!pagedCtx) return;
  const { flow } = pagedCtx;
  const w = pagedPageWidth();
  pagedCtx.w = w;
  pagedCtx.stride = w + PG_GAP;
  flow.style.columnWidth = `${w}px`;
  pagedCtx.pages = Math.max(1, Math.round((flow.scrollWidth + PG_GAP) / pagedCtx.stride));
  state.filePages = pagedCtx.pages;
}

function updatePageInfo() {
  const el = $("pageInfo");
  el.hidden = !pagedActive();
  if (!el.hidden) el.textContent = `${state.pageIdx + 1} / ${pagedCtx.pages}`;
}

function applyPagedTransform(instant) {
  if (!pagedCtx) return;
  state.pageIdx = Math.max(0, Math.min(state.pageIdx, pagedCtx.pages - 1));
  pyMarkMove();   /* 注音settle门控: 翻页位移与滚动同待遇 */
  syncUnitForPage();
  const { flow } = pagedCtx;
  if (instant) {
    const prev = flow.style.transition;
    flow.style.transition = "none";
    flow.style.transform = `translateX(${-state.pageIdx * pagedCtx.stride}px)`;
    void flow.offsetWidth;
    flow.style.transition = prev;
  } else {
    flow.style.transition = "transform .28s ease";
    flow.style.transform = `translateX(${-state.pageIdx * pagedCtx.stride}px)`;
  }
  updatePageInfo();
}

let bumpTimer = 0;
function applyBump(dir) {
  if (!pagedCtx) return;
  const { flow } = pagedCtx;
  clearTimeout(bumpTimer);
  flow.style.transition = "transform .12s ease";
  flow.style.transform = `translateX(${-(state.pageIdx * pagedCtx.stride) - dir * 18}px)`;
  bumpTimer = setTimeout(() => applyPagedTransform(false), 130);
}

function gotoPage(n, instant = false) {
  if (!pagedCtx) return;
  state.pageIdx = Math.max(0, Math.min(n, pagedCtx.pages - 1));
  applyPagedTransform(instant);
  scheduleProgressSave();
}

function anchorToPage(el) {
  if (!pagedCtx || !el) return null;
  const fr = pagedCtx.flow.getBoundingClientRect();
  return Math.max(0, Math.min(pagedCtx.pages - 1,
    Math.floor((el.getBoundingClientRect().left - fr.left) / pagedCtx.stride)));
}

function flipPage(dir) {
  if (!state.book || !pagedCtx) return;
  const next = state.pageIdx + dir;
  if (next < 0) {
    if (state.chapterIndex <= 0) { applyBump(dir); return; }
    state.pageIdx = Infinity; /* setupPaged 会钳到末页 */
    safeShowUnit(firstUnitOfFile(state.chapterIndex - 1), {noAnchor:true});
  } else if (next >= pagedCtx.pages) {
    if (state.chapterIndex >= state.book.spine.length - 1) { applyBump(dir); return; }
    state.pageIdx = 0;
    safeShowUnit(firstUnitOfFile(state.chapterIndex + 1), {noAnchor:true});
  } else gotoPage(next);
}

function setupPaged(doc) {
  const flow = doc.querySelector(".pgflow");
  pagedCtx = null;
  if (!flow) return;
  pagedCtx = { doc, flow };
  measurePaged();
  buildUnitPages();
  applyPagedTransform(true);
}

let pagedSyncTimer = 0;
function syncPagedWidth() {
  if (!pagedCtx || !state.book) return;
  clearTimeout(pagedSyncTimer);
  pagedSyncTimer = setTimeout(() => {
    if (!pagedCtx) return;
    const w = pagedPageWidth();
    if (w === pagedCtx.w) return;
    measurePaged();
    buildUnitPages();
    applyPagedTransform(true);
  }, 80);
}

function buildUnitPages() {
  if (!pagedCtx) return;
  const list = [];
  const doc = pagedCtx.doc;
  state.navUnits.forEach((u, g) => {
    if (u.i !== state.chapterIndex || !u.frag) return;
    const el = resolveAnchor(doc, u.frag);
    if (el) list.push({ g, p: anchorToPage(el) });
  });
  list.sort((a, b) => a.p - b.p);
  pagedCtx.unitPages = list;
}

function syncUnitForPage() {
  const list = pagedCtx?.unitPages;
  if (!list || !list.length) return;
  let g = firstUnitOfFile(state.chapterIndex);
  for (const e of list) { if (e.p <= state.pageIdx) g = e.g; else break; }
  if (g >= 0 && g !== state.unitIdx) {
    state.unitIdx = g;
    $("chapterLabel").textContent = state.navUnits[g].label;
    updateProgress();
    updateToc();
  }
}

function resolveAnchor(doc, id) {
  return doc.getElementById(id) ||
    doc.querySelector(`[name="${CSS.escape(id)}"]`);
}
function anchorElement(doc, ci, frag) {
  if (!frag) return state.renderWhole ? doc.getElementById(`sp${ci}`) : null;
  return resolveAnchor(doc, state.renderWhole ? `${ci}_${frag}` : frag);
}

let scrollMarks = [];
let scrollSyncQueued = false;
let markOffsetsValid = false, markCacheHeight = -1, markCacheAt = 0;

/* 锚点文档绝对 Y 坐标缓存: offsetTop 父链累加一次, 滚动同步只做二分查找,
   不再每帧对全部锚点 getBoundingClientRect (长书滚动掉帧的根源) */
function absDocTop(el) {
  let sum = 0;
  for (let n = el; n; n = n.offsetParent) sum += n.offsetTop;
  return sum;
}
function refreshMarkOffsets(doc) {
  for (const m of scrollMarks) m.y = absDocTop(m.el);
  scrollMarks.sort((a, b) => a.y - b.y || a.g - b.g);   /* 保证二分单调性 */
  markCacheHeight = doc.documentElement.scrollHeight;
  markOffsetsValid = true;
  markCacheAt = performance.now();
}
function ensureMarkOffsets(doc) {
  if (markOffsetsValid && doc.documentElement.scrollHeight === markCacheHeight) return;
  /* 高度变了(字号/主题/懒加载图片撑开文档/窗口缩放) → 限频 250ms 重建偏移表 */
  if (!markOffsetsValid || performance.now() - markCacheAt >= 250) refreshMarkOffsets(doc);
}
function buildScrollMarks(doc) {
  scrollMarks = [];
  markOffsetsValid = false;
  if (!state.book || state.readMode !== "scroll") return;
  state.navUnits.forEach((u, g) => {
    if (!state.renderWhole && u.i !== state.chapterIndex) return;
    const el = anchorElement(doc, u.i, u.frag);
    if (el) scrollMarks.push({ g, el });
  });
}
function scheduleScrollSync() {
  if (scrollSyncQueued) return;
  scrollSyncQueued = true;
  requestAnimationFrame(() => { scrollSyncQueued = false; syncScrollUnit(); });
}
function syncScrollUnit() {
  if (!scrollMarks.length || !state.book || state.readMode !== "scroll") return;
  const frame = $("bookFrame");
  const doc = frame.contentDocument;
  if (!doc || !doc.documentElement) return;
  ensureMarkOffsets(doc);
  const target = frame.contentWindow.scrollY + 96;
  let lo = 0, hi = scrollMarks.length - 1, idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (scrollMarks[mid].y <= target) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const g = scrollMarks[idx].g;
  if (g >= 0 && g !== state.unitIdx) {
    state.unitIdx = g;
    state.chapterIndex = state.navUnits[g].i;
    $("chapterLabel").textContent = state.navUnits[g].label;
    updateProgress();
    updateToc();
  }
}

let wheelAcc = 0, wheelLockUntil = 0;
function pagedWheel(e) {
  if (!pagedActive()) return;
  wheelAcc += e.deltaY;
  const now = performance.now();
  if (now < wheelLockUntil) return;
  if (Math.abs(wheelAcc) >= 60) {
    flipPage(wheelAcc > 0 ? 1 : -1);
    wheelAcc = 0;
    wheelLockUntil = now + 280;
  }
}

/* ---- 移动端触摸手势: 横扫/左右点按分区翻页(仅翻页模式), 中间点按切换沉浸模式(双模式通用) ---- */
let touchX = 0, touchY = 0, touchT = 0, touchMoved = false, immersiveOn = false;
function frameTouchStart(e) {
  if (e.touches.length !== 1) { touchMoved = true; return; }   /* 多指=缩放, 放弃跟踪 */
  const t = e.touches[0];
  touchX = t.clientX; touchY = t.clientY; touchT = performance.now(); touchMoved = false;
}
function frameTouchMove(e) {
  if (e.touches.length > 1) { touchMoved = true; return; }
  const t = e.touches[0];
  if (Math.abs(t.clientX - touchX) > 10 || Math.abs(t.clientY - touchY) > 10) touchMoved = true;
}
function frameTouchEnd(e) {
  if (e.changedTouches.length !== 1 || e.target?.closest?.("a[href],button")) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchX, dy = t.clientY - touchY, dt = performance.now() - touchT;
  /* 横向快扫翻页: 仅翻页模式消费; 滚动模式不拦截, 原生滚动照常 */
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 600 && pagedActive()) {
    e.preventDefault();
    flipPage(dx < 0 ? 1 : -1);
    return;
  }
  if (touchMoved || dt >= 300) return;   /* 拖选/长按不算点按 */
  const w = $("bookFrame")?.clientWidth;
  if (!w) return;
  if (pagedActive() && !(t.clientX > w * .3 && t.clientX < w * .7)) {
    e.preventDefault();                  /* 左右30%分区: 上/下一页 */
    flipPage(t.clientX > w * .5 ? 1 : -1);
    return;
  }
  if (t.clientX > w * .3 && t.clientX < w * .7) {
    e.preventDefault();                  /* 中间点按: 工具栏+状态栏显隐(沉浸阅读) */
    toggleImmersive();
  }
}
/* 沉浸模式: 隐藏工具栏与状态栏, 内容区扩展后重排版(纯高度变化, syncPagedWidth只认宽度故需手动触发) */
function toggleImmersive() {
  immersiveOn = !immersiveOn;
  document.body.classList.toggle("immersive", immersiveOn);
  setTimeout(() => {
    if (!pagedCtx) return;
    measurePaged(); buildUnitPages(); applyPagedTransform(true);
  }, 80);
}

function setReadMode(mode) {
  mode = mode === "paged" ? "paged" : "scroll";
  if (mode === state.readMode) return;
  state.readMode = mode;
  localStorage.setItem("readMode", mode);
  $("modeBtn").innerHTML = mode === "paged" ? ICONS.paged : ICONS.scroll;
  $("modeBtn").setAttribute("aria-pressed", String(mode === "paged"));
  $("pageInfo").hidden = true;
  pagedCtx = null;
  scrollMarks = [];
  if (!state.book || !state.navUnits.length) return;
  state.renderWhole = mode === "scroll";
  state.wholeLoaded = false;
  safeShowUnit(state.unitIdx, {});
}


function scrollByPage(direction) {
  const win = $("bookFrame").contentWindow;
  if (!win) return;
  win.scrollBy({top: direction * getPageHeight(), behavior: REDUCED_MOTION ? "instant" : "smooth"});
}

function nextPage() { scrollByPage(1); }
function prevPage() { scrollByPage(-1); }
