import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';

const AVATAR_HUES = [12, 38, 145, 175, 205, 230, 265, 300, 330];

function hueFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ id, name, size = 28 }: { id: string; name: string; size?: number }) {
  return (
    <span
      className="avatar"
      title={name}
      style={{ width: size, height: size, fontSize: size * 0.4, ['--avatar-hue' as string]: hueFor(id) }}
    >
      {initials(name)}
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="progressbar" aria-label={label} />;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="drawer" aria-label={title}>
      <div className="drawer-header">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="drawer-body">{children}</div>
    </aside>
  );
}

/** Text that turns into an input when clicked. Saves on Enter or blur, cancels on Escape. */
export function InlineEdit({
  value,
  onSave,
  disabled,
  maxLength,
  className,
  label,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
  disabled?: boolean;
  maxLength?: number;
  className?: string;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (disabled || !editing) {
    return disabled ? (
      <span className={className}>{value}</span>
    ) : (
      <button className={`inline-edit ${className ?? ''}`} title={`Rename ${label}`} onClick={() => setEditing(true)}>
        {value}
      </button>
    );
  }

  const commit = async (e?: FormEvent) => {
    e?.preventDefault();
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      input.current?.focus(); // keep the draft so the user can fix it; the caller shows the error
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={commit} className="inline-edit-form">
      <input
        ref={input}
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    </form>
  );
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function timeAgo(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86400 * 30) return relative.format(Math.round(seconds / 86400), 'day');
  return new Date(iso).toLocaleDateString();
}
