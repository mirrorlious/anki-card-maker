import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCardBack,
  buildCardFront,
  buildTextbookCards,
  DEFAULT_PARSER_TEMPLATE,
  GENERAL_PARSER_TEMPLATE,
  normalizeExamText,
  pagesFromExtractedText,
  parseExamCards,
} from '../src/parser.ts';

test('parses mixed labels, punctuation and multiple answers', () => {
  const source = `
    --- PAGE 1 ---
    1－1 下列说法何者正确？
    A．甲说法
    B、乙说法
    C. 丙说法
    D. 丁说法
    【答 案】 A、C
    【知识点】 共同犯罪
    【答案解析】 第一行
    第二行
    【拓 展】 不应进入解析

    1 - 2 - 1 第二道题？
    A. 正确
    B. 错误
    答案：B
    解析：第二题解析
  `;
  const result = parseExamCards(source, DEFAULT_PARSER_TEMPLATE);

  assert.equal(result.cards.length, 2);
  assert.equal(result.cards[0].answer, 'AC');
  assert.equal(result.cards[0].point, '共同犯罪');
  assert.match(result.cards[0].analysis, /第一行\n第二行/);
  assert.doesNotMatch(result.cards[0].analysis, /拓展/);
  assert.equal(result.cards[1].answer, 'B');
});

test('restores structure lost by flat PDF extraction', () => {
  const source =
    '1-1题干？A.选项甲B.选项乙【答案】A【考点】考点【解析】解析。2-1下一题？A.是B.否【答案】B【解析】说明';
  const result = parseExamCards(source, DEFAULT_PARSER_TEMPLATE);

  assert.equal(result.cards.length, 2);
  assert.equal(result.cards[0].options, 'A. 选项甲\nB. 选项乙');
  assert.equal(result.cards[1].question, '2-1下一题？');
});

test('supports a general numbered-question template', () => {
  const result = parseExamCards(
    `
      1. 第一题？
      A. 是
      B. 否
      参考答案：A
      解答：说明
    `,
    GENERAL_PARSER_TEMPLATE,
  );

  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].analysis, '说明');
});

test('does not mistake English explanation text for answer choices', () => {
  const { cards } = parseExamCards(
    `
      1-1 Question?
      A. One
      B. Two
      答案：A Because option A is correct.
    `,
    DEFAULT_PARSER_TEMPLATE,
  );

  assert.equal(cards[0].answer, 'A');
  assert.equal(cards[0].analysis, 'Because option A is correct.');
});

