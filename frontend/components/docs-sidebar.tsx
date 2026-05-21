'use client';

import React from 'react';
import * as Icon from './icons';
import type { Document } from '../lib/types';

interface Collection {
  id: string;
  name: string;
  count: number;
  active?: boolean;
}

interface HistoryItem {
  id: string;
  title: string;
  when: string;
  active?: boolean;
}

interface DocsSidebarProps {
  docs: Document[];
  collections: Collection[];
  history: HistoryItem[];
  showHistory: boolean;
  setShowHistory: (v: boolean | ((prev: boolean) => boolean)) => void;
  activeDocs: string[];
  toggleDoc: (id: string) => void;
  onNewProject: () => void;
}

export default function DocsSidebar({
  docs, collections, history, showHistory, setShowHistory,
  activeDocs, toggleDoc, onNewProject
}: DocsSidebarProps) {
  return (
    <aside className="docs-sidebar scroll">
      <div className="ds-section">
        <button className="ds-newbtn" onClick={onNewProject}>
          <Icon.Plus size={13} /> New project
          <span className="kbd-key mono" style={{ marginLeft: 'auto' }}>⌘N</span>
        </button>
        <div className="ds-search">
          <Icon.Search size={13} />
          <input placeholder="Search projects, docs…" />
          <span className="kbd-key mono">⌘K</span>
        </div>
      </div>

      <div className="ds-section">
        <div className="ds-h">Collections</div>
        {collections.map(c => (
          <div key={c.id} className={`ds-item${c.active ? ' active' : ''}`}>
            <Icon.Folder size={13} />
            <span className="ds-item-name">{c.name}</span>
            <span className="ds-item-count mono">{c.count}</span>
          </div>
        ))}
      </div>

      <div className="ds-section">
        <div className="ds-h">
          Documents
          <span className="mono ds-h-meta">{docs.length} files</span>
        </div>
        {docs.map(d => {
          const active = activeDocs.includes(d.id);
          return (
            <div key={d.id} className={`ds-doc${active ? ' active' : ''}`} onClick={() => toggleDoc(d.id)}>
              <span className="ds-doc-dot" style={{ background: d.color }} />
              <div className="ds-doc-main">
                <div className="ds-doc-name" title={d.name}>{d.name}</div>
                <div className="ds-doc-sub mono">{d.pages}p · {d.chunks} chunks</div>
              </div>
              <span className={`ds-check${active ? ' on' : ''}`}>
                {active && <Icon.Check size={10} />}
              </span>
            </div>
          );
        })}
      </div>

      <div className="ds-section">
        <button className="ds-h ds-h-btn" onClick={() => setShowHistory(h => !h)}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon.History size={12} /> Chat history
          </span>
          <Icon.ChevronDown size={12} style={{ transform: showHistory ? '' : 'rotate(-90deg)', transition: 'transform 160ms' }} />
        </button>
        {showHistory && history.map(h => (
          <div key={h.id} className={`ds-hist${h.active ? ' active' : ''}`}>
            <span className="ds-hist-title">{h.title}</span>
            <span className="ds-hist-when mono">{h.when}</span>
          </div>
        ))}
      </div>

      <div className="ds-foot">
        <div className="ds-foot-user">
          <div className="ds-avatar">Me</div>
          <div style={{ minWidth: 0 }}>
            <div className="ds-foot-name">User</div>
            <div className="muted mono" style={{ fontSize: 11 }}>Local · {docs.length} docs</div>
          </div>
          <button className="icon-btn"><Icon.Settings size={13} /></button>
        </div>
      </div>

      <style jsx>{`
        .docs-sidebar {
          border-right: 1px solid var(--border); padding: 12px 8px;
          display: flex; flex-direction: column; gap: 14px; min-height: 0;
          background: var(--bg);
        }
        .ds-section { display: flex; flex-direction: column; gap: 2px; }
        .ds-h {
          font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--fg-faint); padding: 6px 8px;
          display: flex; justify-content: space-between; align-items: center;
        }
        .ds-h-meta { font-size: 10px; text-transform: none; letter-spacing: 0; color: var(--fg-faint); }
        .ds-h-btn {
          appearance: none; border: 0; background: transparent;
          color: var(--fg-faint); font: inherit; cursor: default; width: 100%;
          padding: 6px 8px; display: flex; justify-content: space-between; align-items: center;
        }
        .ds-h-btn:hover { color: var(--fg-muted); }
        .ds-newbtn {
          appearance: none; border: 1px dashed var(--border-strong);
          background: var(--bg-elev); color: var(--fg);
          width: 100%; height: 32px; border-radius: 8px; cursor: default;
          font: inherit; font-size: 13px;
          display: inline-flex; align-items: center; gap: 8px; padding: 0 10px;
          margin-bottom: 6px;
        }
        .ds-newbtn:hover { background: var(--bg-soft); border-style: solid; border-color: var(--accent); color: var(--accent); }
        .ds-search {
          display: flex; align-items: center; gap: 8px; padding: 0 8px; height: 30px;
          background: var(--bg-soft); border-radius: 8px; color: var(--fg-muted);
        }
        .ds-search input {
          flex: 1; min-width: 0; border: 0; outline: 0;
          background: transparent; font: inherit; font-size: 12.5px; color: var(--fg);
        }
        .ds-item {
          height: 28px; padding: 0 8px;
          display: flex; align-items: center; gap: 8px;
          border-radius: 6px; cursor: default;
          color: var(--fg-muted); font-size: 13px;
        }
        .ds-item:hover { background: var(--bg-soft); color: var(--fg); }
        .ds-item.active { background: var(--bg-soft); color: var(--fg); }
        .ds-item-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ds-item-count { font-size: 10.5px; color: var(--fg-faint); }
        .ds-item.active::before {
          content: ""; width: 2px; height: 12px; background: var(--accent);
          border-radius: 2px; margin-left: -8px; margin-right: 6px;
        }
        .ds-doc {
          display: grid; grid-template-columns: 8px 1fr 16px;
          align-items: center; gap: 10px;
          padding: 7px 8px; border-radius: 6px; cursor: default;
        }
        .ds-doc:hover { background: var(--bg-soft); }
        .ds-doc-dot { width: 8px; height: 8px; border-radius: 50%; }
        .ds-doc-main { min-width: 0; }
        .ds-doc-name {
          font-size: 12.5px; font-weight: 500;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .ds-doc-sub { font-size: 10.5px; color: var(--fg-faint); margin-top: 1px; }
        .ds-check {
          width: 14px; height: 14px; border-radius: 4px;
          border: 1px solid var(--border-strong);
          display: inline-flex; align-items: center; justify-content: center;
          color: white;
        }
        .ds-check.on { background: var(--accent); border-color: var(--accent); }
        .ds-hist { padding: 6px 8px; border-radius: 6px; cursor: default; display: flex; flex-direction: column; gap: 1px; }
        .ds-hist:hover { background: var(--bg-soft); }
        .ds-hist.active { background: var(--bg-soft); }
        .ds-hist-title { font-size: 12.5px; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ds-hist-when { font-size: 10.5px; color: var(--fg-faint); }
        .ds-foot { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border); }
        .ds-foot-user { display: flex; align-items: center; gap: 8px; padding: 6px 4px; }
        .ds-avatar {
          width: 28px; height: 28px; border-radius: 50%; flex: none;
          background: linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 40%, #000));
          color: white; display: grid; place-items: center; font-size: 11px; font-weight: 600;
        }
        .ds-foot-name { font-size: 12.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      `}</style>
    </aside>
  );
}
