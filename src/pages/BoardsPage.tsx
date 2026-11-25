import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import type { BoardSummary } from '../api/types';
import { useSignedIn } from '../auth/AuthContext';
import { useToast } from '../components/Toasts';
import { Spinner, timeAgo } from '../components/ui';
import { RoomsSection } from './RoomsSection';

export function BoardsPage() {
  const { me } = useSignedIn();
  const navigate = useNavigate();
  const toast = useToast();
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = () => {
    setError(null);
    api.listBoards().then(
      (list) => setBoards([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
      (e) => setError(errorMessage(e)),
    );
  };

  useEffect(load, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const board = await api.createBoard(name.trim());
      navigate(`/boards/${board.id}`);
    } catch (err) {
      toast(errorMessage(err), 'error');
      setCreating(false);
    }
  };

  const joined = boards?.filter((b) => me.joinedBoardIds.includes(b.id)) ?? [];

  return (
    <main className="page">
      <div className="page-header">
        <h1>Your boards</h1>
        <form className="row" onSubmit={create}>
          <input
            aria-label="New board name"
            placeholder="New board name"
            value={name}
            maxLength={100}
            disabled={creating}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="button primary" disabled={creating || !name.trim()}>
            {creating ? 'Creating…' : 'Create board'}
          </button>
        </form>
      </div>

      {joined.length > 0 && (
        <div className="notice success">
          You were added to {joined.map((b) => `“${b.name}”`).join(', ')} from a pending invite.
        </div>
      )}

      {error && (
        <div className="notice warning">
          {error}{' '}
          <button className="link" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {!boards && !error && (
        <div className="center">
          <Spinner />
        </div>
      )}

      {boards?.length === 0 && (
        <div className="empty-state">
          <h2>No boards yet</h2>
          <p className="muted">Create your first board above. It starts with To do, In progress and Done columns.</p>
        </div>
      )}

      {boards && boards.length > 0 && (
        <ul className="board-grid">
          {boards.map((b) => (
            <li key={b.id}>
              <Link to={`/boards/${b.id}`} className="board-tile">
                <span className="board-tile-name">{b.name}</span>
                <span className="board-tile-meta">
                  <span className={`role-badge role-${b.role.toLowerCase()}`}>{b.role}</span>
                  <span className="muted small">
                    {b.memberCount} {b.memberCount === 1 ? 'member' : 'members'} · created {timeAgo(b.createdAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <RoomsSection />
    </main>
  );
}
