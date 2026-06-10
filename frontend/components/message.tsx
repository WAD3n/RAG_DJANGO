'use client';

import React from 'react';
import * as Icon from './icons';
import type { ChatMessage, Citation, Document, JudgeResult } from '../lib/types';

interface MessageProps {
  msg: ChatMessage;
  idx: number;
  activeCite: { msgIdx: number; citeId: number };
  setActiveCite: (c: { msgIdx: number; citeId: number }) => void;
  citationStyle: 'numbered' | 'pill' | 'underline';
  docs: Document[];
  model?: string;
}

function JudgePanel({ judge }: { judge: JudgeResult }) {
  const [open, setOpen] = React.useState(false);
  const icon = judge.verdict === 'PASS' ? '✅' : judge.verdict === 'WARN' ? '⚠️' : '❌';
  const color = judge.verdict === 'PASS' ? 'var(--success)' : judge.verdict === 'WARN' ? '#e8a838' : 'var(--danger)';

  return (
    <div className="judge-wrap">
      <button className="judge-badge" onClick={() => setOpen(v => !v)} style={{ '--jc': color } as React.CSSProperties}>
        <span>{icon}</span>
        <span className="mono" style={{ fontSize: 11 }}>score {judge.score}/10</span>
        <span style={{ fontSize: 10, color: 'var(--fg-faint)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="judge-panel">
          <div className="judge-row">
            <span className="judge-label">Verdict</span>
            <span style={{ color, fontWeight: 600 }}>{judge.verdict}</span>
          </div>
          <div className="judge-row">
            <span className="judge-label">Reasoning</span>
            <span>{judge.reasoning}</span>
          </div>
          {(judge.flags ?? []).length > 0 && (
            <div className="judge-row">
              <span className="judge-label">Flags</span>
              <span>{(judge.flags ?? []).join(', ')}</span>
            </div>
          )}
        </div>
      )}
      <style jsx>{`
        .judge-wrap { margin-top: 8px; }
        .judge-badge {
          appearance: none; border: 1px solid var(--border-strong);
          background: var(--bg-soft); border-radius: 20px;
          padding: 3px 10px; display: inline-flex; align-items: center; gap: 6px;
          cursor: default; font: inherit; color: var(--fg);
          transition: border-color 120ms;
        }
        .judge-badge:hover { border-color: var(--jc, var(--accent)); }
        .judge-panel {
          margin-top: 6px; padding: 10px 12px;
          background: var(--bg-elev); border: 1px solid var(--border);
          border-radius: 8px; display: flex; flex-direction: column; gap: 6px;
        }
        .judge-row { display: flex; gap: 10px; font-size: 12.5px; color: var(--fg-muted); }
        .judge-label { font-weight: 600; color: var(--fg-faint); min-width: 70px; }
      `}</style>
    </div>
  );
}

