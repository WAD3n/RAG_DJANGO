'use client';

import React from 'react';
import { login } from '../lib/api';

interface LoginProps {
  onLogin: (username: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const data = await login(username.trim(), password);
      onLogin(data.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">R</div>
          <span className="login-wordmark">RAGFLOW</span>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="field">
            <label className="field-label" htmlFor="u">Username</label>
            <input
              id="u"
              className="field-input"
              type="text"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading}
              placeholder="username"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="p">Password</label>
            <input
              id="p"
              className="field-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              placeholder="••••••••"
            />
          </div>

          {error && <div className="login-error" role="alert">{error}</div>}

          <button
            className="login-btn"
            type="submit"
            disabled={loading || !username.trim() || !password}
          >
            {loading
              ? <><span className="spin" /> Signing in…</>
              : 'Sign in'
            }
          </button>
        </form>

        <p className="login-hint">
          Manage accounts via{' '}
          <code>python manage.py createsuperuser</code>
        </p>
      </div>

      <style jsx>{`
        .login-screen {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg);
          background-image:
            radial-gradient(ellipse 70% 50% at 65% 15%,
              color-mix(in oklab, var(--accent) 9%, transparent) 0%,
              transparent 100%);
          padding: 24px;
        }

        .login-card {
          width: 100%;
          max-width: 340px;
          background: var(--bg-elev);
          border: 1px solid var(--border-strong);
          border-radius: 18px;
          box-shadow: var(--shadow-pop);
          padding: 32px 28px 24px;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }

        .login-brand {
          display: flex;
          align-items: center;
          gap: 11px;
        }
        .brand-mark {
          width: 32px; height: 32px;
          border-radius: 8px;
          background: var(--accent);
          color: var(--accent-fg);
          display: grid;
          place-items: center;
          font-weight: 800;
          font-size: 15px;
          letter-spacing: -0.02em;
          flex: none;
        }
        .login-wordmark {
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--fg);
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .field-label {
          font-size: 11.5px;
          font-weight: 500;
          color: var(--fg-faint);
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .field-input {
          width: 100%;
          height: 38px;
          padding: 0 12px;
          background: var(--bg-soft);
          border: 1px solid var(--border-strong);
          border-radius: 10px;
          color: var(--fg);
          font: inherit;
          font-size: 14px;
          outline: none;
          transition: border-color 120ms, box-shadow 120ms;
          box-sizing: border-box;
        }
        .field-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .field-input:disabled { opacity: 0.5; }
        .field-input::placeholder { color: var(--fg-faint); }

        .login-error {
          font-size: 12.5px;
          color: var(--danger);
          background: color-mix(in oklab, var(--danger) 10%, transparent);
          border: 1px solid color-mix(in oklab, var(--danger) 25%, transparent);
          border-radius: 8px;
          padding: 8px 12px;
        }

        .login-btn {
          width: 100%;
          height: 40px;
          margin-top: 4px;
          background: var(--accent);
          color: var(--accent-fg);
          border: none;
          border-radius: 10px;
          font: inherit;
          font-size: 14px;
          font-weight: 600;
          cursor: default;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: opacity 120ms, transform 80ms;
        }
        .login-btn:hover:not(:disabled) { opacity: 0.88; }
        .login-btn:active:not(:disabled) { transform: scale(0.98); }
        .login-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .login-hint {
          font-size: 11.5px;
          color: var(--fg-faint);
          text-align: center;
          margin: 0;
          line-height: 1.7;
        }
        .login-hint code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10.5px;
          background: var(--bg-soft);
          padding: 1px 5px;
          border-radius: 4px;
          color: var(--fg-muted);
        }
      `}</style>
    </div>
  );
}
