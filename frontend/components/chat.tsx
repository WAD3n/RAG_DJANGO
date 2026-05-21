'use client';

import React from 'react';
import * as Icon from './icons';
import Message, { citationStyles } from './message';
import SourcesPanel from './sources-panel';
import DocsSidebar from './docs-sidebar';
import { queryDocuments } from '../lib/api';
import type { ChatMessage, Citation, Document } from '../lib/types';

const DOC_COLORS = ['#d97757', '#6b8af0', '#5b8c6a', '#c4884f', '#9a6cc4', '#4aa8d8', '#c45b5b'];

interface ChatProps {
  docs: Document[];
  sidebarPosition: 'left' | 'right';
  citationStyle: 'numbered' | 'pill' | 'underline';
  onNewProject: () => void;
}

const INITIAL_COLLECTIONS = [
  { id: 'c1', name: 'Current Project', count: 0, active: true },
];

const INITIAL_HISTORY = [
  { id: 'h1', title: 'New conversation', when: 'just now', active: true },
];

const SUGGESTIONS = [
  'Podsumuj główne punkty',
  'Jakie są kluczowe wnioski?',
  'Wyjaśnij szczegółowo',
  'Porównaj dokumenty',
];

export default function Chat({ docs, sidebarPosition, citationStyle, onNewProject }: ChatProps) {
  const [thread, setThread] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const [activeCite, setActiveCite] = React.useState<{ msgIdx: number; citeId: number }>({ msgIdx: -1, citeId: -1 });
  const [activeDocs, setActiveDocs] = React.useState<string[]>(docs.map(d => d.id));
  const [showHistory, setShowHistory] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread, streaming]);

  const activeMsg = thread[activeCite.msgIdx];
  const activeCitation = activeMsg?.citations?.find(c => c.id === activeCite.citeId);

  function toggleDoc(id: string) {
    setActiveDocs(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || streaming) return;

    const question = input.trim();
    const userMsg: ChatMessage = { role: 'user', content: question };
    setThread(t => [...t, userMsg]);
    setInput('');
    setStreaming(true);

    const placeholderIdx = thread.length + 1;
    const placeholder: ChatMessage = { role: 'assistant', content: '' };
    setThread(t => [...t, placeholder]);

    try {
      const start = Date.now();
      const result = await queryDocuments(question);
      const durationMs = Date.now() - start;

      // Map backend context hits to citations
      const citations: Citation[] = result.context.map((hit, i) => {
        const sourceName = hit.source?.split('/').pop()?.replace(/\.md$/, '') || `source_${i + 1}`;
        const doc = docs.find(d =>
          d.name.replace(/\.[^.]+$/, '') === sourceName ||
          d.objectName === hit.source
        );
        return {
          id: i + 1,
          doc: doc?.id || `d-${i}`,
          passage: hit.text.slice(0, 240),
          score: hit.score,
        };
      });

      // Stream the answer character by character for effect
      const fullAnswer = result.answer;
      let charIdx = 0;
      const tick = () => {
        charIdx += 3 + Math.floor(Math.random() * 4);
        const piece = fullAnswer.slice(0, Math.min(charIdx, fullAnswer.length));
        setThread(t => {
          const copy = [...t];
          copy[copy.length - 1] = { role: 'assistant', content: piece, citations, durationMs };
          return copy;
        });
        if (charIdx < fullAnswer.length) {
          setTimeout(tick, 20);
        } else {
          setStreaming(false);
          setActiveCite({ msgIdx: placeholderIdx, citeId: citations[0]?.id ?? -1 });
        }
      };
      setTimeout(tick, 100);
    } catch (err) {
      setThread(t => {
        const copy = [...t];
        copy[copy.length - 1] = {
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          citations: [],
        };
        return copy;
      });
      setStreaming(false);
    }
  }

  const docsLeft = sidebarPosition !== 'right';

  return (
    <div className={`chat-screen sidebar-${sidebarPosition}`}>
      <style>{citationStyles}</style>

      {docsLeft && (
        <DocsSidebar
          docs={docs} collections={INITIAL_COLLECTIONS} history={INITIAL_HISTORY}
          showHistory={showHistory} setShowHistory={setShowHistory}
          activeDocs={activeDocs} toggleDoc={toggleDoc} onNewProject={onNewProject}
        />
      )}

      <main className="cv-main">
        <div className="cv-toolbar">
          <div className="cv-toolbar-l">
            <button className="icon-btn" title="Pin"><Icon.Pin size={14} /></button>
            <div className="cv-title">
              <span style={{ fontWeight: 600 }}>
                {thread.length ? thread.find(m => m.role === 'user')?.content?.slice(0, 40) + '…' : 'New conversation'}
              </span>
              {docs.length > 0 && (
                <span className="tag accent" style={{ marginLeft: 8 }}>
                  <Icon.Folder size={11} /> {docs.length} docs
                </span>
              )}
            </div>
          </div>
          <div className="cv-toolbar-r">
            <button className="btn ghost sm"><Icon.Export size={12} /> Export</button>
            <button className="icon-btn"><Icon.More size={14} /></button>
          </div>
        </div>

        <div className="cv-thread scroll" ref={scrollRef}>
          {thread.length === 0 && (
            <div className="cv-empty">
              <div className="cv-empty-icon">
                <Icon.Logo size={28} />
              </div>
              <div className="cv-empty-title">Ask about your documents</div>
              <div className="cv-empty-sub muted">
                {docs.length > 0
                  ? `${docs.length} document${docs.length !== 1 ? 's' : ''} indexed and ready`
                  : 'Upload documents first to start asking questions'}
              </div>
              {docs.length > 0 && (
                <div className="cv-empty-docs">
                  {docs.map(d => (
                    <span key={d.id} className="tag" style={{ fontSize: 11 }}>
                      <span className="dot" style={{ background: d.color, width: 6, height: 6, borderRadius: '50%', display: 'inline-block' }} />
                      {d.name.split('.')[0]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {thread.map((m, i) => (
            <Message
              key={i} msg={m} idx={i}
              activeCite={activeCite} setActiveCite={setActiveCite}
              citationStyle={citationStyle} docs={docs}
            />
          ))}
          {streaming && thread.length > 0 && thread[thread.length - 1].content === '' && (
            <div className="cv-streaming muted">
              <span className="spin" /> retrieving passages · synthesizing answer
            </div>
          )}
        </div>

        <form className="cv-composer" onSubmit={handleSend}>
          <div className="cv-comp-row">
            <button type="button" className="icon-btn" title="Attach"><Icon.Plus size={14} /></button>
            <input
              className="cv-input"
              placeholder={docs.length > 0 ? `Ask anything about your ${docs.length} document${docs.length !== 1 ? 's' : ''}…` : 'Upload documents first…'}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={docs.length === 0 || streaming}
            />
            <div className="cv-comp-tools">
              <span className="tag" title="Active docs"><Icon.Layers size={11} /> {activeDocs.length}/{docs.length}</span>
              <button
                type="submit"
                className={`btn accent sm${!input.trim() ? ' is-empty' : ''}`}
                disabled={streaming || !input.trim() || docs.length === 0}
              >
                <Icon.Send size={12} /> Ask
              </button>
            </div>
          </div>
          <div className="cv-suggest">
            {SUGGESTIONS.map(s => (
              <button key={s} type="button" className="suggest-chip" onClick={() => setInput(s)}>
                <Icon.Sparkle size={11} /> {s}
              </button>
            ))}
          </div>
        </form>
      </main>

      <SourcesPanel
        msg={activeMsg}
        activeCite={activeCite}
        setActiveCite={setActiveCite}
        docs={docs}
        activeCitation={activeCitation}
      />

      {!docsLeft && (
        <DocsSidebar
          docs={docs} collections={INITIAL_COLLECTIONS} history={INITIAL_HISTORY}
          showHistory={showHistory} setShowHistory={setShowHistory}
          activeDocs={activeDocs} toggleDoc={toggleDoc} onNewProject={onNewProject}
        />
      )}

      <style jsx>{`
        .chat-screen {
          display: grid;
          grid-template-columns: 260px minmax(0, 1fr) 360px;
          height: calc(100vh - 52px);
          background: var(--bg);
        }
        .chat-screen.sidebar-right {
          grid-template-columns: 360px minmax(0, 1fr) 260px;
        }
        .chat-screen.sidebar-right :global(.docs-sidebar) {
          order: 3; border-right: 0; border-left: 1px solid var(--border);
        }

        .cv-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg); }
        .cv-toolbar {
          height: 48px; flex: none;
          display: flex; justify-content: space-between; align-items: center;
          padding: 0 16px; border-bottom: 1px solid var(--border); gap: 10px;
        }
        .cv-toolbar-l, .cv-toolbar-r { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .cv-title {
          display: flex; align-items: center; gap: 8px; min-width: 0;
          font-size: 14px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
        }

        .cv-thread { flex: 1; padding: 28px 12% 24px; min-height: 0; display: flex; flex-direction: column; gap: 22px; }
        .cv-empty {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 12px; padding: 40px 24px; text-align: center;
          color: var(--fg-muted);
        }
        .cv-empty-icon {
          width: 56px; height: 56px; border-radius: var(--radius-lg);
          background: var(--bg-soft); border: 1px solid var(--border);
          display: grid; place-items: center; color: var(--fg-faint);
        }
        .cv-empty-title { font-size: 16px; font-weight: 600; color: var(--fg); }
        .cv-empty-sub { font-size: 13px; }
        .cv-empty-docs { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 8px; }

        .cv-streaming {
          font-size: 12px; display: flex; align-items: center; gap: 8px;
          padding: 8px 12px; align-self: flex-start;
          background: var(--bg-soft); border-radius: 999px;
        }

        .cv-composer { flex: none; padding: 14px 12% 18px; border-top: 1px solid var(--border); background: var(--bg); }
        .cv-comp-row {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 8px 6px 6px;
          background: var(--bg-elev); border: 1px solid var(--border-strong);
          border-radius: 12px; box-shadow: var(--shadow-card);
          transition: border-color 120ms;
        }
        .cv-comp-row:focus-within { border-color: var(--accent); }
        .cv-input {
          flex: 1; min-width: 0; height: 30px;
          border: 0; outline: 0; background: transparent;
          font-family: inherit; font-size: 14px; color: var(--fg); padding: 0 4px;
        }
        .cv-input::placeholder { color: var(--fg-faint); }
        .cv-input:disabled { cursor: not-allowed; }
        .cv-comp-tools { display: flex; align-items: center; gap: 6px; }

        .cv-suggest { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
        .suggest-chip {
          appearance: none; border: 1px solid var(--border);
          background: var(--bg-elev); color: var(--fg-muted);
          padding: 0 10px; height: 26px; border-radius: 6px;
          cursor: default; font-family: inherit; font-size: 12px;
          display: inline-flex; align-items: center; gap: 6px;
        }
        .suggest-chip:hover { background: var(--bg-soft); color: var(--fg); }
        .suggest-chip :global(svg) { color: var(--accent); }

        @media (max-width: 1280px) {
          .chat-screen, .chat-screen.sidebar-right {
            grid-template-columns: 240px minmax(0, 1fr) 300px;
          }
          .cv-thread, .cv-composer { padding-left: 6%; padding-right: 6%; }
        }
        @media (max-width: 900px) {
          .chat-screen, .chat-screen.sidebar-right {
            grid-template-columns: minmax(0, 1fr);
          }
          :global(.docs-sidebar), :global(.sources-panel) { display: none; }
        }
      `}</style>
    </div>
  );
}

export { DOC_COLORS };
