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
    .replace(/[`´]{1,}/g, '')
    .replace(
      /([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fffA-Za-z0-9])/g,
      '$1',
    )
    .replace(/([A-Za-z0-9])[ \t]+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/[ \t]*([，。；：！？、])[ \t]*/g, '$1')
    .replace(/[ \t]+(?=[（(《〈“”])/g, '')
    .replace(/([（(《〈“”])[ \t]+/g, '$1')
    .replace(/[ \t]+([）)》〉”])/g, '$1')
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
    .replace(/([。！？；])(?=\S)/g, '$1\n')
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length >= 12);
}

interface ExtractedHeading {
  body: string;
  heading: string;
  kind: 'chapter' | 'section';
}

interface TextbookCandidate {
  answer: string;
  confidence: number;
  point: string;
  question: string;
  score: number;
  sourceQuote: string;
  type: string;
}

function extractNumberedHeading(line: string): ExtractedHeading | null {
  const trimmed = line.trim();
  const marker = trimmed.match(
    /^(第[一二三四五六七八九十百千\d]+([章节]))\s*/,
  );
  if (!marker) return null;

  const kind = marker[2] === '章' ? 'chapter' : 'section';
  const remainder = trimmed.slice(marker[0].length).trim();
  const quoted = remainder.match(
    /^[“”"《〈]([^“”"《》〈〉]{2,40})[“”"》〉]\s*/,
  );
  if (quoted) {
    return {
      heading: `${marker[1]} ${quoted[1].trim()}`,
      body: remainder.slice(quoted[0].length).trim(),
      kind,
    };
  }

  const bodyStarters = [
    '所有',
    '一般',
    '通常',
    '根据',
    '为了',
    '不同',
    '其中',
    '当',
    '在',
    '由',
    '其',
    '它',
    '该',
  ];
  const starterIndexes = bodyStarters
    .map((starter) => remainder.indexOf(starter, 2))
    .filter((index) => index >= 2);
  const boundary = starterIndexes.length ? Math.min(...starterIndexes) : -1;
  if (boundary !== -1) {
    return {
      heading: `${marker[1]} ${remainder
        .slice(0, boundary)
        .replace(/^[“”"《〈]|[“”"》〉]$/g, '')
        .trim()}`,
      body: remainder.slice(boundary).trim(),
      kind,
    };
  }

  if (remainder.length <= 32 && !/[。！？；]/.test(remainder)) {
    return {
      heading: `${marker[1]} ${remainder
        .replace(/^[“”"《〈]|[“”"》〉]$/g, '')
        .trim()}`,
      body: '',
      kind,
    };
  }
  return null;
}

function extractMinorHeading(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length > 36 || /[。！？；]$/.test(trimmed)) return null;
  const match = trimmed.match(
    /^(?:[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d+[.、])\s*(\S.{1,30})$/,
  );
  const rawHeading = match?.[1]?.trim();
  if (!rawHeading) return null;
  return (
    rawHeading.match(/^([\u3400-\u9fff]{2,20})/)?.[1] ?? rawHeading
  );
}

function extractInlineTopic(
  line: string,
): { body: string; heading: string } | null {
  const repeated = line.match(
    /^([\u3400-\u9fff]{2,12})[“”"：:]?(?=\1(?:是|指|含有|具有|由))/,
  );
  if (!repeated) return null;
  return {
    heading: repeated[1],
    body: line.slice(repeated[0].length),
  };
}

function extractStandaloneHeading(line: string): string | null {
  if (
    line.length < 2 ||
    line.length > 24 ||
    /[，。；：！？、]/.test(line)
  ) {
    return null;
  }
  const chineseCount = line.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  if (chineseCount / line.length < 0.72) return null;
  return line.replace(/^[^\u3400-\u9fff]+|[^\u3400-\u9fff]+$/g, '');
}

function isLikelyOcrLineNoise(line: string): boolean {
  const chineseCount = line.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  if (/^[\u3400-\u9fff]?传学$/.test(line)) return true;
  return (
    line.length <= 12 &&
    chineseCount < 4 &&
    !/[。！？；]/.test(line) &&
    (chineseCount === 0 || /[<>{}[\]|\\]/.test(line))
  );
}

function headingTopic(heading: string): string {
  return heading
    .replace(/^第[一二三四五六七八九十百千\d]+[章节]\s*/, '')
    .replace(/^[“”"《〈]|[“”"》〉]$/g, '')
    .trim();
}

function cleanSubject(value: string, fallback = ''): string {
  let subject = value
    .replace(
      /[（(〈]?[A-Za-z][A-Za-z0-9 .,'’/_-]{1,60}[）)〉]?\s*$/i,
      '',
    )
    .replace(/^(?:根据|按照|对于|关于|其中|一般(?:而言)?|通常|所谓)\s*/, '')
    .replace(/^(?:可将|可把|将|把)\s*/, '')
    .replace(/[，。；：:“”"《》]/g, '')
    .replace(/(?:大致|大体|概|主要|都)$/g, '')
    .trim();

  if (
    subject.length % 2 === 0 &&
    subject.slice(0, subject.length / 2) === subject.slice(subject.length / 2)
  ) {
    subject = subject.slice(0, subject.length / 2);
  }
  if (/^(?:其|它|该|这种|这些|此)(?:的)?/.test(subject)) {
    subject = fallback;
  }
  if (
    subject.length < 2 ||
    subject.length > 28 ||
    !/[\u4e00-\u9fff]{2}/.test(subject) ||
    /(?:本章|本节|下文|如下|上述|未识别|虽然|因为|不论|但是|现已|已经|试验|研究|证明|表明|认为|可见|为了|外上间|厂面)/.test(
      subject,
    )
  ) {
    return '';
  }
  return subject;
}

function isUsableSentence(sentence: string): boolean {
  const semanticText = sentence.replace(
    /[（(〈][A-Za-z][A-Za-z0-9 .,'’/_-]{1,80}[）)〉]/g,
    '',
  );
  const chineseCount =
    semanticText.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const unusualCount =
    sentence.match(/[^\u4e00-\u9fffA-Za-z0-9，。；：！？、（）()《》“”"·%+\-—\s]/g)
      ?.length ?? 0;
  return (
    sentence.length >= 16 &&
    sentence.length <= 320 &&
    chineseCount >= 10 &&
    chineseCount / semanticText.length >= 0.45 &&
    unusualCount / sentence.length < 0.08 &&
    !/(?:进行介绍|将在下文|本章主要|本节主要|学习目标|思考题|复习题|如图|见图|图\d|表\d)/.test(
      sentence,
    )
  );
}

function makeCandidate(
  sentence: string,
  question: string,
  point: string,
  type: string,
  score: number,
  confidence: number,
): TextbookCandidate {
  return {
    question,
    answer: sentence,
    point,
    type,
    score,
    confidence,
    sourceQuote: sentence,
  };
}

function candidateFromSentence(
  sentence: string,
  contextTopic: string,
): TextbookCandidate | null {
  if (!isUsableSentence(sentence)) return null;
  const normalized = sentence.replace(/\s+/g, ' ').trim();

  const namedMatch = normalized.match(
    /^(.{10,240}?)(?:被称为|称为|叫作|叫做)([^，。；]{2,70})[。；]?$/,
  );
  if (namedMatch) {
    const term = cleanSubject(namedMatch[2]);
    if (term) {
      return makeCandidate(
        normalized,
        `什么是${term}？`,
        term,
        '名词解释',
        100,
        0.9,
      );
    }
  }

  const definitionMatch = normalized.match(
    /^([^，。；：]{2,26}?)(?:是指|指的是)([^。；]{8,260})[。；]?$/,
  );
  if (definitionMatch) {
    const term = cleanSubject(definitionMatch[1], contextTopic);
    if (term) {
      return makeCandidate(
        normalized,
        `什么是${term}？`,
        term,
        '名词解释',
        100,
        0.94,
      );
    }
  }

  const copulaDefinitionMatch = normalized.match(
    /^([^，。；：]{2,60}?)是([^。；]{8,260})[。；]?$/,
  );
  if (
    copulaDefinitionMatch &&
    /(?:基本单位|基本结构|一种[^，。；]{0,28}(?:细胞器|物质|结构|现象|过程|方法|体系)|统称|总称)/.test(
      copulaDefinitionMatch[2],
    )
  ) {
    const term = cleanSubject(copulaDefinitionMatch[1], contextTopic);
    if (term) {
      return makeCandidate(
        normalized,
        `什么是${term}？`,
        term,
        '名词解释',
        98,
        0.9,
      );
    }
  }

  const classificationMatch = normalized.match(
    /^(?:根据|按照)?([^，。；]{2,24})[，,]?(?:可将|可把|将|把)?([^，。；]{2,30}?)(?:划分为|分为|可分为)([^。；]{4,220})[。；]?$/,
  );
  if (classificationMatch) {
    const criterion = cleanSubject(classificationMatch[1]);
    const subject = cleanSubject(classificationMatch[2], contextTopic);
    if (subject) {
      return makeCandidate(
        normalized,
        `${criterion ? `按${criterion}，` : ''}${subject}可分为哪几类？`,
        subject,
        '简答题',
        96,
        0.9,
      );
    }
  }

  const compositionMatch = normalized.match(
    /^([^，。；]{2,30}?)(?:是)?(?:主要)?由([^。；]{4,220}?)(?:组成|构成)(?:[，,][^。；]{4,180})?[。；]?$/,
  );
  if (compositionMatch) {
    const subject = cleanSubject(compositionMatch[1], contextTopic);
    if (subject) {
      return makeCandidate(
        normalized,
        `${subject}由哪些部分组成？`,
        subject,
        '简答题',
        94,
        0.9,
      );
    }
  }

  const includeMatch = normalized.match(
    /^([^，。；]{2,30}?)(?:主要)?(?:包括|包含)([^。；]{4,220})[。；]?$/,
  );
  if (includeMatch) {
    const subject = cleanSubject(includeMatch[1], contextTopic);
    if (subject) {
      return makeCandidate(
        normalized,
        `${subject}包括哪些内容？`,
        subject,
        '简答题',
        92,
        0.86,
      );
    }
  }

  const aspectMatch = normalized.match(
    /^([^，。；]{2,28}?)的(结构|功能|作用|意义|特点|特征|性质)(?:是|为|包括|主要是|主要包括)?([^。；]{4,220})[。；]?$/,
  );
  if (aspectMatch) {
    const subject = cleanSubject(aspectMatch[1], contextTopic);
    const aspect = aspectMatch[2];
    if (subject) {
      return makeCandidate(
        normalized,
        `${subject}的${aspect}是什么？`,
        subject,
        '简答题',
        90,
        0.86,
      );
    }
  }

  const containsMatch = normalized.match(
    /^([^，。；]{2,28}?)(?:含有|具有)([^。；]{5,220})[。；]?$/,
  );
  if (containsMatch) {
    const subject = cleanSubject(containsMatch[1], contextTopic);
    if (subject) {
      const relation = normalized.includes('含有') ? '含有哪些重要成分' : '具有哪些特征';
      return makeCandidate(
        normalized,
        `${subject}${relation}？`,
        subject,
        '简答题',
        86,
        0.82,
      );
    }
  }

  const relationMatch = normalized.match(
    /^([^，。；]{2,24}?)与([^，。；]{2,24}?)(?:之间)?(?:存在|具有|的)([^。；]{6,220}关系[^。；]*)[。；]?$/,
  );
  if (relationMatch) {
    const left = cleanSubject(relationMatch[1], contextTopic);
    const right = cleanSubject(relationMatch[2]);
    if (left && right) {
      return makeCandidate(
        normalized,
        `${left}与${right}有什么关系？`,
        `${left}与${right}`,
        '简答题',
        84,
        0.8,
      );
    }
  }

  return null;
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

export function pagesFromExtractedText(text: string): TextPage[] {
  const marker =
    /^[ \t]*--- PAGE (\d+)(?: \[[^\]]+\])? ---[ \t]*$/gim;
  const matches = [...text.matchAll(marker)];
  if (!matches.length) return [{ text }];

  return matches.map((match, index) => ({
    page: Number.parseInt(match[1], 10),
    text: text.slice(
      match.index + match[0].length,
      matches[index + 1]?.index ?? text.length,
    ),
  }));
}

export function buildTextbookCards(
  pages: TextPage[],
  maxAnswerLength: number,
  maxCardsPerPage: number,
): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();
  const repeatedMarginLines = new Map<string, number>();
  let currentChapter = '';
  let currentHeading = '';

  pages.forEach((page) => {
    const lines = cleanTextbookText(page.text)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const margins = [...lines.slice(0, 2), ...lines.slice(-2)];
    new Set(margins)
      .forEach((line) => {
        if (
          line.length <= 60 &&
          !extractNumberedHeading(line) &&
          !extractMinorHeading(line)
        ) {
          repeatedMarginLines.set(
            line,
            (repeatedMarginLines.get(line) ?? 0) + 1,
          );
        }
      });
  });
  const marginNoise =
    pages.length >= 3
      ? new Set(
          [...repeatedMarginLines.entries()]
            .filter(([, count]) => count >= 3)
            .map(([line]) => line),
        )
      : new Set<string>();

  const push = (
    card: Omit<Card, 'id' | 'tags' | 'origin' | 'reviewStatus'> & {
      tags?: string[];
    },
  ): void => {
    const key = card.question.replace(/[\s，。；：！？]/g, '').toLowerCase();
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
      .filter(
        (line) =>
          line && !marginNoise.has(line) && !isLikelyOcrLineNoise(line),
      );
    const paragraphs: Array<{
      chapter: string;
      heading: string;
      text: string;
    }> = [];
    let buffer = '';

    const flush = () => {
      if (buffer.trim()) {
        paragraphs.push({
          chapter: currentChapter,
          heading: currentHeading,
          text: buffer.trim(),
        });
      }
      buffer = '';
    };

    lines.forEach((rawLine) => {
      let line = rawLine;
      const numberedHeading = extractNumberedHeading(line);
      if (numberedHeading) {
        flush();
        if (numberedHeading.kind === 'chapter') {
          currentChapter = numberedHeading.heading;
          currentHeading = '';
        } else {
          currentHeading = numberedHeading.heading;
        }
        line = numberedHeading.body;
        if (!line) return;
      } else {
        const minorHeading = extractMinorHeading(line);
        if (minorHeading) {
          flush();
          currentHeading = minorHeading;
          return;
        }
        const inlineTopic = extractInlineTopic(line);
        if (inlineTopic) {
          flush();
          currentHeading = inlineTopic.heading;
          line = inlineTopic.body;
        } else if (!buffer) {
          const standaloneHeading = extractStandaloneHeading(line);
          if (standaloneHeading) {
            currentHeading = standaloneHeading;
            return;
          }
        }
      }

      buffer += line;
      if (/[。！？；]$/.test(line) || buffer.length >= 600) {
        flush();
      }
    });
    flush();

    const candidates: Array<
      TextbookCandidate & { chapter: string; heading: string }
    > = [];
    paragraphs.forEach((paragraph) => {
      const contextTopic =
        headingTopic(paragraph.heading) || headingTopic(paragraph.chapter);
      splitSentences(paragraph.text).forEach((sentence) => {
        const candidate = candidateFromSentence(sentence, contextTopic);
        if (candidate) {
          candidates.push({
            ...candidate,
            chapter: paragraph.chapter,
            heading: paragraph.heading,
          });
        }
      });
    });

    candidates
      .sort((left, right) => right.score - left.score)
      .slice(0, maxCardsPerPage)
      .forEach((candidate) => {
        const chapter = candidate.chapter || candidate.heading;
        push({
          question: candidate.question,
          options: '',
          answer: slimAnswer(candidate.answer, maxAnswerLength),
          point: candidate.point,
          analysis: '',
          type: candidate.type,
          chapter,
          sourcePage: page.page,
          tags: ['教材提取', candidate.type, chapter].filter(Boolean),
          sourceQuote: candidate.sourceQuote,
          confidence: candidate.confidence,
        });
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
