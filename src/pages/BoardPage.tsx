import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { errorMessage, isApiError } from '../api/client';
import { api } from '../api/endpoints';
import { canEdit as roleCanEdit, canManage, type Card, type Column, type Members } from '../api/types';
import { useSignedIn } from '../auth/AuthContext';
import { ActivityPanel } from '../board/ActivityPanel';
import { BoardColumns, type MoveIntent } from '../board/BoardColumns';
import { cardsByColumn, positionBetween } from '../board/boardState';
import { CardModal } from '../board/CardModal';
import { ChatPanel } from '../board/ChatPanel';
import { MembersPanel } from '../board/MembersPanel';
import { useBoard } from '../board/useBoard';
import { useChat } from '../board/useChat';
import { Whiteboard } from '../board/Whiteboard';
import { useToast } from '../components/Toasts';
import { Avatar, InlineEdit, Modal, Spinner } from '../components/ui';
import { getHub, type HubStatus, hubStatus, onHubStatus } from '../realtime/hub';

type Panel = 'chat' | 'members' | 'activity' | null;

export function BoardPage() {
  const { boardId = '' } = useParams();
  const { user } = useSignedIn();
  const navigate = useNavigate();
  const toast = useToast();
  const { state, dispatch, loadError, reload, leavingRef } = useBoard(boardId);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const live = useHubStatus();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'whiteboard' ? 'whiteboard' : 'cards';
  const chat = useChat(boardId, panel === 'chat');
  const togglePanel = (next: Exclude<Panel, null>) => setPanel((p) => (p === next ? null : next));

  const editable = roleCanEdit(state.myRole);
  const isOwner = canManage(state.myRole);
  const grouped = useMemo(() => cardsByColumn(state), [state]);
  const onlineIds = useMemo(() => new Set(state.presence.map((u) => u.userId)), [state.presence]);

  useEffect(() => {
    document.title = state.name ? `${state.name} · LiveBoard` : 'LiveBoard';
    return () => {
      document.title = 'LiveBoard';
    };
  }, [state.name]);

  const fail = useCallback((e: unknown) => toast(errorMessage(e), 'error'), [toast]);

  // ---- Board ----

  const renameBoard = async (name: string) => {
    try {
      const summary = await api.renameBoard(boardId, name);
      dispatch({ type: 'renamed', name: summary.name });
    } catch (e) {
      fail(e);
      throw e;
    }
  };

  const deleteBoard = async () => {
    try {
      leavingRef.current = true;
      await api.deleteBoard(boardId);
      toast(`Deleted “${state.name}”.`, 'success');
      navigate('/', { replace: true });
    } catch (e) {
      leavingRef.current = false;
      fail(e);
    }
  };

  const leaveBoard = async () => {
    leavingRef.current = true;
    try {
      await api.removeMember(boardId, user.uid);
      toast(`You left “${state.name}”.`, 'success');
      navigate('/', { replace: true });
    } catch (e) {
      leavingRef.current = false;
      throw e;
    }
  };

  // ---- Columns ----

  const addColumn = async (name: string) => {
    try {
      dispatch({ type: 'columnUpserted', column: await api.addColumn(boardId, name) });
    } catch (e) {
      fail(e);
      throw e;
    }
  };

  const renameColumn = async (columnId: string, name: string) => {
    try {
      dispatch({ type: 'columnUpserted', column: await api.renameColumn(boardId, columnId, name) });
    } catch (e) {
      fail(e);
      throw e;
    }
  };

  const removeColumn = async (column: Column) => {
    if ((grouped[column.id]?.length ?? 0) > 0) {
      toast('Move or delete the cards in this column before removing it.', 'info');
      return;
    }
    try {
      await api.removeColumn(boardId, column.id);
      dispatch({ type: 'columnRemoved', columnId: column.id });
    } catch (e) {
      fail(e);
    }
  };

  // ---- Cards ----

  const addCard = async (columnId: string, title: string) => {
    try {
      dispatch({ type: 'cardUpserted', card: await api.createCard(boardId, columnId, title, null) });
    } catch (e) {
      fail(e);
      throw e;
    }
  };

  const moveCard = async ({ cardId, columnId, beforeCardId, afterCardId }: MoveIntent) => {
    const card = state.cards[cardId];
    if (!card) return;
    // Show the result immediately; the server's answer (or a reload on failure) settles it.
    const before = beforeCardId ? state.cards[beforeCardId]?.position : undefined;
    const after = afterCardId ? state.cards[afterCardId]?.position : undefined;
    dispatch({ type: 'cardMovedLocally', cardId, columnId, position: positionBetween(before, after) });
    try {
      const moved = await api.moveCard(boardId, cardId, { columnId, beforeCardId, afterCardId, version: card.version });
      dispatch({ type: 'cardUpserted', card: moved });
    } catch (e) {
      toast(
        isApiError(e, 409) ? 'Someone changed that column at the same moment. The board was refreshed; try again.' : errorMessage(e),
        isApiError(e, 409) ? 'info' : 'error',
      );
      await reload();
    }
  };

  const saveCard = async (title: string, description: string | null, version: number) => {
    const saved = await api.editCard(boardId, openCardId!, title, description, version);
    dispatch({ type: 'cardUpserted', card: saved });
    return saved;
  };

  const deleteCard = async () => {
    const id = openCardId!;
    await api.deleteCard(boardId, id);
    dispatch({ type: 'cardRemoved', cardId: id });
    setOpenCardId(null);
  };

  const setEditing = useCallback(
    (cardId: string, isEditing: boolean) => {
      const hub = getHub();
      if (hub.state !== 'Connected') return;
      hub.invoke(isEditing ? 'StartEditing' : 'StopEditing', cardId).catch(() => undefined);
    },
    [],
  );
  const onEditingChange = useCallback(
    (isEditing: boolean) => openCardId && setEditing(openCardId, isEditing),
    [openCardId, setEditing],
  );

  const onMembers = useCallback(
    (result: Members) => {
      dispatch({ type: 'members', members: result.members, myUserId: user.uid });
      dispatch({ type: 'invites', invites: result.pendingInvites });
    },
    [dispatch, user.uid],
  );

  // ---- Render ----

  if (loadError) {
    return (
      <main className="page">
        <div className="empty-state">
          <h2>{loadError.notFound ? 'Board not found' : 'Could not load this board'}</h2>
          <p className="muted">
            {loadError.notFound ? 'It may have been deleted, or you are not a member.' : loadError.message}
          </p>
          <div className="row center">
            {!loadError.notFound && (
              <button className="button" onClick={() => void reload()}>
                Try again
              </button>
            )}
            <Link className="button primary" to="/">
              Back to boards
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!state.id) {
    return (
      <main className="page center">
        <Spinner label="Loading board" />
      </main>
    );
  }

  const openCard = openCardId ? state.cards[openCardId] : undefined;
  const openCardColumn = state.columns.find((c) => c.id === openCard?.columnId)?.name ?? '';

  return (
    <main className="board-page">
      <div className="board-header">
        <div className="board-title-row">
          <Link to="/" className="back-link" aria-label="All boards">
            ←
          </Link>
          <h1>
            <InlineEdit
              label="board name"
              className="board-title"
              value={state.name}
              maxLength={100}
              disabled={!isOwner}
              onSave={renameBoard}
            />
          </h1>
          <span className={`role-badge role-${state.myRole?.toLowerCase()}`}>{state.myRole}</span>
          <LiveIndicator status={live} />
        </div>
        <div className="board-actions">
          <div className="presence" aria-label="People viewing this board">
            {state.presence.slice(0, 5).map((u) => (
              <Avatar key={u.userId} id={u.userId} name={u.userId === user.uid ? `${u.displayName} (you)` : u.displayName} />
            ))}
            {state.presence.length > 5 && <span className="avatar avatar-more">+{state.presence.length - 5}</span>}
          </div>
          <button className={`button ${panel === 'chat' ? 'active' : ''}`} onClick={() => togglePanel('chat')}>
            Chat
            {chat.unread > 0 && (
              <span className="badge" aria-label={`${chat.unread} unread`}>
                {chat.unread > 99 ? '99+' : chat.unread}
              </span>
            )}
          </button>
          <button className={`button ${panel === 'members' ? 'active' : ''}`} onClick={() => togglePanel('members')}>
            Members · {state.members.length}
          </button>
          <button className={`button ${panel === 'activity' ? 'active' : ''}`} onClick={() => togglePanel('activity')}>
            Activity
          </button>
          {isOwner && (
            <button className="button ghost danger-text" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="view-tabs" role="tablist" aria-label="Board view">
        <button
          role="tab"
          aria-selected={view === 'cards'}
          className={`view-tab ${view === 'cards' ? 'active' : ''}`}
          onClick={() => setSearchParams({}, { replace: true })}
        >
          Cards
        </button>
        <button
          role="tab"
          aria-selected={view === 'whiteboard'}
          className={`view-tab ${view === 'whiteboard' ? 'active' : ''}`}
          onClick={() => setSearchParams({ view: 'whiteboard' }, { replace: true })}
        >
          Whiteboard
        </button>
        {!editable && <span className="muted small view-note">View-only access. Ask an owner for Editor access to make changes.</span>}
      </div>

      <div className="board-body">
        {view === 'whiteboard' ? (
          <Whiteboard key={boardId} boardId={boardId} canEdit={editable} myUserId={user.uid} />
        ) : (
        <BoardColumns
          columns={state.columns}
          cardsByColumn={grouped}
          editing={state.editing}
          canEdit={editable}
          onOpenCard={setOpenCardId}
          onMoveCard={(m) => void moveCard(m)}
          onAddCard={addCard}
          onAddColumn={addColumn}
          onRenameColumn={renameColumn}
          onRemoveColumn={(c) => void removeColumn(c)}
        />
        )}

        {panel === 'chat' && (
          <ChatPanel chat={chat} myUserId={user.uid} isOwner={isOwner} onClose={() => setPanel(null)} />
        )}

        {panel === 'members' && (
          <MembersPanel
            boardId={boardId}
            members={state.members}
            invites={state.invites}
            myRole={state.myRole}
            myUserId={user.uid}
            onlineIds={onlineIds}
            onMembers={onMembers}
            onLeave={leaveBoard}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'activity' && (
          <ActivityPanel
            boardId={boardId}
            activity={state.activity}
            hasMore={state.activityHasMore}
            dispatch={dispatch}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      {openCardId && (
        <CardModal
          key={openCardId}
          card={openCard}
          columnName={openCardColumn}
          members={state.members}
          editors={state.editing[openCardId]}
          canEdit={editable}
          myUserId={user.uid}
          onClose={() => setOpenCardId(null)}
          onSave={saveCard}
          onDelete={deleteCard}
          onEditingChange={onEditingChange}
          onConflict={(current: Card) => dispatch({ type: 'cardUpserted', card: current })}
        />
      )}

      {confirmDelete && (
        <Modal title="Delete board?" onClose={() => setConfirmDelete(false)}>
          <p>
            This permanently deletes <strong>{state.name}</strong>, all its cards and its activity history for every member.
          </p>
          <div className="row end">
            <button className="button ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button className="button danger" onClick={() => void deleteBoard()}>
              Delete board
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function useHubStatus(): HubStatus {
  const [status, setStatus] = useState<HubStatus>(hubStatus);
  useEffect(() => onHubStatus(setStatus), []);
  return status;
}

function LiveIndicator({ status }: { status: HubStatus }) {
  const label = { connected: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…', offline: 'Offline' }[status];
  return (
    <span className={`live live-${status}`} title={status === 'connected' ? 'Changes from others appear instantly' : 'Live updates paused'}>
      <span className="live-dot" />
      {label}
    </span>
  );
}
