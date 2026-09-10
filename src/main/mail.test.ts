import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { ImapFlow, MessageStructureObject } from 'imapflow';
vi.mock('electron', () => ({ BrowserWindow: {}, ipcMain: {}, shell: {} }));
vi.mock('./database', () => ({ getDatabase: vi.fn() }));
vi.mock('./credentials', () => ({
  clearMailCredentials: vi.fn(),
  loadMailCredentials: vi.fn(),
  saveMailCredentials: vi.fn(),
}));
import { downloadHtmlImages, pickTextPart } from './mail';

describe('mail MIME rendering', () => {
  it('prefers HTML alternatives and ignores attached messages', () => {
    const structure: MessageStructureObject = {
      type: 'multipart/mixed',
      childNodes: [
        { type: 'message/rfc822', childNodes: [{ type: 'text/html', part: '1.1' }] },
        {
          type: 'multipart/alternative',
          childNodes: [
            { type: 'text/plain', part: '2.1' },
            { type: 'text/html', part: '2.2' },
          ],
        },
      ],
    };
    expect(pickTextPart(structure)).toEqual({ type: 'text/html', part: '2.2' });
    expect(pickTextPart({ type: 'text/plain', part: '1' })).toEqual({
      type: 'text/plain',
      part: '1',
    });
    expect(pickTextPart(undefined)).toBeNull();
  });

  it('resolves encoded CID references once, without downloading unrelated attachments', async () => {
    const download = vi.fn(async () => ({ content: Readable.from([Buffer.from('image')]) }));
    const client = { download } as unknown as ImapFlow;
    const structure: MessageStructureObject = {
      type: 'multipart/related',
      childNodes: [
        { type: 'image/png', id: '<logo@example>', part: '2', size: 5 },
        { type: 'image/png', id: '<other>', part: '3', size: 5 },
        { type: 'image/png', id: '<attachment>', part: '4', size: 5, disposition: 'attachment' },
      ],
    };
    const output = await downloadHtmlImages(
      client,
      1,
      structure,
      '<img src="cid:logo%40example"><div style="background:url(cid:logo@example)"></div>',
    );
    expect(output.match(/data:image\/png;base64,aW1hZ2U=/g)).toHaveLength(2);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('keeps text readable when inline images fail or exceed the size limit', async () => {
    const download = vi.fn(async () => {
      throw new Error('offline');
    });
    const client = { download } as unknown as ImapFlow;
    const structure: MessageStructureObject = {
      type: 'multipart/related',
      childNodes: [
        { type: 'image/png', id: '<large>', part: '2', size: 3_000_000 },
        { type: 'image/png', id: '<missing>', part: '3', size: 5 },
      ],
    };
    const html = '<p>正文</p><img src="cid:large"><img src="cid:missing">';
    expect(await downloadHtmlImages(client, 1, structure, html)).toBe(html);
    expect(download).toHaveBeenCalledTimes(1);
  });
});
