import { type FormEvent, useLayoutEffect, useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import type { ChatMessage } from '../api/types';
import { useToast } from '../components/Toasts';
import { Avatar, Drawer, Spinner } from '../components/ui';
import type { ChatApi } from './useChat';

interface Props {
  chat: ChatApi;
  myUserId: string;
  isOwner: boolean;
  onClose(): void;
}

const GROUP_GAP_MS = 5 * 60 * 1000;

export function ChatPanel({ chat, myUserId, isOwner, onClose }: Props) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const previousHeight = useRef(0);
  const messages = chat.messages;

  // Keep the newest message in view, unless the reader scrolled up to read history.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    else if (loadingOlder) el.scrollTop += el.scrollHeight - previousHeight.current; // keep place after prepending
    previousHeight.current = el.scrollHeight;
  }, [messages, loadingOlder]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await chat.send(value);
      setText('');
      stickToBottom.current = true;
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSending(false);
    }
  };

  const loadOlder = async () => {
    setLoadingOlder(true);
    previousHeight.current = list.current?.scrollHeight ?? 0;
    try {
      await chat.loadOlder();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setLoadingOlder(false);
    }
  };

  const typing = chat.typingNames;

  return (
    <Drawer title="Chat" onClose={onClose}>
      <div className="chat">
        <div
          ref={list}
          className="chat-messages"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {messages === null && (
            <div className="center">
              <Spinner />
            </div>
          )}
          {chat.hasMore && (
            <button className="button ghost small full" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          )}
          {messages?.length === 0 && <p className="muted center chat-empty">No messages yet. Say hello 👋</p>}
          {messages?.map((m, i) => (
            <MessageRow
              key={m.id}
              message={m}
              grouped={isSameGroup(messages[i - 1], m)}
              mine={m.authorId === myUserId}
              canDelete={m.authorId === myUserId || isOwner}
              onDelete={() => chat.remove(m.id).catch((err) => toast(errorMessage(err), 'error'))}
            />
          ))}
        </div>

        <p className="chat-typing muted small" aria-live="polite">
          {typing.length === 1 && `${typing[0]} is typing…`}
          {typing.length === 2 && `${typing[0]} and ${typing[1]} are typing…`}
          {typing.length > 2 && 'Several people are typing…'}
        </p>

        <form className="chat-composer" onSubmit={submit}>
          <textarea
            aria-label="Message"
            placeholder="Message the board…"
            rows={2}
            maxLength={2000}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value.trim()) chat.notifyTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <button className="button primary" disabled={sending || !text.trim()}>
            Send
          </button>
        </form>
        <p className="muted small chat-hint">Enter to send · Shift+Enter for a new line</p>
      </div>
    </Drawer>
  );
}

function isSameGroup(previous: ChatMessage | undefined, current: ChatMessage) {
  return (
    !!previous &&
    previous.authorId === current.authorId &&
    new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_GAP_MS
  );
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function formatTime(iso: string) {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return today ? timeFormat.format(date) : `${dayFormat.format(date)}, ${timeFormat.format(date)}`;
}

function MessageRow({
  message,
  grouped,
  mine,
  canDelete,
  onDelete,
}: {
  message: ChatMessage;
  grouped: boolean;
  mine: boolean;
  canDelete: boolean;
  onDelete(): void;
}) {
  return (
    <div className={`chat-message ${grouped ? 'grouped' : ''} ${mine ? 'mine' : ''}`}>
      <div className="chat-avatar">{!grouped && <Avatar id={message.authorId} name={message.authorName} size={30} />}</div>
      <div className="chat-body">
        {!grouped && (
          <div className="chat-meta">
            <strong>{mine ? 'You' : message.authorName}</strong>
            <time className="muted small" dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
              {formatTime(message.createdAt)}
            </time>
          </div>
        )}
        <p className="chat-text">{message.text}</p>
      </div>
      {canDelete && (
        <button className="icon-button subtle chat-delete" aria-label="Delete message" title="Delete message" onClick={onDelete}>
          ×
        </button>
      )}
    </div>
  );
}
