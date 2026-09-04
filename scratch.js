/* scratch.js — 逐字阅读(刮刮乐)模式: 正文如刮刮乐涂层隐藏为小格, 鼠标划过逐个字显现
   涂覆为视图懒加载: IntersectionObserver 观测书块, 进入视野才包裹span → 超大章节/整书模式可用
   依赖运行期全局(函数体内调用, 与加载序无关): state/t/toast/readerColors/$(reader.js)
   reader.js 契约: scratchEnter(doc) 开启/章节加载后重进; scratchReset() 退出恢复
   抹黑比例: state.scratchRatio (0-100), 0=不涂, 100=全涂, 默认50 */

const SCR_BLOCK_SEL = "p,li,dd,dt,blockquote,h1,h2,h3,h4,h5,h6";
let scrDoc = null;          /* 当前激活文档 */
let _scrSeed = 0;           /* 涂层比例确定性散布种子 */

/* 涂层色: 由主题 bg/fg 中和派生, 深色主题自动变亮银(刮刮乐质感) */
function scrCoating() {
  const { bg, fg } = readerColors();
  const pm = c => {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || "");
    return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : [127, 127, 127];
  };
  const b = pm(bg), f = pm(fg);
  const mid = b.map((v, i) => Math.round(v * 0.45 + f[i] * 0.55));
  return `rgba(${mid[0]},${mid[1]},${mid[2]},0.86)`;
}

function scrEnsureStyle(doc) {
  if (doc.getElementById("scrStyle")) return;
  const st = doc.createElement("style");
  st.id = "scrStyle";
  st.textContent = `
    .scr{color:transparent !important;background:${scrCoating()} !important;border-radius:2px;user-select:none;-webkit-user-select:none;cursor:default;}
    .scr.sd{color:inherit !important;background:transparent !important;border-radius:0;}`;
  doc.head.appendChild(st);
}

/* 邻块去重(父块已收则子块跳过, 防双包), 兜底无标准块时取 spinePart/content 直系子 */
function scrCollectBlocks(doc) {
  let els = [...doc.body.querySelectorAll(SCR_BLOCK_SEL)];
  if (!els.length) els = [...doc.body.querySelectorAll(".spinePart > *, .content > *")];
  if (!els.length) els = [doc.body];
  const seen = new Set();
  return els.filter(el => {
    if (el.closest(".scr, rt, rp, script, style")) return false;
    const anc = el.parentElement?.closest(SCR_BLOCK_SEL);
    if (anc && seen.has(anc)) return false;
    seen.add(el);
    return !!((el.textContent || "").trim());
  });
}

/* 单个文本节点: 非空白逐字符包span, 空白保持原文(保布局/保pre-wrap换行语义)
   按抹黑比例 state.scratchRatio 决定每字是否涂层: 确定性散布保证整段近似达到目标比例 */
function scrWrapText(doc, node, frag) {
  const text = node.nodeValue || "";
  const ratio = Math.min(100, Math.max(0, Number(state.scratchRatio) || 0)) / 100;
  let plain = "";
  const flush = () => { if (plain) { frag.appendChild(doc.createTextNode(plain)); plain = ""; } };
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const len = cp > 0xffff ? 2 : 1;
    if (/\s/u.test(ch)) plain += ch;
    else {
      /* 确定性伪随机散布: 用简单哈希命中与否, 双样本负相关避免明显聚集 */
      _scrSeed = (_scrSeed * 9301 + 49297) % 233280;
      const r = _scrSeed / 233280;
      const coated = ratio >= 1 ? true : (ratio <= 0 ? false : r < ratio);
      if (coated) {
        flush();
        const s = doc.createElement("span");
        s.className = "scr";
        s.textContent = ch;
        frag.appendChild(s);
      } else plain += ch;
    }
    i += len;
  }
  flush();
}

/* 涂覆一块: 包裹其全部可见字符(整块包, 跳过rt/rp/script/style与已包内容) */
function scrCoatBlock(doc, block) {
  if (block.classList.contains("scDone")) return;
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest("rt, rp, script, style") || p.closest?.(".scr")) return NodeFilter.FILTER_REJECT;
      return (n.nodeValue || "").trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const todo = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const frag = doc.createDocumentFragment();
    scrWrapText(doc, n, frag);
    if (frag.childNodes.length) todo.push([n, frag]);
  }
  for (const [n, frag] of todo) n.replaceWith(frag);
  block.classList.add("scDone");
}

/* 进入即同步涂覆当前视野(IO 异步回调之前就位, 观感/测试都确定); 其余交给 IO 懒涂 */
function scrSweepVisible(doc, blocks) {
  const win = doc.defaultView;
  const vw = win?.innerWidth || 0, vh = win?.innerHeight || 0;
  for (const b of blocks) {
    const r = b.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    scrCoatBlock(doc, b);
  }
}

function scratchEnter(doc) {
  scrDoc = doc;
  scrEnsureStyle(doc);
  if (doc.__scrObserver) doc.__scrObserver.disconnect();
  const blocks = scrCollectBlocks(doc);
  const obs = new IntersectionObserver(entries => {
    for (const en of entries) if (en.isIntersecting) { scrCoatBlock(doc, en.target); obs.unobserve(en.target); }
  }, { root: null, rootMargin: "100% 100% 100% 100%" });
  blocks.forEach(b => obs.observe(b));
  doc.__scrObserver = obs;
  scrSweepVisible(doc, blocks);
  if (!doc.__scrPointerMove) {
    doc.__scrPointerMove = e => {
      const t = e.target?.closest?.(".scr");
      if (t && !t.classList.contains("sd")) t.classList.add("sd");
    };
    doc.addEventListener("pointermove", doc.__scrPointerMove, { passive: true });
  }
}

function scratchReset() {
  const doc = scrDoc;
  scrDoc = null;
  if (!doc) return;
  if (doc.__scrPointerMove) { doc.removeEventListener("pointermove", doc.__scrPointerMove); doc.__scrPointerMove = null; }
  if (doc.__scrObserver) { doc.__scrObserver.disconnect(); doc.__scrObserver = null; }
  const st = doc.getElementById("scrStyle");
  if (st) st.remove();
  for (const s of doc.querySelectorAll(".scr.sd")) s.classList.remove("sd");
}