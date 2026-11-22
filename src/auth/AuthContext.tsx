import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import type { Me } from '../api/types';
import { auth, googleProvider } from '../lib/firebase';
import { stopHub } from '../realtime/hub';

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'syncFailed'; user: User; error: string }
  | { status: 'signedIn'; user: User; me: Me };

interface AuthApi {
  state: AuthState;
  signInWithGoogle(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(name: string, email: string, password: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  resendVerification(): Promise<void>;
  /** Re-reads the Firebase user and re-syncs, e.g. after the user clicked the verification link. */
  refresh(): Promise<boolean>;
  retrySync(): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  // While signing up, the profile name is set after the account exists; sync once that is done.
  const signingUp = useRef(false);

  const sync = useCallback(async (user: User) => {
    try {
      const me = await api.syncMe();
      if (auth.currentUser?.uid === user.uid) setState({ status: 'signedIn', user, me });
    } catch (e) {
      if (auth.currentUser?.uid === user.uid) setState({ status: 'syncFailed', user, error: errorMessage(e) });
    }
  }, []);

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        if (!user) {
          void stopHub();
          setState({ status: 'signedOut' });
          return;
        }
        if (signingUp.current) return;
        setState({ status: 'loading' });
        void sync(user);
      }),
    [sync],
  );

  const value = useMemo<AuthApi>(
    () => ({
      state,
      async signInWithGoogle() {
        await signInWithPopup(auth, googleProvider);
      },
      async signInWithEmail(email, password) {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      async signUpWithEmail(name, email, password) {
        signingUp.current = true;
        try {
          const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
          if (name.trim()) await updateProfile(user, { displayName: name.trim() });
          await sendEmailVerification(user).catch(() => undefined);
          await user.getIdToken(true); // new token carries the display name
          setState({ status: 'loading' });
          await sync(user);
        } finally {
          signingUp.current = false;
        }
      },
      async resetPassword(email) {
        await sendPasswordResetEmail(auth, email.trim());
      },
      async resendVerification() {
        if (auth.currentUser) await sendEmailVerification(auth.currentUser);
      },
      async refresh() {
        const user = auth.currentUser;
        if (!user) return false;
        await user.reload();
        await user.getIdToken(true); // email_verified claim only updates in a fresh token
        await sync(user);
        return user.emailVerified;
      },
      async retrySync() {
        const user = auth.currentUser;
        if (!user) return;
        setState({ status: 'loading' });
        await sync(user);
      },
      async signOut() {
        await stopHub();
        await firebaseSignOut(auth);
      },
    }),
    [state, sync],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}

/** For components that only render while signed in. */
export function useSignedIn(): { user: User; me: Me } {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('useSignedIn used while not signed in.');
  return { user: state.user, me: state.me };
}
