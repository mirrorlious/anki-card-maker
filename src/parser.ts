import type {
  Card,
  ParseResult,
  ParserTemplate,
  TextPage,
} from './types';

type CanonicalSection = '答案' | '考点' | '解析' | '结束';

interface Section {
  name: CanonicalSection;
  start: number;
  contentStart: number;
}

const SECTION_REGEX = /(?:^|\n)【(答案|考点|解析|结束)】/g;
const KEYWORD_PATTERNS = [
  /包括|组成|构成|分为|可分为|主要有/,
  /特点|特征|性质|原则|规律/,
  /作用|功能|意义|任务|方法|途径/,
  /影响|原因|条件|机制|过程/,
];

let fallbackId = 0;

export const DEFAULT_PARSER_TEMPLATE: ParserTemplate = {
  id: 'criminal-law',
  name: '刑法母子题',
  questionPattern: String.raw`\d+\s*[-－—–]\s*\d+(?:\s*[-－—–]\s*\d+)?`,
  optionLetters: 'ABCDEFGH',
  answerLabels: ['答案', '正确答案'],
  pointLabels: ['考点', '知识点'],
  analysisLabels: ['解析', '答案解析'],
  trailingLabels: ['拓展', '子题', '小结', '命题角度'],
};

export const GENERAL_PARSER_TEMPLATE: ParserTemplate = {
  id: 'general-choice',
  name: '通用选择题',
  questionPattern: String.raw`(?:\d+\s*[-－—–]\s*)*\d+[.．、)]?`,
  optionLetters: 'ABCDEFGH',
  answerLabels: ['答案', '正确答案', '参考答案'],
  pointLabels: ['考点', '知识点'],
  analysisLabels: ['解析', '答案解析', '解答'],
  trailingLabels: ['拓展', '小结', '备注'],
};

