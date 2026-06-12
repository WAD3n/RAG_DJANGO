'use client';

import React from 'react';
import * as Icon from './icons';
import type { Document, Workspace } from '../lib/types';

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  messageCount: number;
}

interface DocsSidebarProps {
  docs: Document[];
  activeDocs: string[];
  toggleDoc: (id: string) => void;
  onUpload: () => void;
  conversations: Conversation[];
  activeConvId: string;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  username: string;
  onLogout: () => void;
  workspaceName?: string;
  onGetSummary?: (source: string) => Promise<string | null>;
  workspaces?: Workspace[];
  activeWorkspaceId?: number | null;
  onWorkspaceChange?: (id: number) => void;
  onCreateWorkspace?: (name: string) => Promise<void>;
  onRenameWorkspace?: (id: number, name: string) => Promise<void>;
  onDeleteWorkspace?: (id: number) => Promise<void>;
  onDeleteDoc?: (doc: Document) => Promise<void>;
}

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ConvItem({
  conv, active, onSelect, onRename, onDelete,
}: {
  conv: Conversation;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(conv.title);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(conv.title);
    setEditing(true);
  }

  function commit() {
    const t = draft.trim();
    if (t && t !== conv.title) onRename(t);
    setEditing(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditing(false);
  }

  return (
    <div
      className={`conv-item${active ? ' active' : ''}`}
      onClick={() => { if (!editing) onSelect(); }}
    >
      {active && <span className="conv-bar" />}

      {editing ? (
        <input
          ref={inputRef}
          className="conv-rename"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <>
          <div className="conv-body">
            <span className="conv-title">{conv.title}</span>
            <span className="conv-when mono">{relativeTime(conv.createdAt)}</span>
          </div>
          <button className="conv-edit" onClick={startEdit} title="Rename">
            <Icon.Pencil size={11} />
          </button>
          <button className="conv-del" onClick={e => { e.stopPropagation(); onDelete(); }} title="Delete">
            <Icon.Trash size={11} />
          </button>
        </>
      )}

      <style jsx>{`
        .conv-item {
          position: relative;
          display: flex; align-items: center; gap: 6px;
          padding: 7px 8px 7px 12px;
          border-radius: 8px; cursor: default;
          transition: background 100ms;
          min-width: 0;
        }
        .conv-item:hover { background: var(--bg-soft); }
        .conv-item.active {
          background: color-mix(in oklab, var(--accent) 12%, var(--bg-soft));
        }
        .conv-item.active:hover {
          background: color-mix(in oklab, var(--accent) 16%, var(--bg-soft));
        }
        .conv-bar {
          position: absolute; left: 3px; top: 50%;
          transform: translateY(-50%);
          width: 3px; height: 60%; min-height: 16px; max-height: 28px;
          background: var(--accent);
          border-radius: 2px;
        }
        .conv-body {
          flex: 1; min-width: 0;
          display: flex; flex-direction: column; gap: 1px;
        }
        .conv-title {
          font-size: 13px; font-weight: 500;
          color: var(--fg);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          line-height: 1.4;
        }
        .conv-item.active .conv-title {
          font-weight: 600;
          color: var(--fg);
        }
        .conv-when {
          font-size: 10.5px; color: var(--fg-faint);
          line-height: 1;
        }
        .conv-item.active .conv-when {
          color: color-mix(in oklab, var(--accent) 80%, var(--fg-faint));
        }
        .conv-edit, .conv-del {
          appearance: none; border: 0; background: transparent;
          color: var(--fg-faint); padding: 2px; border-radius: 4px;
          display: none; align-items: center; justify-content: center;
          flex: none;
        }
        .conv-item:hover .conv-edit, .conv-item:hover .conv-del { display: flex; }
        .conv-edit:hover { color: var(--fg); background: var(--bg-softer); }
        .conv-del:hover { color: #e05555; background: color-mix(in oklab, #e05555 12%, transparent); }
        .conv-rename {
          flex: 1; min-width: 0;
          background: var(--bg-elev);
          border: 1px solid var(--accent);
          border-radius: 5px;
          color: var(--fg);
          font: inherit; font-size: 13px;
          padding: 2px 6px;
          outline: none;
        }
      `}</style>
    </div>
  );
}

function DocItem({
  doc, active, onToggle, onGetSummary, onDelete,
}: {
  doc: Document;
  active: boolean;
  onToggle: () => void;
  onGetSummary?: (source: string) => Promise<string | null>;
  onDelete?: () => Promise<void>;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  async function handleExpand(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onGetSummary) return;
    setExpanded(v => !v);
    if (!summary && !loading) {
      setLoading(true);
      try {
        const s = await onGetSummary(doc.id);
        setSummary(s);
      } finally {
        setLoading(false);
      }
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onDelete || deleting) return;
    setDeleting(true);
    try { await onDelete(); } finally { setDeleting(false); }
  }

  return (
    <div className="doc-wrap">
      <div className={`ds-doc${active ? ' active' : ''}`} onClick={onToggle}>
        <span className="ds-dot" style={{ background: doc.color }} />
        <div className="ds-main">
          <div className="ds-name" title={doc.name}>{doc.name}</div>
          <div className="ds-sub mono">{doc.chunks} chunks</div>
        </div>
        {onGetSummary && (
          <button className="ds-summ-btn" onClick={handleExpand} title="Summary">
            <Icon.File size={10} />
          </button>
        )}
        {onDelete && (
          <button className="ds-del-btn" onClick={handleDelete} disabled={deleting} title="Delete document">
            <Icon.Trash size={10} />
          </button>
        )}
        <span className={`ds-chk${active ? ' on' : ''}`}>
          {active && <Icon.Check size={10} />}
        </span>
      </div>
      {expanded && (
        <div className="ds-summ-panel">
          {loading ? (
            <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>Loading summary...</span>
          ) : summary ? (
            <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--fg-muted)', margin: 0 }}>{summary}</p>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>No summary available.</span>
          )}
        </div>
      )}
      <style jsx>{`
        .doc-wrap { display: flex; flex-direction: column; }
        .ds-doc {
          display: flex; align-items: center; gap: 9px;
          padding: 6px 8px 6px 10px; border-radius: 7px; cursor: default;
          transition: background 100ms;
        }
        .ds-doc:hover { background: var(--bg-soft); }
        .ds-doc.active { background: var(--bg-soft); }
        .ds-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
        .ds-main { min-width: 0; flex: 1; }
        .ds-name {
          font-size: 13px; font-weight: 500; color: var(--fg);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          line-height: 1.35;
        }
        .ds-sub { font-size: 10.5px; color: var(--fg-faint); margin-top: 1px; }
        .ds-chk {
          width: 14px; height: 14px; border-radius: 4px; flex: none;
          border: 1px solid var(--border-strong);
          display: inline-flex; align-items: center; justify-content: center;
          color: white; transition: background 100ms;
        }
        .ds-chk.on { background: var(--accent); border-color: var(--accent); }
        .ds-summ-btn, .ds-del-btn {
          appearance: none; border: 0; background: transparent; flex: none;
          color: var(--fg-faint); padding: 2px; border-radius: 4px;
          display: none; align-items: center;
        }
        .ds-doc:hover .ds-summ-btn, .ds-doc:hover .ds-del-btn { display: flex; }
        .ds-summ-btn:hover { color: var(--accent); background: var(--accent-soft); }
        .ds-del-btn:hover { color: #e05555; background: color-mix(in oklab, #e05555 12%, transparent); }
        .ds-del-btn:disabled { opacity: 0.5; }
        .ds-summ-panel {
          margin: 2px 10px 6px 26px; padding: 8px 10px;
          background: var(--bg-soft);
          border-left: 2px solid var(--accent-soft);
          border-radius: 0 6px 6px 0;
        }
      `}</style>
    </div>
  );
}

