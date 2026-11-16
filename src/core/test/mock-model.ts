import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import type { StoredLlmProvider } from '../agent/llm-config';
import {
  MockOpenAiServer,
  mockFrames,
  type RecordedRequest,
} from '../agent/test/mock-openai-server';

const SESSION_TABLES = `
  CREATE TABLE workspace_entries (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL,
    kind TEXT NOT NULL, source_id TEXT, local_path TEXT, remote_id TEXT, updated_at TEXT NOT NULL);
  CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, cwd TEXT, file TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '新对话', message_count INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    provider_id TEXT, model TEXT, effort TEXT, parent_id TEXT);
  CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export async function startMockModel() {
  const server = await MockOpenAiServer.start();
  const provider: StoredLlmProvider = {
    id: 'p1',
    name: 'mock',
    baseUrl: server.baseUrl,
    apiKey: 'test-only',
    models: ['mock-model'],
    piProvider: null,
    enabled: true,
  };
  const db = new Database(':memory:');
  db.exec(SESSION_TABLES);
  return { server, provider, db };
}

export async function stopMockModel(
  { server, db }: { server: MockOpenAiServer; db: Database.Database | null },
  root: string,
) {
  await server.close();
  db?.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

export const reply = (text: string, delayMs = 0) => ({
  kind: 'sse' as const,
  frames: [
    mockFrames.textDelta(text.slice(0, 1)),
    { ...mockFrames.textDelta(text.slice(1)), delayMs },
    mockFrames.finishFrame('stop'),
  ],
});

export const askInput = (text: string, attachments: string[] = []) => ({
  text,
  attachments,
  context: [],
  comments: [],
});

export function recordRequests(server: MockOpenAiServer) {
  const requests: RecordedRequest[] = [];
  const stop = server.onRequest((request) => requests.push(request));
  return { requests, stop };
}
