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
  download_url: string;
}

export interface StatsResponse {
  total_chunks: number;
  total_documents: number;
  sources: string[];
}

export interface QueryHit {
  text: string;
  source: string;
  heading: string;
  score: number;
  page_no?: number;
}

export interface QueryResponse {
  answer: string;
  context: QueryHit[];
}

export interface AuthResponse {
  token: string;
  username: string;
}

export interface DocumentInfo {
  source: string;
  name: string;
  chunks: number;
  original_key?: string;
  original_ext?: string;
}

export interface ConvRecord {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface MessageRecord {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  duration_ms?: number | null;
  created_at: string;
}
