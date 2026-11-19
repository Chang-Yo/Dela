// 读 `~/.ssh/config` 的主机别名作为候选；只读别名与展示字段，不读密钥内容，认证与跳板仍由 ssh 解析。
// 候选不落库：连上之后才保存为连接，config 里删掉的主机不会留下幽灵条目。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { SshConfigHost } from '../contract';

/** Include 只展开这么多层：config 互相 Include 成环时不至于死循环。 */
const INCLUDE_DEPTH = 4;

function expandHome(path: string): string {
  return path.startsWith('~') ? join(homedir(), path.slice(1)) : path;
}

function includeTargets(pattern: string): string[] {
  const full = expandHome(pattern);
  const path = isAbsolute(full) ? full : join(homedir(), '.ssh', full);
  if (!path.includes('*')) return [path];
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const dir = path.slice(0, cut);
  const glob = new RegExp(
    `^${path
      .slice(cut + 1)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')}$`,
  );
  try {
    return readdirSync(dir)
      .filter((name) => glob.test(name))
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/** 跳过带通配符的 Host 与 Match 块；同名以先出现的为准，与 ssh 一致。 */
export function parseSshConfig(text: string, depth = 0): SshConfigHost[] {
  const hosts: SshConfigHost[] = [];
  let current: SshConfigHost[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const match = /^([^\s=]+)\s*=?\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim().replace(/^"(.*)"$/, '$1');
    if (key === 'host') {
      current = value
        .split(/\s+/)
        .filter((name) => name && !/[*?!]/.test(name))
        .map((alias) => ({ alias, hostName: null, user: null, port: null }));
      hosts.push(...current);
    } else if (key === 'match') {
      current = [];
    } else if (key === 'include' && depth < INCLUDE_DEPTH) {
      for (const pattern of value.split(/\s+/))
        for (const file of includeTargets(pattern))
          if (existsSync(file))
            hosts.push(...parseSshConfig(readFileSync(file, 'utf8'), depth + 1));
    } else {
      for (const host of current) {
        if (key === 'hostname' && !host.hostName) host.hostName = value;
        else if (key === 'user' && !host.user) host.user = value;
        else if (key === 'port' && host.port === null) {
          const port = Number(value);
          if (Number.isInteger(port) && port > 0 && port <= 65535) host.port = port;
        }
      }
    }
  }
  const seen = new Set<string>();
  return hosts.filter((host) => (seen.has(host.alias) ? false : (seen.add(host.alias), true)));
}

export function sshConfigHosts(): SshConfigHost[] {
  const path = join(homedir(), '.ssh', 'config');
  try {
    return existsSync(path) ? parseSshConfig(readFileSync(path, 'utf8')) : [];
  } catch {
    return [];
  }
}
