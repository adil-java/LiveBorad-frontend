import { type FormEvent, useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { type BoardRole, canManage, type Invite, type Member, type Members, ROLES } from '../api/types';
import { useToast } from '../components/Toasts';
import { Avatar, Drawer, timeAgo } from '../components/ui';

interface Props {
  boardId: string;
  members: Member[];
  invites: Invite[];
  myRole: BoardRole | undefined;
  myUserId: string;
  onlineIds: Set<string>;
  onMembers(result: Members): void;
  onLeave(): Promise<void>;
  onClose(): void;
}

export function MembersPanel({ boardId, members, invites, myRole, myUserId, onlineIds, onMembers, onLeave, onClose }: Props) {
  const toast = useToast();
  const isOwner = canManage(myRole);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<BoardRole>('Editor');
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Pending invites are not pushed live, so refresh them when the panel opens.
  useEffect(() => {
    api.listMembers(boardId).then(onMembers, () => undefined);
  }, [boardId, onMembers]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;
    void run(async () => {
      const before = new Set(members.map((m) => m.userId));
      const result = await api.inviteMember(boardId, address, role);
      onMembers(result);
      setEmail('');
      const added = result.members.find((m) => !before.has(m.userId));
      toast(
        added
          ? `${added.displayName} now has access as ${role}.`
          : `Invite saved. ${address} gets access the next time they sign in with that verified email. LiveBoard doesn't send emails, so let them know.`,
        'success',
      );
    });
  };

  return (
    <Drawer title="Members" onClose={onClose}>
      {isOwner && (
        <form className="stack invite-form" onSubmit={invite}>
          <label className="field">
            <span>Add people by email</span>
            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              required
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <div className="row">
            <select aria-label="Role" value={role} disabled={busy} onChange={(e) => setRole(e.target.value as BoardRole)}>
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <button className="button primary" disabled={busy || !email.trim()}>
              Add
            </button>
          </div>
          <p className="muted small">Viewers can only look. Editors can change columns and cards. Owners also manage members.</p>
        </form>
      )}

      <ul className="member-list">
        {members.map((m) => {
          const isMe = m.userId === myUserId;
          return (
            <li key={m.userId}>
              <span className="presence-wrap">
                <Avatar id={m.userId} name={m.displayName} size={32} />
                {onlineIds.has(m.userId) && <span className="online-dot" title="Viewing this board now" />}
              </span>
              <div className="member-info">
                <strong>
                  {m.displayName}
                  {isMe && <span className="muted"> (you)</span>}
                </strong>
                {m.email && <span className="muted small">{m.email}</span>}
              </div>
              {isOwner && !isMe ? (
                <div className="row">
                  <select
                    aria-label={`Role for ${m.displayName}`}
                    value={m.role}
                    disabled={busy}
                    onChange={(e) =>
                      void run(async () => onMembers(await api.changeRole(boardId, m.userId, e.target.value as BoardRole)))
                    }
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <button
                    className="icon-button subtle"
                    aria-label={`Remove ${m.displayName}`}
                    title="Remove from board"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.removeMember(boardId, m.userId);
                        onMembers({ members: members.filter((x) => x.userId !== m.userId), pendingInvites: invites });
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ) : (
                <span className={`role-badge role-${m.role.toLowerCase()}`}>{m.role}</span>
              )}
            </li>
          );
        })}
      </ul>

      {isOwner && invites.length > 0 && (
        <>
          <h3 className="section-title">Pending invites</h3>
          <ul className="member-list">
            {invites.map((i) => (
              <li key={i.email}>
                <span className="avatar avatar-pending">@</span>
                <div className="member-info">
                  <strong>{i.email}</strong>
                  <span className="muted small">
                    {i.role} · invited {timeAgo(i.invitedAt)}
                  </span>
                </div>
                <button
                  className="button ghost small"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.cancelInvite(boardId, i.email);
                      onMembers({ members, pendingInvites: invites.filter((x) => x.email !== i.email) });
                    })
                  }
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="drawer-footer">
        {confirmLeave ? (
          <div className="row">
            <span className="muted small">Leave this board?</span>
            <button className="button danger" disabled={busy} onClick={() => void run(onLeave)}>
              Leave
            </button>
            <button className="button ghost" onClick={() => setConfirmLeave(false)}>
              Stay
            </button>
          </div>
        ) : (
          <button className="button ghost danger-text" onClick={() => setConfirmLeave(true)}>
            Leave board
          </button>
        )}
      </div>
    </Drawer>
  );
}
