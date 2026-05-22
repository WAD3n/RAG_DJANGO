'use client';

import React from 'react';
import * as Icon from './icons';
import Message, { citationStyles } from './message';
import SourcesPanel from './sources-panel';
import DocsSidebar, { type Conversation } from './docs-sidebar';
import Upload from './upload';
import {
  addMessages, createConversation, deleteConversationApi,
  getConversations, getDocuments, getMessages, getModels, queryDocuments, renameConversationApi,
} from '../lib/api';
import type { ChatMessage, Citation, Document, DocumentInfo, UploadedFile } from '../lib/types';

const DOC_COLORS = ['#d97757', '#6b8af0', '#5b8c6a', '#c4884f', '#9a6cc4', '#4aa8d8', '#c45b5b'];

interface ChatProps {
  username: string;
  onLogout: () => void;
  sidebarPosition: 'left' | 'right';
  citationStyle: 'numbered' | 'pill' | 'underline';
}

const SUGGESTIONS = [
  'Podsumuj główne punkty',
  'Jakie są kluczowe wnioski?',
  'Wyjaśnij szczegółowo',
  'Porównaj dokumenty',
];

function makeConv(title = 'New conversation'): Conversation {
  return { id: `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`, title, createdAt: Date.now(), messageCount: 0 };
}

