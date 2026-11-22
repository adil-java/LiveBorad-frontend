import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import type { Activity } from '../api/types';
import { Avatar, Drawer, Spinner, timeAgo } from '../components/ui';
import type { BoardAction } from './boardState';

const PAGE = 30;

interface Props {
  boardId: string;
  activity: Activity[] | null;
  hasMore: boolean;
  dispatch(action: BoardAction): void;
  onClose(): void;
}

export function ActivityPanel({ boardId, activity, hasMore, dispatch, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (before?: string) => {
    setLoading(true);
    setError(null);
    try {
      const entries = await api.listActivity(boardId, before);
      dispatch({ type: 'activityLoaded', entries, append: !!before, hasMore: entries.length === PAGE });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  return (
    <Drawer title="Activity" onClose={onClose}>
      {error && <p className="error-text">{error}</p>}
      {activity === null && loading && <Spinner />}
      {activity?.length === 0 && <p className="muted">Nothing has happened yet.</p>}
      <ol className="activity-list">
        {activity?.map((a) => (
          <li key={a.id}>
            <Avatar id={a.actorId} name={a.actorName} size={26} />
            <div>
              <p>
                <strong>{a.actorName}</strong> {a.summary}
              </p>
              <time className="muted small" dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString()}>
                {timeAgo(a.createdAt)}
              </time>
            </div>
          </li>
        ))}
      </ol>
      {activity && hasMore && (
        <button
          className="button ghost full"
          disabled={loading}
          onClick={() => void load(activity[activity.length - 1]?.createdAt)}
        >
          {loading ? 'Loading…' : 'Load older'}
        </button>
      )}
    </Drawer>
  );
}
