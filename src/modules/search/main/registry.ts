// 只搜本机已有的数据：每个来源自己写查询，这里按注册顺序分组汇总。
import { SEARCH_LIMIT, type SearchGroup, type SearchHit, type SearchIcon } from '../contract';

export interface SearchProvider {
  id: string;
  label: string;
  icon: SearchIcon;
  /** 空查询返回最近的记录；最多返回 limit 条。 */
  search(query: string, limit: number): SearchHit[];
}

const providers: SearchProvider[] = [];

export function registerSearchProvider(provider: SearchProvider): void {
  providers.push(provider);
}

export function querySearch(query: string): SearchGroup[] {
  return providers.flatMap(({ id, label, icon, search }) => {
    const hits = search(query, SEARCH_LIMIT);
    return hits.length ? [{ id, label, icon, truncated: hits.length >= SEARCH_LIMIT, hits }] : [];
  });
}

/** SQLite LIKE 的字面量匹配：转义通配符，配合 `ESCAPE '!'` 使用。 */
export function likePattern(query: string): string {
  return `%${query.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`;
}
