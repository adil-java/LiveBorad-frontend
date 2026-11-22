import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type FormEvent, useMemo, useState } from 'react';
import type { Card, Column, PresenceUser } from '../api/types';
import { InlineEdit } from '../components/ui';
import { Avatar } from '../components/ui';

export interface MoveIntent {
  cardId: string;
  columnId: string;
  beforeCardId: string | null;
  afterCardId: string | null;
}

interface Props {
  columns: Column[];
  cardsByColumn: Record<string, Card[]>;
  editing: Record<string, PresenceUser[]>;
  canEdit: boolean;
  onOpenCard(cardId: string): void;
  onMoveCard(move: MoveIntent): void;
  onAddCard(columnId: string, title: string): Promise<void>;
  onAddColumn(name: string): Promise<void>;
  onRenameColumn(columnId: string, name: string): Promise<void>;
  onRemoveColumn(column: Column): void;
}

const COLUMN_PREFIX = 'column:';
const isColumnId = (id: string) => id.startsWith(COLUMN_PREFIX);

export function BoardColumns(props: Props) {
  const { columns, cardsByColumn, canEdit } = props;
  const [activeId, setActiveId] = useState<string | null>(null);
  /** While dragging, the order the user sees (card IDs per column). Committed on drop. */
  const [dragOrder, setDragOrder] = useState<Record<string, string[]> | null>(null);

  const sensors = useSensors(
    // A small threshold so a plain click still opens the card.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const cardById = useMemo(() => {
    const map: Record<string, Card> = {};
    for (const list of Object.values(cardsByColumn)) for (const c of list) map[c.id] = c;
    return map;
  }, [cardsByColumn]);

  const order: Record<string, string[]> = useMemo(() => {
    if (!dragOrder) return Object.fromEntries(columns.map((c) => [c.id, (cardsByColumn[c.id] ?? []).map((x) => x.id)]));
    // Cards deleted by someone else mid-drag disappear immediately.
    return Object.fromEntries(columns.map((c) => [c.id, (dragOrder[c.id] ?? []).filter((id) => cardById[id])]));
  }, [dragOrder, columns, cardsByColumn, cardById]);

  const columnOf = (id: string, current: Record<string, string[]>) =>
    isColumnId(id) ? id.slice(COLUMN_PREFIX.length) : Object.keys(current).find((col) => current[col].includes(id));

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setDragOrder(order);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);

    setDragOrder((prev) => {
      if (!prev) return prev;
      const from = columnOf(activeKey, prev);
      const to = columnOf(overKey, prev);
      if (!from || !to || from === to) return prev;
      const source = prev[from].filter((id) => id !== activeKey);
      const target = prev[to].filter((id) => id !== activeKey);
      let index = target.length;
      if (!isColumnId(overKey)) {
        const overIndex = target.indexOf(overKey);
        const translated = active.rect.current.translated;
        const below = translated && translated.top > over.rect.top + over.rect.height / 2;
        index = overIndex < 0 ? target.length : overIndex + (below ? 1 : 0);
      }
      target.splice(index, 0, activeKey);
      return { ...prev, [from]: source, [to]: target };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const cardId = String(active.id);
    const current = dragOrder;
    setActiveId(null);
    setDragOrder(null);
    if (!over || !current) return;

    const columnId = columnOf(cardId, current);
    if (!columnId) return;
    let list = current[columnId];
    const overKey = String(over.id);
    if (!isColumnId(overKey) && overKey !== cardId && list.includes(overKey)) {
      list = arrayMove(list, list.indexOf(cardId), list.indexOf(overKey));
    }

    const index = list.indexOf(cardId);
    const beforeCardId = list[index - 1] ?? null;
    const afterCardId = list[index + 1] ?? null;

    // Skip the request if the card ends up exactly where it started.
    const card = cardById[cardId];
    const original = (cardsByColumn[card?.columnId] ?? []).map((c) => c.id);
    const originalIndex = original.indexOf(cardId);
    const unchanged =
      card?.columnId === columnId &&
      (original[originalIndex - 1] ?? null) === beforeCardId &&
      (original[originalIndex + 1] ?? null) === afterCardId;
    if (!card || unchanged) return;

    props.onMoveCard({ cardId, columnId, beforeCardId, afterCardId });
  };

  const activeCard = activeId ? cardById[activeId] : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDragOrder(null);
      }}
    >
      <div className="columns">
        {columns.map((column) => (
          <ColumnView
            key={column.id}
            column={column}
            cards={order[column.id].map((id) => cardById[id])}
            {...props}
          />
        ))}
        {canEdit && <AddColumn onAdd={props.onAddColumn} />}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeCard ? <CardFace card={activeCard} editors={props.editing[activeCard.id]} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function ColumnView({
  column,
  cards,
  editing,
  canEdit,
  onOpenCard,
  onAddCard,
  onRenameColumn,
  onRemoveColumn,
}: Props & { column: Column; cards: Card[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: COLUMN_PREFIX + column.id });

  return (
    <section className="column" aria-label={column.name}>
      <header className="column-header">
        <InlineEdit
          className="column-title"
          label="column name"
          value={column.name}
          maxLength={50}
          disabled={!canEdit}
          onSave={(name) => onRenameColumn(column.id, name)}
        />
        <span className="count">{cards.length}</span>
        {canEdit && (
          <button
            className="icon-button subtle"
            title={cards.length ? 'Move or delete its cards first' : 'Remove column'}
            aria-label={`Remove column ${column.name}`}
            onClick={() => onRemoveColumn(column)}
          >
            ×
          </button>
        )}
      </header>
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={`card-list ${isOver ? 'is-over' : ''}`}>
          {cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              editors={editing[card.id]}
              canEdit={canEdit}
              onOpen={() => onOpenCard(card.id)}
            />
          ))}
          {cards.length === 0 && <p className="empty-column">{canEdit ? 'Drop cards here' : 'No cards'}</p>}
        </div>
      </SortableContext>
      {canEdit && <AddCard onAdd={(title) => onAddCard(column.id, title)} />}
    </section>
  );
}

