/* pager.js — 排版引擎(翻页+滚动双模式): CSS columns 测排/翻页变换/滚动虚拟化/触摸与滚轮手势/沉浸模式/模式切换
   依赖契约(运行期全局, 经典脚本共享): reader.js 的 state/$/t/toast/pyMarkMove/showUnit/safeShowUnit/getPageHeight/updateProgress/REDUCED_MOTION;
   pinyin.js 的 pyMarkMove 打点; 引擎自身状态(pagedCtx/scrollMarks等)为本文件私有, 外部经函数API访问
   链序: engine → pager → reader (本文件顶层仅常量/let/函数声明, 无执行语句) */

const PG_GAP = 48, PG_PADX = 48;
function pagedPageWidth() {
  const reader = $("reader");
  /* 竖排: column-width = 视口高度(每列纵向填满屏幕, 列沿X轴扩展) */
  if (state.vertical) {
    const h = (reader.clientHeight || 600) - 80;
    return Math.max(200, h);
  }
  const readerW = reader.clientWidth || 800;
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

/* 竖排滚动轴适配: vertical-rl 块轴=物理水平, 滚动/偏移量/尺寸全部切换 scrollLeft/scrollWidth/offsetLeft;
   Chrome 对 RTL 系轴的 scrollX 取值范围是 [-max..0](0=内容起点), 统一归一为 [0..max] 正向=阅读方向 */
function scrollMax(win) {
  if (!win) return 0;
  const docEl = win.document?.documentElement;
  if (!docEl) return 0;
  return state.vertical
    ? Math.max(0, (docEl.scrollWidth || 0) - (win.innerWidth || 0))
    : Math.max(0, (docEl.scrollHeight || 0) - (win.innerHeight || 0));
}
function scrollPos(win) {
  return state.vertical ? -(win.scrollX || 0) : (win.scrollY || 0);
}
function scrollToPos(win, pos) {
  if (state.vertical) win.scrollTo(-pos, 0);
  else win.scrollTo(0, pos);
}
function scrollByDelta(win, delta) {
  if (state.vertical) win.scrollBy(-delta, 0);
  else win.scrollBy(0, delta);
}
function absDocOffset(el) {
  let sum = 0;
  const prop = state.vertical ? "offsetLeft" : "offsetTop";
  for (let n = el; n; n = n.offsetParent) sum += n[prop];
  return sum;
}

function currentScrollRatio() {
  const win = $("bookFrame").contentWindow;
  if (!win) return 0;
  const max = scrollMax(win);
  return max > 0 ? scrollPos(win) / max : 0;
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
  pagedCtx.vertical = !!state.vertical;
  flow.style.columnWidth = `${w}px`;
  if (pagedCtx.vertical) {
    /* 竖排 vertical-rl: 列条带纵向填满, 沿块轴(物理X)向左堆叠 → scrollWidth=全书总宽;
       一页窗口 = 视口宽减body左右padding(48*2), 步进与横排同构 */
    const win = pagedCtx.doc.defaultView;
    const visW = Math.max(200, ((win ? win.innerWidth : 0) || flow.clientWidth || 600) - PG_PADX * 2);
    pagedCtx.vStride = visW + PG_GAP;
    pagedCtx.totalW = flow.scrollWidth;
    pagedCtx.pages = Math.max(1, Math.ceil(pagedCtx.totalW / pagedCtx.vStride));
  } else {
    pagedCtx.totalW = flow.scrollWidth;
    pagedCtx.pages = Math.max(1, Math.round((flow.scrollWidth + PG_GAP) / pagedCtx.stride));
  }
  state.filePages = pagedCtx.pages;
}

/* 翻页位移: 竖排与横排都沿物理X轴(竖排内容起于右端, 向左推进), 差别只在步进来源 */
function pageTx(i) {
  const c = pagedCtx;
  if (c.vertical) return -i * c.vStride;
  return -i * c.stride;
}

function updatePageInfo() {
  const el = $("pageInfo");
  el.hidden = !pagedActive();
  if (!el.hidden) el.textContent = `${state.pageIdx + 1} / ${pagedCtx.pages}`;
}

function applyPagedTransform(instant) {
  if (!pagedCtx) return;
  state.pageIdx = Math.max(0, Math.min(state.pageIdx, pagedCtx.pages - 1));
  pyMarkMove();
  syncUnitForPage();
  const { flow } = pagedCtx;
  if (pagedCtx.vertical) {
    /* 竖排: pgflow 自右向左延伸且 body 不再裁剪 → 用文档滚动定位页(translate 会把内容推出视口外成白屏) */
    const win = pagedCtx.doc.defaultView;
    const target = state.pageIdx * pagedCtx.vStride;
    if (instant || REDUCED_MOTION) scrollToPos(win, target);
    else win.scrollTo({ left: -target, behavior: "smooth" });
    updatePageInfo();
    return;
  }
  flow.style.transition = instant ? "none" : "transform .28s ease";
  if (instant) { void flow.offsetWidth; }
  flow.style.transform = `translateX(${pageTx(state.pageIdx)}px)`;
  updatePageInfo();
}

let bumpTimer = 0;
function applyBump(dir) {
  if (!pagedCtx) return;
  clearTimeout(bumpTimer);
  if (pagedCtx.vertical) {
    /* 竖排无位移变换可弹: 以回滚 18px 的过冲模拟碰撞反馈 */
    const win = pagedCtx.doc.defaultView;
    scrollToPos(win, Math.max(0, state.pageIdx * pagedCtx.vStride - dir * 18));
    bumpTimer = setTimeout(() => applyPagedTransform(false), 130);
    return;
  }
  const { flow } = pagedCtx;
  flow.style.transition = "transform .12s ease";
  flow.style.transform = `translateX(${pageTx(state.pageIdx) - dir * 18}px)`;
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
  if (pagedCtx.vertical) {
    /* 竖排内容起于右端: 元素的阅读进度 = 总宽 - 距流左缘偏移 */
    let left = 0;
    for (let n = el; n && n !== pagedCtx.flow; n = n.offsetParent) left += n.offsetLeft;
    const distFromStart = Math.max(0, pagedCtx.totalW - left);
    return Math.max(0, Math.min(pagedCtx.pages - 1, Math.floor(distFromStart / pagedCtx.vStride)));
  }
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
let markOffsetsValid = false, markCacheSize = -1, markCacheAt = 0;

/* 锚点文档坐标缓存: 统一换算为"距内容起点的阅读距离"(竖排=总宽-物理X, 横排=物理Y), 保证二分单调递增 */
function refreshMarkOffsets(doc) {
  const docW = state.vertical ? (doc.documentElement.scrollWidth || 0) : 0;
  for (const m of scrollMarks) {
    const off = absDocOffset(m.el);
    m.y = state.vertical ? Math.max(0, docW - off) : off;
  }
  scrollMarks.sort((a, b) => a.y - b.y || a.g - b.g);   /* 保证二分单调性 */
  markCacheSize = state.vertical
    ? docW
    : (doc.documentElement.scrollHeight || 0);
  markCacheAt = performance.now();
  markOffsetsValid = true;
}
function ensureMarkOffsets(doc) {
  const curSize = state.vertical
    ? (doc.documentElement.scrollWidth || 0)
    : (doc.documentElement.scrollHeight || 0);
  if (markOffsetsValid && curSize === markCacheSize) return;
  /* 尺寸变了(字号/主题/懒加载图片撑开文档/窗口缩放) → 限频 250ms 重建偏移表 */
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
  const target = scrollPos(frame.contentWindow) + 96;
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
  /* 横向快扫翻页: 仅翻页模式消费; 滚动模式不拦截, 原生滚动照常
     竖排翻页同样沿物理X推进(内容左移) → 扫动手势与横排一致 */
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 600 && pagedActive()) {
    e.preventDefault();
    flipPage(dx < 0 ? 1 : -1);
    return;
  }
  if (touchMoved || dt >= 300) return;   /* 拖选/长按不算点按 */
  const w = $("bookFrame")?.clientWidth;
  if (!w) return;
  if (pagedActive() && !(t.clientX > w * .3 && t.clientX < w * .7)) {
    e.preventDefault();                  /* 左右30%分区: 上/下一页; 竖排正文起于右侧 → 点左=下一页 */
    flipPage((t.clientX > w * .5 ? 1 : -1) * (pagedCtx.vertical ? -1 : 1));
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
  const behavior = REDUCED_MOTION ? "instant" : "smooth";
  /* 竖排: 前进=物理向左(Chrome RTL系轴 scrollX 为负值域); 横排: 物理向下 */
  if (state.vertical) win.scrollBy({ left: -direction * getPageHeight(), behavior });
  else win.scrollBy({ top: direction * getPageHeight(), behavior });
}

function nextPage() { scrollByPage(1); }
function prevPage() { scrollByPage(-1); }
