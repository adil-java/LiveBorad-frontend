import {
  HttpTransportType,
  type HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import { config } from '../config';
import { auth } from '../lib/firebase';

/**
 * One SignalR connection per signed-in user, shared by every page.
 * The hub only carries live events and presence; all writes go through the REST API.
 */

export type HubStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

let connection: HubConnection | null = null;
let status: HubStatus = 'offline';
let stopped = true;
let startLoop: Promise<void> | null = null;

const statusListeners = new Set<(s: HubStatus) => void>();
const reconnectListeners = new Set<() => void>();

function setStatus(next: HubStatus) {
  status = next;
  statusListeners.forEach((l) => l(next));
}

function build(): HubConnection {
  const hub = new HubConnectionBuilder()
    .withUrl(`${config.apiUrl}/hubs/board`, {
      // Firebase returns the cached ID token and refreshes it shortly before it expires.
      accessTokenFactory: async () => (await auth.currentUser?.getIdToken()) ?? '',
      transport: HttpTransportType.WebSockets | HttpTransportType.ServerSentEvents | HttpTransportType.LongPolling,
    })
    // Keep retrying forever with capped backoff; the UI shows "Reconnecting" meanwhile.
    .withAutomaticReconnect({ nextRetryDelayInMilliseconds: (ctx) => Math.min(1000 * 2 ** ctx.previousRetryCount, 15000) })
    .configureLogging(LogLevel.Warning)
    .build();

  hub.onreconnecting(() => setStatus('reconnecting'));
  hub.onreconnected(() => {
    setStatus('connected');
    reconnectListeners.forEach((l) => l());
  });
  hub.onclose(() => {
    setStatus('offline');
    if (!stopped) void startWithRetry(); // closed for a reason other than sign-out: start over
  });
  return hub;
}

async function startWithRetry(): Promise<void> {
  if (startLoop) return startLoop;
  startLoop = (async () => {
    let attempt = 0;
    while (!stopped && connection && connection.state === HubConnectionState.Disconnected) {
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      try {
        await connection.start();
        setStatus('connected');
        if (attempt > 0) reconnectListeners.forEach((l) => l());
        return;
      } catch {
        attempt++;
        setStatus('offline');
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 15000)));
      }
    }
  })().finally(() => {
    startLoop = null;
  });
  return startLoop;
}

export function getHub(): HubConnection {
  connection ??= build();
  return connection;
}

/** Starts the connection if needed and resolves once it is connected. */
export async function connectHub(): Promise<HubConnection> {
  const hub = getHub();
  stopped = false;
  if (hub.state === HubConnectionState.Connected) return hub;
  if (hub.state === HubConnectionState.Disconnected) void startWithRetry();
  await new Promise<void>((resolve) => {
    if (hub.state === HubConnectionState.Connected) return resolve();
    const off = onHubStatus((s) => {
      if (s === 'connected') {
        off();
        resolve();
      }
    });
  });
  return hub;
}

/** Called on sign-out so the next user gets a fresh connection with their own token. */
export async function stopHub(): Promise<void> {
  stopped = true;
  const hub = connection;
  connection = null;
  if (hub) await hub.stop().catch(() => undefined);
  setStatus('offline');
}

export function hubStatus(): HubStatus {
  return status;
}

export function onHubStatus(listener: (s: HubStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Fires after the connection comes back; events sent meanwhile were missed, so callers should rejoin and reload. */
export function onHubReconnected(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

/** Sent with REST writes so the server skips echoing the change back to this tab. */
export function currentConnectionId(): string | null {
  return connection?.state === HubConnectionState.Connected ? connection.connectionId : null;
}
