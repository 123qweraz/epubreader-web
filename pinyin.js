/* 拼音标注模块(独立于阅读器核心): 懒加载 pinyin-pro(vendor本地文件, 首次开启才拉取, SW缓存后离线可用)
   依赖运行期全局: $(reader.js), state, toast, t(i18n.js) —— 均为函数体内调用, 与加载顺序无关 */
let pinyinLibPromise = null;
function ensurePinyinLib() {
  if (window.pinyinPro) return Promise.resolve();
  pinyinLibPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/pinyin-pro.min.js";
    s.onload = resolve;
    s.onerror = () => { pinyinLibPromise = null; reject(new Error("pinyin lib load failed")); };
    document.head.appendChild(s);
  });
  return pinyinLibPromise;
}
const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;
/* 注音粒度参数: 小目标同步直注 / 单块上限 / 观察器邻域(纵向px, 横向%视宽) / 批预算 */
const PY_SMALL = 20000, PY_CAP = 80000, PY_LOOK_V = "1500px", PY_LOOK_H = "60%";
const PY_BATCH_MS = 12, PY_BATCH_CHARS = 1200, PY_SETTLE_MS = 150;
let pyQueue = [], pyPumping = false, pyLastMove = 0;

function pyCountHan(el) {
  const m = (el.textContent || "").match(new RegExp(HAN_RE.source, "g"));
  return m ? m.length : 0;
}
function pyWalker(doc, root) {
  return doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => HAN_RE.test(n.nodeValue) && !n.parentElement.closest("ruby,rt,script,style")
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
  });
}
/* 单文本节点: 连续汉字段逐字包ruby(纯DOM构建避免转义问题), 返回处理的汉字数 */
function pyAnnotateNode(node) {
  const doc = node.ownerDocument;
  const text = node.nodeValue;
  const frag = doc.createDocumentFragment();
  let last = 0, chars = 0;
  for (let i = 0; i < text.length;) {
    if (!HAN_RE.test(text[i])) { i++; continue; }
    let j = i + 1;
    while (j < text.length && HAN_RE.test(text[j])) j++;
    const seg = text.slice(i, j);
    if (i > last) frag.appendChild(doc.createTextNode(text.slice(last, i)));
    const pys = window.pinyinPro.pinyin(seg, { type: "array" });
    for (let k = 0; k < seg.length; k++) {
      const rb = doc.createElement("ruby");
      rb.textContent = seg[k];
      const rt = doc.createElement("rt");
      rt.textContent = pys[k] || "";
      rb.appendChild(rt);
      frag.appendChild(rb);
    }
    chars += seg.length;
    last = j; i = j;
  }
  if (!last) return 0;
  if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
  node.replaceWith(frag);
  return chars;
}
/* 关键: 先快照全部文本节点再逐个替换 —— TreeWalker是活的, 边遍历边replaceWith会让当前节点
   脱离文档树导致后续nextNode()返回null(渐进泵只注出一个字就停死的根因) */
