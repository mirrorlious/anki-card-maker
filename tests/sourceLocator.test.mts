import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachSourceLocations,
  locateQuoteRegions,
} from '../src/sourceLocator.ts';
import { createCard } from '../src/parser.ts';

test('locates a source quote across OCR lines with inserted spaces', () => {
  const regions = [
    {
      text: '线 粒 体 是 由 内 外 两 层 膜 组 成',
      x: 0.1,
      y: 0.2,
      width: 0.7,
      height: 0.04,
    },
    {
      text: '外 膜 光 滑 ， 内 膜 向 内 折 叠 。',
      x: 0.1,
      y: 0.25,
      width: 0.68,
      height: 0.04,
    },
    {
      text: '下一段无关内容',
      x: 0.1,
      y: 0.4,
      width: 0.4,
      height: 0.04,
    },
  ];

  const located = locateQuoteRegions(
    '线粒体是由内外两层膜组成，外膜光滑，内膜向内折叠。',
    regions,
  );

  assert.equal(located.length, 2);
  assert.ok(located.every((rect) => rect.y < 0.3));
});

test('attaches locations only to cards with verified page evidence', () => {
  const card = createCard({
    question: '线粒体由哪些部分组成？',
    options: '',
    answer: '线粒体由内外两层膜组成。',
    point: '线粒体',
    analysis: '',
    type: '简答题',
    chapter: '细胞',
    sourcePage: 23,
    sourceQuote: '线粒体由内外两层膜组成。',
  });

  const [located] = attachSourceLocations(
    [card],
    [
      {
        page: 23,
        method: 'ocr',
        text: card.sourceQuote ?? '',
        regions: [
          {
            text: '线粒体由内外两层膜组成。',
            x: 0.2,
            y: 0.3,
            width: 0.5,
            height: 0.05,
          },
        ],
      },
    ],
  );

  assert.equal(located.sourceRects?.length, 1);
});
