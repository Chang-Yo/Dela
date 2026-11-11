// 通用会话默认各有私有目录；模块可登记共用同一工作目录的作用域，例如课件资料库。
export interface SessionScope {
  id: string;
  /** 该作用域下的会话共用的工作目录。 */
  directory(): string;
}

const scopes = new Map<string, SessionScope>();

export function registerSessionScope(scope: SessionScope): void {
  scopes.set(scope.id, scope);
}

export function sessionScope(id: string): SessionScope | undefined {
  return scopes.get(id);
}

export function sessionScopes(): SessionScope[] {
  return [...scopes.values()];
}
