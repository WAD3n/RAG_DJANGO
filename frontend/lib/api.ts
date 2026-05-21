import type { QueryResponse, StatsResponse, StorageObject } from './types';

const BASE = '/api';

export async function uploadFile(file: File): Promise<{ object_name: string; filename: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/upload/`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
  return res.json();
}

export async function convertFile(objectName: string): Promise<{ minio_key: string }> {
  const res = await fetch(`${BASE}/convert/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ object_name: objectName }),
  });
  if (!res.ok) throw new Error(`Convert failed: ${res.statusText}`);
  return res.json();
}

export async function ingestFile(minioKey: string): Promise<{ chunks: number }> {
  const res = await fetch(`${BASE}/ingest/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minio_key: minioKey }),
  });
  if (!res.ok) throw new Error(`Ingest failed: ${res.statusText}`);
  return res.json();
}

export async function queryDocuments(question: string): Promise<QueryResponse> {
  const res = await fetch(`${BASE}/query/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error(`Query failed: ${res.statusText}`);
  return res.json();
}

export async function getStats(): Promise<StatsResponse> {
  const res = await fetch(`${BASE}/stats/`);
  if (!res.ok) throw new Error(`Stats failed: ${res.statusText}`);
  return res.json();
}

export async function listStorage(prefix = ''): Promise<StorageObject[]> {
  const res = await fetch(`${BASE}/storage/?prefix=${encodeURIComponent(prefix)}`);
  if (!res.ok) throw new Error(`Storage list failed: ${res.statusText}`);
  return res.json();
}
