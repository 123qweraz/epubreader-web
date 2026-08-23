# EPUB Reader（网页版）

纯本地 EPUB / TXT 阅读器，自同名浏览器扩展移植的独立网页项目。零依赖、零构建、纯静态——所有解析、渲染、存储均在浏览器内完成，**书籍文件不会上传到任何服务器**。

## 功能

- 打开 `.epub` / `.txt`（点击选择或拖入页面），TXT 按章节标题正则自动分卷分章
- 书架：最近 15 本记录 + 阅读进度持久化（IndexedDB），重开同一文件自动续读
- 目录侧栏（可固定/浮动）、全书搜索（含上下文预览与跳转）
- 滚动 / 双列翻页两种排版；字号、行距、页宽、字体调节
- 主题：浅色 / 羊皮纸 / 深色 + 3 个自定义配色槽位
- 中英双语界面，默认跟随浏览器语言，可在设置中切换
- 自动阅读（定时翻章）、书内锚点跳转、外部链接新标签打开

## 本地运行

任意静态服务器指向本目录即可，例如：

```bash
python3 -m http.server 8080
# 浏览器访问 http://localhost:8080/
```

> 不建议直接双击 index.html 以 file:// 打开：部分浏览器对 file:// 来源的 IndexedDB / localStorage 限制较多，书架与进度可能无法保存。

## 部署上线

纯静态站点，任何静态托管开箱即用：

**GitHub Pages**

1. 推送到 GitHub 仓库
2. Settings → Pages → Source 选 `main` 分支 `/ (root)`
3. 访问 `https://<用户名>.github.io/<仓库名>/`

**Cloudflare Pages / Netlify / Vercel**

连接仓库或直接拖拽目录上传，零配置。根目录已含 `.nojekyll`（GitHub Pages 免 Jekyll 处理）。

## 技术说明

- 解压依赖浏览器原生 `DecompressionStream`（Chrome/Edge 80+、Firefox 113+、Safari 16.4+），需 HTTPS 或 localhost 环境
- 存储：书籍文件与元数据存 IndexedDB（上限 30 本，按最旧读取时间清理）；界面偏好存 localStorage；进度双写（localStorage 热缓存 + IndexedDB 持久）
- 语言检测：`navigator.language`，zh* → 中文、en* → English、其他回退中文；手动选择存 `lang` 键
- 与浏览器扩展版（epubreader 仓库）同源异流：本项目面向 Web 托管独立演化