function createCardId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackId += 1;
  return `card-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}

export function createCard(
  input: Omit<Card, 'id' | 'tags' | 'origin' | 'reviewStatus'> & {
    id?: string;
    tags?: string[];
    origin?: Card['origin'];
    reviewStatus?: Card['reviewStatus'];
  },
): Card {
  return {
    origin: 'local',
    reviewStatus: 'approved',
    ...input,
    id: input.id ?? createCardId(),
    tags: input.tags ?? [],
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flexibleLabel(value: string): string {
  return [...value.trim()].map(escapeRegex).join('[ \\t]*');
}

function labelsPattern(labels: string[]): string {
  return labels
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(flexibleLabel)
    .join('|');
}

function optionClass(template: ParserTemplate): string {
  const letters = [...new Set(template.optionLetters.toUpperCase())]
    .filter((letter) => /[A-Z]/.test(letter))
    .join('');
  return letters || DEFAULT_PARSER_TEMPLATE.optionLetters;
}

function cleanField(value: string): string {
  return value
    .replace(/\t/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function matchAnswerPrefix(
  value: string,
  template: ParserTemplate,
): { answer: string; matchLength: number } | null {
  const letters = optionClass(template);
  const token = `[${letters}]`;
  const pattern = new RegExp(
    String.raw`^\s*((?:(?:${token}[ \t]*[,，、/][ \t]*)+${token}|${token}(?:[ \t]+${token})+(?![A-Za-z])|${token}+))(?![A-Za-z])[.。]?[ \t]*`,
    'i',
  );
  const match = value.match(pattern);
  if (!match) return null;

  const choices = [...match[1]]
    .map((choice) => choice.toUpperCase())
    .filter((choice) => letters.includes(choice));
  if (!choices.length) return null;

  return {
    answer: [...new Set(choices)].join(''),
    matchLength: match[0].length,
  };
}

function normalizeSection(
  text: string,
  labels: string[],
  canonical: CanonicalSection,
): string {
  const names = labelsPattern(labels);
  if (!names) return text;

  const bracketed = new RegExp(
    String.raw`[ \t]*(?:【|\[|［)[ \t]*(?:${names})[ \t]*(?:】|\]|］)[ \t]*[：:]?[ \t]*`,
    'gi',
  );
  const labelled = new RegExp(
    String.raw`[ \t]*(?:${names})[ \t]*[：:][ \t]*`,
    'gi',
  );
  return text
    .replace(bracketed, `\n【${canonical}】`)
    .replace(labelled, `\n【${canonical}】`);
}

export function validateParserTemplate(template: ParserTemplate): string | null {
  if (!template.name.trim()) return '模板名称不能为空。';
  if (!template.questionPattern.trim()) return '题号正则不能为空。';
  if (!template.answerLabels.some((label) => label.trim())) {
    return '至少需要一个答案标签。';
  }

  try {
    new RegExp(template.questionPattern, 'gm');
  } catch (error) {
    return `题号正则无效：${(error as Error).message}`;
  }
  return null;
}

export function normalizeExamText(
  source: string,
  template: ParserTemplate = DEFAULT_PARSER_TEMPLATE,
): string {
  let text = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .replace(/\u00A0|\u3000/g, ' ')
    .replace(/^[ \t]*---[ \t]*PAGE[ \t]+\d+.*---[ \t]*$/gim, '')
    .replace(/^[ \t]*关注小[ \t]*Red[ \t]*书\s*@?[ \t]*刑法于越.*$/gim, '')
    .replace(/^[ \t]*(?:第[ \t]*)?\d{1,4}[ \t]*页[ \t]*$/gm, '')
    .replace(/^[ \t]*[-—–][ \t]*\d{1,4}[ \t]*[-—–][ \t]*$/gm, '');

  text = normalizeSection(text, template.trailingLabels, '结束');
  text = normalizeSection(text, template.analysisLabels, '解析');
  text = normalizeSection(text, template.pointLabels, '考点');
  text = normalizeSection(text, template.answerLabels, '答案');

  text = text.replace(/(【答案】)([^\n]*)/g, (full, marker, content) => {
    const parsed = matchAnswerPrefix(content, template);
    if (!parsed) return full;
    const remainder = content.slice(parsed.matchLength).trimStart();
    return `${marker}${parsed.answer}${remainder ? ` ${remainder}` : ''}`;
  });

  const letters = optionClass(template);
  text = text.replace(
    new RegExp(
      String.raw`[ \t]*(?<![A-Za-z0-9])([${letters}])[ \t]*[.．、][ \t]*`,
      'gi',
    ),
    (_, letter: string) => `\n${letter.toUpperCase()}. `,
  );

  text = text.replace(
    new RegExp(
      String.raw`([。！？!?；;])[ \t]*(${template.questionPattern})(?=[ \t]*\S)`,
      'g',
    ),
    '$1\n$2',
  );

  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findQuestionBlocks(
  text: string,
  template: ParserTemplate,
): string[] {
  const questionStart = new RegExp(
    String.raw`^[ \t]*(${template.questionPattern})(?=[ \t]*\S)`,
    'gm',
  );
  const starts = [...text.matchAll(questionStart)].map((match) => match.index);
  return starts.map((start, index) =>
    text.slice(start, starts[index + 1] ?? text.length).trim(),
  );
}

function findSections(block: string): Section[] {
  return [...block.matchAll(SECTION_REGEX)].map((match) => ({
    name: match[1] as CanonicalSection,
    start: match.index,
    contentStart: match.index + match[0].length,
  }));
}

function getSectionContent(
  block: string,
  sections: Section[],
  name: CanonicalSection,
): string {
  const index = sections.findIndex((section) => section.name === name);
  if (index === -1) return '';
  return cleanField(
    block.slice(
      sections[index].contentStart,
      sections[index + 1]?.start ?? block.length,
    ),
  );
}

function parseExamBlock(
  block: string,
  template: ParserTemplate,
): Card | null {
  const sections = findSections(block);
  const answerSectionIndex = sections.findIndex(
    (section) => section.name === '答案',
  );
  if (answerSectionIndex === -1) return null;

  const answerSection = sections[answerSectionIndex];
  const beforeAnswer = block.slice(0, answerSection.start).trim();
  const letters = optionClass(template);
  const optionRegex = new RegExp(
    String.raw`(?:^|\n)[ \t]*([${letters}])\.[ \t]*`,
    'gi',
  );
  const firstOption = [...beforeAnswer.matchAll(optionRegex)][0];
  const question = cleanField(
    firstOption ? beforeAnswer.slice(0, firstOption.index) : beforeAnswer,
  );
  const options = cleanField(
    firstOption ? beforeAnswer.slice(firstOption.index) : '',
  )
    .split('\n')
    .filter(Boolean)
    .join('\n');

  const rawAnswer = block.slice(
    answerSection.contentStart,
    sections[answerSectionIndex + 1]?.start ?? block.length,
  );
  const parsedAnswer = matchAnswerPrefix(rawAnswer, template);
  if (!question || !parsedAnswer) return null;

  const point = getSectionContent(block, sections, '考点');
  let analysis = getSectionContent(block, sections, '解析');
  if (!analysis && !point) {
    analysis = cleanField(rawAnswer.slice(parsedAnswer.matchLength));
  }

  return createCard({
    question,
    options,
    answer: parsedAnswer.answer,
    point,
    analysis,
    type: '选择题',
    chapter: template.name,
    tags: [template.name, '选择题', point].filter(Boolean),
  });
}

export function parseExamCards(
  source: string,
  template: ParserTemplate = DEFAULT_PARSER_TEMPLATE,
): ParseResult {
  const templateError = validateParserTemplate(template);
  if (templateError) throw new Error(templateError);

  const blocks = findQuestionBlocks(
    normalizeExamText(source, template),
    template,
  );
  const cards = blocks
    .map((block) => parseExamBlock(block, template))
    .filter((card): card is Card => card !== null);

  return {
    cards,
    candidateCount: blocks.length,
    skippedCount: blocks.length - cards.length,
  };
}

function normalizeSpaces(value: string): string {
  return value
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function cleanTextbookText(value: string): string {
  return normalizeSpaces(value)
    .replace(/香气物联网\s*P?D?G?/g, '')
    .replace(/农业生态学\s*$/gm, '')
    .replace(/^\s*[·•]\s*\d+\s*[·•]?\s*$/gm, '')
    .replace(/^\s*\d+\s*$/gm, '')
    .replace(/-{2,}\s*PAGE\s*\d+.*-{2,}/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSentences(value: string): string[] {
  return value
    .replace(/([。！？；])/g, '$1\n')
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length >= 18);
}

function isChapterLine(line: string): boolean {
  return /^第[一二三四五六七八九十百千\d]+章\s*.{0,50}$/.test(line.trim());
}

function isSectionLine(line: string): boolean {
  return /^第[一二三四五六七八九十百千\d]+节\s*.{0,50}$/.test(line.trim());
}

function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length <= 42 &&
    /^(?:[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d+[.、])\s*\S+/.test(
      trimmed,
    )
  );
}

function slimAnswer(value: string, maxLength: number): string {
  const compact = normalizeSpaces(value).replace(/\n+/g, '\n');
  if (compact.length <= maxLength) return compact;
  const sliced = compact.slice(0, maxLength);
  const lastStop = Math.max(
    sliced.lastIndexOf('。'),
    sliced.lastIndexOf('；'),
    sliced.lastIndexOf('，'),
  );
  return `${sliced.slice(0, lastStop > 80 ? lastStop + 1 : maxLength)}……`;
}

export function buildTextbookCards(
  pages: TextPage[],
  maxAnswerLength: number,
  maxCardsPerPage: number,
): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();
  let currentChapter = '未识别章节';
  let currentHeading = '';

  const push = (
    card: Omit<Card, 'id' | 'tags' | 'origin' | 'reviewStatus'> & {
      tags?: string[];
    },
  ): void => {
    const key = `${card.question}|${card.answer.slice(0, 30)}`;
    if (seen.has(key) || card.question.length < 6 || card.answer.length < 14) {
      return;
    }
    seen.add(key);
    cards.push(createCard(card));
  };

  pages.forEach((page) => {
    const text = cleanTextbookText(page.text);
    if (!text) return;

    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const pageStartCount = cards.length;
    const paragraphs: string[] = [];
    let buffer = '';

    lines.forEach((line) => {
      if (isChapterLine(line)) {
        currentChapter = line;
        currentHeading = '';
        return;
      }
      if (isSectionLine(line) || isHeadingLine(line)) {
        if (buffer) paragraphs.push(buffer);
        buffer = '';
        currentHeading = line.replace(
          /^(?:[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d+[.、])\s*/,
          '',
        );
        return;
      }
      buffer += line;
      if (/[。！？；]$/.test(line) || buffer.length >= 220) {
        paragraphs.push(buffer);
        buffer = '';
      }
    });
    if (buffer) paragraphs.push(buffer);

    paragraphs.forEach((paragraph) => {
      if (cards.length - pageStartCount >= maxCardsPerPage) return;
      const sentences = splitSentences(paragraph);
      const joined = slimAnswer(
        sentences.slice(0, 3).join(''),
        maxAnswerLength,
      );
      const chapter = currentChapter;
      const topic =
        currentHeading ||
        chapter.replace(/^第[一二三四五六七八九十百千\d]+章\s*/, '') ||
        '本节内容';
      const definitionMatch = paragraph.match(
        /([\u4e00-\u9fa5A-Za-z0-9（）()·—-]{2,22})(?:是指|是|指)([^。！？；]{18,220}[。！？；]?)/,
      );

      if (definitionMatch) {
        const term = definitionMatch[1]
          .replace(/^[的地得和与及其这种一个一种]+/, '')
          .replace(/[，。；：:、]/g, '')
          .trim();
        const connector = paragraph.includes('是指')
          ? '是指'
          : paragraph.includes('指')
            ? '指'
            : '是';
        const definition = slimAnswer(
          `${term}${connector}${definitionMatch[2]}`,
          maxAnswerLength,
        );
        if (term.length >= 2 && term.length <= 18) {
          push({
            question: `什么是${term}？`,
            options: '',
            answer: definition,
            point: topic,
            analysis: '由教材正文自动抽取定义句，建议预览后精修。',
            type: '名词解释',
            chapter,
            sourcePage: page.page,
            tags: ['教材OCR', '名词解释', chapter],
          });
        }
      }

      if (cards.length - pageStartCount >= maxCardsPerPage) return;
      if (
        KEYWORD_PATTERNS.some((pattern) => pattern.test(paragraph)) &&
        joined.length >= 35
      ) {
        const questionPrefix = /包括|组成|构成|分为|可分为|主要有/.test(
          paragraph,
        )
          ? '简述其组成或分类。'
          : /作用|功能|意义|任务|方法|途径/.test(paragraph)
            ? '简述其作用、意义或方法。'
            : '简述教材中的核心要点。';
        push({
          question: `${topic}：${questionPrefix}`,
          options: '',
          answer: joined,
          point: topic,
          analysis: '命中“组成/特点/作用/影响”等高频考点词后自动生成。',
          type: '简答题',
          chapter,
          sourcePage: page.page,
          tags: ['教材OCR', '简答', chapter],
        });
      }

      if (cards.length - pageStartCount >= maxCardsPerPage) return;
      const fillSentence = sentences.find(
        (sentence) =>
          /是|包括|分为|具有/.test(sentence) && sentence.length <= 120,
      );
      if (fillSentence) {
        const fillTerm =
          definitionMatch?.[1]?.replace(/[，。；：:、]/g, '').trim() ||
          topic.slice(0, 12);
        if (fillTerm.length >= 2 && fillSentence.includes(fillTerm)) {
          push({
            question: fillSentence.replace(fillTerm, '____'),
            options: '',
            answer: fillTerm,
            point: topic,
            analysis: fillSentence,
            type: '填空题',
            chapter,
            sourcePage: page.page,
            tags: ['教材OCR', '填空', chapter],
          });
        }
      }
    });
  });

  return cards;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function textToHtml(value: string): string {
  return escapeHtml(value.trim()).replace(/\n/g, '<br>');
}

export function buildCardFront(card: Card): string {
  return card.options
    ? `${textToHtml(card.question)}<br><br>${textToHtml(card.options)}`
    : textToHtml(card.question);
}

export function buildCardBack(card: Card): string {
  const meta = [
    card.chapter,
    card.sourcePage ? `PDF 第 ${card.sourcePage} 页` : '',
    card.type,
  ]
    .filter(Boolean)
    .join(' ｜ ');
  const parts = [`<b>答案：</b><br>${textToHtml(card.answer)}`];
  if (card.point) parts.push(`<b>考点：</b>${textToHtml(card.point)}`);
  if (card.analysis) {
    parts.push(`<b>解析：</b><br>${textToHtml(card.analysis)}`);
  }
  if (meta) {
    parts.push(
      `<span style="color:#666;font-size:12px">${textToHtml(meta)}</span>`,
    );
  }
  return parts.join('<br><br>');
}
