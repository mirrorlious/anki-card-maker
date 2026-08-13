import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { buildCardBack, buildCardFront } from './parser';
import type { Card } from './types';

function safeFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(
        /./g,
        (character) => (character.charCodeAt(0) < 32 ? '_' : character),
      )
      .replace(/[. ]+$/g, '')
      .slice(0, 80) || 'Anki_???'
  );
}

export function buildAnkiText(cards: Card[]): string {
  return `\uFEFF${cards
    .map((card) => `${buildCardFront(card)}\t${buildCardBack(card)}`)
    .join('\n')}`;
}

export function buildCardsJson(cards: Card[]): string {
  return JSON.stringify(
    cards.map((card) => ({
      ...card,
      front: buildCardFront(card),
      back: buildCardBack(card),
    })),
    null,
    2,
  );
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFileName(fileName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(
    tags
      .map((tag) => tag.trim().replace(/\s+/g, '_'))
      .filter(Boolean),
  )];
}

export async function buildAnkiPackage(
  cards: Card[],
  deckName: string,
): Promise<Blob> {
  const [{ default: initSqlJs }, { Deck, DeckConfig, Model, Note, Package }] =
    await Promise.all([import('sql.js'), import('ankipack')]);
  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  const model = new Model({
    name: 'Anki ???',
    fields: [{ name: 'Front' }, { name: 'Back' }],
    templates: [
      {
        name: '?? 1',
        questionFormat: '{{Front}}',
        answerFormat:
          '{{FrontSide}}<hr id="answer" style="margin:18px 0">{{Back}}',
      },
    ],
    css: `.card {
  font-family: Arial, "Microsoft YaHei", sans-serif;
  font-size: 20px;
  line-height: 1.6;
  text-align: left;
  color: #111827;
  background: #ffffff;
  max-width: 760px;
  margin: 0 auto;
}`,
  });
  const normalizedDeckName = deckName.trim() || 'Anki ???';
  const deck = new Deck({
    name: normalizedDeckName,
    description: '? Anki ????????',
    config: new DeckConfig({
      name: `${normalizedDeckName} FSRS`,
      desiredRetention: 0.9,
      newPerDay: 30,
      reviewsPerDay: 300,
    }),
  });

  cards.forEach((card) => {
    deck.addNote(
      new Note({
        model,
        fields: [buildCardFront(card), buildCardBack(card)],
        tags: normalizeTags(card.tags),
      }),
    );
  });

  const pkg = new Package();
  pkg.addDeck(deck);
  const bytes = await pkg.toUint8Array(SQL);
  return new Blob([bytes.slice().buffer], {
    type: 'application/vnd.anki',
  });
}

export function exportFileName(
  deckName: string,
  cardCount: number,
  extension: 'txt' | 'json' | 'apkg' | 'miki-cards.json',
): string {
  return `${safeFileName(deckName)}_${cardCount}?.${extension}`;
}
