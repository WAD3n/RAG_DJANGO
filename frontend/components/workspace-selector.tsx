'use client';

import React from 'react';
import type { Workspace } from '../lib/types';

interface WorkspaceSelectorProps {
  workspaces: Workspace[];
  activeId: number | null;
  onSelect: (id: number) => void;
}

export default function WorkspaceSelector({ workspaces, activeId, onSelect }: WorkspaceSelectorProps) {
  if (workspaces.length === 0) {
    return (
      <div className="ws-empty">
        <span>No workspaces assigned. Contact your administrator.</span>
        <style jsx>{`.ws-empty { padding: 32px; text-align: center; color: var(--fg-muted); font-size: 14px; }`}</style>
      </div>
    );
  }

  return (
    <div className="ws-selector">
      <div className="ws-title">Select workspace</div>
      <div className="ws-list">
        {workspaces.map(ws => (
          <button
            key={ws.id}
            className={`ws-item${ws.id === activeId ? ' active' : ''}`}
            onClick={() => onSelect(ws.id)}
          >
            <div className="ws-name">{ws.name}</div>
            <div className="ws-meta mono">{ws.member_count} members</div>
          </button>
        ))}
      </div>
      <style jsx>{`
        .ws-selector { padding: 32px 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
        .ws-title { font-size: 16px; font-weight: 600; color: var(--fg); }
        .ws-list { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 360px; }
        .ws-item {
          appearance: none; border: 1.5px solid var(--border-strong);
          background: var(--bg-elev); border-radius: 10px;
          padding: 14px 16px; text-align: left; cursor: default;
          transition: border-color 120ms, background 120ms;
          display: flex; flex-direction: column; gap: 3px;
        }
        .ws-item:hover { border-color: var(--accent); background: var(--accent-soft); }
        .ws-item.active { border-color: var(--accent); background: color-mix(in oklab, var(--accent) 10%, var(--bg-elev)); }
        .ws-name { font-size: 14px; font-weight: 600; color: var(--fg); }
        .ws-meta { font-size: 11.5px; color: var(--fg-muted); }
      `}</style>
    </div>
  );
}
