// 打包前准备上传到远程项目服务器的 ripgrep（Linux musl 静态版）：helper 优先用它做 glob/grep，
// 远端没装 rg 也能按 .gitignore 搜索。产物到 .build/remote-rg，仓库不提交；换版本时成对更新 SHA256。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const VERSION = '15.2.0';
const RELEASES: Record<'amd64' | 'arm64', { triple: string; sha256: string }> = {
  amd64: {
    triple: 'x86_64-unknown-linux-musl',
    sha256: '33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c',
  },
  arm64: {
    triple: 'aarch64-unknown-linux-musl',
    sha256: '800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915',
  },
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.build', 'remote-rg');
mkdirSync(outDir, { recursive: true });

/** ustar 里按名字取一个普通文件：发布包只有十来个条目，不值得引入 tar 依赖。 */
function tarEntry(archive: Buffer, wanted: string): Buffer | null {
  const field = (offset: number, length: number) =>
    archive.toString('utf8', offset, offset + length).replace(/\0.*$/s, '');
  for (let offset = 0; offset + 512 <= archive.length && archive[offset] !== 0;) {
    const prefix = field(offset + 345, 155);
    const name = prefix ? `${prefix}/${field(offset, 100)}` : field(offset, 100);
    const size = Number.parseInt(field(offset + 124, 12).trim() || '0', 8);
    if (name === wanted) return archive.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

for (const [arch, { triple, sha256 }] of Object.entries(RELEASES)) {
  const target = join(outDir, `rg-linux-${arch}`);
  const marker = `${target}.version`;
  if (existsSync(target) && existsSync(marker) && readFileSync(marker, 'utf8').trim() === sha256) {
    console.log(`rg ${VERSION} linux/${arch} 已就绪，跳过下载。`);
    continue;
  }
  const base = `ripgrep-${VERSION}-${triple}`;
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${base}.tar.gz`;
  console.log(`下载 ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`下载 rg 失败：HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== sha256) throw new Error(`rg linux/${arch} SHA256 不符（${actual.slice(0, 12)}…）`);
  const binary = tarEntry(gunzipSync(archive), `${base}/rg`);
  if (!binary) throw new Error(`${base}.tar.gz 里没有 rg`);
  writeFileSync(target, binary, { mode: 0o755 });
  writeFileSync(marker, sha256);
  console.log(`rg ${VERSION} linux/${arch} 已就绪：${target}`);
}
