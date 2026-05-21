'use client';

import React from 'react';
import * as Icon from '../components/icons';
import Login from '../components/login';
import Chat from '../components/chat';
import { loadToken, logout } from '../lib/api';

type Screen = 'login' | 'chat';

export default function Page() {
  const [screen, setScreen] = React.useState<Screen>('login');
  const [username, setUsername] = React.useState('');
  const [dark, setDark] = React.useState(true);

  React.useEffect(() => {
    const token = loadToken();
    if (token) {
      const saved = typeof window !== 'undefined'
        ? (localStorage.getItem('ragflow_username') || '')
        : '';
      setUsername(saved);
      setScreen('chat');
    }
  }, []);

  function handleLogin(name: string) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('ragflow_username', name);
    }
    setUsername(name);
    setScreen('chat');
  }

  async function handleLogout() {
    await logout();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ragflow_username');
    }
    setUsername('');
    setScreen('login');
  }

  return (
    <div className={`app theme-${dark ? 'dark' : 'light'} density-regular`}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">R</div>
          RAGFLOW
        </div>

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
