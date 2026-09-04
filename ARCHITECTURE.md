# ARCHITECTURE — 架构现状与演进路线

> 本文档记录项目的技术哲学、依赖清单、代码现状地图，以及「按需拆分」的演进路线。
> 改动架构前先读这里；完成一次拆分后回来更新对应条目。

## 一、项目定位与技术哲学

纯本地网页版阅读器（EPUB/TXT），PWA 可安装。核心决策与约束：

- **零依赖**：除一个拼音字典库外全部手写（ZIP 解压、EPUB 解析、分页引擎、搜索、主题）
- **本地可运行**：无 CDN 运行时引用、无构建步骤、无打包器；经典 `<script>` 标签链加载，
  **保留 file:// 双击直开能力**（因此不迁移 ES Modules——其 CORS 限制会杀死直开）
- **部署形态**：GitHub Pages 静态托管 + Service Worker 离线缓存；SW 要求 http(s) 环境，
  故实际使用走 localhost / Pages，file:// 直开是降级可用路径

## 二、依赖清单

### 第三方（仅此一项）

| 资产 | 许可 | 说明 |
|---|---|---|
| `vendor/pinyin-pro.min.js`（347KB） | MIT | 汉字转拼音的字典+分词。**不在首屏**：`pinyin.js` 的 `ensurePinyinLib()` 动态注入 `<script>`，首次开启注音才拉取，SW 预缓存后离线可用 |

我们的 `pinyin.js` 只是调度引擎（DOM 遍历/批量调度/观察器），转换能力全部来自该库。

### 自写模块

ZIP 中央目录读取 + CRC32 + 手写 DEFLATE inflate（`reader.js` 内 `ZipReader`）、
EPUB 解析（DOMParser 处理 OPF/nav/NCX）、分页引擎（CSS columns 方案）、全书搜索、
主题派生色算法、TXT 编码探测与章节切分、i18n、Service Worker。

### 平台 API

IndexedDB（书籍文件）、localStorage（进度与偏好）、Service Worker + Cache API、
Blob/File、MessageChannel（宏任务让出，后台标签不被钳制）、DOMParser/XMLSerializer。

## 三、现状地图

```
index.html   252 行   UI 骨架 + 脚本链 + 内联 SW 版本握手
engine.js    259 行   格式解析引擎(纯函数层): ZIP/CRC32/路径工具/XML解析 + EPUB(container/OPF/nav/NCX/封面) + TXT(编码/分章)
pager.js     309 行   排版引擎: 翻页(CSS columns)+滚动双模式/虚拟化/触摸滚轮手势/沉浸模式/模式切换(私有状态, 函数API对外)
reader.js   2177 行起 UI 编排与渲染管线(state 单点/存储/书架/搜索/渲染/主题/设置绑定)
i18n.js      172 行   翻译表
pinyin.js    166 行   外挂注音调度引擎(独立于核心, 三触点: pyDispatch/pyMarkMove/pyReset)
typing.js    438 行   打字模式调度引擎(独立于核心, 触点: twEnterPick/twReset)
scratch.js   128 行   逐字阅读(刮刮乐)调度引擎(独立于核心, 触点: scratchEnter/scratchReset)
sw.js         80 行   预缓存 SHELL 清单 + 缓存策略
vendor/             pinyin-pro.min.js
tests/smoke.mjs 1176 行   零依赖冒烟测试(内置静态服务器驱动真 Chrome, 129 项断言)
```

### 脚本链与依赖契约

`i18n.js → pinyin.js → typing.js → scratch.js → engine.js → pager.js → mindmap.js → reader.js`(经典脚本全局共享):

- **engine.js** 纯函数无状态; 运行期用 i18n 的 `t()`(仅函数体内)
- **pager.js** 顶层仅声明无执行语句; 运行期依赖 reader 的 `state/$/t/toast/showUnit/getPageHeight/REDUCED_MOTION` 与 pinyin 的 `pyMarkMove`(契约写在文件头)
- **reader.js** 是装配点: state 单点、DOM 绑定、启动引导都在这里; 引擎函数经全局直呼(运行期才发生, 无加载顺序风险)
- 拆分纪律: 每拆一层 = 独立 commit + 冒烟回归 + SW SHELL 同步 + VERSION 递增

## 四、架构演进原则

**按需拆分，只拆大功能，触发即拆不预拆。**

- 模块机制维持经典脚本链：拆出的文件就是链条里多一环 `<script src="xxx.js">`，
  排在被依赖者之后、使用者之前
- 不迁 ES Modules：file:// 直开兼容优先于 import 显式化
- 每次拆分 = 一个独立 commit + 冒烟回归 + `sw.js` 版本递增
- 体量不足的功能域永不单独成文件（util、TXT、搜索、i18n）

## 五、候选拆分队列（触发条件 → 产出）