export default function Message({ msg, idx, activeCite, setActiveCite, citationStyle, docs, model }: MessageProps) {
  const isUser = msg.role === 'user';
  const [copied, setCopied] = React.useState(false);

  function handleCite(citeId: number) {
    setActiveCite({ msgIdx: idx, citeId });
  }

  function handleViewSources() {
    const first = msg.citations?.[0];
    if (first) setActiveCite({ msgIdx: idx, citeId: first.id });
  }

  function handleCopy() {
    navigator.clipboard?.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className={`msg ${isUser ? 'is-user' : 'is-ai'} fade-up`}>
      <div className="msg-avatar">
        {isUser ? 'Me' : <Icon.Sparkle size={14} />}
      </div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="msg-role">{isUser ? 'You' : (model || 'LLM')}</span>
          {!isUser && msg.citations && msg.durationMs && (
            <span className="muted mono" style={{ fontSize: 10.5 }}>
              · {msg.citations.length} sources · {(msg.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {!isUser && msg.citations && !msg.durationMs && (
            <span className="muted mono" style={{ fontSize: 10.5 }}>
              · {msg.citations.length} sources
            </span>
          )}
        </div>
        <div className="msg-content">
          {renderRich(msg.content, msg.citations, citationStyle, handleCite, docs)}
          {!isUser && msg.content && msg.citations && (
            <div className="msg-actions">
              <button className="msg-act" onClick={handleViewSources} disabled={!msg.citations.length}>
                <Icon.Quote size={11} /> View sources
              </button>
              <span className="msg-act-sep">·</span>
              <button className="msg-act" onClick={handleCopy}>
                <Icon.Export size={11} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}
          {!isUser && msg.judgeResult && (
            <JudgePanel judge={msg.judgeResult} />
          )}
        </div>
      </div>

      <style jsx>{`
        .msg { display: grid; grid-template-columns: 28px 1fr; gap: 12px; align-items: flex-start; }
        .msg-avatar {
          width: 28px; height: 28px; border-radius: 50%;
          display: grid; place-items: center;
          font-size: 10.5px; font-weight: 600; flex-shrink: 0;
        }
        .msg.is-user .msg-avatar {
          background: linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 30%, #000));
          color: white;
        }
        .msg.is-ai .msg-avatar { background: var(--fg); color: var(--bg); }
        .msg-body { min-width: 0; }
        .msg-meta {
          display: flex; gap: 6px; align-items: baseline;
          margin-bottom: 6px; font-size: 12px; color: var(--fg-muted);
        }
        .msg-role { font-weight: 600; color: var(--fg); font-size: 12.5px; }
        .msg-content { font-size: 14.5px; line-height: 1.6; color: var(--fg); }
        .msg-content :global(p) { margin: 0 0 10px; }
        .msg-content :global(p:first-child) { margin-top: 0; }
        .msg-content :global(p:last-child) { margin-bottom: 0; }
        .msg-content :global(ol) { padding-left: 24px; margin: 6px 0 10px; }
        .msg-content :global(li) { margin: 4px 0; padding-left: 4px; }
        .msg-content :global(li::marker) {
          color: var(--fg-faint); font-variant-numeric: tabular-nums;
          font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px;
        }
        .msg-actions {
          display: flex; align-items: center; gap: 10px; margin-top: 12px;
          padding-top: 8px; border-top: 1px dashed var(--border);
          font-size: 11.5px; color: var(--fg-muted);
        }
        .msg-act {
          appearance: none; border: 0; background: transparent;
          color: var(--fg-muted); font: inherit; cursor: default;
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 4px; border-radius: 4px;
        }
        .msg-act:hover { color: var(--fg); background: var(--bg-soft); }
        .msg-act-sep { color: var(--fg-faint); }
      `}</style>
    </div>
  );
}

function renderRich(
  text: string,
  citations: Citation[] | undefined,
  style: 'numbered' | 'pill' | 'underline',
  onCite: (id: number) => void,
  docs: Document[]
): React.ReactNode {
  if (!text) return null;
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length) {
      out.push(
        <ol key={`list-${out.length}`}>
          {listBuffer.map((l, i) => (
            <li key={i}>{renderInline(l, citations, style, onCite, docs)}</li>
          ))}
        </ol>
      );
      listBuffer = [];
    }
  };

  lines.forEach((line, i) => {
    const m = line.match(/^(\d+)\.\s+(.*)$/);
    if (m) {
      listBuffer.push(m[2]);
    } else {
      flushList();
      if (line.trim()) {
        out.push(<p key={`p-${i}`}>{renderInline(line, citations, style, onCite, docs)}</p>);
      }
    }
  });
  flushList();
  return out;
}

function renderInline(
  line: string,
  citations: Citation[] | undefined,
  style: 'numbered' | 'pill' | 'underline',
  onCite: (id: number) => void,
  docs: Document[]
): React.ReactNode {
  const tokens: Array<string | { b: string } | { cite: number }> = [];
  let buf = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '*' && line[i + 1] === '*') {
      if (buf) { tokens.push(buf); buf = ''; }
      const end = line.indexOf('**', i + 2);
      if (end === -1) { buf += line.slice(i); break; }
      tokens.push({ b: line.slice(i + 2, end) });
      i = end + 2;
    } else if (line[i] === '[' && /\d/.test(line[i + 1] || '')) {
      const end = line.indexOf(']', i);
      if (end === -1) { buf += line[i++]; continue; }
      const n = parseInt(line.slice(i + 1, end), 10);
      if (Number.isFinite(n)) {
        if (buf) { tokens.push(buf); buf = ''; }
        tokens.push({ cite: n });
        i = end + 1;
      } else { buf += line[i++]; }
    } else { buf += line[i++]; }
  }
  if (buf) tokens.push(buf);

  return tokens.map((t, k) => {
    if (typeof t === 'string') return <React.Fragment key={k}>{t}</React.Fragment>;
    if ('b' in t) return <b key={k}>{t.b}</b>;
    if ('cite' in t) {
      const cit = citations?.find(c => c.id === t.cite);
      const doc = cit ? docs.find(d => d.id === cit.doc) : undefined;
      if (style === 'pill') {
        return (
          <button key={k} className="cite cite-pill" onClick={() => onCite(t.cite)}>
            {doc && <span className="dot" style={{ background: doc.color }} />}
            {doc ? `${doc.name.split('-')[0]} · p${cit?.page}` : `[${t.cite}]`}
          </button>
        );
      }
      if (style === 'underline') {
        return (
          <button key={k} className="cite cite-under" onClick={() => onCite(t.cite)}>
            <span>{t.cite}</span>
          </button>
        );
      }
      return (
        <button key={k} className="cite" onClick={() => onCite(t.cite)}>
          {t.cite}
        </button>
      );
    }
    return null;
  });
}

// Inline citation styles (referenced via globals)
export const citationStyles = `
  .cite {
    appearance: none; cursor: default;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px; color: var(--accent);
    padding: 0 5px; border-radius: 4px;
    background: var(--accent-soft);
    vertical-align: 2px; line-height: 1.6;
    margin: 0 1px; border: 0;
  }
  .cite:hover { background: color-mix(in oklab, var(--accent) 28%, transparent); }
  .cite-pill {
    background: var(--bg-soft); color: var(--fg-muted);
    border: 1px solid var(--border);
    padding: 1px 6px 1px 4px;
    display: inline-flex; align-items: center; gap: 4px;
    vertical-align: 1px;
  }
  .cite-pill .dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }
  .cite-pill:hover { color: var(--fg); background: var(--bg-softer); }
  .cite-under {
    background: transparent; color: var(--accent);
    text-decoration: underline; text-underline-offset: 3px;
    padding: 0 1px; vertical-align: 0;
  }
`;
