import type { AuthResponse, Citation, ConvRecord, DocumentInfo, MessageRecord, QueryResponse, StatsResponse, StorageObject } from './types';

const BASE = '/api';

let _token: string | null = null;

export function setToken(token: string | null): void {
  _token = token;
  if (typeof window !== 'undefined') {
    if (token) localStorage.setItem('ragflow_token', token);
    else localStorage.removeItem('ragflow_token');
  }
}

export function loadToken(): string | null {
  if (typeof window !== 'undefined') {
    _token = localStorage.getItem('ragflow_token');
  }
  return _token;
}

export function getToken(): string | null {
  return _token;
}

function auth(): Record<string, string> {
  return _token ? { Authorization: `Token ${_token}` } : {};
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Login failed: ${res.statusText}`);
  }
  const data: AuthResponse = await res.json();
  setToken(data.token);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: auth() });
  } finally {
    setToken(null);
  }
}

export async function uploadFile(file: File): Promise<{ object_name: string; filename: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/upload`, { method: 'POST', headers: auth(), body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
  return res.json();
}

export async function convertFile(objectName: string): Promise<{ minio_key: string }> {
  const res = await fetch(`${BASE}/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({ object_name: objectName }),
  });
  if (!res.ok) throw new Error(`Convert failed: ${res.statusText}`);
  return res.json();
}

export async function ingestFile(minioKey: string): Promise<{ chunks: number }> {
  const res = await fetch(`${BASE}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({ minio_key: minioKey }),
  });
  if (!res.ok) throw new Error(`Ingest failed: ${res.statusText}`);
  return res.json();
}

export async function queryDocuments(question: string, model?: string | null): Promise<QueryResponse> {
  const res = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({ question, ...(model ? { model } : {}) }),
  });
  if (!res.ok) throw new Error(`Query failed: ${res.statusText}`);
  return res.json();
}

export async function getModels(): Promise<{ backend: string; active: string; models: string[] }> {
  const res = await fetch(`${BASE}/models`, { headers: auth() });
  if (!res.ok) throw new Error(`Models failed: ${res.statusText}`);
  return res.json();
}

export async function getStats(): Promise<StatsResponse> {
  const res = await fetch(`${BASE}/stats`, { headers: auth() });
  if (!res.ok) throw new Error(`Stats failed: ${res.statusText}`);
  return res.json();
}

export async function getDocuments(): Promise<DocumentInfo[]> {
  const res = await fetch(`${BASE}/documents`, { headers: auth() });
  if (!res.ok) throw new Error(`Documents failed: ${res.statusText}`);
  return res.json();
}

export async function listStorage(prefix = ''): Promise<StorageObject[]> {
  const res = await fetch(`${BASE}/storage?prefix=${encodeURIComponent(prefix)}`, {
    headers: auth(),
  });
  if (!res.ok) throw new Error(`Storage list failed: ${res.statusText}`);
  return res.json();
}

export async function getConversations(): Promise<ConvRecord[]> {
  const res = await fetch(`${BASE}/conversations`, { headers: auth() });
  if (!res.ok) throw new Error(`Conversations failed: ${res.statusText}`);
  return res.json();
}

export async function createConversation(title = 'New conversation'): Promise<ConvRecord> {
  const res = await fetch(`${BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Create conversation failed: ${res.statusText}`);
  return res.json();
}

export async function renameConversationApi(id: number, title: string): Promise<void> {
  const res = await fetch(`${BASE}/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Rename conversation failed: ${res.statusText}`);
}

export async function deleteConversationApi(id: number): Promise<void> {
  const res = await fetch(`${BASE}/conversations/${id}`, {
    method: 'DELETE',
    headers: auth(),
  });
  if (!res.ok) throw new Error(`Delete conversation failed: ${res.statusText}`);
}

export async function getMessages(convId: number): Promise<MessageRecord[]> {
  const res = await fetch(`${BASE}/conversations/${convId}/messages`, { headers: auth() });
  if (!res.ok) throw new Error(`Messages failed: ${res.statusText}`);
  return res.json();
}

export async function addMessages(
  convId: number,
  messages: Array<{ role: string; content: string; citations?: Citation[]; duration_ms?: number }>,
): Promise<void> {
  const res = await fetch(`${BASE}/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify(messages),
  });
  if (!res.ok) throw new Error(`Add messages failed: ${res.statusText}`);
}