test('escapes imported HTML in card exports', () => {
  const { cards } = parseExamCards(
    `
      1-1 <img src=x onerror=alert(1)>？
      A. 甲
      B. 乙
      【答案】A
      【解析】第一行
      第二行
    `,
    DEFAULT_PARSER_TEMPLATE,
  );
  const front = buildCardFront(cards[0]);
  const back = buildCardBack(cards[0]);

  assert.match(front, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(front, /<img src=x/);
  assert.match(back, /第一行<br>第二行/);
});

test('generates textbook definition and summary cards without duplicates', () => {
  const cards = buildTextbookCards(
    [
      {
        page: 12,
        text: `
          第一章 生态系统
          第一节 基本概念
          一、生态系统
          生态系统是指生物群落与其环境之间通过能量流动和物质循环形成的统一整体。
          生态系统的主要功能包括能量流动、物质循环和信息传递，这些过程共同维持系统稳定。
        `,
      },
    ],
    220,
    5,
  );

  assert.ok(cards.length >= 2);
  assert.ok(cards.some((card) => card.type === '名词解释'));
  assert.ok(cards.some((card) => card.type === '简答题'));
  assert.ok(cards.every((card) => card.sourcePage === 12));
});

test('normalizes malformed square-bracket labels and page noise', () => {
  const normalized = normalizeExamText(
    `
      第 12 页
      1-1 题干
      A. 甲
      [答案]: A
      ［解析］: 内容
    `,
    DEFAULT_PARSER_TEMPLATE,
  );

  assert.doesNotMatch(normalized, /第 12 页/);
  assert.match(normalized, /【答案】A/);
  assert.match(normalized, /【解析】内容/);
});

test('generates specific textbook questions instead of generic chapter prompts', () => {
  const cards = buildTextbookCards(
    [
      {
        page: 21,
        text: `第一节“细胞的结构和功能所有生物都具有一定的细胞结构，但在细胞结构的组成上，各种生物是不同的。根据细胞结构的复杂程度，可把生物界的细胞概分为两类，原核细胞和真核细胞。必要对细胞的结构和功能、细胞的分裂方式以及生物繁殖方式与遗传表现的关系进行介绍。`,
      },
      {
        page: 23,
        text: `线粒体含有大量的脂类，主要是磷脂类，它是线粒体双膜结构的重要成分。线粒体是由内外两层膜组成，外膜光滑，内膜向内回旋折叠，形成许多横隔。`,
      },
      {
        page: 25,
        text: `在多数物种中，有一对形态和所含基因位点不同的同源染色体，称为性染色体。其余形态结构相同的染色体称为常染色体。`,
      },
    ],
    220,
    5,
  );
  const questions = cards.map((card) => card.question);

  assert.ok(
    questions.includes('按细胞结构的复杂程度，生物界的细胞可分为哪几类？'),
  );
  assert.ok(questions.includes('线粒体含有哪些重要成分？'));
  assert.ok(questions.includes('线粒体由哪些部分组成？'));
  assert.ok(questions.includes('什么是性染色体？'));
  assert.ok(questions.includes('什么是常染色体？'));
  assert.ok(
    questions.every(
      (question) =>
        !question.includes('未识别章节') &&
        !question.includes('简述其') &&
        !question.includes('核心要点'),
    ),
  );
  assert.ok(cards.every((card) => card.analysis === ''));
  assert.ok(cards.every((card) => card.sourceQuote));
  assert.equal(
    new Set(questions.map((question) => question.replace(/\s/g, ''))).size,
    questions.length,
  );
});

test('restores PDF page boundaries when regenerating from saved extracted text', () => {
  const pages = pagesFromExtractedText(`
    --- PAGE 21 [ocr] ---
    第一页正文。

    --- PAGE 22 [text] ---
    第二页正文。
  `);

  assert.deepEqual(
    pages.map((page) => page.page),
    [21, 22],
  );
  assert.match(pages[0].text, /第一页正文/);
  assert.match(pages[1].text, /第二页正文/);
});

test('normalizes OCR character spacing before extracting textbook cards', () => {
  const cards = buildTextbookCards(
    [
      {
        page: 21,
        text: `< 一
        [第 二 恒
        W
        一
        遗传 的 细胞 学 基础
        细胞 (cell) 是 生物 体 结构 和 生命 活动 的 基本 单位 。
        高 等 的 多 细胞 生物 虽然 是 由 许多 形态 不 同 的 细胞 所 组 成 ， 但 生命 活动 仍 以 细胞 为 基础 。
        正 因为 生物 具有 繁殖 后 代 的 能 力 ， 才 能 世代 相传 。
        第 一 节 ”细胞 的 结构 和 功能
        根 据 细胞 结构 的 复杂 程度 ， 可 把 生物 界 的 细胞 概 分 为 两 类 ： 原核 细胞 和 真 核 细胞 。`,
      },
      {
        page: 23,
        text: `现 已 肯定 线粒体 、 叶绿体 、 核糖 体 和 内 质 网 等 具有 重要 的 遗传 功能 。
        线粒体 ”线粒体 是 由 内 外 两 层 膜 组 成 ， 外 膜 光滑 ， 内 膜 向 内 回旋 折叠 ， 形成 许多 横 隔 。
        线粒体 含有 大 量 的 脂 类 ， 主 要 是 磷脂 类 。`,
      },
      {
        page: 27,
        text: `形态 和 结构 相同 的 一 对 染色 体 ， 称 为 同 源 染色 体 (homologous chromosome) 。`,
      },
    ],
    220,
    5,
  );
  const questions = cards.map((card) => card.question);

  assert.ok(
    questions.includes('按细胞结构的复杂程度，生物界的细胞可分为哪几类？'),
  );
  assert.ok(questions.includes('什么是细胞？'));
  assert.ok(questions.includes('线粒体由哪些部分组成？'));
  assert.ok(questions.includes('线粒体含有哪些重要成分？'));
  assert.ok(questions.includes('什么是同源染色体？'));
  assert.ok(
    questions.every(
      (question) =>
        !/(?:虽然|正因为|现已|叶绿体叶绿体|外上间|厂面)/.test(question),
    ),
  );
  assert.ok(cards.every((card) => !card.answer.includes('线 粒 体')));
});
