import { config } from '../config';
import { auth } from '../lib/firebase';
import { currentConnectionId } from '../realtime/hub';

export class ApiError extends Error {
  readonly status: number;
  /** Parsed response body. For 409 on cards this is the current card. */
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export const isApiError = (e: unknown, status?: number): e is ApiError =>
  e instanceof ApiError && (status === undefined || e.status === status);

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFor(status: number, body: unknown): string {
  const problem = body as { detail?: string; title?: string } | null;
  if (problem && typeof problem === 'object' && (problem.detail || problem.title)) {
    return problem.detail || problem.title!;
  }
  switch (status) {
    case 401:
      return 'Your session expired. Please sign in again.';
    case 403:
      return 'You do not have permission to do this.';
    case 404:
      return 'Not found. It may have been deleted.';
    case 409:
      return 'Someone else changed this at the same time.';
    default:
      return `The server returned an error (${status}).`;
  }
}

export async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, 'You are signed out.', null);

  const headers: Record<string, string> = { Authorization: `Bearer ${await user.getIdToken()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const connectionId = currentConnectionId();
  if (connectionId) headers['X-SignalR-Connection-Id'] = connectionId;

  let response: Response;
  try {
    response = await fetch(config.apiUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, `Cannot reach the server at ${config.apiUrl}. Is the API running?`, null);
  }

  const text = response.status === 204 ? '' : await response.text();
  const data = text ? parse(text) : undefined;
  if (!response.ok) throw new ApiError(response.status, messageFor(response.status, data), data);
  return data as T;
}
