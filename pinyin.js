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
/* 假名(平/片)与长音符ー; 拼音模式不匹配, 罗马音模式专用 */
const KANA_RE = /[\u3041-\u309f\u30a0-\u30fc]/;
const KANA_HAN_RE = new RegExp(`(?:${KANA_RE.source}|${HAN_RE.source})`);

/* ---------- wapuro 式罗马音转换(打字输入习惯: おう→ou っき→kki ー→重复前元音) ---------- */
const KANA_BASE = { /* 平假名基础音+浊音+半浊音 */
  あ:"a",い:"i",う:"u",え:"e",お:"o", わ:"wa",ゐ:"i",ゑ:"e", を:"wo",ん:"n",
  か:"ka",き:"ki",く:"ku",け:"ke",こ:"ko", が:"ga",ぎ:"gi",ぐ:"gu",げ:"ge",ご:"go",
  さ:"sa",し:"shi",す:"su",せ:"se",そ:"so", ざ:"za",じ:"ji",ず:"zu",ぜ:"ze",ぞ:"zo",
  た:"ta",ち:"chi",つ:"tsu",て:"te",と:"to", だ:"da",ぢ:"ji",づ:"zu",で:"de",ど:"do",
  な:"na",に:"ni",ぬ:"nu",ね:"ne",の:"no", は:"ha",ひ:"hi",ふ:"fu",へ:"he",ほ:"ho",
  ば:"ba",び:"bi",ぶ:"bu",べ:"be",ぼ:"bo", ぱ:"pa",ぴ:"pi",ぷ:"pu",ぺ:"pe",ぽ:"po",
  ま:"ma",み:"mi",む:"mu",め:"me",も:"mo", や:"ya",ゆ:"yu",よ:"yo",
  ら:"ra",り:"ri",る:"ru",れ:"re",ろ:"ro", 
  ぁ:"xa",ぃ:"xi",ぅ:"xu",ぇ:"xe",ぉ:"xo", ゃ:"xya",ゅ:"xyu",ょ:"xyo"
};
const KANA_DIGRAPH = { /* 拄音: 两字符最长匹配 */
  きゃ:"kya",きゅ:"kyu",きょ:"kyo", しゃ:"sha",しゅ:"shu",しょ:"sho",
  ちゃ:"cha",ちゅ:"chu",ちょ:"cho", てゃ:"tha",てゅ:"thu",てょ:"tho",
  にゃ:"nya",にゅ:"nyu",にょ:"nyo", ひゃ:"hya",ひゅ:"hyu",ひょ:"hyo",
  みゃ:"mya",みゅ:"myu",みょ:"myo", りゃ:"rya",りゅ:"ryu",りょ:"ryo",
  ぎゃ:"gya",ぎゅ:"gyu",ぎょ:"gyo", じゃ:"ja",じゅ:"ju",じょ:"jo",
  ぢゃ:"ja",ぢゅ:"ju",ぢょ:"jo", いぇ:"ye", ひぇ:"hye",
  びゃ:"bya",びゅ:"byu",びょ:"byo", ぴゃ:"pya",ぴゅ:"pyu",ぴょ:"pyo",
  ふぁ:"fa",ふぃ:"fi",ふぇ:"fe",ふぉ:"fo", ふゅ:"fyu", ヴぁ:"va",ヴぃ:"vi",ヴぇ:"ve",ヴぉ:"vo"
};
const kata2hira = ch => (ch >= "\u30a1" && ch <= "\u30f3") ? String.fromCharCode(ch.charCodeAt(0) - 0x60) : ch;
function toRomaji(s) {
  let out = "";
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === "ー") {   /* 长音符: 重复前一元音 */
      const m = /[aeiou]/.exec(out.slice(-1));
      out += m ? m[0] : ""; i++; continue;
    }
    const h = kata2hira(c), h2 = h + kata2hira(s[i + 1] || "");
    if (h === "っ" || h === "ッ") {   /* 促音: 双写下一辅音 */
      const nxt = toRomaji(s[i + 1] || "");
      out += nxt ? nxt[0] : ""; i++; continue;
    }
    if (KANA_DIGRAPH[h2]) { out += KANA_DIGRAPH[h2]; i += 2; continue; }
    if (KANA_BASE[h]) { out += KANA_BASE[h]; i++; continue; }
    out += c; i++;
  }
  return out;
}
/* 注音模式判定: pinyin 只注汉字 / romaji 只注假名(+书内rt转罗马音); 中日混排各注各的天然无歧义 */
let pyMode = "pinyin";   /* 运行期由 reader.js 设置(state.annotate) */

