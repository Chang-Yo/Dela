// 远端连接的取色：同一台服务器在界面上恒定同色，不同服务器尽量不同色。
// 只用主题里已有的 calendar 调色板（浅色与深色两套都给了值），不新造颜色、不写死色值。
const accentNames = ['blue', 'teal', 'sage', 'sand', 'peach', 'rose', 'lilac', 'slate'] as const;

/** 由连接 id 稳定派生颜色：hash 只用来选色相，同一个 id 永远同一色，换台机器也一样。
 *  用 FNV-1a 再取高位（低位对相似 id 会扎堆），保证「a1/b2/c3」这种相邻 id 也散得开。 */
export function remoteAccent(
  remoteId: string | null | undefined,
  part: 'text' | 'bg' = 'text',
): string {
  if (!remoteId) return part === 'bg' ? 'var(--field)' : 'var(--ink-3)';
  let hash = 2166136261;
  for (const char of remoteId) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `var(--cal-${accentNames[(hash >>> 8) % accentNames.length]}-${part})`;
}
