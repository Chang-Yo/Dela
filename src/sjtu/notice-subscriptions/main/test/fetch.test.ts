import { expect, it, vi } from 'vitest';
import { fetchNoticePage, PAGE_BYTE_LIMIT } from '../fetch';

it('follows a relative redirect and returns bytes with the final base URL and charset', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/news/' } }))
    .mockResolvedValueOnce(
      new Response('<p>公告</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    );
  const page = await fetchNoticePage('https://unknown.example/', request);
  expect(page.url).toBe('https://unknown.example/news/');
  expect(page.body.toString()).toBe('<p>公告</p>');
  expect(page.charset).toBe('utf-8');
  expect(request.mock.calls[0]?.[1]).toMatchObject({
    redirect: 'manual',
    signal: expect.any(AbortSignal),
  });
});

it('rejects non-HTTP URLs before a request and on every redirect', async () => {
  const request = vi.fn<typeof fetch>();
  await expect(fetchNoticePage('file:///private', request)).rejects.toThrow('HTTP');
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValue(
    new Response(null, { status: 302, headers: { location: 'file:///private' } }),
  );
  await expect(fetchNoticePage('https://unknown.example/', request)).rejects.toThrow('HTTP');
  expect(request).toHaveBeenCalledTimes(1);
});

it('does not treat error pages, PDFs or redirect loops as successful HTML', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('error', { status: 503 }));
  await expect(fetchNoticePage('https://unknown.example/', request)).rejects.toThrow('503');
  request.mockResolvedValueOnce(
    new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
  );
  await expect(fetchNoticePage('https://unknown.example/', request)).rejects.toThrow('响应类型');
  request.mockImplementation(
    async () => new Response(null, { status: 302, headers: { location: '/again' } }),
  );
  await expect(fetchNoticePage('https://unknown.example/', request)).rejects.toThrow('次数过多');
});

it('enforces the byte limit for chunked content as well as declared lengths', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response('small', { headers: { 'content-length': String(PAGE_BYTE_LIMIT + 1) } }),
    );
  await expect(fetchNoticePage('https://unknown.example/', request)).rejects.toThrow('2 MiB');
  request.mockResolvedValueOnce(
    new Response(new Uint8Array(PAGE_BYTE_LIMIT + 1), { headers: { 'content-type': 'text/html' } }),
  );
  await expect(fetchNoticePage('https://unknown.example/', request)).rejects.toThrow('2 MiB');
});