function SortableCard({
  card,
  editors,
  canEdit,
  onOpen,
}: {
  card: Card;
  editors?: PresenceUser[];
  canEdit: boolean;
  onOpen(): void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? 'card-placeholder' : undefined}
      {...attributes}
      {...listeners}
      role="button"
      aria-roledescription={canEdit ? 'draggable card' : 'card'}
      onClick={onOpen}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter' && !e.defaultPrevented) onOpen();
      }}
    >
      <CardFace card={card} editors={editors} />
    </div>
  );
}

function CardFace({ card, editors, dragging }: { card: Card; editors?: PresenceUser[]; dragging?: boolean }) {
  return (
    <article className={`card ${dragging ? 'card-dragging' : ''} ${editors?.length ? 'card-being-edited' : ''}`}>
      <p className="card-title">{card.title}</p>
      {(card.description || editors?.length) && (
        <div className="card-meta">
          {card.description && (
            <span className="card-has-description" title="Has a description">
              ≡
            </span>
          )}
          {editors?.length ? (
            <span className="card-editors">
              {editors.map((u) => (
                <Avatar key={u.userId} id={u.userId} name={u.displayName} size={20} />
              ))}
              <span>{editors.length === 1 ? `${editors[0].displayName} is editing` : `${editors.length} editing`}</span>
            </span>
          ) : null}
        </div>
      )}
    </article>
  );
}

function AddCard({ onAdd }: { onAdd(title: string): Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button className="add-button" onClick={() => setOpen(true)}>
        + Add card
      </button>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onAdd(title.trim());
      setTitle(''); // stay open for quick entry of several cards
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        autoFocus
        aria-label="Card title"
        placeholder="What needs doing?"
        value={title}
        maxLength={200}
        rows={2}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) void submit(e);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <div className="row">
        <button className="button primary" disabled={busy || !title.trim()}>
          Add
        </button>
        <button type="button" className="button ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddColumn({ onAdd }: { onAdd(name: string): Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button className="add-column" onClick={() => setOpen(true)}>
        + Add column
      </button>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onAdd(name.trim());
      setName('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="column composer" onSubmit={submit}>
      <input
        autoFocus
        aria-label="Column name"
        placeholder="Column name"
        value={name}
        maxLength={50}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      />
      <div className="row">
        <button className="button primary" disabled={busy || !name.trim()}>
          Add column
        </button>
        <button type="button" className="button ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
