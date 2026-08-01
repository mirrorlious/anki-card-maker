export const SUPPORTED_FILE_ACCEPT = [
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.html',
  '.htm',
].join(',');

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'html',
  'htm',
]);

export type ImportFileKind = 'pdf' | 'docx' | 'text' | 'unsupported';

export function fileExtension(fileName: string): string {
  return fileName.toLowerCase().split('.').pop() ?? '';
}

export function importFileKind(file: Pick<File, 'name' | 'type'>): ImportFileKind {
  const extension = fileExtension(file.name);
  if (extension === 'pdf' || file.type === 'application/pdf') return 'pdf';
  if (
    extension === 'docx' ||
    file.type ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (TEXT_EXTENSIONS.has(extension) || file.type.startsWith('text/')) {
    return 'text';
  }
  return 'unsupported';
}

function htmlToPlainText(source: string): string {
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(source, 'text/html');
    document.querySelectorAll('script,style,noscript').forEach((node) => node.remove());
    return document.body.textContent?.replace(/\n{3,}/g, '\n\n').trim() ?? '';
  }
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function extractDocumentText(file: File): Promise<string> {
  const kind = importFileKind(file);
  if (kind === 'unsupported' || kind === 'pdf') {
    throw new Error(`不支持的文件格式：${file.name}`);
  }

  if (kind === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value.trim();
  }

  const extension = fileExtension(file.name);
  const source = await file.text();
  if (extension === 'html' || extension === 'htm') return htmlToPlainText(source);
  if (extension === 'json') {
    try {
      return JSON.stringify(JSON.parse(source), null, 2);
    } catch {
      throw new Error(`${file.name} 不是有效的 JSON 文件。`);
    }
  }
  return source.trim();
}
