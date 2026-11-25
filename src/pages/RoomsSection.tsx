import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import type { Room } from '../api/types';
import { useToast } from '../components/Toasts';
import { timeAgo } from '../components/ui';
import { copyText, normalizeRoomCode, roomLink } from '../lib/roomCode';

/** Call rooms on the home page: create one, share its link, see who's in it, end it, or join by code. */
export function RoomsSection() {
  const navigate = useNavigate();
  const toast = useToast();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.listRooms().then(setRooms, () => setRooms([]));
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const room = await api.createRoom(name.trim() || null);
      navigate(`/room/${room.code}`); // the room page shows the code and link to share
    } catch (err) {
      toast(errorMessage(err), 'error');
      setCreating(false);
    }
  };

  const end = async (room: Room) => {
    try {
      await api.endRoom(room.code);
      setRooms((all) => all?.filter((r) => r.id !== room.id) ?? null);
      toast(`Ended “${room.name}”.`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <section className="rooms-section">
      <div className="page-header">
        <div>
          <h2>Call rooms</h2>
          <p className="muted small">Share a link; anyone can join the call, even without an account.</p>
        </div>
        <form className="row" onSubmit={create}>
          <input
            aria-label="Room name"
            placeholder="Room name (optional)"
            value={name}
            maxLength={60}
            disabled={creating}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="button primary" disabled={creating}>
            {creating ? 'Creating…' : 'New room'}
          </button>
        </form>
      </div>

      <JoinByCode />

      {rooms && rooms.length > 0 && (
        <ul className="room-list">
          {rooms.map((r) => (
            <li key={r.id}>
              <div className="room-list-info">
                <Link to={`/room/${r.code}`} className="room-list-name">
                  {r.name}
                </Link>
                <span className="muted small">
                  <span className="room-code">{r.code}</span> · created {timeAgo(r.createdAt)}
                  {r.peopleInCall > 0 && <strong className="in-call-now"> · {r.peopleInCall} in call now</strong>}
                </span>
              </div>
              <div className="row">
                <button
                  className="button small"
                  onClick={async () => toast((await copyText(roomLink(r.code))) ? 'Invite link copied.' : roomLink(r.code), 'success')}
                >
                  Copy link
                </button>
                <Link className="button small primary" to={`/room/${r.code}`}>
                  Open
                </Link>
                <button className="button small ghost danger-text" onClick={() => void end(r)} title="Disconnect everyone and retire the code">
                  End
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Have a code?" box, also used on the sign-in page for guests. */
export function JoinByCode({ compact }: { compact?: boolean }) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = normalizeRoomCode(value);
    if (!code) {
      setInvalid(true);
      return;
    }
    navigate(`/room/${code}`);
  };

  return (
    <form className={`join-code ${compact ? 'compact' : ''}`} onSubmit={submit}>
      <input
        aria-label="Room code or invite link"
        placeholder="Room code or link, e.g. abc-defg-hij"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
      />
      <button className="button" disabled={!value.trim()}>
        Join
      </button>
      {invalid && <span className="error-text">That doesn't look like a room code.</span>}
    </form>
  );
}
