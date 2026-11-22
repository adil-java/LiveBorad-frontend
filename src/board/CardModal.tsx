import { type FormEvent, useEffect, useState } from 'react';
import { errorMessage, isApiError } from '../api/client';
import type { Card, Member, PresenceUser } from '../api/types';
import { useToast } from '../components/Toasts';
import { Avatar, Modal, timeAgo } from '../components/ui';

interface Props {
  /** The live card from board state, or undefined once someone deletes it. */
  card: Card | undefined;
  columnName: string;
  members: Member[];
  editors: PresenceUser[] | undefined;
  canEdit: boolean;
  myUserId: string;
  onClose(): void;
  onSave(title: string, description: string | null, version: number): Promise<Card>;
  onDelete(): Promise<void>;
  onEditingChange(isEditing: boolean): void;
  /** Lets the board apply the current card returned with a 409. */
  onConflict(current: Card): void;
}

function snapshot(card: Card | undefined) {
  return { version: card?.version ?? 0, title: card?.title ?? '', description: card?.description ?? '' };
}

/**
 * View and edit a card. Edits are sent with the version the user started from; if someone else saved first,
 * the server answers 409 with their version and the user picks which one to keep.
 */
export function CardModal(props: Props) {
  const { card, canEdit, onEditingChange } = props;
  const toast = useToast();
  /** The copy of the card the draft started from; its version is what a save is checked against. */
  const [base, setBase] = useState(() => snapshot(card));
  const [title, setTitle] = useState(base.title);
  const [description, setDescription] = useState(base.description);
  const [conflict, setConflict] = useState<Card | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = title !== base.title || description !== base.description;

  const rebase = (next: Card) => {
    const s = snapshot(next);
    setBase(s);
    setTitle(s.title);
    setDescription(s.description);
  };

  // Someone else saved while the modal is open: take their version if the user hasn't typed anything.
  // (Adjusting state during render is React's recommended way to follow a changing prop.)
  if (card && card.version !== base.version && !dirty && !conflict) rebase(card);

  // Tell others this card is being edited while the modal is open.
  useEffect(() => {
    if (!canEdit) return;
    onEditingChange(true);
    return () => onEditingChange(false);
  }, [canEdit, onEditingChange]);

  const nameOf = (userId: string) =>
    userId === props.myUserId ? 'you' : (props.members.find((m) => m.userId === userId)?.displayName ?? 'someone');

  const changedUnderneath = !!card && card.version !== base.version && !conflict;

  const save = async (version: number) => {
    setSaving(true);
    try {
      await props.onSave(title.trim(), description.trim() || null, version);
      setConflict(null);
      props.onClose();
    } catch (e) {
      if (isApiError(e, 409) && e.body && typeof e.body === 'object') {
        const current = e.body as Card;
        props.onConflict(current);
        setConflict(current);
      } else {
        toast(errorMessage(e), 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    void save(base.version);
  };

  const useTheirs = () => {
    if (!conflict) return;
    rebase(conflict);
    setConflict(null);
  };

  if (!card) {
    return (
      <Modal title="Card deleted" onClose={props.onClose}>
        <p className="muted">Someone deleted this card while you had it open.</p>
        <div className="row end">
          <button className="button primary" onClick={props.onClose}>
            Close
          </button>
        </div>
      </Modal>
    );
  }

  const others = props.editors ?? [];

  return (
    <Modal title={canEdit ? 'Edit card' : 'Card'} onClose={props.onClose} wide>
      <p className="muted small">
        In <strong>{props.columnName}</strong> · last changed by {nameOf(card.updatedBy)} {timeAgo(card.updatedAt)}
      </p>

      {others.length > 0 && (
        <div className="notice">
          {others.map((u) => (
            <Avatar key={u.userId} id={u.userId} name={u.displayName} size={20} />
          ))}
          <span>{others.map((u) => u.displayName).join(', ')} also editing this card.</span>
        </div>
      )}

      {changedUnderneath && (
        <div className="notice warning">
          {nameOf(card.updatedBy)} saved a change while you were editing. Saving now will ask you to resolve it.
        </div>
      )}

      {conflict && (
        <div className="conflict">
          <p>
            <strong>{nameOf(conflict.updatedBy)}</strong> saved this card first. Their version:
          </p>
          <div className="conflict-version">
            <p className="card-title">{conflict.title}</p>
            {conflict.description && <p className="pre">{conflict.description}</p>}
          </div>
          <div className="row">
            <button className="button primary" disabled={saving} onClick={() => void save(conflict.version)}>
              Keep mine
            </button>
            <button className="button" disabled={saving} onClick={useTheirs}>
              Use theirs
            </button>
          </div>
        </div>
      )}

      {canEdit ? (
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>Title</span>
            <input value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              value={description}
              maxLength={5000}
              rows={8}
              placeholder="Add more detail…"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="row spread">
            {confirmDelete ? (
              <div className="row">
                <span className="muted small">Delete this card?</span>
                <button
                  type="button"
                  className="button danger"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await props.onDelete();
                    } catch (e) {
                      toast(errorMessage(e), 'error');
                      setSaving(false);
                    }
                  }}
                >
                  Delete
                </button>
                <button type="button" className="button ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <button type="button" className="button ghost danger-text" onClick={() => setConfirmDelete(true)}>
                Delete card
              </button>
            )}
            <div className="row">
              <button type="button" className="button ghost" onClick={props.onClose}>
                Cancel
              </button>
              <button className="button primary" disabled={saving || !title.trim() || !!conflict}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="stack">
          <h3 className="card-title large">{card.title}</h3>
          {card.description ? <p className="pre">{card.description}</p> : <p className="muted">No description.</p>}
          <p className="muted small">You have view-only access to this board.</p>
        </div>
      )}
    </Modal>
  );
}
