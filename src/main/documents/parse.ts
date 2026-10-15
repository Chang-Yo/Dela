import { fileTypeFromFile } from 'file-type';

export type OfficeZipKind = 'docx' | 'pptx' | 'xlsx';
export const officeZipMime: Record<OfficeZipKind, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** GUI 预览按实际文件内容识别；正文提取交给 document-reading skill。 */
export async function classifyOfficeFile(path: string): Promise<OfficeZipKind | null> {
  const kind = await fileTypeFromFile(path).catch(() => undefined);
  return kind?.ext === 'docx' || kind?.ext === 'pptx' || kind?.ext === 'xlsx' ? kind.ext : null;
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // 主进程没有 Worker 环境：先把 WorkerMessageHandler 挂到 globalThis，
      // pdf.js 检测到后直接在进程内解析，不再执行运行时相对路径的 worker import。
      (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker =
        await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      return import('pdfjs-dist/legacy/build/pdf.mjs');
    })();
  }
  return pdfjsPromise;
}

export async function extractPdfText(
  bytes: Uint8Array,
): Promise<{ kind: 'pdf'; text: string; pages: number; hasTextLayer: boolean }> {
  const pdfjs = await loadPdfjs();
  // pdf.js 明确拒绝 Buffer（Node 检测分支），复制为普通 Uint8Array；
  // 副作用是调用方的缓冲不会被 transfer。
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    const document = await task.promise;
    const sections: string[] = [];
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = '';
      for (const item of content.items) {
        if ('str' in item) pageText += item.str + (item.hasEOL ? '\n' : '');
      }
      pageText = pageText.replace(/\n{3,}/g, '\n\n').trim();
      characters += pageText.length;
      sections.push(`[第 ${pageNumber} 页]\n${pageText}`);
      page.cleanup();
    }
    return {
      kind: 'pdf',
      text: sections.join('\n\n'),
      pages: document.numPages,
      hasTextLayer: characters > 0,
    };
  } finally {
    await task.destroy();
  }
}
