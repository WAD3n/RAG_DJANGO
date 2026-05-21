export interface UploadedFile {
  id: string;
  name: string;
  type: 'pdf' | 'doc' | 'xls' | 'ppt' | string;
  sizeMB: number;
  pages?: number;
  status: 'queued' | 'uploading' | 'converting' | 'chunking' | 'embedding' | 'ready' | 'error';
  progress: number;
  chunks: number;
  embedded: number;
  objectName?: string;
  error?: string;
}

export interface Citation {
  id: number;
  doc: string;
  page?: number;
  passage: string;
  score?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  durationMs?: number;
}

export interface Document {
  id: string;
  name: string;
  type: string;
  size: string;
  pages: number;
  chunks: number;
  color: string;
  tag?: string;
  objectName?: string;
}

export interface StorageObject {
  key: string;
  size: number;
  last_modified: string;
}

export interface StatsResponse {
  total_chunks: number;
  total_documents: number;
  embedding_model: string;
}

export interface QueryHit {
  text: string;
  source: string;
  heading: string;
  score: number;
}

export interface QueryResponse {
  answer: string;
  context: QueryHit[];
}