export default function Chat({ username, onLogout, sidebarPosition, citationStyle }: ChatProps) {
  const [docs, setDocs] = React.useState<Document[]>([]);
  const [docsLoading, setDocsLoading] = React.useState(true);
  const [activeDocs, setActiveDocs] = React.useState<string[]>([]);

  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = React.useState('');
  const [threads, setThreads] = React.useState<Record<string, ChatMessage[]>>({});
  const [convsLoading, setConvsLoading] = React.useState(true);

  const [input, setInput] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const [activeCite, setActiveCite] = React.useState<{ msgIdx: number; citeId: number }>({ msgIdx: -1, citeId: -1 });
  const [showUpload, setShowUpload] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const [availableModels, setAvailableModels] = React.useState<string[]>([]);
  const [activeModel, setActiveModel] = React.useState<string>('');
  const [modelBackend, setModelBackend] = React.useState<string>('');
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
  const modelMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    getModels().then(data => {
      setAvailableModels(data.models);
      setActiveModel(data.active);
      setModelBackend(data.backend);
    }).catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!modelMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [modelMenuOpen]);

  const thread = threads[activeConvId] ?? [];
  const activeConv = conversations.find(c => c.id === activeConvId)!;

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread, streaming]);

  const loadDocuments = React.useCallback(async () => {
    try {
      const infos = await getDocuments();
      const loaded: Document[] = infos.map((info: DocumentInfo, i: number) => ({
        id: info.source,
        name: info.original_ext ? `${info.name}.${info.original_ext}` : info.name,
        type: info.original_ext || 'md',
        size: 'indexed',
        pages: 0,
        chunks: info.chunks,
        color: DOC_COLORS[i % DOC_COLORS.length],
        objectName: info.original_key,
      }));
      setDocs(loaded);
      setActiveDocs(loaded.map(d => d.id));
    } catch (err) {
      console.warn('Failed to load documents:', err);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  React.useEffect(() => { loadDocuments(); }, [loadDocuments]);

  // ── Conversation helpers ──────────────────────────────────────────────────

  function backendId(id: string): number | null {
    const n = Number(id);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function convFromRecord(r: { id: number; title: string; created_at: string; message_count: number }): Conversation {
    return { id: String(r.id), title: r.title, createdAt: new Date(r.created_at).getTime(), messageCount: r.message_count };
  }

  async function loadMessagesForConv(id: string) {
    const bid = backendId(id);
    if (bid === null) return;
    try {
      const msgs = await getMessages(bid);
      const chatMsgs: ChatMessage[] = msgs.map(m => ({
        role: m.role,
        content: m.content,
        citations: m.citations ?? [],
        durationMs: m.duration_ms ?? undefined,
      }));
      setThreads(prev => ({ ...prev, [id]: chatMsgs }));
    } catch (err) {
      console.warn('Failed to load messages:', err);
    }
  }

  React.useEffect(() => {
    (async () => {
      try {
        const records = await getConversations();
        if (records.length === 0) {
          const rec = await createConversation();
          const conv = convFromRecord(rec);
          setConversations([conv]);
          setActiveConvId(conv.id);
        } else {
          const convs = records.map(convFromRecord);
          setConversations(convs);
          setActiveConvId(convs[0].id);
          await loadMessagesForConv(convs[0].id);
        }
      } catch {
        const conv = makeConv();
        setConversations([conv]);
        setActiveConvId(conv.id);
      } finally {
        setConvsLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateThread(convId: string, updater: (prev: ChatMessage[]) => ChatMessage[]) {
    setThreads(prev => ({ ...prev, [convId]: updater(prev[convId] ?? []) }));
  }

  async function newConversation() {
    try {
      const rec = await createConversation();
      const conv = convFromRecord(rec);
      setConversations(prev => [conv, ...prev]);
      setActiveConvId(conv.id);
      setActiveCite({ msgIdx: -1, citeId: -1 });
    } catch {
      const conv = makeConv();
      setConversations(prev => [conv, ...prev]);
      setActiveConvId(conv.id);
      setActiveCite({ msgIdx: -1, citeId: -1 });
    }
  }

  async function selectConversation(id: string) {
    setActiveConvId(id);
    setActiveCite({ msgIdx: -1, citeId: -1 });
    if (!threads[id]) await loadMessagesForConv(id);
  }

  function renameConversation(id: string, title: string) {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
    const bid = backendId(id);
    if (bid !== null) renameConversationApi(bid, title).catch(() => {});
  }

  function deleteConversation(id: string) {
    const bid = backendId(id);
    if (bid !== null) deleteConversationApi(bid).catch(() => {});

    const wasActive = activeConvId === id;
    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== id);
      if (filtered.length === 0) {
        const newConv = makeConv();
        if (wasActive) { setActiveConvId(newConv.id); setActiveCite({ msgIdx: -1, citeId: -1 }); }
        return [newConv];
      }
      if (wasActive) { setActiveConvId(filtered[0].id); setActiveCite({ msgIdx: -1, citeId: -1 }); }
      return filtered;
    });
    setThreads(prev => { const copy = { ...prev }; delete copy[id]; return copy; });
  }

  function toggleDoc(id: string) {
    setActiveDocs(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  }

  async function handleUploadComplete(_files: UploadedFile[]) {
    setShowUpload(false);
    await loadDocuments();
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || streaming) return;

    const question = input.trim();
    const convId = activeConvId;

    // Auto-title from first message
    if ((threads[convId] ?? []).length === 0) {
      const autoTitle = question.length > 48 ? question.slice(0, 48) + '…' : question;
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: autoTitle } : c));
      const bid = backendId(convId);
      if (bid !== null) renameConversationApi(bid, autoTitle).catch(() => {});
    }

    const userMsg: ChatMessage = { role: 'user', content: question };
    updateThread(convId, prev => [...prev, userMsg]);
    setInput('');
    setStreaming(true);

    const placeholderIdx = (threads[convId] ?? []).length + 1;
    updateThread(convId, prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const start = Date.now();
      const result = await queryDocuments(question, activeModel || null);
      const durationMs = Date.now() - start;

      const citations: Citation[] = result.context.map((hit, i) => {
        const sourceName = hit.source?.split('/').pop()?.replace(/\.md$/, '') || `source_${i + 1}`;
        const doc = docs.find(d =>
          d.name.replace(/\.[^.]+$/, '') === sourceName || d.objectName === hit.source
        );
        return { id: i + 1, doc: doc?.id || `d-${i}`, page: hit.page_no, passage: hit.text.slice(0, 240), score: hit.score };
      });

      const fullAnswer = result.answer;
      let charIdx = 0;
      const tick = () => {
        charIdx += 3 + Math.floor(Math.random() * 4);
        const piece = fullAnswer.slice(0, Math.min(charIdx, fullAnswer.length));
        updateThread(convId, prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: piece, citations, durationMs };
          return copy;
        });
        if (charIdx < fullAnswer.length) {
          setTimeout(tick, 20);
        } else {
          setStreaming(false);
          setActiveCite({ msgIdx: placeholderIdx, citeId: citations[0]?.id ?? -1 });
          setConversations(prev => prev.map(c =>
            c.id === convId ? { ...c, messageCount: c.messageCount + 1 } : c
          ));
          const bid = backendId(convId);
          if (bid !== null) {
            addMessages(bid, [
              { role: 'user', content: question },
              { role: 'assistant', content: fullAnswer, citations, duration_ms: durationMs },
            ]).catch(() => {});
          }
        }
      };
      setTimeout(tick, 100);
    } catch (err) {
      updateThread(convId, prev => {
        const copy = [...prev];
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
  const activeMsg = thread[activeCite.msgIdx];
  const activeCitation = activeMsg?.citations?.find(c => c.id === activeCite.citeId);

  const sidebar = (
    <DocsSidebar
      docs={docs} activeDocs={activeDocs} toggleDoc={toggleDoc}
      onUpload={() => setShowUpload(true)}
      conversations={conversations}
      activeConvId={activeConvId}
      onNewConversation={newConversation}
      onSelectConversation={selectConversation}
      onRenameConversation={renameConversation}
      onDeleteConversation={deleteConversation}
      username={username}
      onLogout={onLogout}
    />
  );

  return (
    <div className={`chat-screen sidebar-${sidebarPosition}`}>
      <style>{citationStyles}</style>

      {docsLeft && sidebar}

      <main className="cv-main">
        <div className="cv-toolbar">
          <div className="cv-toolbar-l">
            <div className="cv-title">
              <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--fg)' }}>
                {activeConv?.title ?? 'New conversation'}
              </span>
            </div>
          </div>
          <div className="cv-toolbar-r">
            {activeDocs.length > 0 && (
              <div className="cv-active-pills">
                {activeDocs.map(id => {
                  const doc = docs.find(d => d.id === id);
                  if (!doc) return null;
                  const label = doc.name.replace(/\.[^.]+$/, '').slice(0, 14);
                  return (
                    <span key={id} className="cv-pill">
                      <span className="cv-pill-dot" style={{ background: doc.color }} />
                      <span className="cv-pill-name">{label}</span>
                      <button className="cv-pill-x" onClick={() => toggleDoc(id)} title={`Deselect ${doc.name}`}>
                        <Icon.Close size={8} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <button className="btn ghost sm" onClick={newConversation}>
              <Icon.Plus size={12} /> New chat
            </button>
            <button className="icon-btn" onClick={() => deleteConversation(activeConvId)} title="Delete conversation">
              <Icon.Trash size={14} />
            </button>
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
                {docsLoading
                  ? 'Loading indexed documents…'
                  : docs.length > 0
                    ? `${docs.length} document${docs.length !== 1 ? 's' : ''} indexed and ready`
                    : 'No documents indexed yet'}
              </div>
              {!docsLoading && docs.length === 0 && (
                <button className="btn accent sm" style={{ marginTop: 10 }} onClick={() => setShowUpload(true)}>
                  <Icon.Plus size={12} /> Upload documents
                </button>
              )}
              {!docsLoading && docs.length > 0 && (
                <div className="cv-empty-docs">
                  {docs.map(d => (
                    <span key={d.id} className="tag" style={{ fontSize: 11 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.color, display: 'inline-block' }} />
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
            <button type="button" className="icon-btn" title="Upload documents" onClick={() => setShowUpload(true)}>
              <Icon.Plus size={14} />
            </button>
            <input
              className="cv-input"
              placeholder={docs.length > 0
                ? `Ask anything about your ${docs.length} document${docs.length !== 1 ? 's' : ''}…`
                : 'Upload documents first…'}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={docs.length === 0 || streaming}
            />
            <div className="cv-comp-tools">
              {availableModels.length > 0 && (
                <>
                  <div className="model-picker" ref={modelMenuRef}>
                    <button
                      type="button"
                      className={`model-picker-btn mono${modelMenuOpen ? ' open' : ''}`}
                      onClick={() => setModelMenuOpen(o => !o)}
                      title={`LLM backend: ${modelBackend}`}
                    >
                      <span className="model-picker-label">{activeModel}</span>
                      <Icon.ChevronDown size={11} />
                    </button>
                    {modelMenuOpen && (
                      <div className="model-picker-menu">
                        {availableModels.map(m => (
                          <button
                            key={m}
                            type="button"
                            className={`model-picker-item mono${m === activeModel ? ' active' : ''}`}
                            onClick={() => { setActiveModel(m); setModelMenuOpen(false); }}
                          >
                            {m === activeModel && <Icon.Check size={11} />}
                            {m !== activeModel && <span style={{ width: 11, display: 'inline-block' }} />}
                            {m}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="comp-sep" />
                </>
              )}
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

      {!docsLeft && sidebar}

      {showUpload && (
        <div className="upload-overlay">
          <div className="upload-overlay-header">
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--fg)' }}>Upload documents</span>
            <button className="icon-btn" onClick={() => setShowUpload(false)} title="Close">
              <Icon.Close size={14} />
            </button>
          </div>
          <div className="upload-overlay-body scroll">
            <Upload onComplete={handleUploadComplete} />
          </div>
        </div>
      )}

      <style jsx>{`
        .chat-screen {
          display: grid;
          grid-template-columns: 260px minmax(0, 1fr) 360px;
          height: calc(100vh - 52px);
          background: var(--bg);
          position: relative;
        }
        .chat-screen.sidebar-right {
          grid-template-columns: 360px minmax(0, 1fr) 260px;
        }

        .cv-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg); }
        .cv-toolbar {
          height: 48px; flex: none;
          display: flex; justify-content: space-between; align-items: center;
          padding: 0 16px; border-bottom: 1px solid var(--border); gap: 10px;
        }
        .cv-toolbar-l, .cv-toolbar-r { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .cv-active-pills {
          display: flex; align-items: center; gap: 4px;
          overflow-x: auto; max-width: 320px; flex-shrink: 1;
          scrollbar-width: none;
        }
        .cv-active-pills::-webkit-scrollbar { display: none; }
        .cv-pill {
          display: inline-flex; align-items: center; gap: 4px; flex: none;
          height: 22px; padding: 0 4px 0 7px;
          background: color-mix(in oklab, var(--accent) 14%, var(--bg-soft));
          border: 1px solid color-mix(in oklab, var(--accent) 45%, transparent);
          border-radius: 11px; font-size: 11px; color: var(--accent);
          white-space: nowrap;
        }
        .cv-pill-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
        .cv-pill-name { font-weight: 500; max-width: 80px; overflow: hidden; text-overflow: ellipsis; }
        .cv-pill-x {
          appearance: none; border: 0; background: transparent;
          color: color-mix(in oklab, var(--accent) 70%, transparent);
          padding: 0 2px; display: flex; align-items: center;
          border-radius: 3px; line-height: 1;
        }
        .cv-pill-x:hover { color: var(--accent); background: color-mix(in oklab, var(--accent) 20%, transparent); }
        .cv-title {
          display: flex; align-items: center; gap: 8px; min-width: 0;
          overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
        }
        .model-picker { position: relative; flex: none; }
        .model-picker-btn {
          display: inline-flex; align-items: center; gap: 5px;
          height: 26px; padding: 0 8px;
          border: 1px solid var(--border-strong); border-radius: 7px;
          background: var(--bg-soft); color: var(--fg-muted);
          font-size: 11.5px; font-family: inherit; cursor: pointer;
          transition: border-color 120ms, color 120ms, background 120ms;
          white-space: nowrap;
        }
        .model-picker-btn:hover, .model-picker-btn.open {
          color: var(--fg); border-color: var(--accent);
          background: color-mix(in oklab, var(--accent) 6%, var(--bg-soft));
        }
        .model-picker-label { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
        .model-picker-menu {
          position: absolute; bottom: calc(100% + 6px); right: 0;
          min-width: 220px;
          background: var(--bg-elev); border: 1px solid var(--border-strong);
          border-radius: 10px; padding: 4px;
          box-shadow: var(--shadow-pop);
          z-index: 50;
          display: flex; flex-direction: column; gap: 1px;
        }
        .model-picker-item {
          display: flex; align-items: center; gap: 7px;
          width: 100%; padding: 7px 10px;
          border: 0; border-radius: 7px;
          background: transparent; color: var(--fg-muted);
          font-size: 12px; font-family: inherit; cursor: pointer;
          text-align: left; transition: background 80ms, color 80ms;
        }
        .model-picker-item:hover { background: var(--bg-soft); color: var(--fg); }
        .model-picker-item.active { color: var(--fg); }
        .model-picker-item.active :global(svg) { color: var(--accent); }
        .comp-sep { width: 1px; height: 16px; background: var(--border); flex: none; }

        .cv-thread { flex: 1; padding: 28px 12% 24px; min-height: 0; display: flex; flex-direction: column; gap: 22px; }
        .cv-empty {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 12px; padding: 40px 24px; text-align: center;
        }
        .cv-empty-icon {
          width: 56px; height: 56px; border-radius: var(--radius-lg);
          background: var(--bg-soft); border: 1px solid var(--border);
          display: grid; place-items: center; color: var(--fg-faint);
        }
        .cv-empty-title { font-size: 17px; font-weight: 600; color: var(--fg); }
        .cv-empty-sub { font-size: 13.5px; color: var(--fg-muted); }
        .cv-empty-docs { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 6px; }

        .cv-streaming {
          font-size: 12px; display: flex; align-items: center; gap: 8px;
          padding: 8px 14px; align-self: flex-start;
          background: var(--bg-soft); border-radius: 999px;
          color: var(--fg-muted);
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
          transition: background 100ms, color 100ms;
        }
        .suggest-chip:hover { background: var(--bg-soft); color: var(--fg); }
        .suggest-chip :global(svg) { color: var(--accent); }

        .upload-overlay {
          position: absolute; inset: 0;
          background: var(--bg);
          z-index: 20;
          display: flex; flex-direction: column;
        }
        .upload-overlay-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 20px; height: 48px;
          border-bottom: 1px solid var(--border); flex: none;
        }
        .upload-overlay-body { flex: 1; min-height: 0; }

        @media (max-width: 1280px) {
          .chat-screen, .chat-screen.sidebar-right {
            grid-template-columns: 240px minmax(0, 1fr) 300px;
          }
          .cv-thread, .cv-composer { padding-left: 6%; padding-right: 6%; }
        }
        @media (max-width: 900px) {
          .chat-screen, .chat-screen.sidebar-right { grid-template-columns: minmax(0, 1fr); }
          :global(.docs-sidebar), :global(.sources-panel) { display: none; }
        }
      `}</style>
    </div>
  );
}

export { DOC_COLORS };
