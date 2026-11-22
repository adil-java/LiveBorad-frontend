import { apiRequest } from './client';
import type { Activity, BoardDetail, BoardRole, BoardSummary, Card, ChatMessage, Column, Me, Members, Stroke, StrokeTool } from './types';

const board = (boardId: string) => `/api/boards/${boardId}`;

export const api = {
  syncMe: () => apiRequest<Me>('POST', '/api/me/sync'),

  listBoards: () => apiRequest<BoardSummary[]>('GET', '/api/boards'),
  createBoard: (name: string) => apiRequest<BoardSummary>('POST', '/api/boards', { name }),
  getBoard: (boardId: string) => apiRequest<BoardDetail>('GET', board(boardId)),
  renameBoard: (boardId: string, name: string) => apiRequest<BoardSummary>('PATCH', board(boardId), { name }),
  deleteBoard: (boardId: string) => apiRequest<void>('DELETE', board(boardId)),

  addColumn: (boardId: string, name: string) => apiRequest<Column>('POST', `${board(boardId)}/columns`, { name }),
  renameColumn: (boardId: string, columnId: string, name: string) =>
    apiRequest<Column>('PATCH', `${board(boardId)}/columns/${columnId}`, { name }),
  removeColumn: (boardId: string, columnId: string) => apiRequest<void>('DELETE', `${board(boardId)}/columns/${columnId}`),

  createCard: (boardId: string, columnId: string, title: string, description: string | null) =>
    apiRequest<Card>('POST', `${board(boardId)}/cards`, { columnId, title, description }),
  editCard: (boardId: string, cardId: string, title: string, description: string | null, version: number) =>
    apiRequest<Card>('PUT', `${board(boardId)}/cards/${cardId}`, { title, description, version }),
  moveCard: (
    boardId: string,
    cardId: string,
    move: { columnId: string; beforeCardId: string | null; afterCardId: string | null; version: number },
  ) => apiRequest<Card>('POST', `${board(boardId)}/cards/${cardId}/move`, move),
  deleteCard: (boardId: string, cardId: string) => apiRequest<void>('DELETE', `${board(boardId)}/cards/${cardId}`),

  listMembers: (boardId: string) => apiRequest<Members>('GET', `${board(boardId)}/members`),
  inviteMember: (boardId: string, email: string, role: BoardRole) =>
    apiRequest<Members>('POST', `${board(boardId)}/members`, { email, role }),
  changeRole: (boardId: string, userId: string, role: BoardRole) =>
    apiRequest<Members>('PATCH', `${board(boardId)}/members/${encodeURIComponent(userId)}`, { role }),
  removeMember: (boardId: string, userId: string) =>
    apiRequest<void>('DELETE', `${board(boardId)}/members/${encodeURIComponent(userId)}`),
  cancelInvite: (boardId: string, email: string) =>
    apiRequest<void>('DELETE', `${board(boardId)}/members/invites/${encodeURIComponent(email)}`),

  listActivity: (boardId: string, before?: string) => {
    const query = new URLSearchParams({ limit: '30' });
    if (before) query.set('before', before);
    return apiRequest<Activity[]>('GET', `${board(boardId)}/activity?${query}`);
  },

  listChat: (boardId: string, before?: string) => {
    const query = new URLSearchParams({ limit: '50' });
    if (before) query.set('before', before);
    return apiRequest<ChatMessage[]>('GET', `${board(boardId)}/chat?${query}`);
  },
  sendChat: (boardId: string, text: string) => apiRequest<ChatMessage>('POST', `${board(boardId)}/chat`, { text }),
  deleteChat: (boardId: string, messageId: string) => apiRequest<void>('DELETE', `${board(boardId)}/chat/${messageId}`),

  listStrokes: (boardId: string) => apiRequest<Stroke[]>('GET', `${board(boardId)}/drawing`),
  addStroke: (boardId: string, stroke: { id: string; tool: StrokeTool; color: string; width: number; points: number[] }) =>
    apiRequest<Stroke>('POST', `${board(boardId)}/drawing/strokes`, stroke),
  eraseStrokes: (boardId: string, strokeIds: string[]) =>
    apiRequest<void>('POST', `${board(boardId)}/drawing/erase`, { strokeIds }),
  clearDrawing: (boardId: string) => apiRequest<void>('DELETE', `${board(boardId)}/drawing`),
};
