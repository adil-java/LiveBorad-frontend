// Mirrors backend/src/LiveBoard.Api/Features/Contracts.cs. Enums are serialized as strings.

export type BoardRole = 'Viewer' | 'Editor' | 'Owner';
export const ROLES: BoardRole[] = ['Viewer', 'Editor', 'Owner'];

const rank: Record<BoardRole, number> = { Viewer: 0, Editor: 1, Owner: 2 };
export const canEdit = (role: BoardRole | undefined) => role !== undefined && rank[role] >= rank.Editor;
export const canManage = (role: BoardRole | undefined) => role !== undefined && rank[role] >= rank.Owner;

export interface Me {
  userId: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  joinedBoardIds: string[];
}

export interface BoardSummary {
  id: string;
  name: string;
  role: BoardRole;
  memberCount: number;
  createdAt: string;
}

export interface Column {
  id: string;
  name: string;
  position: number;
}

export interface Card {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  position: number;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

export interface CardPosition {
  cardId: string;
  position: number;
}

export interface Member {
  userId: string;
  displayName: string;
  email: string | null;
  role: BoardRole;
}

export interface Invite {
  email: string;
  role: BoardRole;
  invitedAt: string;
}

export interface Members {
  members: Member[];
  pendingInvites: Invite[];
}

export interface BoardDetail {
  id: string;
  name: string;
  myRole: BoardRole;
  columns: Column[];
  cards: Card[];
  members: Member[];
  pendingInvites: Invite[];
}

export interface PresenceUser {
  userId: string;
  displayName: string;
}

export type ActivityType =
  | 'BoardCreated'
  | 'BoardRenamed'
  | 'ColumnAdded'
  | 'ColumnRenamed'
  | 'ColumnRemoved'
  | 'CardCreated'
  | 'CardEdited'
  | 'CardMoved'
  | 'CardDeleted'
  | 'MemberAdded'
  | 'MemberInvited'
  | 'MemberRoleChanged'
  | 'MemberRemoved'
  | 'DrawingCleared'
  | 'CallStarted';

export interface Activity {
  id: string;
  actorId: string;
  actorName: string;
  type: ActivityType;
  summary: string;
  cardId: string | null;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  boardId: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export type StrokeTool = 'Pen' | 'Highlighter';

/** Points are flattened [x0, y0, x1, y1, ...] in a fixed logical canvas (see CANVAS in board/whiteboard). */
export interface Stroke {
  id: string;
  boardId: string;
  authorId: string;
  tool: StrokeTool;
  color: string;
  width: number;
  points: number[];
  createdAt: string;
}

/** One browser connection in a board's call; connectionId addresses it for WebRTC signalling. */
export interface CallParticipant {
  connectionId: string;
  userId: string;
  displayName: string;
  micOn: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
  isGuest: boolean;
}

/** A call room anyone with the code can join, including guests without an account. */
export interface Room {
  id: string;
  code: string;
  name: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  peopleInCall: number;
}

export interface IceServer {
  urls: string[];
  username: string | null;
  credential: string | null;
}
