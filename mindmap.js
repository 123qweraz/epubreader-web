/* mindmap.js — 思维导图: 从 tocEntries 构建树 → 计算布局 → 渲染水平树形图(SVG连线+可折叠节点)
   依赖契约(运行期全局): reader.js 的 state/$/t/findUnit/safeShowUnit/safeShow */

/* ---------- 树构建: flat tocEntries(depth字段) → 嵌套树 ---------- */
function buildMindMapTree(entries) {
  const root = { label: "", children: [], collapsed: false, depth: -1, chapterIndex: -1, fragment: "" };
  const stack = [root];
  for (const e of entries) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= e.depth) stack.pop();
    const node = { label: e.label, children: [], collapsed: false, depth: e.depth, chapterIndex: e.chapterIndex, fragment: e.fragment, path: e.path };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root;
}

/* ---------- 布局算法: 从叶子数计算每个节点占据的垂直空间, 自底向上分配 y ---------- */
const MM = { NODE_H: 32, NODE_GAP: 8, LEVEL_W: 220, PAD_X: 40, PAD_Y: 30, MIN_LEAF_H: 40 };

function countLeaves(node) {
  if (!node.children.length || node.collapsed) return 1;
  return node.children.reduce((s, c) => s + countLeaves(c), 0);
}

function assignY(node, yStart) {
  const leaves = countLeaves(node);
  node._h = leaves * MM.MIN_LEAF_H;
  node._y = yStart + node._h / 2;
  let cy = yStart;
  for (const c of node.children) {
    if (node.collapsed) break;
    const cLeaves = countLeaves(c);
    assignY(c, cy);
    cy += cLeaves * MM.MIN_LEAF_H;
  }
}
function assignX(node, depth) {
  node._x = MM.PAD_X + depth * MM.LEVEL_W;
  if (!node.collapsed) for (const c of node.children) assignX(c, depth + 1);
}

