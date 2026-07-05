import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

function createTextPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test('creates, edits, restores and exports cards', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('anki-card-maker');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
  await page.reload();

  await page.getByRole('button', { name: '文本粘贴' }).click();
  await page.getByRole('button', { name: '题库解析卡' }).click();
  await page.getByPlaceholder(/粘贴/).fill(`
    1-1 <img src=x onerror=alert(1)>？
    A. 甲
    B. 乙
    【答案】A
    【考点】测试
    【解析】第一行
    第二行
  `);
  await page.getByRole('button', { name: '开始制卡' }).click();

  await expect(page.getByText('共 1 张')).toBeVisible();
  await expect(page.locator('article img')).toHaveCount(0);
  const answerEditor = page
    .locator('article')
    .getByText('答案', { exact: true })
    .locator('..')
    .locator('textarea');
  await answerEditor.fill('A（已复核）');

  await page.getByLabel('选择第 1 张卡片').check();
  await page.getByPlaceholder('批量添加标签').fill('复核完成');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: '删除所选' }).click();
  await expect(page.getByText('共 0 张')).toBeVisible();
  await page.getByRole('button', { name: '撤销删除' }).click();
  await expect(page.getByText('共 1 张')).toBeVisible();

  const textDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Anki TXT' }).click();
  const textDownload = await textDownloadPromise;
  const textPath = await textDownload.path();
  expect(textPath).not.toBeNull();
  const textContent = await readFile(textPath!, 'utf8');
  expect(textContent).toContain('&lt;img');
  expect(textContent).toContain('A（已复核）');

  const packageDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 .apkg' }).click();
  const packageDownload = await packageDownloadPromise;
  expect(packageDownload.suggestedFilename()).toMatch(/\.apkg$/);
  const packagePath = await packageDownload.path();
  expect(packagePath).not.toBeNull();
  const packageBytes = await readFile(packagePath!);
  expect(packageBytes.byteLength).toBeGreaterThan(10_000);

  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByText(/已恢复/)).toBeVisible();
  await expect(page.getByText('共 1 张')).toBeVisible();
});

test('loads a PDF through the bundled local worker', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '题库解析卡' }).click();
  await page.locator('#pdf-upload').setInputFiles({
    name: 'sample.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('1-1 test question? A. one B. two'),
  });

  await expect(page.getByRole('alert')).toContainText('找到了题号');
});

test('keeps extracted PDF text when strict textbook rules generate no cards', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('识别方式').selectOption('text');
  await page.locator('#pdf-upload').setInputFiles({
    name: 'preface.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('Preface and publication information only.'),
  });

  await expect(page.getByRole('status')).toContainText('PDF 提取完成');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '重新生成本地卡片' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '文本粘贴' }).click();
  await expect(page.getByPlaceholder(/粘贴/)).toContainText(
    'Preface and publication information only.',
  );

  await page.getByRole('button', { name: '添加卡片' }).click();
  await page.getByRole('button', { name: 'PDF 对照' }).click();
  await expect(page.getByLabel('PDF 页码')).toHaveAttribute('max', '1');
  await page.getByRole('button', { name: '重新框选' }).click();
  const overlay = page.getByTestId('pdf-source-overlay');
  await overlay.scrollIntoViewIfNeeded();
  const bounds = await overlay.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = page.viewportSize();
  const startY = Math.max(bounds!.y + 30, 80);
  const endY = Math.min(
    bounds!.y + bounds!.height - 20,
    (viewport?.height ?? 720) - 30,
    startY + 90,
  );
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.15,
    startY,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width + 40,
    endY,
  );
  await page.mouse.up();
  await expect(page.getByText('已精确定位')).toBeVisible();
  await expect(page.getByText('来源第 1 页')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '重新框选来源' }),
  ).toBeVisible();

  await page.locator('main aside textarea').first().fill('校订后的问题');
  await page.getByRole('button', { name: '卡片', exact: true }).click();
  await expect(page.locator('article textarea').first()).toHaveValue(
    '校订后的问题',
  );
});

test('uses a custom AI endpoint and requires candidate approval', async ({
  page,
}) => {
  const authorizationHeaders: string[] = [];
  await page.route('https://api.deepseek.com/chat/completions', async (route) => {
    authorizationHeaders.push(
      (await route.request().allHeaders()).authorization ?? '',
    );
    const request = route.request().postDataJSON() as {
      messages: Array<{ content: string }>;
    };
    const isConnectionTest = request.messages.some((message) =>
      message.content.includes('连接测试'),
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        usage: { prompt_tokens: 50, completion_tokens: 30 },
        choices: [
          {
            message: {
              content: isConnectionTest
                ? '{"status":"ok"}'
                : JSON.stringify({
                    cards: [
                      {
                        question: '什么是犯罪构成？',
                        answer: '犯罪构成是认定犯罪的法律要件体系。',
                        type: '名词解释',
                        tags: ['刑法'],
                        sourceQuote:
                          '犯罪构成是认定犯罪的法律要件体系。',
                        confidence: 0.95,
                      },
                    ],
                  }),
            },
          },
        ],
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '文本粘贴' }).click();
  await page
    .getByPlaceholder(/粘贴/)
    .fill('犯罪构成是认定犯罪的法律要件体系。');
  await page.getByText('AI 辅助生成候选卡', { exact: true }).click();
  await page
    .getByLabel('API Key（仅保存在当前页面会话）')
    .fill('test-secret');
  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText(/AI 接口连接成功/)).toBeVisible();

  await page.getByRole('button', { name: '生成候选卡' }).click();
  await expect(page.getByText(/待审核 1/)).toBeVisible();
  await expect(page.getByText('AI 候选')).toBeVisible();
  await page.getByRole('button', { name: '待审核 · 点击批准' }).click();
  await expect(page.getByText(/待审核 1/)).toHaveCount(0);
  expect(authorizationHeaders).toEqual([
    'Bearer test-secret',
    'Bearer test-secret',
  ]);
});