| 触发点 | 抽出模块 | 体量 | 内容 |
|---|---|---|---|
| ✅ 已完成(2026-08, 架构升级) | `engine.js` | 259 行 | ZIP/CRC32/路径/XML + EPUB 解析 + TXT 解析 + 目录构建 + 封面提取 |
| ✅ 已完成(2026-08, 架构升级) | `pager.js` | 309 行 | 翻页+滚动引擎整体迁出; FXL 固定排版与 RTL 翻页将并入此层 |
| 做云备份/同步时 | `storage.js` | ~300 行 | IndexedDB/localStorage/备份导入导出 |
| 主题系统大改时 | `theme.js` | ~250 行 | THEMES+派生色+设置绑定中的外观部分 |

## 六、未来功能挂载点速查

| 功能 | 落点 | 备注 |
|---|---|---|
| encryption.xml 字体解密（IDPF/Adobe 双混淆算法，XOR 前 1040/1024 字节） | epub 层 | 参考实现 foliate-js epub.js:568-640（MIT）；SHA-1 用 crypto.subtle（安全上下文可用） |
| FXL 固定排版（绘本/漫画，rendition:layout=pre-paginated） | pager 层 | 整页缩放模式，视口来源回退链：SVG viewBox → viewport meta → 书级默认 → 图片自然尺寸 |
| RTL 翻页（日漫 page-progression-direction="rtl"） | pager 层 | 现有 flipPage 符号取反即可 |
| 竖排（writing-mode: vertical-rl） | pager 层 | ✅ spike 已验证可行(2026-08, 真 Chrome 实测)，见下方结论 |

### 竖排 spike 结论（2026-08, Chrome 无头实测）

1. **`vertical-rl` + CSS columns 可用**：列沿物理 X 轴向右扩展，`scrollWidth`
   如实报告总宽 W（55216px 实测）；阅读起点在最右列，序向左推进
2. **翻页公式**：列厚=`column-width`(块轴尺寸)，列长=元素 height(内联轴)。
   页 k 的窗口 = 内容空间 `[W−pw−k·S, W−k·S]`(S=pw+gap)，实现为
   `translateX(T_k)`，**T_k = k·S − (W−pw)**。实测 135 页遍历单调无空白无重叠，
   越界页正确为空
3. **实现要点**：pager 的 pagedCtx 增加轴向标志；竖排时 iframe 内 body 注入
   `writing-mode:vertical-rl; height:视口高; column-width:视口宽`；总宽取
   scrollWidth；触摸方向反转（内容随 k 右移 → 右滑=下一页）；滚轮 deltaY
   语义不变。unit-page 映射(showUnit/getPageHeight/currentScrollRatio)、
   滚动模式虚拟化(scrollMarks 沿 scrollLeft)、pyMarkMove 需轴感知适配
4. **建议分期**：先做竖排×翻页模式(改动集中在 pagedCtx 数学)，滚动模式竖排
   二期；拼音注音为 DOM 级注入不受排版方向影响
| SVG 直接作 spine 条目 / EPUB2 封面三级回退（cover-image 属性 → meta name=cover → guide type） | epub/渲染管线 | prepareSpineBody 已有 `svg image, svg use` 选择器兜底 |
| 拼音库懒加载 | ✅ 已完成 | ensurePinyinLib 动态注入，勿改为首屏静态引入 |

## 七、已知风险与开发纪律

1. **SW 缓存一致性**：SHELL 清单必须随文件增删同步 + VERSION 递增；缓存优先+后台刷新策略
   → 发版后用户需刷新两次（或关标签重开）才拿到新资源
2. **jsdom ≠ Chrome**：XML 命名空间行为有引擎差异——Chrome 的 XML 文档里
   `image[xlink\:href]` 属性选择器匹配不到带命名空间属性而 jsdom 可以
   （SVG 封面空白事故，commit 928b708）。凡涉 XML 解析/命名空间的行为，
   一律真浏览器验证，不信 jsdom 等价性
3. **requestIdleCallback 必须传字典参数**：`ric.call(win, step, {timeout:500})`，
   数字第二参在 Firefox 会抛错（拼音 v9 事故）
4. **潜在隐患备忘**：materializeResource 在 makeResourceUrl 失败时仍无条件摘除 data-rpath
   （.catch 吞错后清理照跑）——属健壮性缺口，下次动媒体管线时顺手加固
5. **回归测试资产**：`tests/smoke.mjs` 已入库（零依赖, `node tests/smoke.mjs` 直接运行,
   内置随机端口静态服务器 + 真 Chrome CDP 驱动, 129 项断言覆盖开书/分章/书架/编辑模式/
   备份往返/重链接/双视图/封面提取/注音会话级/i18n/a11y/打字模式/逐字阅读/野生书容错）。
   凡改解析/排版/书架或新增交互模式, 先跑冒烟再提交
6. **经典脚本方法重名陷阱**：类里新增方法不可与既有同名（哪怕签名不同）——后者静默覆盖
   前者；ZipReader 曾因新增 `async text(name)` 覆盖同步解码器 `text(bytes,enc)`，
   未 await 的 Promise 漏进同步调用链引发诡异 TypeError。加方法前先 grep 全类
7. **野生书容错纪律**：只做通用性回退（container 扫描、编码探测、错误隔离），
   不为特定工具写特判；目标是优雅降级而非全都能开
