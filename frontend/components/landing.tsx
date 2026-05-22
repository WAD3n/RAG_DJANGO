'use client';

import * as Icon from './icons';

interface LandingProps {
  onStart: () => void;
}

export default function Landing({ onStart }: LandingProps) {
  return (
    <div className="landing">
      <div className="landing-inner">
        <div className="lp-eyebrow mono">
          <span className="eyebrow-dot" />
          v0.4 · ask your documents anything
        </div>
        <h1 className="lp-title">
          Drop in your files.<br />
          <span className="lp-title-accent">Ask grounded questions.</span>
        </h1>
        <p className="lp-sub">
          Upload your PDFs, decks, spreadsheets and notes — get answers
          with citations back to the exact passage. Bring your own model,
          keep your sources private.
        </p>

        <div className="lp-cta-row">
          <button className="btn accent" onClick={onStart}>
            <Icon.Upload size={14} /> Start a new project
          </button>
          <button className="btn ghost">
            See a sample project <Icon.Chevron size={12} />
          </button>
        </div>

        <div className="lp-prooflist">
          <div className="lp-proof">
            <Icon.File size={14} />
            <div>
              <div className="lp-proof-h">PDF · DOCX · XLSX · MD · TXT</div>
              <div className="lp-proof-s muted">Up to 200 MB per file · 50 files per project</div>
            </div>
          </div>
          <div className="lp-proof">
            <Icon.Layers size={14} />
            <div>
              <div className="lp-proof-h">Semantic + lexical hybrid retrieval</div>
              <div className="lp-proof-s muted">mmlw-retrieval-roberta · re-ranked by relevance</div>
            </div>
          </div>
          <div className="lp-proof">
            <Icon.Quote size={14} />
            <div>
              <div className="lp-proof-h">Every answer cites its sources</div>
              <div className="lp-proof-s muted">Click any passage to see the original context</div>
            </div>
          </div>
        </div>

        <div className="lp-stage">
          <LandingPreview />
        </div>

        <div className="lp-foot mono muted">
          <span>↵  to send</span>
          <span className="dot">·</span>
          <span>drag &amp; drop files to upload</span>
          <span className="dot">·</span>
          <span>local model · private data</span>
        </div>
      </div>

      <style jsx>{`
        .landing {
          min-height: calc(100vh - 52px);
          display: flex; align-items: flex-start; justify-content: center;
          padding: 56px 24px 96px;
        }
        .landing-inner { width: 100%; max-width: 880px; }
        .lp-eyebrow {
          display: inline-flex; align-items: center; gap: 8px;
          font-size: 11.5px; color: var(--fg-muted);
          padding: 5px 10px 5px 8px;
          border: 1px solid var(--border); border-radius: 999px;
          background: var(--bg-elev);
          letter-spacing: 0.02em;
        }
        .eyebrow-dot {
          width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .lp-title {
          font-size: clamp(38px, 5.4vw, 64px);
          line-height: 1.03; letter-spacing: -0.025em;
          margin: 22px 0 18px; font-weight: 600;
        }
        .lp-title-accent {
          color: var(--fg-muted); font-style: italic; font-weight: 400;
          font-family: 'Inter Tight', serif;
        }
        .lp-sub {
          font-size: 17px; color: var(--fg-muted); max-width: 560px;
          line-height: 1.55; margin: 0 0 28px;
        }
        .lp-cta-row { display: flex; gap: 10px; align-items: center; }
        .lp-cta-row :global(.btn) { height: 38px; padding: 0 16px; font-size: 14px; border-radius: 10px; }
        .lp-prooflist {
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 14px; margin-top: 44px; padding-top: 28px;
          border-top: 1px solid var(--border);
        }
        .lp-proof { display: flex; gap: 10px; align-items: flex-start; color: var(--fg); font-size: 13px; }
        .lp-proof > :global(svg) { margin-top: 1px; color: var(--accent); flex: none; }
        .lp-proof-h { font-weight: 500; }
        .lp-proof-s { font-size: 12px; margin-top: 2px; }
        .lp-stage { margin-top: 44px; position: relative; }
        .lp-foot {
          display: flex; gap: 10px; justify-content: center;
          margin-top: 32px; font-size: 11.5px;
        }
        .lp-foot .dot { opacity: 0.4; }
        @media (max-width: 720px) {
          .lp-prooflist { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

function LandingPreview() {
  return (
    <div className="lp-preview card">
      <div className="lpp-head">
        <div className="lpp-tabs">
          <span className="lpp-tab active">
            <Icon.Folder size={12} /> Quarterly Review
          </span>
          <span className="lpp-tab"><Icon.Plus size={12} /></span>
        </div>
        <span className="mono faint" style={{ fontSize: 11 }}>5 docs · 1,116 chunks</span>
      </div>
      <div className="lpp-body">
        <div className="lpp-msg user">What changed in our Q3 margin vs Q2?</div>
        <div className="lpp-msg ai">
          Operating margin expanded <b>+180 bps</b>, from <b>22.4% → 24.2%</b>.
          Drivers were mix lift <span className="cite">[1]</span>, S&amp;M leverage
          <span className="cite">[2]</span>, and a one-time real-estate benefit
          <span className="cite">[3]</span>.
        </div>
        <div className="lpp-cite">
          <Icon.Quote size={11} />
          <span className="mono faint" style={{ fontSize: 11 }}>Q3-2025-Earnings-Call.pdf · p.8</span>
          <span className="muted" style={{ fontSize: 12 }}>
            &quot;...margin of <mark>24.2% in the third quarter</mark> compared to 22.4% in the prior quarter...&quot;
          </span>
        </div>
      </div>
      <style jsx>{`
        .lp-preview { padding: 12px; }
        .lpp-head {
          display: flex; justify-content: space-between; align-items: center;
          padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid var(--border);
        }
        .lpp-tabs { display: flex; gap: 6px; align-items: center; }
        .lpp-tab {
          display: inline-flex; align-items: center; gap: 5px;
          height: 24px; padding: 0 9px; border-radius: 6px;
          font-size: 12px; color: var(--fg-muted);
          border: 1px solid transparent;
        }
        .lpp-tab.active { background: var(--bg-soft); color: var(--fg); border-color: var(--border); }
        .lpp-body { display: flex; flex-direction: column; gap: 10px; padding: 4px 4px 6px; }
        .lpp-msg { font-size: 13.5px; line-height: 1.55; }
        .lpp-msg.user { color: var(--fg-muted); }
        .lpp-msg.user::before { content: "→  "; color: var(--fg-faint); }
        .lpp-msg.ai b { font-weight: 600; }
        .cite {
          display: inline-block;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 10.5px; color: var(--accent);
          padding: 0 4px; border-radius: 4px;
          background: var(--accent-soft);
          vertical-align: 2px; margin: 0 1px;
        }
        .lpp-cite {
          display: flex; gap: 8px; align-items: baseline;
          padding: 8px 10px; margin-top: 4px;
          background: var(--bg-soft); border-radius: 8px;
          border-left: 2px solid var(--accent);
          font-size: 12px;
        }
        .lpp-cite :global(mark) {
          background: var(--highlight); color: inherit; padding: 0 2px; border-radius: 2px;
        }
      `}</style>
    </div>
  );
}
