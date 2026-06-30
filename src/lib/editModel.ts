/**
 * editModel.ts — pure logic for the JSONL line editor.
 *
 * Works on RAW lines, not rendered turns. This keeps serialization byte-faithful:
 * untouched rows are written back as their original string; only dirty rows are
 * re-serialized via JSON.stringify.
 *
 * No browser dependencies — fully testable in Node.js.
 */

// ── Row type ──────────────────────────────────────────────────────────────────

export interface Row {
  id: number;
  original: string;     // exact original line text
  obj: unknown | null;  // JSON.parse(original), or null if it didn't parse
  deleted: boolean;
  dirty: boolean;       // true if obj was edited and needs re-serialization
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Split raw JSONL text into editable rows.
 * Empty lines (including the trailing newline) are dropped.
 * IDs are sequential starting from `idStart` (default 0).
 */
export function parseRows(rawText: string, idStart = 0): Row[] {
  const lines = rawText.split('\n');
  // Drop trailing empty line produced by the final \n
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  let nextId = idStart;
  return lines
    .filter(line => line.trim() !== '')
    .map(line => {
      let obj: unknown | null = null;
      try {
        obj = JSON.parse(line);
      } catch {
        obj = null;
      }
      return { id: nextId++, original: line, obj, deleted: false, dirty: false };
    });
}

// ── Serialization ─────────────────────────────────────────────────────────────

/**
 * Produce the file content to write.
 * Untouched rows use their original string byte-for-byte.
 * Dirty rows are re-serialized via JSON.stringify.
 */
export function serialize(rows: Row[]): string {
  return (
    rows
      .filter(r => !r.deleted)
      .map(r => (r.dirty && r.obj !== null ? JSON.stringify(r.obj) : r.original))
      .join('\n') + '\n'
  );
}

// ── Deep clone ────────────────────────────────────────────────────────────────

function deepCloneRow(r: Row): Row {
  return {
    ...r,
    obj: r.obj === null ? null : JSON.parse(JSON.stringify(r.obj)),
  };
}

function deepCloneRows(rows: Row[]): Row[] {
  return rows.map(deepCloneRow);
}

// ── Mutating operations (all return a new array — immutable style) ─────────────

/** Mark a row as deleted. */
export function deleteRow(rows: Row[], id: number): Row[] {
  return rows.map(r => (r.id === id ? { ...r, deleted: true } : r));
}

/** Un-delete a row. */
export function restoreRow(rows: Row[], id: number): Row[] {
  return rows.map(r => (r.id === id ? { ...r, deleted: false } : r));
}

/** Move a row one position up in the array. */
export function moveUp(rows: Row[], id: number): Row[] {
  const idx = rows.findIndex(r => r.id === id);
  if (idx <= 0) return rows;
  const next = [...rows];
  [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
  return next;
}

/** Move a row one position down in the array. */
export function moveDown(rows: Row[], id: number): Row[] {
  const idx = rows.findIndex(r => r.id === id);
  if (idx < 0 || idx >= rows.length - 1) return rows;
  const next = [...rows];
  [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
  return next;
}

/**
 * Update the textual content of a row.
 * - If obj.message.content is a string  → replaces it.
 * - If obj.message.content is an array  → replaces the first block of type
 *   'text' .text, or prepends a new {type:'text', text} block if none exists.
 * Marks the row dirty so serialize() will re-serialize it.
 * Rows whose obj is null (unparseable lines) are returned unchanged.
 */
export function editText(rows: Row[], id: number, newText: string): Row[] {
  return rows.map(r => {
    if (r.id !== id || r.obj === null) return r;
    const obj = JSON.parse(JSON.stringify(r.obj)) as Record<string, unknown>;
    const msg = obj.message as Record<string, unknown> | undefined;
    if (!msg) return r;
    const content = msg.content;
    if (typeof content === 'string') {
      msg.content = newText;
    } else if (Array.isArray(content)) {
      const idx = (content as Array<{ type: string; text?: string }>).findIndex(
        b => b.type === 'text'
      );
      if (idx >= 0) {
        (content as Array<{ type: string; text?: string }>)[idx] = {
          ...(content as Array<{ type: string; text?: string }>)[idx],
          text: newText,
        };
      } else {
        (content as Array<unknown>).unshift({ type: 'text', text: newText });
      }
    } else {
      // Cannot edit non-string, non-array content
      return r;
    }
    return { ...r, obj, dirty: true };
  });
}

// ── Undo / redo ───────────────────────────────────────────────────────────────

const MAX_HISTORY = 100;

export interface EditHistory {
  past: Row[][];   // states before each operation; top = most recent
  future: Row[][]; // states after an undo; top = most recent undo
}

export function createHistory(): EditHistory {
  return { past: [], future: [] };
}

/**
 * Call BEFORE a mutating operation.
 * Saves `current` onto the past stack and clears the redo stack.
 */
export function pushHistory(hist: EditHistory, current: Row[]): EditHistory {
  const past = [...hist.past, deepCloneRows(current)];
  if (past.length > MAX_HISTORY) past.shift();
  return { past, future: [] };
}

/** Undo: pop from past, push current to future. */
export function undo(
  hist: EditHistory,
  current: Row[]
): { hist: EditHistory; rows: Row[] } {
  if (hist.past.length === 0) return { hist, rows: current };
  const past = [...hist.past];
  const prev = past.pop()!;
  return {
    hist: { past, future: [deepCloneRows(current), ...hist.future] },
    rows: prev,
  };
}

/** Redo: pop from future, push current to past. */
export function redo(
  hist: EditHistory,
  current: Row[]
): { hist: EditHistory; rows: Row[] } {
  if (hist.future.length === 0) return { hist, rows: current };
  const future = [...hist.future];
  const next = future.shift()!;
  return {
    hist: { past: [...hist.past, deepCloneRows(current)], future },
    rows: next,
  };
}

// ── Preview helpers ───────────────────────────────────────────────────────────

/**
 * Extract the plain text content from a row (for filling the edit textarea).
 * Returns null if the row has no editable text content.
 */
export function getTextContent(row: Row): string | null {
  if (row.obj === null) return null;
  const obj = row.obj as Record<string, unknown>;
  const msg = obj.message as Record<string, unknown> | undefined;
  if (!msg) return null;
  const content = msg.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const block = (content as Array<{ type: string; text?: string }>).find(
      b => b.type === 'text'
    );
    return block?.text ?? null;
  }
  return null;
}

export interface RowPreview {
  role: string;
  msgClass: string;
  summaryText: string | null;
  isTextEditable: boolean;
}

/**
 * Produce a compact preview descriptor for a row (used by EditView).
 */
export function getPreview(row: Row): RowPreview {
  if (row.obj === null) {
    return {
      role: 'raw',
      msgClass: '',
      summaryText: row.original.slice(0, 200),
      isTextEditable: false,
    };
  }
  const obj = row.obj as Record<string, unknown>;
  const msg = obj.message as Record<string, unknown> | undefined;
  const role =
    (msg?.role as string | undefined) ?? (obj.type as string | undefined) ?? 'unknown';

  let msgClass = '';
  if (role === 'user') msgClass = 'msg--user';
  else if (role === 'assistant') msgClass = 'msg--assistant';

  const content = msg?.content;
  let summaryText: string | null = null;
  let isTextEditable = false;

  if (typeof content === 'string') {
    summaryText = content;
    isTextEditable = true;
  } else if (Array.isArray(content)) {
    const blocks = content as Array<{ type: string; text?: string; name?: string; thinking?: string }>;
    const textBlock = blocks.find(b => b.type === 'text');
    const toolBlock = blocks.find(b => b.type === 'tool_use');
    const thinkingBlock = blocks.find(b => b.type === 'thinking');
    if (textBlock) {
      summaryText = textBlock.text ?? null;
      isTextEditable = true;
    } else if (toolBlock) {
      summaryText = `Tool: ${toolBlock.name ?? 'unknown'}`;
      msgClass = 'msg--tool';
    } else if (thinkingBlock) {
      summaryText = 'Thinking';
      msgClass = 'msg--thinking';
    }
  }

  return { role, msgClass, summaryText, isTextEditable };
}

/**
 * After an override-save, reset rows so original = current serialized form
 * and dirty = false.  Deleted rows stay deleted but are unchanged.
 */
export function markSaved(rows: Row[]): Row[] {
  return rows.map(r => {
    if (r.deleted) return r;
    const newOriginal =
      r.dirty && r.obj !== null ? JSON.stringify(r.obj) : r.original;
    return { ...r, original: newOriginal, dirty: false };
  });
}
