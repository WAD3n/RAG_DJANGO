'use client';

import React, { useCallback, useRef } from 'react';
import * as Icon from './icons';
import { uploadFile, convertFile, ingestFile } from '../lib/api';
import type { UploadedFile } from '../lib/types';

interface UploadProps {
  onComplete: (docs: UploadedFile[]) => void;
}

const FILE_COLORS: Record<string, string> = {
  pdf: '#d97757', doc: '#5b8bdc', docx: '#5b8bdc',
  xls: '#3a7a5b', xlsx: '#3a7a5b', ppt: '#c4884f', pptx: '#c4884f',
};
const TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/markdown': 'md', 'text/plain': 'txt',
};

export default function Upload({ onComplete }: UploadProps) {
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateFile = useCallback((id: string, patch: Partial<UploadedFile>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }, []);

  async function processFile(file: File, id: string) {
    try {
      // 1. Upload
      updateFile(id, { status: 'uploading', progress: 10 });
      const { object_name } = await uploadFile(file);
      updateFile(id, { status: 'uploading', progress: 60, objectName: object_name });

      // 2. Convert
      updateFile(id, { status: 'converting', progress: 65 });
      const { minio_key } = await convertFile(object_name);
      updateFile(id, { status: 'chunking', progress: 75 });

      // 3. Ingest
      updateFile(id, { status: 'embedding', progress: 85 });
      const { chunks } = await ingestFile(minio_key);
      updateFile(id, { status: 'ready', progress: 100, chunks, embedded: chunks });
    } catch (err) {
      updateFile(id, { status: 'error', error: String(err) });
    }
  }

  function addFiles(fileList: FileList | File[]) {
    const newFiles: UploadedFile[] = [];
    Array.from(fileList).forEach(file => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const type = TYPE_LABELS[file.type] || ext;
      const id = `f-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      newFiles.push({
        id, name: file.name, type, sizeMB: file.size / 1024 / 1024,
        status: 'queued', progress: 0, chunks: 0, embedded: 0,
      });
    });
    setFiles(prev => {
      const updated = [...prev, ...newFiles];
      return updated;
    });
    // Start processing each new file
    newFiles.forEach((nf, i) => {
      const file = Array.from(fileList)[i];
      setTimeout(() => processFile(file, nf.id), i * 300);
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) addFiles(e.target.files);
  }

  const allReady = files.length > 0 && files.every(f => f.status === 'ready' || f.status === 'error');
  const totalChunks = files.reduce((s, f) => s + f.chunks, 0);
  const totalEmb = files.reduce((s, f) => s + f.embedded, 0);
  const overallPct = files.length === 0 ? 0 : Math.round(
    files.reduce((s, f) => s + f.progress, 0) / files.length
  );

  return (
    <div className="upload-screen">
      <div className="us-inner">
        <div className="us-head">
          <div className="muted" style={{ fontSize: 13 }}>
            Drop in the materials you want to query. Files stay private.
          </div>
        </div>

        <label
          className={`dropzone${dragging ? ' is-drag' : ''}${files.length ? ' has-files' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.md,.txt"
                 style={{ display: 'none' }} onChange={handleInputChange} />
          <div className="dz-illu">
            <div className="dz-page p1"><div /><div /><div /></div>
            <div className="dz-page p2"><div /><div /><div /></div>
            <div className="dz-page p3"><div /><div /><div /></div>
            <div className="dz-plus"><Icon.Plus size={14} /></div>
          </div>
          <div className="dz-text">
            <div className="dz-title">
              {dragging ? 'Drop to add files' : files.length ? 'Add more files' : 'Drop files here or click to browse'}
            </div>
            <div className="dz-sub muted">
              PDF · DOCX · XLSX · PPTX · MD · TXT — up to 200&nbsp;MB each
            </div>
          </div>
          <div className="dz-shortcut">
            <span className="kbd-key mono">⌘</span><span className="kbd-key mono">U</span>
          </div>
        </label>

        {files.length > 0 && (
          <div className="files-block fade-up">
            <div className="files-head">
              <div className="files-head-l">
                <span className="files-title">{files.length} {files.length === 1 ? 'file' : 'files'}</span>
                <span className="muted mono" style={{ fontSize: 11.5 }}>
                  · {totalChunks} chunks · {totalEmb} embedded
                </span>
              </div>
              <div className="files-head-r">
                <span className="muted mono" style={{ fontSize: 11.5 }}>
                  {allReady ? 'Ready' : `${overallPct}%`}
                </span>
                <button className="btn ghost sm" onClick={() => setFiles([])}>
                  <Icon.Trash size={12} /> Clear
                </button>
              </div>
            </div>
            <div className="files-list">
              {files.map(f => <FileRow key={f.id} f={f} />)}
            </div>
            <div className="files-foot">
              <div className="muted" style={{ fontSize: 12 }}>
                {allReady
                  ? <><span>All files indexed. </span><b style={{ color: 'var(--fg)' }}>You can start asking questions.</b></>
                  : <>Processing — converting and indexing your documents...</>
                }
              </div>
              <button
                className={`btn ${allReady ? 'accent' : 'primary'}`}
                disabled={!allReady}
                onClick={() => allReady && onComplete(files)}
              >
                Open chat <Icon.Chevron size={12} />
              </button>
            </div>
          </div>
        )}

      </div>

      <style jsx>{`
        .upload-screen { padding: 36px 24px 80px; display: flex; justify-content: center; }
        .us-inner { width: 100%; max-width: 880px; display: flex; flex-direction: column; gap: 22px; }
        .us-head {
          display: flex; justify-content: space-between; align-items: flex-start;
          gap: 16px; flex-wrap: wrap;
        }
        .dropzone {
          position: relative;
          border: 1.5px dashed var(--border-strong);
          border-radius: 16px;
          padding: 36px 24px;
          background: var(--bg-elev);
          display: flex; flex-direction: column; align-items: center;
          gap: 18px; cursor: default;
          transition: border-color 160ms, background 160ms;
        }
        .dropzone:hover { border-color: var(--accent); }
        .dropzone.is-drag { border-color: var(--accent); background: var(--accent-soft); border-style: solid; }
        .dropzone.has-files { padding: 22px; }

        .dz-illu { position: relative; width: 92px; height: 78px; }
        .dz-page {
          position: absolute; width: 56px; height: 70px;
          background: var(--bg); border: 1px solid var(--border-strong);
          border-radius: 6px;
          display: flex; flex-direction: column; gap: 5px; padding: 10px 8px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.04);
        }
        .dz-page > div { height: 3px; border-radius: 2px; background: var(--border); }
        .dz-page > div:nth-child(2) { width: 80%; }
        .dz-page > div:nth-child(3) { width: 60%; }
        .dz-page.p1 { transform: rotate(-9deg) translate(-4px, 4px); }
        .dz-page.p2 { transform: rotate(2deg) translate(12px, 2px); z-index: 2; }
        .dz-page.p3 { transform: rotate(10deg) translate(26px, 6px); }
        .dz-plus {
          position: absolute; right: -10px; bottom: -2px;
          width: 26px; height: 26px; border-radius: 50%;
          background: var(--accent); color: var(--accent-fg);
          display: grid; place-items: center;
          box-shadow: 0 0 0 4px var(--bg-elev);
          z-index: 3;
        }
        .dz-text { text-align: center; }
        .dz-title { font-size: 15px; font-weight: 500; }
        .dz-sub { font-size: 13px; margin-top: 4px; }
        .dz-shortcut { position: absolute; right: 14px; top: 14px; display: flex; gap: 3px; }

        .files-block {
          background: var(--bg-elev); border: 1px solid var(--border);
          border-radius: 14px; overflow: hidden;
        }
        .files-head {
          display: flex; justify-content: space-between; align-items: center;
          padding: 12px 16px; border-bottom: 1px solid var(--border);
        }
        .files-head-l, .files-head-r { display: flex; align-items: center; gap: 8px; }
        .files-title { font-weight: 600; font-size: 14px; }
        .files-list { display: flex; flex-direction: column; }
        .files-foot {
          display: flex; justify-content: space-between; align-items: center;
          padding: 14px 16px; background: var(--bg-soft); border-top: 1px solid var(--border);
        }
      `}</style>
    </div>
  );
}

function FileRow({ f }: { f: UploadedFile }) {
  const statusLabel = {
    queued:     'Queued',
    uploading:  `Uploading ${f.progress}%`,
    converting: 'Converting...',
    chunking:   `Chunking · ${f.chunks} chunks`,
    embedding:  `Embedding · ${f.embedded}/${f.chunks}`,
    ready:      'Indexed',
    error:      f.error || 'Error',
  }[f.status] ?? f.status;

  const pct = f.status === 'ready' ? 100 : f.progress;
  const typeKey = f.type.split('/').pop() || f.type;

  return (
    <div className="frow">
      <FileGlyph type={typeKey} />
      <div className="frow-main">
        <div className="frow-top">
          <span className="frow-name">{f.name}</span>
          <span className="mono faint frow-meta">
            {f.sizeMB < 1 ? `${Math.round(f.sizeMB * 1024)} KB` : `${f.sizeMB.toFixed(1)} MB`}
          </span>
        </div>
        <div className="frow-status">
          <div className="progress"><i style={{ width: `${pct}%` }} /></div>
          <span className={`frow-state mono${f.status === 'ready' ? ' ok' : f.status === 'error' ? ' err' : ''}`}>
            {f.status === 'ready'
              ? <><Icon.Check size={11} /> {statusLabel}</>
              : f.status === 'error'
              ? <><Icon.Close size={11} /> {statusLabel}</>
              : <><span className="spin" /> {statusLabel}</>
            }
          </span>
        </div>
      </div>

      <style jsx>{`
        .frow {
          display: grid; grid-template-columns: 36px 1fr;
          align-items: center; gap: 12px;
          padding: 12px 16px; border-bottom: 1px solid var(--border);
        }
        .frow:last-child { border-bottom: 0; }
        .frow-main { min-width: 0; }
        .frow-top {
          display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
        }
        .frow-name { font-weight: 500; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .frow-meta { font-size: 11.5px; flex: none; }
        .frow-status { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
        .frow-status :global(.progress) { flex: 1; }
        .frow-state {
          font-size: 11px; color: var(--fg-muted);
          display: inline-flex; align-items: center; gap: 6px;
          min-width: 150px; justify-content: flex-end;
        }
        .frow-state.ok { color: var(--success); }
        .frow-state.err { color: var(--danger); }
      `}</style>
    </div>
  );
}

function FileGlyph({ type }: { type: string }) {
  const color = FILE_COLORS[type] || '#888';
  const label = type.slice(0, 3).toUpperCase();
  return (
    <div className="fglyph" style={{ '--g': color } as React.CSSProperties}>
      <span className="mono">{label}</span>
      <style jsx>{`
        .fglyph {
          width: 30px; height: 38px; border-radius: 4px;
          background: var(--bg); border: 1px solid var(--border-strong);
          position: relative;
          display: flex; align-items: flex-end; justify-content: center;
          padding-bottom: 4px;
        }
        .fglyph::before {
          content: ""; position: absolute; top: 0; right: 0;
          width: 9px; height: 9px;
          background: var(--bg-soft);
          border-left: 1px solid var(--border-strong);
          border-bottom: 1px solid var(--border-strong);
        }
        .fglyph::after {
          content: ""; position: absolute; left: 0; right: 0; top: 13px; height: 3px;
          background: var(--g, #888);
        }
        .fglyph .mono { font-size: 8.5px; font-weight: 700; color: var(--g, #888); letter-spacing: 0.04em; }
      `}</style>
    </div>
  );
}
