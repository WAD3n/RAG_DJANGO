'use client';

import React from 'react';
import * as Icon from '../components/icons';
import Landing from '../components/landing';
import Upload from '../components/upload';
import Chat from '../components/chat';
import type { UploadedFile, Document } from '../lib/types';

type Screen = 'landing' | 'upload' | 'chat';
type Density = 'compact' | 'regular' | 'comfy';
type CitationStyle = 'numbered' | 'pill' | 'underline';

const DOC_COLORS = ['#d97757', '#6b8af0', '#5b8c6a', '#c4884f', '#9a6cc4', '#4aa8d8', '#c45b5b'];

export default function Page() {
  const [screen, setScreen] = React.useState<Screen>('landing');
  const [dark, setDark] = React.useState(true);
  const [density] = React.useState<Density>('regular');
  const [citationStyle] = React.useState<CitationStyle>('numbered');
  const [sidebarPosition] = React.useState<'left' | 'right'>('left');
  const [accent] = React.useState('#d97757');
  const [docs, setDocs] = React.useState<Document[]>([]);
  const [projectName] = React.useState('New Project');

  function handleUploadComplete(uploadedFiles: UploadedFile[]) {
    const newDocs: Document[] = uploadedFiles
      .filter(f => f.status === 'ready')
      .map((f, i) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        size: f.sizeMB < 1 ? `${Math.round(f.sizeMB * 1024)} KB` : `${f.sizeMB.toFixed(1)} MB`,
        pages: f.pages || 0,
        chunks: f.chunks,
        color: DOC_COLORS[i % DOC_COLORS.length],
        objectName: f.objectName,
      }));
    setDocs(newDocs);
    setScreen('chat');
  }

  const themeClass = dark ? 'theme-dark' : 'theme-light';
  const densityClass = `density-${density}`;

  return (
    <div
      className={`app ${themeClass} ${densityClass}`}
      style={{ '--accent': accent } as React.CSSProperties}
    >
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">R</div>
          RAGFLOW
        </div>
        {screen !== 'landing' && (
          <div className="crumbs">
            <span className="sep">/</span>
            <span style={{ color: 'var(--fg)' }}>{projectName}</span>
          </div>
        )}

        <div className="spacer" />

        {screen !== 'landing' && (
          <button className="btn ghost sm" onClick={() => setScreen('landing')}>
            <Icon.Plus size={12} /> New project
          </button>
        )}
        <button className="icon-btn" onClick={() => setDark(d => !d)} title="Toggle theme">
          {dark ? <Icon.Sun size={14} /> : <Icon.Moon size={14} />}
        </button>
      </header>

      {screen === 'landing' && <Landing onStart={() => setScreen('upload')} />}
      {screen === 'upload' && (
        <Upload onComplete={handleUploadComplete} />
      )}
      {screen === 'chat' && (
        <Chat
          docs={docs}
          sidebarPosition={sidebarPosition}
          citationStyle={citationStyle}
          onNewProject={() => setScreen('landing')}
        />
      )}

      <ScreenJumper screen={screen} setScreen={setScreen} />

      <style jsx global>{`
        .app { min-height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
      `}</style>
    </div>
  );
}

function ScreenJumper({ screen, setScreen }: { screen: Screen; setScreen: (s: Screen) => void }) {
  return (
    <div className="screen-jumper">
      {([
        { id: 'landing' as Screen, label: '1 · Landing' },
        { id: 'upload' as Screen, label: '2 · Upload' },
        { id: 'chat' as Screen, label: '3 · Chat' },
      ]).map(s => (
        <button
          key={s.id}
          className={`sj-btn${screen === s.id ? ' active' : ''}`}
          onClick={() => setScreen(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
