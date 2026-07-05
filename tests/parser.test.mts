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
