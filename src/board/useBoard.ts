import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage, isApiError } from '../api/client';
import { api } from '../api/endpoints';
import type { Activity, Card, CardPosition, Column, Member, PresenceUser } from '../api/types';
import { useToast } from '../components/Toasts';
import { auth } from '../lib/firebase';
import { connectHub, getHub, onHubReconnected } from '../realtime/hub';
import { boardReducer, emptyBoard } from './boardState';

/**
 * Loads a board, joins its live channel and keeps the state in sync with everyone else's changes.
 * After a reconnect the board is reloaded, because events sent while offline are not replayed.
 */
export function useBoard(boardId: string) {
  const [state, dispatch] = useReducer(boardReducer, emptyBoard);
  const [loadError, setLoadError] = useState<{ notFound: boolean; message: string } | null>(null);
  const navigate = useNavigate();
  const toast = useToast();
  /** Set when this tab is leaving/deleting the board itself, so the resulting events don't show a second message. */
  const leavingRef = useRef(false);

  const reload = useCallback(async () => {
    try {
      const detail = await api.getBoard(boardId);
      dispatch({ type: 'loaded', detail });
      setLoadError(null);
    } catch (e) {
      setLoadError({ notFound: isApiError(e, 404), message: errorMessage(e) });
    }
  }, [boardId]);

  useEffect(() => {
    dispatch({ type: 'reset' });
    setLoadError(null);
    leavingRef.current = false;
    void reload();
  }, [boardId, reload]);

  useEffect(() => {
    const hub = getHub();
    const myUserId = auth.currentUser?.uid ?? '';
    let disposed = false;
    let joined = false;
    // SignalR hands event arguments over untyped; each handler below declares the payload shape it expects.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Handler = (...args: any[]) => void;
    const handlers: [string, Handler][] = [];
    const on = (name: string, handler: Handler) => {
      const wrapped: Handler = (...args) => {
        if (!disposed) handler(...args);
      };
      hub.on(name, wrapped);
      handlers.push([name, wrapped]);
    };
    const mine = (id: string) => id === boardId;

    const leave = (message: string) => {
      if (!leavingRef.current) toast(message, 'info');
      leavingRef.current = true;
      navigate('/', { replace: true });
    };

    on('BoardRenamed', (id: string, name: string) => mine(id) && dispatch({ type: 'renamed', name }));
    on('BoardDeleted', (id: string) => mine(id) && leave('This board was deleted by its owner.'));
    on('ColumnsChanged', (id: string, columns: Column[]) => mine(id) && dispatch({ type: 'columns', columns }));
    on('CardCreated', (card: Card) => mine(card.boardId) && dispatch({ type: 'cardUpserted', card }));
    on('CardUpdated', (card: Card) => mine(card.boardId) && dispatch({ type: 'cardUpserted', card }));
    on('CardMoved', (card: Card) => mine(card.boardId) && dispatch({ type: 'cardUpserted', card }));
    on('CardDeleted', (id: string, cardId: string) => mine(id) && dispatch({ type: 'cardRemoved', cardId }));
    on('CardsRepositioned', (id: string, positions: CardPosition[]) =>
      mine(id) && dispatch({ type: 'repositioned', positions }),
    );
    on('MembersChanged', (id: string, members: Member[]) => mine(id) && dispatch({ type: 'members', members, myUserId }));
    on('AccessRevoked', (id: string) => mine(id) && leave('You no longer have access to this board.'));
    on('PresenceChanged', (id: string, users: PresenceUser[]) => mine(id) && dispatch({ type: 'presence', users }));
    on('CardEditing', (id: string, cardId: string, user: PresenceUser, isEditing: boolean) => {
      if (mine(id) && user.userId !== myUserId) dispatch({ type: 'editing', cardId, user, isEditing });
    });
    // Activity entries carry no board ID; a connection only belongs to one board's group at a time.
    on('ActivityAdded', (entry: Activity) => joined && dispatch({ type: 'activityAdded', entry }));

    const join = async () => {
      try {
        const users = await hub.invoke<PresenceUser[]>('JoinBoard', boardId);
        if (disposed) return;
        joined = true;
        dispatch({ type: 'presence', users });
        // Anything that changed between the first load and joining would otherwise be missed.
        await reload();
      } catch {
        // Not a member / board gone: the REST load reports that.
      }
    };

    const offReconnect = onHubReconnected(() => void join());
    void connectHub().then(() => {
      if (!disposed) void join();
    });

    return () => {
      disposed = true;
      handlers.forEach(([name, handler]) => hub.off(name, handler));
      offReconnect();
      if (joined) hub.invoke('LeaveBoard').catch(() => undefined);
    };
  }, [boardId, navigate, reload, toast]);

  return { state, dispatch, loadError, reload, leavingRef };
}
