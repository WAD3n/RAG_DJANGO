'use client';

import React from 'react';
import * as Icon from '../components/icons';
import Login from '../components/login';
import Chat from '../components/chat';
import { getWorkspaces, loadToken, logout } from '../lib/api';
import type { Workspace } from '../lib/types';

type Screen = 'login' | 'chat';

export default function Page() {
  const [screen, setScreen] = React.useState<Screen>('login');
  const [username, setUsername] = React.useState('');
  const [dark, setDark] = React.useState(true);
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<number | null>(null);

  function applyWorkspaces(ws: Workspace[]) {
    setWorkspaces(ws);
    if (ws.length > 0) setActiveWorkspaceId(ws[0].id);
  }

  React.useEffect(() => {
    const token = loadToken();
    if (token) {
      const saved = typeof window !== 'undefined'
        ? (localStorage.getItem('ragflow_username') || '')
        : '';
      setUsername(saved);
      getWorkspaces().then(applyWorkspaces).catch(() => {});
      setScreen('chat');
    }
  }, []);

  function handleLogin(name: string) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('ragflow_username', name);
    }
    setUsername(name);
    getWorkspaces().then(applyWorkspaces).catch(() => {});
    setScreen('chat');
  }

  async function handleLogout() {
    await logout();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ragflow_username');
    }
    setUsername('');
    setWorkspaces([]);
    setActiveWorkspaceId(null);
    setScreen('login');
  }

  function handleWorkspacesChange(ws: Workspace[]) {
    setWorkspaces(ws);
    if (!ws.find(w => w.id === activeWorkspaceId) && ws.length > 0) {
      setActiveWorkspaceId(ws[0].id);
    }
  }

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);

  return (
    <div className={`app theme-${dark ? 'dark' : 'light'} density-regular`}>
      <header className="topbar">
        <div className="spacer" />

        <button className="icon-btn" onClick={() => setDark(d => !d)} title="Toggle theme">
          {dark ? <Icon.Sun size={14} /> : <Icon.Moon size={14} />}
        </button>
      </header>

      {screen === 'login' && <Login onLogin={handleLogin} />}
      {screen === 'chat' && (
        <Chat
          username={username}
          onLogout={handleLogout}
          sidebarPosition="left"
          citationStyle="numbered"
          workspaceId={activeWorkspaceId}
          workspaceName={activeWorkspace?.name}
          workspaces={workspaces}
          onWorkspaceChange={setActiveWorkspaceId}
          onWorkspacesChange={handleWorkspacesChange}
        />
      )}

      <style jsx global>{`
        .app {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: var(--bg);
        }
      `}</style>
    </div>
  );
}
