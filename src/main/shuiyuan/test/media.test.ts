import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../../credentials', () => ({
  loadShuiyuanCredential: () => ({ key: 'user-key', clientId: 'client' }),
}));
import { handleShuiyuanMediaRequest } from '../media';

const upload = 'dela-resource://shuiyuan/secure-uploads/optimized/4X/a/b/c/abc_2_690x388.jpeg';

afterEach(() => vi.unstubAllGlobals());

it('fetches each image once with the User API Key', async () => {
  const fetch = vi.fn(
    async () => new Response('jpeg', { headers: { 'content-type': 'image/jpeg' } }),
  );
  vi.stubGlobal('fetch', fetch);

  const response = await handleShuiyuanMediaRequest(new Request(upload));

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/jpeg');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    'https://shuiyuan.sjtu.edu.cn/secure-uploads/optimized/4X/a/b/c/abc_2_690x388.jpeg',
    expect.objectContaining({
      headers: { 'User-Api-Key': 'user-key', 'User-Api-Client-Id': 'client' },
    }),
  );
});

it('does not serve the login wall page as an image', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })),
  );

  expect((await handleShuiyuanMediaRequest(new Request(upload))).status).toBe(404);
});
