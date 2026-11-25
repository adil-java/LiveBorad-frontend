import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { authErrorMessage } from '../lib/firebase';
import { JoinByCode } from './RoomsSection';

type Mode = 'signIn' | 'signUp' | 'reset';

export function SignInPage() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const attempt = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'signIn') void attempt(() => auth.signInWithEmail(email, password));
    if (mode === 'signUp') void attempt(() => auth.signUpWithEmail(name, email, password));
    if (mode === 'reset')
      void attempt(async () => {
        await auth.resetPassword(email);
        setInfo('If an account exists for that email, a reset link is on its way.');
      });
  };

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
  };

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="brand large">
          <span className="brand-mark" aria-hidden="true" />
          LiveBoard
        </div>
        <p className="muted">Plan together on boards that update for everyone as you work.</p>

        {mode !== 'reset' && (
          <>
            <button className="button google full" disabled={busy} onClick={() => void attempt(auth.signInWithGoogle)}>
              <GoogleIcon />
              Continue with Google
            </button>
            <div className="divider">
              <span>or</span>
            </div>
          </>
        )}

        <form className="stack" onSubmit={submit}>
          {mode === 'signUp' && (
            <label className="field">
              <span>Your name</span>
              <input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} maxLength={80} />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {mode !== 'reset' && (
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}

          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {info && <p className="success-text">{info}</p>}

          <button className="button primary full" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : mode === 'signUp' ? 'Create account' : 'Send reset link'}
          </button>
        </form>

        <div className="auth-links">
          {mode === 'signIn' && (
            <>
              <button className="link" onClick={() => switchTo('signUp')}>
                Create an account
              </button>
              <button className="link" onClick={() => switchTo('reset')}>
                Forgot password?
              </button>
            </>
          )}
          {mode !== 'signIn' && (
            <button className="link" onClick={() => switchTo('signIn')}>
              Back to sign in
            </button>
          )}
        </div>

        <div className="divider">
          <span>joining a call?</span>
        </div>
        <JoinByCode compact />
        <p className="muted small">No account needed: open the invite link or enter the room code.</p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  );
}
