import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { errorMessage, isApiError } from '../api/client';
import { api } from '../api/endpoints';
import type { Room } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { getAudioContext } from '../board/audioLevel';
import { CallDock } from '../board/CallDock';
import { hubErrorMessage, useCall } from '../board/useCall';
import { useToast } from '../components/Toasts';
import { Modal, Spinner } from '../components/ui';
import { authErrorMessage } from '../lib/firebase';
import { copyText, loadGuestName, normalizeRoomCode, roomLink, saveGuestName } from '../lib/roomCode';
import { connectHub, getHub, onHubReconnected } from '../realtime/hub';

type Phase = 'lobby' | 'joining' | 'inRoom' | 'ended';

/**
 * A call room at /room/:code. Works for members and for guests without an account: guests type a name and are
 * signed in anonymously behind the scenes. Rooms only hold a call; they never expose boards.
 */
export function RoomPage() {
  const { code: rawCode = '' } = useParams();
  const code = normalizeRoomCode(rawCode);
  const auth = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [phase, setPhase] = useState<Phase>('lobby');
  const [room, setRoom] = useState<Room | null>(null);
  const [preview, setPreview] = useState<Room | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState(loadGuestName);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  /** The host dismissed the "you're alone, invite people" panel. */
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const autoJoinCall = useRef(false);

  const call = useCall(room?.id ?? '');
  const leaveCall = call.leave;
  const status = auth.state.status;
  const member = status === 'signedIn' ? auth.state : null;
  const isOwner = !!member && !!room && room.ownerId === member.me.userId;
  const myName = member ? member.me.displayName : guestName.trim();
  const myUserId = member ? member.me.userId : auth.state.status === 'guest' ? auth.state.user.uid : '';

  // Members (and returning guests) can see the room's name and who's there before joining.
  useEffect(() => {
    if (!code || (status !== 'signedIn' && status !== 'guest')) return;
    api.getRoom(code).then(setPreview, (e) => isApiError(e, 404) && setNotFound(true));
  }, [code, status]);

  const enterRoom = useCallback(async () => {
    const hub = await connectHub();
    const joined = await hub.invoke<Room>('JoinRoom', code, member ? null : guestName.trim());
    setRoom(joined);
    return joined;
  }, [code, member, guestName]);

  const join = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!code) return;
    getAudioContext(); // unlock audio while we still have this click's user gesture
    setError(null);
    if (!member && !guestName.trim()) {
      setError('Enter your name so others know who joined.');
      return;
    }
    setPhase('joining');
    try {
      if (!member) {
        await auth.signInAsGuest();
        saveGuestName(guestName.trim());
      }
      await enterRoom();
      autoJoinCall.current = true;
      setPhase('inRoom');
    } catch (err) {
      setPhase('lobby');
      const firebaseCode = (err as { code?: string })?.code ?? '';
      setError(
        firebaseCode === 'auth/operation-not-allowed'
          ? 'Guest joining is turned off. The app owner must enable Anonymous sign-in in Firebase (Authentication → Sign-in method).'
          : firebaseCode.startsWith('auth/')
            ? (authErrorMessage(err) ?? 'Sign-in failed.')
            : hubErrorMessage(err),
      );
    }
  };

  // Start the call once the room is joined and useCall is listening to this room's events.
  useEffect(() => {
    if (phase === 'inRoom' && room && autoJoinCall.current && !call.joined && !call.joining) {
      autoJoinCall.current = false;
      void call.join();
    }
  }, [phase, room, call.joined, call.joining, call.join]);

  // Room ended by its owner, or our connection dropped and came back (the server forgot us: rejoin the room).
  useEffect(() => {
    if (phase !== 'inRoom' || !room) return;
    const hub = getHub();
    const onEnded = (roomId: string) => {
      if (roomId !== room.id) return;
      leaveCall();
      setPhase('ended');
    };
    hub.on('RoomEnded', onEnded);
    const offReconnect = onHubReconnected(() => {
      enterRoom().catch(() => setPhase('ended'));
    });
    return () => {
      hub.off('RoomEnded', onEnded);
      offReconnect();
    };
  }, [phase, room, leaveCall, enterRoom]);

  // Leaving the page leaves the room (useCall already leaves the call).
  useEffect(
    () => () => {
      const hub = getHub();
      if (hub.state === 'Connected') hub.invoke('LeaveBoard').catch(() => undefined);
    },
    [],
  );

  const endRoom = async () => {
    setConfirmEnd(false);
    try {
      await api.endRoom(code!);
      call.leave();
      toast('Room ended for everyone.', 'success');
      navigate('/', { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  // ---- Render ----

  if (status === 'loading') {
    return (
      <main className="room-page center">
        <Spinner />
      </main>
    );
  }

  if (!code || notFound || phase === 'ended') {
    return (
      <main className="room-page center">
        <div className="room-card">
          <h1>{phase === 'ended' ? 'This room has ended' : 'Room not found'}</h1>
          <p className="muted">
            {phase === 'ended'
              ? 'The host ended the room, so the call is over.'
              : 'Check the link or code. The room may have been ended by its host.'}
          </p>
          <Link className="button primary" to="/">
            Go to LiveBoard
          </Link>
        </div>
      </main>
    );
  }

  if (phase === 'inRoom' && room) {
    return (
      <main className="room-page in-call">
        <header className="room-bar">
          <div className="room-title">
            <span className="brand-mark" aria-hidden="true" />
            <div>
              <h1>{room.name}</h1>
              <span className="room-code">{room.code}</span>
            </div>
          </div>
          <div className="row">
            <button className="button small primary" onClick={() => setInviteOpen(true)}>
              Invite people
            </button>
            {isOwner && (
              <button className="button small danger" onClick={() => setConfirmEnd(true)}>
                End room
              </button>
            )}
          </div>
        </header>

        {call.joined && call.participants.length <= 1 && !inviteDismissed && (
          <div className="room-invite-inline">
            <InvitePanel room={room} onClose={() => setInviteDismissed(true)} heading="You're the only one here. Invite people:" />
          </div>
        )}

        {inviteOpen && (
          <Modal title="Invite people" onClose={() => setInviteOpen(false)}>
            <InvitePanel room={room} />
          </Modal>
        )}

        {call.joined ? (
          <CallDock call={call} myUserId={myUserId} myName={myName} variant="page" />
        ) : (
          <div className="room-stage-empty">
            {call.joining ? (
              <Spinner label="Joining the call" />
            ) : (
              <div className="room-card">
                <h2>You're not in the call</h2>
                <p className="muted">
                  {call.participants.length > 0
                    ? `${call.participants.length} ${call.participants.length === 1 ? 'person is' : 'people are'} in the call.`
                    : 'Nobody is in the call yet.'}
                </p>
                <div className="row center">
                  <button className="button primary" onClick={() => void call.join()}>
                    Join call
                  </button>
                  <Link className="button ghost" to="/">
                    Leave room
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {confirmEnd && (
          <Modal title="End this room?" onClose={() => setConfirmEnd(false)}>
            <p>Everyone is disconnected and the code and invite link stop working.</p>
            <div className="row end">
              <button className="button ghost" onClick={() => setConfirmEnd(false)}>
                Cancel
              </button>
              <button className="button danger" onClick={() => void endRoom()}>
                End room
              </button>
            </div>
          </Modal>
        )}
      </main>
    );
  }

  // Lobby: choose a name (guests) and join.
  return (
    <main className="room-page center">
      <form className="room-card" onSubmit={join}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          LiveBoard
        </div>
        <h1>{preview?.name ?? 'Join the call'}</h1>
        <p className="muted">
          Room <span className="room-code">{code}</span>
          {preview && preview.peopleInCall > 0 && ` · ${preview.peopleInCall} in the call`}
        </p>

        {member ? (
          <p>
            Joining as <strong>{member.me.displayName}</strong>
          </p>
        ) : (
          <label className="field">
            <span>Your name</span>
            <input
              autoFocus
              value={guestName}
              maxLength={40}
              placeholder="How others will see you"
              autoComplete="name"
              onChange={(e) => setGuestName(e.target.value)}
            />
          </label>
        )}

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <button className="button primary full" disabled={phase === 'joining'}>
          {phase === 'joining' ? 'Joining…' : 'Join call'}
        </button>
        <p className="muted small">Your browser will ask to use your microphone. The camera stays off until you turn it on.</p>

        {!member && (
          <p className="muted small">
            Have an account?{' '}
            <Link to="/" className="link">
              Sign in
            </Link>{' '}
            first, then open this link again.
          </p>
        )}
      </form>
    </main>
  );
}

/** Everything needed to bring people in: the code to read out, the link to send, and the phone share sheet. */
function InvitePanel({ room, heading, onClose }: { room: Room; heading?: string; onClose?(): void }) {
  const toast = useToast();
  const link = roomLink(room.code);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async (text: string, what: string) => {
    toast((await copyText(text)) ? `${what} copied.` : text, 'success');
  };

  return (
    <div className="invite-panel">
      {heading && (
        <div className="invite-heading">
          <strong>{heading}</strong>
          {onClose && (
            <button className="icon-button" aria-label="Hide" onClick={onClose}>
              ×
            </button>
          )}
        </div>
      )}
      <div className="invite-code-block">
        <span className="muted small">Room code</span>
        <span className="invite-code">{room.code}</span>
      </div>
      <label className="field">
        <span>Invite link</span>
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div className="row">
        <button className="button primary" onClick={() => void copy(link, 'Invite link')}>
          Copy link
        </button>
        <button className="button" onClick={() => void copy(room.code, 'Room code')}>
          Copy code
        </button>
        {canShare && (
          <button
            className="button"
            onClick={() => navigator.share({ title: room.name, text: `Join my LiveBoard call "${room.name}"`, url: link }).catch(() => undefined)}
          >
            Share…
          </button>
        )}
      </div>
      <p className="muted small">Anyone with the link or code can join, even without an account. They just type their name.</p>
    </div>
  );
}
