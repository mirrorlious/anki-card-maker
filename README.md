# Anki 批量制卡引擎

自动解析 PDF / 纯文本生成 Anki 闪卡，专为**法考《刑法母题》**结构化题目设计。

## 功能

- **PDF 上传解析** — 使用 PDF.js 自动提取文字并清洗排版
- **纯文本粘贴** — 直接粘贴解析
- **智能切分** — 按题号自动切分**题干 / 选项 / 答案 / 解析**
- **Anki 导出** — 生成 TAB 分隔的 `.txt`，支持 HTML 格式正面/背面

## 快速开始

```bash
npm install
npm run dev
```

## 使用说明

1. 上传 PDF 或粘贴文本
2. 自动提取题目结构
3. 预览确认后导出 `.txt`
4. 打开 Anki → 导入文件 → 分隔符选 **制表符 (Tab)** → 勾选 **允许在字段中使用 HTML**

## 技术栈

- React 19 + TypeScript
- Vite (构建)
- Tailwind CSS (样式)
- PDF.js (PDF 文本提取)
- Lucide React (图标)

## 许可

MIT