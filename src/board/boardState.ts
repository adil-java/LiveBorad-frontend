import type { Activity, BoardDetail, BoardRole, Card, CardPosition, Column, Invite, Member, PresenceUser } from '../api/types';

export interface BoardState {
  id: string | null;
  name: string;
  myRole: BoardRole | undefined;
  columns: Column[];
  cards: Record<string, Card>;
  members: Member[];
  invites: Invite[];
  presence: PresenceUser[];
  /** cardId -> people currently editing it (other than me). */
  editing: Record<string, PresenceUser[]>;
  activity: Activity[] | null;
  activityHasMore: boolean;
}

export const emptyBoard: BoardState = {
  id: null,
  name: '',
  myRole: undefined,
  columns: [],
  cards: {},
  members: [],
  invites: [],
  presence: [],
  editing: {},
  activity: null,
  activityHasMore: false,
};

export type BoardAction =
  | { type: 'reset' }
  | { type: 'loaded'; detail: BoardDetail }
  | { type: 'renamed'; name: string }
  | { type: 'columns'; columns: Column[] }
  | { type: 'columnUpserted'; column: Column }
  | { type: 'columnRemoved'; columnId: string }
  | { type: 'cardUpserted'; card: Card }
  | { type: 'cardMovedLocally'; cardId: string; columnId: string; position: number }
  | { type: 'cardRemoved'; cardId: string }
  | { type: 'repositioned'; positions: CardPosition[] }
  | { type: 'members'; members: Member[]; myUserId: string }
  | { type: 'invites'; invites: Invite[] }
  | { type: 'presence'; users: PresenceUser[] }
  | { type: 'editing'; cardId: string; user: PresenceUser; isEditing: boolean }
  | { type: 'activityLoaded'; entries: Activity[]; append: boolean; hasMore: boolean }
  | { type: 'activityAdded'; entry: Activity };

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'reset':
      return emptyBoard;

    case 'loaded': {
      const { detail } = action;
      return {
        ...state,
        id: detail.id,
        name: detail.name,
        myRole: detail.myRole,
        columns: [...detail.columns].sort(byPosition),
        cards: Object.fromEntries(detail.cards.map((c) => [c.id, c])),
        members: detail.members,
        invites: detail.pendingInvites,
      };
    }

    case 'renamed':
      return { ...state, name: action.name };

    case 'columns':
      return { ...state, columns: [...action.columns].sort(byPosition) };

    case 'columnUpserted': {
      const others = state.columns.filter((c) => c.id !== action.column.id);
      return { ...state, columns: [...others, action.column].sort(byPosition) };
    }

    case 'columnRemoved':
      return { ...state, columns: state.columns.filter((c) => c.id !== action.columnId) };

    case 'cardUpserted': {
      // Versions only go up, so an older copy (e.g. a late event) never overwrites a newer one.
      const existing = state.cards[action.card.id];
      if (existing && existing.version > action.card.version) return state;
      return { ...state, cards: { ...state.cards, [action.card.id]: action.card } };
    }

    case 'cardMovedLocally': {
      const card = state.cards[action.cardId];
      if (!card) return state;
      return {
        ...state,
        cards: { ...state.cards, [card.id]: { ...card, columnId: action.columnId, position: action.position } },
      };
    }

    case 'cardRemoved': {
      if (!state.cards[action.cardId]) return state;
      const { [action.cardId]: _removed, ...rest } = state.cards;
      const { [action.cardId]: _editors, ...editing } = state.editing;
      return { ...state, cards: rest, editing };
    }

    case 'repositioned': {
      const cards = { ...state.cards };
      for (const { cardId, position } of action.positions) {
        if (cards[cardId]) cards[cardId] = { ...cards[cardId], position };
      }
      return { ...state, cards };
    }

    case 'members': {
      const me = action.members.find((m) => m.userId === action.myUserId);
      return { ...state, members: action.members, myRole: me?.role ?? state.myRole };
    }

    case 'invites':
      return { ...state, invites: action.invites };

    case 'presence': {
      // Drop "is editing" markers for people who left.
      const online = new Set(action.users.map((u) => u.userId));
      const editing = Object.fromEntries(
        Object.entries(state.editing)
          .map(([cardId, users]) => [cardId, users.filter((u) => online.has(u.userId))] as const)
          .filter(([, users]) => users.length > 0),
      );
      return { ...state, presence: action.users, editing };
    }

    case 'editing': {
      const current = (state.editing[action.cardId] ?? []).filter((u) => u.userId !== action.user.userId);
      const next = action.isEditing ? [...current, action.user] : current;
      const editing = { ...state.editing };
      if (next.length) editing[action.cardId] = next;
      else delete editing[action.cardId];
      return { ...state, editing };
    }

    case 'activityLoaded': {
      const base = action.append && state.activity ? state.activity : [];
      const seen = new Set(base.map((a) => a.id));
      return {
        ...state,
        activity: [...base, ...action.entries.filter((a) => !seen.has(a.id))],
        activityHasMore: action.hasMore,
      };
    }

    case 'activityAdded':
      if (!state.activity || state.activity.some((a) => a.id === action.entry.id)) return state;
      return { ...state, activity: [action.entry, ...state.activity] };
  }
}

/** Cards of each column in display order. */
export function cardsByColumn(state: BoardState): Record<string, Card[]> {
  const result: Record<string, Card[]> = Object.fromEntries(state.columns.map((c) => [c.id, [] as Card[]]));
  for (const card of Object.values(state.cards)) result[card.columnId]?.push(card);
  for (const list of Object.values(result)) list.sort(byPosition);
  return result;
}

/** Same rule as the server's Ranking.Between, used to place a card optimistically before the server answers. */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  const step = 1024;
  if (before === undefined && after === undefined) return step;
  if (after === undefined) return before! + step;
  if (before === undefined) return after - step;
  return before + (after - before) / 2;
}