function WorkspaceItem({
  ws, active, onSelect, onRename, onDelete,
}: {
  ws: Workspace;
  active: boolean;
  onSelect: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(ws.name);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  async function commit() {
    const t = draft.trim();
    if (t && t !== ws.name) {
      setBusy(true);
      try { await onRename(t); } catch { /* ignore */ } finally { setBusy(false); }
    }
    setEditing(false);
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    try { await onDelete(); } finally { setBusy(false); }
  }

  return (
    <div className={`ws-item${active ? ' active' : ''}`} onClick={() => { if (!editing) onSelect(); }}>
      {active && <span className="ws-item-bar" />}
      {editing ? (
        <input
          ref={inputRef}
          className="ws-item-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          onClick={e => e.stopPropagation()}
          disabled={busy}
        />
      ) : (
        <>
          <span className="ws-item-dot" />
          <span className="ws-item-name">{ws.name}</span>
          {active && <Icon.Check size={10} />}
          <button className="ws-item-edit" onClick={e => { e.stopPropagation(); setDraft(ws.name); setEditing(true); }} title="Rename">
            <Icon.Pencil size={10} />
          </button>
          <button className="ws-item-del" onClick={handleDelete} title="Delete" disabled={busy}>
            <Icon.Trash size={10} />
          </button>
        </>
      )}
      <style jsx>{`
        .ws-item {
          position: relative; display: flex; align-items: center; gap: 6px;
          padding: 6px 8px 6px 12px; border-radius: 7px; cursor: default;
          transition: background 100ms; min-width: 0;
        }
        .ws-item:hover { background: var(--bg-soft); }
        .ws-item.active { background: color-mix(in oklab, var(--accent) 12%, var(--bg-soft)); }
        .ws-item-bar {
          position: absolute; left: 3px; top: 50%; transform: translateY(-50%);
          width: 3px; height: 60%; min-height: 14px; max-height: 24px;
          background: var(--accent); border-radius: 2px;
        }
        .ws-item-dot {
          width: 7px; height: 7px; border-radius: 50%; flex: none;
          background: var(--border-strong);
        }
        .ws-item.active .ws-item-dot { background: var(--accent); }
        .ws-item-name {
          flex: 1; font-size: 13px; font-weight: 500; color: var(--fg-muted);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .ws-item.active .ws-item-name { color: var(--fg); font-weight: 600; }
        .ws-item :global(svg) { color: var(--accent); flex: none; }
        .ws-item-edit, .ws-item-del {
          appearance: none; border: 0; background: transparent;
          color: var(--fg-faint); padding: 2px; border-radius: 4px;
          display: none; align-items: center; justify-content: center; flex: none;
        }
        .ws-item:hover .ws-item-edit, .ws-item:hover .ws-item-del { display: flex; }
        .ws-item-edit:hover { color: var(--fg); background: var(--bg-softer); }
        .ws-item-del:hover { color: #e05555; background: color-mix(in oklab, #e05555 12%, transparent); }
        .ws-item-input {
          flex: 1; min-width: 0; background: var(--bg-elev);
          border: 1px solid var(--accent); border-radius: 5px;
          color: var(--fg); font: inherit; font-size: 13px;
          padding: 2px 6px; outline: none;
        }
      `}</style>
    </div>
  );
}

export default function DocsSidebar({
  docs, activeDocs, toggleDoc, onUpload,
  conversations, activeConvId, onNewConversation, onSelectConversation, onRenameConversation, onDeleteConversation,
  username, onLogout, workspaceName, onGetSummary,
  workspaces, activeWorkspaceId, onWorkspaceChange,
  onCreateWorkspace, onRenameWorkspace, onDeleteWorkspace, onDeleteDoc,
}: DocsSidebarProps) {
  const [docFilter, setDocFilter] = React.useState('');
  const [creatingWs, setCreatingWs] = React.useState(false);
  const [newWsName, setNewWsName] = React.useState('');
  const newWsRef = React.useRef<HTMLInputElement>(null);
  const filtered = docFilter
    ? docs.filter(d => d.name.toLowerCase().includes(docFilter.toLowerCase()))
    : docs;

  React.useEffect(() => { if (creatingWs) newWsRef.current?.focus(); }, [creatingWs]);

  async function submitNewWs() {
    const name = newWsName.trim();
    if (name && onCreateWorkspace) {
      await onCreateWorkspace(name);
    }
    setNewWsName('');
    setCreatingWs(false);
  }

  return (
    <aside className="docs-sidebar scroll">

      {/* Workspace switcher + CRUD */}
      {workspaces !== undefined && (
        <div className="ds-section">
          <div className="ds-h">
            <span>Workspaces</span>
            {onCreateWorkspace && (
              <button className="ds-new-conv" onClick={() => setCreatingWs(true)} title="New workspace">
                <Icon.Plus size={12} />
              </button>
            )}
          </div>
          <div className="ws-switch-list">
            {(workspaces ?? []).map(ws => (
              <WorkspaceItem
                key={ws.id}
                ws={ws}
                active={ws.id === activeWorkspaceId}
                onSelect={() => onWorkspaceChange?.(ws.id)}
                onRename={async (name) => { if (onRenameWorkspace) await onRenameWorkspace(ws.id, name); }}
                onDelete={async () => { if (onDeleteWorkspace) await onDeleteWorkspace(ws.id); }}
              />
            ))}
            {creatingWs && (
              <div className="ws-new-row">
                <input
                  ref={newWsRef}
                  className="ws-new-input"
                  placeholder="Workspace name…"
                  value={newWsName}
                  onChange={e => setNewWsName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitNewWs(); if (e.key === 'Escape') { setCreatingWs(false); setNewWsName(''); } }}
                  onBlur={() => { if (!newWsName.trim()) { setCreatingWs(false); } }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Documents */}
      <div className="ds-section">
        {workspaceName && (
          <div className="ws-badge">
            <span className="ws-dot" />
            {workspaceName}
          </div>
        )}
        <div className="ds-h">
          <span>Documents</span>
          <span className="mono ds-h-meta">
            {docFilter && filtered.length !== docs.length ? `${filtered.length}/${docs.length}` : docs.length}
          </span>
        </div>

        {docs.length > 0 && (
          <div className="ds-filter">
            <Icon.Search size={12} />
            <input
              className="ds-filter-input"
              placeholder="Filter by name…"
              value={docFilter}
              onChange={e => setDocFilter(e.target.value)}
            />
            {docFilter && (
              <button className="ds-filter-clear" onClick={() => setDocFilter('')} title="Clear">
                <Icon.Close size={10} />
              </button>
            )}
          </div>
        )}

        {docs.length === 0 ? (
          <button className="ds-empty-btn" onClick={onUpload}>
            <Icon.Upload size={12} /> Upload first document
          </button>
        ) : filtered.length === 0 ? (
          <div className="ds-no-match">No documents match &ldquo;{docFilter}&rdquo;</div>
        ) : (
          filtered.map(d => (
            <DocItem
              key={d.id}
              doc={d}
              active={activeDocs.includes(d.id)}
              onToggle={() => toggleDoc(d.id)}
              onGetSummary={onGetSummary}
              onDelete={onDeleteDoc ? () => onDeleteDoc(d) : undefined}
            />
          ))
        )}
        <button className="ds-add-btn" onClick={onUpload}>
          <Icon.Plus size={12} /> Add documents
        </button>
      </div>

      {/* Conversations */}
      <div className="ds-section ds-convs">
        <div className="ds-h">
          <span>Conversations</span>
          <button className="ds-new-conv" onClick={onNewConversation} title="New conversation">
            <Icon.Plus size={12} />
          </button>
        </div>
        {conversations.map(conv => (
          <ConvItem
            key={conv.id}
            conv={conv}
            active={conv.id === activeConvId}
            onSelect={() => onSelectConversation(conv.id)}
            onRename={title => onRenameConversation(conv.id, title)}
            onDelete={() => onDeleteConversation(conv.id)}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="ds-foot">
        <div className="ds-foot-user">
          <div className="ds-avatar">{username.slice(0, 2).toUpperCase()}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="ds-foot-name">{username}</div>
            <div className="ds-foot-sub mono">{docs.length} doc{docs.length !== 1 ? 's' : ''} indexed</div>
          </div>
          <button className="icon-btn" onClick={onLogout} title="Sign out">
            <Icon.LogOut size={13} />
          </button>
        </div>
      </div>

      <style jsx>{`
        .docs-sidebar {
          border-right: 1px solid var(--border);
          padding: 10px 8px;
          display: flex; flex-direction: column; gap: 6px;
          min-height: 0;
          background: var(--bg-elev);
        }

        .ds-section { display: flex; flex-direction: column; gap: 1px; padding-bottom: 6px; }
        .ds-convs { flex: 1; min-height: 0; overflow: hidden; }

        .ds-h {
          font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase;
          color: var(--fg-faint); font-weight: 600;
          padding: 6px 10px 4px;
          display: flex; justify-content: space-between; align-items: center;
        }
        .ds-h-meta { font-size: 10px; text-transform: none; letter-spacing: 0; }

        .ds-new-conv {
          appearance: none; border: 1px solid var(--border-strong);
          background: var(--bg-soft); color: var(--fg-muted);
          width: 20px; height: 20px; border-radius: 5px;
          display: grid; place-items: center;
        }
        .ds-new-conv:hover { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }

        .ds-add-btn {
          appearance: none; border: 1px dashed var(--border-strong);
          background: transparent; color: var(--fg-faint);
          width: 100%; height: 28px; border-radius: 7px; margin-top: 4px;
          font: inherit; font-size: 12px; cursor: default;
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          transition: all 100ms;
        }
        .ds-add-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); border-style: solid; }

        .ds-filter {
          display: flex; align-items: center; gap: 6px;
          padding: 0 8px; height: 28px; margin: 2px 0 4px;
          background: var(--bg-soft); border: 1px solid var(--border);
          border-radius: 6px; color: var(--fg-faint);
          transition: border-color 120ms;
        }
        .ds-filter:focus-within { border-color: var(--border-strong); color: var(--fg-muted); }
        .ds-filter-input {
          flex: 1; min-width: 0; border: 0; outline: 0;
          background: transparent; font: inherit; font-size: 12px; color: var(--fg);
        }
        .ds-filter-input::placeholder { color: var(--fg-faint); }
        .ds-filter-clear {
          appearance: none; border: 0; background: transparent;
          color: var(--fg-faint); padding: 0; display: flex; align-items: center;
        }
        .ds-filter-clear:hover { color: var(--fg); }
        .ds-no-match {
          font-size: 12px; color: var(--fg-faint); text-align: center;
          padding: 8px 4px; font-style: italic;
        }
        .ds-empty-btn {
          appearance: none; border: 1px dashed var(--border);
          background: transparent; color: var(--fg-faint);
          width: 100%; height: 32px; border-radius: 7px;
          font: inherit; font-size: 12.5px; cursor: default;
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          margin-bottom: 4px;
        }
        .ds-empty-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); border-style: solid; }


        .ws-switch-list { display: flex; flex-direction: column; gap: 2px; }
        .ws-new-row { padding: 2px 8px; }
        .ws-new-input {
          width: 100%; background: var(--bg-elev);
          border: 1px solid var(--accent); border-radius: 6px;
          color: var(--fg); font: inherit; font-size: 13px;
          padding: 4px 8px; outline: none;
        }

        .ws-badge {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 11px; font-weight: 600; color: var(--accent);
          background: var(--accent-soft); border-radius: 6px;
          padding: 3px 8px; margin: 0 10px 4px; letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .ws-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }

        .ds-foot { margin-top: auto; padding-top: 8px; border-top: 1px solid var(--border); }
        .ds-foot-user { display: flex; align-items: center; gap: 8px; padding: 5px 4px; }
        .ds-avatar {
          width: 28px; height: 28px; border-radius: 50%; flex: none;
          background: linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 40%, #000));
          color: white; display: grid; place-items: center;
          font-size: 10px; font-weight: 700; letter-spacing: 0.02em;
        }
        .ds-foot-name {
          font-size: 13px; font-weight: 600; color: var(--fg);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .ds-foot-sub { font-size: 10.5px; color: var(--fg-faint); margin-top: 1px; }
      `}</style>
    </aside>
  );
}
