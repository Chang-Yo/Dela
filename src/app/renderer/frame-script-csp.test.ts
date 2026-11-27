// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { FRAME_SCRIPT, htmlFrameDocument } from '../../ui/lib/html-frame-document';

it('pins the external-HTML frame script hash in both the frame and the app CSP', async () => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(FRAME_SCRIPT));
  const hash = `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
  const frame = new DOMParser().parseFromString(
    htmlFrameDocument('<p>x</p>', { rootSize: 14 }),
    'text/html',
  );
  const appHtml = readFileSync(resolve(import.meta.dirname, 'index.html'), 'utf8');
  expect(frame.querySelector('meta[http-equiv]')!.getAttribute('content')).toContain(hash);
  expect(appHtml).toContain(hash);
});