/* ---------- SVG 连线: 父节点右端 → 子节点左端, 三次贝塞尔弯曲 ---------- */
function buildPaths(node, paths) {
  if (node.collapsed || !node.children.length) return;
  for (const c of node.children) {
    const x1 = node._x, y1 = node._y, x2 = c._x, y2 = c._y;
    const mx = (x1 + x2) / 2;
    paths.push(`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
    buildPaths(c, paths);
  }
}
function buildSvgPaths(root) {
  const paths = [];
  buildPaths(root, paths);
  return paths;
}

/* ---------- 节点收集(用于渲染 div) ---------- */
function collectNodes(node, out) {
  out.push(node);
  if (!node.collapsed) for (const c of node.children) collectNodes(c, out);
}

/* ---------- 折叠/展开 ---------- */
function toggleMindMapNode(node) {
  if (!node.children.length) return;
  node.collapsed = !node.collapsed;
  renderMindMap();
}

/* ---------- 点击跳转 ---------- */
function mindMapNavigate(node) {
  if (node.chapterIndex < 0) return;
  const ui = findUnit(node.chapterIndex, node.fragment);
  if (ui >= 0) safeShowUnit(ui);
  else safeShow(node.chapterIndex, node.fragment);
}

/* ---------- 缩放/平移状态 ---------- */
let mmScale = 1, mmTranslateX = 0, mmTranslateY = 0;
let mmDrag = false, mmDragX = 0, mmDragY = 0;
let mmDragMoved = false;   /* 区分拖拽与点击: mousedown→mousemove位移>3px 算拖拽 */

/* ---------- 应用变换到 wrap ---------- */
function mmApplyTransform(wrap) {
  wrap.style.transform = `scale(${mmScale}) translate(${mmTranslateX}px,${mmTranslateY}px)`;
}

/* ---------- 主渲染函数 ---------- */
function renderMindMap() {
  const container = $("mindMapContent");
  if (!container) return;
  const entries = state.tocEntries;
  if (!entries || !entries.length) { container.innerHTML = `<div class="mmEmpty">${t("mmEmpty")}</div>`; return; }

  const tree = buildMindMapTree(entries);
  /* 如果只有一个根级子节点, 跳过虚拟根 */
  const displayRoot = tree.children.length === 1 && tree.children[0].depth === 0 ? tree.children[0] : tree;
  if (displayRoot === tree) { displayRoot.label = state.book?.title || "Mind Map"; displayRoot.depth = -1; }

  assignX(displayRoot, 0);
  assignY(displayRoot, MM.PAD_Y);

  const totalH = displayRoot._h + MM.PAD_Y * 2;
  const maxDepth = (() => { let d = 0; const walk = (n, dep) => { if (dep > d) d = dep; if (!n.collapsed) n.children.forEach(c => walk(c, dep + 1)); }; walk(displayRoot, 0); return d; })();
  const totalW = MM.PAD_X + (maxDepth + 1) * MM.LEVEL_W + MM.PAD_X;

  const nodes = [];
  collectNodes(displayRoot, nodes);
  const paths = buildSvgPaths(displayRoot);

  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "mmCanvas";
  Object.assign(wrap.style, { width: totalW + "px", height: totalH + "px" });
  mmApplyTransform(wrap);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "mmSvg");
  svg.setAttribute("width", totalW);
  svg.setAttribute("height", totalH);
  for (const d of paths) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  wrap.appendChild(svg);

  for (const n of nodes) {
    const el = document.createElement("div");
    el.className = "mmNode" + (n.collapsed ? " mmCollapsed" : "") + (n.depth === 0 ? " mmRoot" : n.depth === 1 ? " mmL1" : "") + (n.children.length ? " mmHasChildren" : "");
    const txt = document.createElement("span");
    txt.className = "mmLabel";
    txt.textContent = n.label;
    el.appendChild(txt);
    if (n.children.length) {
      const badge = document.createElement("span");
      badge.className = "mmBadge";
      badge.textContent = n.collapsed ? "+" + n.children.length : "−";
      badge.onclick = (e) => { e.stopPropagation(); toggleMindMapNode(n); };
      el.appendChild(badge);
    }
    el.style.left = n._x + "px";
    el.style.top = (n._y - MM.NODE_H / 2) + "px";
    /* 点击导航: 仅在未拖拽时触发 */
    el.onclick = (e) => { if (!mmDragMoved) mindMapNavigate(n); };
    wrap.appendChild(el);
  }
  container.appendChild(wrap);

  /* ---- 交互: 中键拖拽平移 + 滚轮缩放(鼠标位置为中心) ---- */
  wrap.onmousedown = (e) => {
    if (e.button === 1) {
      /* 中键: 平移 */
      mmDrag = true; mmDragMoved = false;
      mmDragX = e.clientX - mmTranslateX * mmScale;
      mmDragY = e.clientY - mmTranslateY * mmScale;
      e.preventDefault();
    } else if (e.button === 0) {
      /* 左键: 仅记录起点, 用于判断是否拖拽(区分点击) */
      mmDragMoved = false;
      mmDragX = e.clientX;
      mmDragY = e.clientY;
    }
  };
  container.onmousemove = (e) => {
    if (mmDrag) {
      /* 中键拖拽平移 */
      mmTranslateX = (e.clientX - mmDragX) / mmScale;
      mmTranslateY = (e.clientY - mmDragY) / mmScale;
      mmApplyTransform(wrap);
    } else if (e.buttons === 1) {
      /* 左键拖拽也平移(更直觉) */
      const dx = e.clientX - mmDragX, dy = e.clientY - mmDragY;
      if (!mmDragMoved && Math.abs(dx) + Math.abs(dy) > 3) mmDragMoved = true;
      if (mmDragMoved) {
        mmTranslateX += dx / mmScale;
        mmTranslateY += dy / mmScale;
        mmDragX = e.clientX;
        mmDragY = e.clientY;
        mmApplyTransform(wrap);
      }
    }
  };
  container.onmouseup = (e) => {
    if (e.button === 1) mmDrag = false;
    if (e.button === 0) { /* 左键释放: 状态由 mmDragMoved 控制, onclick 里检查 */ }
  };
  container.onmouseleave = () => { mmDrag = false; };
  /* 滚轮缩放: 以鼠标位置为中心 */
  container.onwheel = (e) => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const oldScale = mmScale;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    mmScale = Math.min(3, Math.max(0.2, mmScale * delta));
    /* 保持鼠标位置下的内容点不动: tx' = tx + cx*(1/S' - 1/S) */
    mmTranslateX += cx * (1 / mmScale - 1 / oldScale);
    mmTranslateY += cy * (1 / mmScale - 1 / oldScale);
    mmApplyTransform(wrap);
  };
  /* 禁用中键默认行为(自动滚动) */
  container.oncontextmenu = (e) => { if (e.button === 1) e.preventDefault(); };
}

function resetMindMapView() { mmScale = 1; mmTranslateX = 0; mmTranslateY = 0; }