/* 书内原生 ruby rt(假名furigana) → 罗马音显示: 仅romaji模式执行, iframe DOM为一次性重建故改动安全 */
function pyConvertNativeRt(doc) {
  for (const rt of doc.querySelectorAll("rt")) {
    if (rt.closest("ruby.py")) continue;
    const txt = rt.textContent || "";
    if (!KANA_RE.test(txt)) continue;
    const r = toRomaji(txt);
    if (r && r !== txt) rt.textContent = r;
  }
}
/* 注音粒度参数: 小目标同步直注 / 单块上限 / 观察器邻域(纵向px, 横向%视宽) / 批预算 */
const PY_SMALL = 20000, PY_CAP = 80000, PY_LOOK_V = "1500px", PY_LOOK_H = "60%";
const PY_BATCH_MS = 12, PY_BATCH_CHARS = 1200, PY_SETTLE_MS = 150;
let pyQueue = [], pyPumping = false, pyLastMove = 0;

function pyCountHan(el) {
  const RE = pyMode === "romaji" ? KANA_RE : HAN_RE;
  const m = (el.textContent || "").match(new RegExp(RE.source, "g"));
  return m ? m.length : 0;
}
function pyWalker(doc, root) {
  const want = pyMode === "romaji" ? KANA_RE : HAN_RE;
  return doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => want.test(n.nodeValue) && !n.parentElement.closest("ruby,rt,script,style")
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
  });
}
/* 单文本节点: 连续目标文字段逐字包ruby(纯DOM构建避免转义问题), 返回处理的字数 */
function pyAnnotateNode(node) {
  const doc = node.ownerDocument;
  const text = node.nodeValue;
  const frag = doc.createDocumentFragment();
  const RE = pyMode === "romaji" ? KANA_RE : HAN_RE;
  let last = 0, chars = 0;
  for (let i = 0; i < text.length;) {
    if (!RE.test(text[i])) { i++; continue; }
    let j = i + 1;
    while (j < text.length && RE.test(text[j])) j++;
    const seg = text.slice(i, j);
    if (i > last) frag.appendChild(doc.createTextNode(text.slice(last, i)));
    if (pyMode === "pinyin") {
      const pys = window.pinyinPro.pinyin(seg, { type: "array" });
      for (let k = 0; k < seg.length; k++) {
        const rb = doc.createElement("ruby");
        rb.className = "py";   /* 外挂标记: 注入样式只作用于 ruby.py, 书籍原生注音不受连带影响 */
        rb.textContent = seg[k];
        const rt = doc.createElement("rt");
        rt.textContent = pys[k] || "";
        rb.appendChild(rt);
        frag.appendChild(rb);
      }
    } else {
      /* romaji: 拄音两字符合用一个ruby, 其余逐字符 */
      for (let k = 0; k < seg.length;) {
        const two = seg.slice(k, k + 2);
        const len = KANA_DIGRAPH[two] ? 2 : 1;
        const rb = doc.createElement("ruby");
        rb.className = "py";
        rb.textContent = seg.slice(k, k + len);
        const rt = doc.createElement("rt");
        rt.textContent = len === 2 ? KANA_DIGRAPH[two] : (toRomaji(seg[k]) || "");
        rb.appendChild(rt);
        frag.appendChild(rb);
        k += len;
      }
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
  if (!doc?.body) return;
  if (pyMode === "romaji") {
    /* romaji 不依赖词典库: 书内假名furigana先转罗马音, 再对裸假名外挂ruby */
    pyConvertNativeRt(doc);
    const targets = collectPyTargets(doc);
    let total = 0;
    const counts = targets.map(el => { const c = pyCountHan(el); total += c; return c; });
    if (total <= PY_SMALL) { for (const el of targets) pyAnnotateRootSync(doc, el); return; }
    if (targets.length === 1 && total > PY_CAP) { toast(t("pinyinTooLong")); return; }
    pySetupLazy(doc, targets, counts);
    return;
  }
  if (!window.pinyinPro) return;
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
