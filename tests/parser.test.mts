import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCardBack,
  buildCardFront,
  buildTextbookCards,
  DEFAULT_PARSER_TEMPLATE,
  GENERAL_PARSER_TEMPLATE,
  normalizeExamText,
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
