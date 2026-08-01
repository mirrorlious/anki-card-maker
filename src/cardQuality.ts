import type { Card } from './types.ts';

export type CardQualitySeverity = 'blocking' | 'warning';

export type CardQualityIssueCode =
  | 'empty_question'
  | 'empty_answer'
  | 'duplicate_card'
  | 'duplicate_question'
  | 'missing_options'
  | 'missing_type'
  | 'question_too_long'
  | 'answer_too_long'
  | 'missing_source'
  | 'unverified_source'
  | 'low_confidence';

export interface CardQualityIssue {
  code: CardQualityIssueCode;
  message: string;
  severity: CardQualitySeverity;
}

export interface CardQualityReport {
  blockingIssues: CardQualityIssue[];
  issues: CardQualityIssue[];
  warningIssues: CardQualityIssue[];
}

export interface CardQualitySummary {
  approvablePendingIds: string[];
  blockingCardIds: string[];
  exportableCards: Card[];
  issueCardIds: string[];
  reports: Record<string, CardQualityReport>;
  warningCardIds: string[];
}

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function issue(
  code: CardQualityIssueCode,
  severity: CardQualitySeverity,
  message: string,
): CardQualityIssue {
  return { code, severity, message };
}

function baseIssues(card: Card): CardQualityIssue[] {
  const issues: CardQualityIssue[] = [];
  const question = card.question.trim();
  const answer = card.answer.trim();
  if (!question) {
    issues.push(issue('empty_question', 'blocking', '问题为空，必须补充后才能导出。'));
  } else if (question.length > 180) {
    issues.push(issue('question_too_long', 'warning', '问题超过 180 字，建议拆成更原子的卡片。'));
  }
  if (!answer) {
    issues.push(issue('empty_answer', 'blocking', '答案为空，必须补充后才能导出。'));
  } else if (answer.length > 800) {
    issues.push(issue('answer_too_long', 'warning', '答案超过 800 字，复习负担可能过高。'));
  }
  if (!card.type.trim()) {
    issues.push(issue('missing_type', 'warning', '尚未填写卡片类型。'));
  }
  if (/选择题/.test(card.type) && card.options.trim().split(/\n+/).filter(Boolean).length < 2) {
    issues.push(issue('missing_options', 'blocking', '选择题至少需要两个有效选项。'));
  }
  if (card.origin === 'ai') {
    if (!card.sourceQuote?.trim()) {
      issues.push(issue('missing_source', 'blocking', 'AI 卡缺少可核对的原文依据。'));
    } else if (card.tags.includes('来源待核')) {
      issues.push(issue('unverified_source', 'blocking', 'AI 引用未能在原文中核验。'));
    }
  }
  if (typeof card.confidence === 'number' && card.confidence < 0.55) {
    issues.push(issue('low_confidence', 'warning', '可信度低于 55%，建议人工重点复核。'));
  }
  return issues;
}

export function evaluateCardQuality(cards: Card[]): CardQualitySummary {
  const issueLists = new Map<string, CardQualityIssue[]>();
  const exactCards = new Map<string, string>();
  const questions = new Map<string, string>();

  cards.forEach((card) => {
    const issues = baseIssues(card);
    const questionKey = normalized(card.question);
    const answerKey = normalized(card.answer);
    if (questionKey && answerKey) {
      const exactKey = `${questionKey}|${answerKey}`;
      if (exactCards.has(exactKey)) {
        issues.push(issue('duplicate_card', 'blocking', '与前面的卡片问题和答案完全重复。'));
      } else {
        exactCards.set(exactKey, card.id);
      }
    }
    if (questionKey) {
      if (questions.has(questionKey) && !issues.some((item) => item.code === 'duplicate_card')) {
        issues.push(issue('duplicate_question', 'warning', '存在相同问题但答案不同，请确认是否冲突。'));
      } else if (!questions.has(questionKey)) {
        questions.set(questionKey, card.id);
      }
    }
    issueLists.set(card.id, issues);
  });

  const reports = Object.fromEntries(
    cards.map((card) => {
      const issues = issueLists.get(card.id) ?? [];
      return [
        card.id,
        {
          issues,
          blockingIssues: issues.filter((item) => item.severity === 'blocking'),
          warningIssues: issues.filter((item) => item.severity === 'warning'),
        },
      ];
    }),
  ) as Record<string, CardQualityReport>;
  const blockingCardIds = cards
    .filter((card) => reports[card.id].blockingIssues.length > 0)
    .map((card) => card.id);
  const warningCardIds = cards
    .filter((card) => reports[card.id].warningIssues.length > 0)
    .map((card) => card.id);
  const issueCardIds = cards
    .filter((card) => reports[card.id].issues.length > 0)
    .map((card) => card.id);
  const blockingIds = new Set(blockingCardIds);

  return {
    reports,
    blockingCardIds,
    warningCardIds,
    issueCardIds,
    approvablePendingIds: cards
      .filter(
        (card) =>
          card.origin === 'ai' &&
          card.reviewStatus === 'pending' &&
          !blockingIds.has(card.id),
      )
      .map((card) => card.id),
    exportableCards: cards.filter(
      (card) => card.reviewStatus === 'approved' && !blockingIds.has(card.id),
    ),
  };
}
