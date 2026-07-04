# Anki 批量制卡引擎

在浏览器中把教材 PDF、扫描页或结构化题库转换为可编辑的 Anki 卡片。所有正文解析、预览和导出都在本机完成。

## 核心能力

- **教材制卡**：从章节正文中生成名词解释、简答和填空卡。
- **题库制卡**：稳健识别题号、选项、答案、考点与解析，支持自定义模板。
- **PDF + OCR**：优先读取 PDF 文本层，仅在扫描页或强制模式下调用 Tesseract OCR。
- **完整编辑**：修改全部卡片字段，支持全选、批量标签、批量分类、删除与撤销。
- **草稿恢复**：卡片、原文和设置自动保存在浏览器 IndexedDB 中。
- **安全导出**：原文 HTML 会被转义，可导出 Anki TXT、JSON 和现代 `.apkg` 牌组。
- **本地依赖**：PDF.js、OCR worker、SQLite WASM 均随应用构建，不再动态加载第三方脚本。

> OCR 首次使用仍需下载所选语言模型，浏览器随后会缓存模型。纯文本 PDF 和题库粘贴不需要 OCR。

## 快速开始

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173/`。

## 使用方式

1. 选择“教材背诵卡”或“题库解析卡”。
2. 上传 PDF，或切换到“文本粘贴”。
3. 在预览区精修卡片，可批量添加标签或修改类型。
4. 推荐直接导出 `.apkg`；也可导出 Tab 分隔的 Anki TXT 或 JSON 备份。

扫描版教材建议按章处理。自动模式会检查每页文本量，只对疑似扫描页执行 OCR；处理中可随时取消，既有卡片不会被覆盖。

## 题库模板

内置“刑法母子题”和“通用选择题”预设。高级设置中可修改：

- 题号正则；
- 选项字母范围；
- 答案、考点、解析与截断标签。

无效正则会在界面直接提示，不会启动解析。

## 质量检查

```bash
npm test
npm run lint
npm run build
```

端到端测试首次需要安装 Chromium：

```bash
npx playwright install chromium
npm run test:e2e
```

测试覆盖题库兼容性、教材卡生成、HTML 安全、编辑与批量操作、撤销删除、草稿恢复、PDF worker、TXT 与 `.apkg` 下载。

## 技术栈

- React 19、TypeScript、Vite、Tailwind CSS
- PDF.js 6
- Tesseract.js 7
- ankipack + SQL.js
- Node Test Runner + Playwright

## 许可

MIT
