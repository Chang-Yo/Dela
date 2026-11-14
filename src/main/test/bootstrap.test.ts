import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('node:module', () => ({ createRequire: () => runtime.load }));

const originalArgv = process.argv;

beforeEach(() => {
  vi.resetModules();
  runtime.load.mockClear();
});

afterEach(() => {
  process.argv = originalArgv;
});

it('loads the normal app entry and preserves its launch arguments', async () => {
  const argv = [process.execPath, '/app/index.cjs', '--hidden'];
  process.argv = [...argv];
  await import('../bootstrap');
  expect(runtime.load).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/[\\/]app\.cjs$/));
  expect(process.argv).toEqual(argv);
});

it.each([true, false])(
  'loads only the notice worker with an entry path present: %s',
  async (entryPath) => {
    const args = ['--notice-url=https://example.com/notices', '/temporary/output', '20000'];
    process.argv = [process.execPath, ...(entryPath ? ['/app/render-worker.cjs'] : []), ...args];
    await import('../bootstrap');
    expect(runtime.load).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/[\\/]render-worker\.cjs$/),
    );
    expect(process.argv[0]).toBe(process.execPath);
    expect(process.argv[1]).toMatch(/[\\/]render-worker\.cjs$/);
    expect(process.argv.slice(2)).toEqual(args);
  },
);
