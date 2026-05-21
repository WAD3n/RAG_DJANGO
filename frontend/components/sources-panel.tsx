'use client';

import React from 'react';
import * as Icon from './icons';
import { getToken } from '../lib/api';
import type { ChatMessage, Citation, Document } from '../lib/types';

interface SourcesPanelProps {
  msg: ChatMessage | undefined;
  activeCite: { msgIdx: number; citeId: number };
  setActiveCite: (c: { msgIdx: number; citeId: number }) => void;
  docs: Document[];
  activeCitation: Citation | undefined;
}

function openInPdf(objectName: string, passage: string, pageNo?: number) {
  const token = getToken();
  const params = new URLSearchParams({ key: objectName });
  if (token) params.set('_token', token);
  const fragment = pageNo && pageNo > 1
    ? `#page=${pageNo}`
    : `#search=${encodeURIComponent(passage.replace(/\s+/g, ' ').trim().slice(0, 120))}`;
  window.open(`/api/pdf/view?${params}${fragment}`, '_blank');
}

export default function SourcesPanel({ msg, activeCite, setActiveCite, docs, activeCitation }: SourcesPanelProps) {
  const citations = msg?.citations || [];
  const doc = activeCitation && docs.find(d => d.id === activeCitation.doc);
  return (
    <aside className="sources-panel">
      <div className="sp-tabs">
        <button className="sp-tab active">
          Cited <span className="sp-tab-count mono">{citations.length}</span>
        </button>
        <div style={{ flex: 1 }} />
        <button className="icon-btn" title="Filter"><Icon.Filter size={13} /></button>
      </div>

      <div className="sp-list scroll">
        {citations.length === 0 && (
          <div className="sp-empty">
            <Icon.Quote size={20} />
            <div>Source passages will appear here when RAGFLOW answers your question.</div>
          </div>
        )}
        {citations.map(c => {
          const d = docs.find(x => x.id === c.doc);
          const active = activeCitation?.id === c.id;
          const hasPdf = !!d?.objectName;

          return (
            <button
              key={c.id}
              className={`sp-card${active ? ' active' : ''}`}
              onClick={() => setActiveCite({ msgIdx: activeCite.msgIdx, citeId: c.id })}
            >
              <div className="sp-card-head">
                <span className="sp-card-num mono">[{c.id}]</span>
                <span className="sp-card-doc">
                  <span className="sp-dot" style={{ background: d?.color }} />
                  <span className="sp-doc-name">{d?.name || `Source ${c.id}`}</span>
                </span>
                {c.score && (
                  <span className="sp-score mono">{(c.score * 100).toFixed(0)}%</span>
                )}
              </div>
              <div className="sp-card-passage">
                &ldquo;{highlightPassage(c.passage)}&rdquo;
              </div>
              {hasPdf && (
                <div className="sp-card-foot" onClick={e => e.stopPropagation()}>
                  <button
                    className="sp-open-btn"
                    onClick={() => openInPdf(d!.objectName!, c.passage, c.page)}
                    title="Open PDF at this passage (Chrome/Edge)"
                  >
                    <Icon.Export size={11} /> Open in PDF
                  </button>
                </div>
              )}
            </button>
          );
        })}

        {activeCitation && doc && (
          <div className="sp-preview fade-up">
            <div className="sp-preview-head">
              <span className="mono" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon.File size={11} /> {doc.name}
              </span>
              {doc.objectName && (
                <button
                  className="sp-preview-open"
                  onClick={() => openInPdf(doc.objectName!, activeCitation.passage, activeCitation.page)}
                  title="Open PDF"
                >
                  <Icon.Export size={11} /> Open PDF
                </button>
              )}
            </div>
            <div className="sp-preview-page">
              <div className="pdf-line h" />
              <div className="pdf-line w90" />
              <div className="pdf-line w95" />
              <div className="pdf-line w70" />
              <div className="pdf-block-highlight">
                <div className="pdf-line on w92" />
                <div className="pdf-line on w88" />
                <div className="pdf-line on w50" />
              </div>
              <div className="pdf-line w94" />
              <div className="pdf-line w80" />
              <div className="pdf-line w90" />
              <div className="pdf-line w60" />
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .sources-panel {
          border-left: 1px solid var(--border);
          background: var(--bg); display: flex; flex-direction: column;
          min-height: 0;
        }
        .sp-tabs {
          height: 48px; flex: none;
          display: flex; align-items: center; gap: 4px;
          padding: 0 12px; border-bottom: 1px solid var(--border);
        }
        .sp-tab {
          appearance: none; border: 0; background: transparent;
          color: var(--fg-muted); font: inherit; font-size: 12.5px; font-weight: 500;
          padding: 6px 8px; border-radius: 6px; cursor: default;
          display: inline-flex; align-items: center; gap: 5px;
        }
        .sp-tab:hover { color: var(--fg); background: var(--bg-soft); }
        .sp-tab.active { color: var(--fg); }
        .sp-tab-count {
          font-size: 10.5px; color: var(--fg-faint);
          background: var(--bg-soft); padding: 0 5px; border-radius: 4px;
          border: 1px solid var(--border);
        }
        .sp-list {
          flex: 1; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 0;
        }
        .sp-empty {
          padding: 32px 16px; text-align: center; font-size: 12.5px;
          display: flex; flex-direction: column; gap: 10px; align-items: center;
          color: var(--fg-faint);
        }
        .sp-card {
          appearance: none; text-align: left; cursor: default;
          background: var(--bg-elev); border: 1px solid var(--border);
          border-radius: 10px; padding: 10px 12px;
          color: var(--fg); font: inherit;
          display: flex; flex-direction: column; gap: 7px;
          transition: border-color 120ms, background 120ms; width: 100%;
        }
        .sp-card:hover { border-color: var(--border-strong); background: var(--bg-soft); }
        .sp-card.active {
          border-color: var(--accent);
          background: color-mix(in oklab, var(--accent-soft) 40%, var(--bg-elev));
          box-shadow: 0 0 0 1px var(--accent-soft);
        }
        .sp-card-head { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--fg-muted); }
        .sp-card-num { color: var(--accent); font-weight: 700; flex: none; font-size: 11.5px; }
        .sp-card-doc { display: inline-flex; align-items: center; gap: 5px; flex: 1; min-width: 0; }
        .sp-doc-name {
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          font-size: 12px; font-weight: 500; color: var(--fg);
        }
        .sp-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
        .sp-score {
          font-size: 10px; color: var(--fg-faint);
          background: var(--bg-soft); border: 1px solid var(--border);
          padding: 1px 5px; border-radius: 4px; flex: none;
        }
        .sp-card-passage {
          font-size: 12.5px; line-height: 1.55; color: var(--fg);
          font-style: italic; letter-spacing: 0.01em;
        }
        .sp-card-passage :global(mark) {
          background: var(--highlight); color: inherit; padding: 0 2px; border-radius: 2px; font-style: normal;
        }
        .sp-card-foot { display: flex; align-items: center; padding-top: 2px; }
        .sp-open-btn {
          appearance: none; border: 1px solid var(--border-strong);
          background: var(--bg-soft); color: var(--fg-muted);
          padding: 0 9px; height: 24px; border-radius: 5px;
          font: inherit; font-size: 11.5px; font-weight: 500;
          display: inline-flex; align-items: center; gap: 5px;
          cursor: default; transition: all 100ms;
        }
        .sp-open-btn:hover:not(:disabled) {
          background: var(--accent); color: var(--accent-fg);
          border-color: var(--accent);
        }
        .sp-open-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .sp-open-btn.loading { gap: 6px; }

        .sp-preview { margin-top: 4px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
        .sp-preview-head {
          display: flex; justify-content: space-between; align-items: center;
          padding: 8px 10px; border-bottom: 1px solid var(--border); color: var(--fg-muted);
        }
        .sp-preview-open {
          appearance: none; border: 1px solid var(--border-strong);
          background: var(--bg-soft); color: var(--fg-muted);
          padding: 0 8px; height: 22px; border-radius: 5px;
          font: inherit; font-size: 11px; font-weight: 500;
          display: inline-flex; align-items: center; gap: 4px; cursor: default;
        }
        .sp-preview-open:hover { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
        .sp-preview-page {
          background: #fff; padding: 18px 16px;
          display: flex; flex-direction: column; gap: 6px; position: relative;
        }
        :global(.theme-dark) .sp-preview-page { background: #19191c; }
        .pdf-line { height: 6px; background: #d9d6cf; border-radius: 2px; width: 100%; }
        :global(.theme-dark) .pdf-line { background: #303035; }
        .pdf-line.h { height: 9px; width: 50%; background: #888581; margin-bottom: 6px; }
        :global(.theme-dark) .pdf-line.h { background: #6a6862; }
        .pdf-line.w50 { width: 50%; } .pdf-line.w60 { width: 60%; }
        .pdf-line.w70 { width: 70%; } .pdf-line.w80 { width: 80%; }
        .pdf-line.w88 { width: 88%; } .pdf-line.w90 { width: 90%; }
        .pdf-line.w92 { width: 92%; } .pdf-line.w94 { width: 94%; }
        .pdf-line.w95 { width: 95%; }
        .pdf-block-highlight {
          background: var(--highlight); margin: 2px -4px; padding: 6px 4px;
          border-radius: 2px; position: relative;
          display: flex; flex-direction: column; gap: 6px;
        }
        .pdf-block-highlight::before {
          content: ""; position: absolute; left: -8px; top: 0; bottom: 0; width: 3px;
          background: var(--accent); border-radius: 0 2px 2px 0;
        }
        .pdf-line.on { background: color-mix(in oklab, var(--accent) 55%, transparent); }
      `}</style>
    </aside>
  );
}

function highlightPassage(passage: string): React.ReactNode {
  const m = passage.match(/(\d+\.?\d*\s*(?:%|bps|million|billion|MM|M\b)?(?:\s+in\s+the\s+\w+\s+quarter)?)/);
  if (!m) return passage;
  const start = passage.indexOf(m[0]);
  const end = start + m[0].length;
  return (
    <>
      {passage.slice(0, start)}
      <mark>{passage.slice(start, end)}</mark>
      {passage.slice(end)}
    </>
  );
}
