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
  await page.locator('textarea').first().fill(`
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