function pyCollectNodes(doc, root) {
  const walker = pyWalker(doc, root);
  const out = [];
  while (walker.nextNode()) out.push(walker.currentNode);
  return out;
}
function pyAnnotateRootSync(doc, root) {
  for (const n of pyCollectNodes(doc, root)) pyAnnotateNode(n);
}
/* 目标块收集: 整书模式章节区/TXT行块下沉, 无结构回退body */
function collectPyTargets(doc) {
  const secs = [...doc.body.querySelectorAll(".spinePart, .content")];
  if (!secs.length) return [doc.body];
  const out = [];
  for (const s of secs) {
    const lns = s.querySelectorAll(":scope > .ln");
    out.push(...(lns.length ? lns : [s]));
  }
  return out;
}
/* 渐进泵: rIC分批啃队列; 滚动/翻页未停稳不出批, 出批前剪枝丢掉已远离的目标 */
function pyPump() {
  if (pyPumping) return;
  pyPumping = true;
  const schedule = () => {
    const win = $("bookFrame")?.contentWindow;
    /* requestIdleCallback第二参是选项字典{timeout}而非毫秒数(传数字Chrome会抛TypeError杀死泵);
       必须call(win)防detached调用Illegal invocation; timeout兜底保证页面忙碌时也能推进 */
    const ric = win?.requestIdleCallback;
    if (ric) ric.call(win, step, { timeout: 500 });
    else setTimeout(step, 60);
  };
  const step = () => {
    pyPumping = false;
    if (!state.showPinyin) { pyQueue = []; return; }
    const frame = $("bookFrame");
    if (!frame?.contentDocument?.body) { pyQueue = []; return; }
    if (performance.now() - pyLastMove < PY_SETTLE_MS) { schedule(); return; }
    const doc = frame.contentDocument;
    /* 剪枝: 文档不匹配或几何上已远离当前视口邻域的目标直接丢弃 */
    const vw = frame.clientWidth || 800, vh = frame.clientHeight || 600;
    pyQueue = pyQueue.filter(it => {
      if (it.doc !== doc || !it.el.isConnected) return false;
      const r = it.el.getBoundingClientRect();
      return r.bottom > -vh * 2 && r.top < vh * 3 && r.right > -vw * 1.5 && r.left < vw * 2.5;
    });
    const deadline = performance.now() + PY_BATCH_MS;
    let chars = 0;
    while (pyQueue.length && performance.now() < deadline && chars < PY_BATCH_CHARS) {
      const it = pyQueue[0];
      if (it.doc !== doc) { pyQueue.shift(); continue; }
      it.nodes ||= pyCollectNodes(it.doc, it.el);
      if (it.pos >= it.nodes.length) { it.el.dataset.pyQ = ""; pyQueue.shift(); continue; }
      const n = it.nodes[it.pos++];
      if (!n.isConnected) continue; /* 已被前序替换带走的节点跳过 */
      chars += pyAnnotateNode(n);
    }
    if (pyQueue.length) schedule();
  };
  step();
}
function pyEnqueue(doc, el) {
  if (el.dataset.pyQ) return;
  el.dataset.pyQ = "1";
  pyQueue.push({ doc, el, nodes: null, pos: 0 });
  pyPump();
}
/* 邻域观察器: 必须用iframe自己的构造器(跨文档); 滚动模式吃纵向margin, 翻页模式transform位移同样触发 */
function pySetupLazy(doc, targets, counts) {
  if (doc.__pyIO) return;
  doc.__pyIO = true;
  const io = new doc.defaultView.IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      if (Number(en.target.dataset.pyCnt || 0) <= PY_CAP) pyEnqueue(doc, en.target);
    }
  }, { rootMargin: `${PY_LOOK_V} ${PY_LOOK_H} ${PY_LOOK_V} ${PY_LOOK_H}` });
  for (let i = 0; i < targets.length; i++) {
    if (!counts[i]) continue;
    targets[i].dataset.pyCnt = counts[i];
    io.observe(targets[i]);
  }
}
/* 派发: 总字数低于阈值全量直注(覆盖日常章节); 否则多块结构走IO懒注音 */
function pyDispatch(doc) {
  if (!window.pinyinPro || !doc?.body) return;
  const targets = collectPyTargets(doc);
  let total = 0;
  const counts = targets.map(el => { const c = pyCountHan(el); total += c; return c; });
  if (total <= PY_SMALL) {
    for (const el of targets) pyAnnotateRootSync(doc, el);
    return;
  }
  if (targets.length === 1 && total > PY_CAP) { toast(t("pinyinTooLong")); return; }
  pySetupLazy(doc, targets, counts);
}
/* 阅读器位移打点(滚动事件与翻页transform共用): 泵的settle门控依据 */
function pyMarkMove() {
  pyLastMove = performance.now();
}
/* 开关关闭/换书时清场: 丢队列, 已注内容保留由重渲染自然带走 */
function pyReset() {
  pyQueue = [];
}
