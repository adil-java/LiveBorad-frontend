import { useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { errorMessage } from './api/client';
import { api } from './api/endpoints';
import { AuthProvider, useAuth, useSignedIn } from './auth/AuthContext';
import { ToastProvider, useToast } from './components/Toasts';
import { Avatar, Spinner } from './components/ui';
import { authErrorMessage } from './lib/firebase';
import { BoardPage } from './pages/BoardPage';
import { BoardsPage } from './pages/BoardsPage';
import { RoomPage } from './pages/RoomPage';
import { SignInPage } from './pages/SignInPage';

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}

function Shell() {
  const { state, retrySync, signOut } = useAuth();
  const location = useLocation();

  // Call rooms are open to everyone with the link, signed in or not; the page handles its own sign-in.
  if (location.pathname.startsWith('/room/')) {
    return (
      <Routes>
        <Route path="/room/:code" element={<RoomPage />} />
      </Routes>
    );
  }

  if (state.status === 'loading') {
    return (
      <main className="page center full-height">
        <Spinner />
      </main>
    );
  }

  // Signed-out visitors see the sign-in screen at whatever URL they opened, and land there after signing in.
  // Guests (anonymous sign-in for rooms) can't use boards, so they get the sign-in screen here too.
  if (state.status === 'signedOut' || state.status === 'guest') return <SignInPage />;

  if (state.status === 'syncFailed') {
    return (
      <main className="page center full-height">
        <div className="empty-state">
          <h2>Can't reach LiveBoard</h2>
          <p className="muted">{state.error}</p>
          <div className="row center">
            <button className="button primary" onClick={() => void retrySync()}>
              Try again
            </button>
            <button className="button ghost" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <TopBar />
      <VerifyEmailBanner />
      <Routes>
        <Route path="/" element={<BoardsPage />} />
        <Route path="/boards/:boardId" element={<BoardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function TopBar() {
  const { signOut } = useAuth();
  const { me } = useSignedIn();
  const navigate = useNavigate();
  const toast = useToast();
  const [creatingRoom, setCreatingRoom] = useState(false);

  // One click to a call anyone can join: create a room and open it (its page shows the code and link to share).
  const newRoom = async () => {
    setCreatingRoom(true);
    try {
      const room = await api.createRoom(null);
      navigate(`/room/${room.code}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setCreatingRoom(false);
    }
  };

  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <span className="brand-mark" aria-hidden="true" />
        LiveBoard
      </Link>
      <div className="row">
        <button className="button primary small" disabled={creatingRoom} onClick={() => void newRoom()}>
          {creatingRoom ? 'Creating…' : '+ New call room'}
        </button>
        <Avatar id={me.userId} name={me.displayName} />
        <span className="topbar-name">{me.displayName}</span>
        <button className="button ghost small" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </header>
  );
}

/** Invites are only accepted for verified emails, so nudge email/password users to verify. */
function VerifyEmailBanner() {
  const { refresh, resendVerification } = useAuth();
  const { me, user } = useSignedIn();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (me.emailVerified || user.emailVerified) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast(authErrorMessage(e) ?? 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="banner">
      <span>
        Verify <strong>{me.email}</strong> to accept board invites sent to that address. Check your inbox for the link.
      </span>
      <div className="row">
        <button
          className="button small"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await resendVerification();
              toast('Verification email sent.', 'success');
            })
          }
        >
          Resend email
        </button>
        <button
          className="button primary small"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const verified = await refresh();
              toast(verified ? 'Email verified.' : 'Not verified yet. Click the link in the email first.', verified ? 'success' : 'info');
            })
          }
        >
          I've verified
        </button>
      </div>
    </div>
  );
}
