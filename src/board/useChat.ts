import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/endpoints';
import type { ChatMessage, PresenceUser } from '../api/types';
import { auth } from '../lib/firebase';
import { getHub, onHubReconnected } from '../realtime/hub';

const PAGE = 50;
const TYPING_SHOWN_MS = 4000;
const TYPING_SEND_EVERY_MS = 2500;

/**
 * A board's chat. Stays subscribed while the board is open (not only while the panel is visible)
 * so it can count unread messages.
 */
export function useChat(boardId: string, isOpen: boolean) {
  /** Oldest first, for display. */
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [unread, setUnread] = useState(0);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const openRef = useRef(isOpen);
  const lastTypingSent = useRef(0);

  useEffect(() => {
    openRef.current = isOpen;
    if (isOpen) setUnread(0);
  }, [isOpen]);

  const loadLatest = useCallback(async () => {
    try {
      const page = await api.listChat(boardId);
      setMessages(page.reverse());
      setHasMore(page.length === PAGE);
    } catch {
      setMessages((m) => m ?? []);
    }
  }, [boardId]);

  const loadOlder = useCallback(async () => {
    const oldest = messages?.[0];
    if (!oldest) return;
    const page = await api.listChat(boardId, oldest.createdAt);
    setMessages((current) => {
      const seen = new Set(current?.map((m) => m.id));
      return [...page.reverse().filter((m) => !seen.has(m.id)), ...(current ?? [])];
    });
    setHasMore(page.length === PAGE);
  }, [boardId, messages]);

  const add = useCallback((message: ChatMessage) => {
    setMessages((current) =>
      current?.some((m) => m.id === message.id) ? current : [...(current ?? []), message],
    );
  }, []);

  useEffect(() => {
    setMessages(null);
    setUnread(0);
    setTyping({});
    void loadLatest();

    const hub = getHub();
    const myUserId = auth.currentUser?.uid;

    const onAdded = (message: ChatMessage) => {
      if (message.boardId !== boardId) return;
      add(message);
      setTyping(({ [message.authorId]: _, ...rest }) => rest);
      if (!openRef.current && message.authorId !== myUserId) setUnread((n) => n + 1);
    };
    const onDeleted = (id: string, messageId: string) => {
      if (id === boardId) setMessages((current) => current?.filter((m) => m.id !== messageId) ?? null);
    };
    const onTyping = (id: string, user: PresenceUser) => {
      if (id === boardId && user.userId !== myUserId)
        setTyping((t) => ({ ...t, [user.userId]: { name: user.displayName, until: Date.now() + TYPING_SHOWN_MS } }));
    };

    hub.on('ChatMessageAdded', onAdded);
    hub.on('ChatMessageDeleted', onDeleted);
    hub.on('ChatTyping', onTyping);
    const offReconnect = onHubReconnected(() => void loadLatest()); // messages sent while offline

    const prune = setInterval(() => {
      setTyping((t) => {
        const now = Date.now();
        const live = Object.entries(t).filter(([, v]) => v.until > now);
        return live.length === Object.keys(t).length ? t : Object.fromEntries(live);
      });
    }, 1000);

    return () => {
      hub.off('ChatMessageAdded', onAdded);
      hub.off('ChatMessageDeleted', onDeleted);
      hub.off('ChatTyping', onTyping);
      offReconnect();
      clearInterval(prune);
    };
  }, [boardId, add, loadLatest]);

  const send = useCallback(
    async (text: string) => {
      const message = await api.sendChat(boardId, text);
      add(message);
      lastTypingSent.current = 0;
    },
    [boardId, add],
  );

  const remove = useCallback(
    async (messageId: string) => {
      await api.deleteChat(boardId, messageId);
      setMessages((current) => current?.filter((m) => m.id !== messageId) ?? null);
    },
    [boardId],
  );

  /** Call on every keystroke; actually sends at most every few seconds. */
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_SEND_EVERY_MS) return;
    lastTypingSent.current = now;
    const hub = getHub();
    if (hub.state === 'Connected') hub.invoke('Typing').catch(() => undefined);
  }, []);

  return {
    messages,
    hasMore,
    unread,
    typingNames: Object.values(typing).map((t) => t.name),
    loadOlder,
    send,
    remove,
    notifyTyping,
  };
}

export type ChatApi = ReturnType<typeof useChat>;
