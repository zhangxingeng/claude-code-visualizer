/**
 * Smoke test for editModel.ts.
 * Run with: npx tsx tests/edit_smoke.mjs   (from repo root)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const {
  parseRows,
  serialize,
  deleteRow,
  restoreRow,
  moveUp,
  moveDown,
  editText,
  getTextContent,
  getPreview,
  markSaved,
  createHistory,
  pushHistory,
  undo,
  redo,
} = await import(join(root, 'src/lib/editModel.ts'));

// ── Test helpers ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ok  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL ${msg}`);
    failed++;
  }
}

// ── Mock JSONL data ───────────────────────────────────────────────────────────

// Line with string content
const LINE_STRING = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: 'Hello, world!' },
  uuid: 'u1',
});

// Line with array content (has a text block)
const LINE_ARRAY = JSON.stringify({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'I am thinking...' },
      { type: 'text', text: 'Here is my answer.' },
    ],
  },
  uuid: 'a1',
});

// Line with tool_use content (no text block)
const LINE_TOOL = JSON.stringify({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: {} }],
  },
  uuid: 'a2',
});

// Invalid JSON line (not parseable)
const LINE_RAW = 'not-valid-json at all {{{';

const RAW_TEXT = [LINE_STRING, LINE_ARRAY, LINE_TOOL, LINE_RAW].join('\n') + '\n';

// ── Test: parseRows ───────────────────────────────────────────────────────────
console.log('\n[parseRows]');
const rows = parseRows(RAW_TEXT);
assert(rows.length === 4, `parsed 4 rows (got ${rows.length})`);
assert(rows[0].original === LINE_STRING, 'row[0].original preserved exactly');
assert(rows[0].obj !== null, 'row[0].obj parsed');
assert(rows[3].obj === null, 'row[3] (invalid JSON) has obj===null');
assert(rows.every(r => !r.deleted && !r.dirty), 'all rows start undeleted and clean');

// ── Test: serialize preserves untouched lines ─────────────────────────────────
console.log('\n[serialize — untouched]');
const content = serialize(rows);
const lines = content.split('\n');
// Last element is empty string (trailing newline)
assert(lines[lines.length - 1] === '', 'content ends with newline');
const contentLines = lines.slice(0, -1);
assert(contentLines[0] === LINE_STRING, 'untouched line[0] byte-identical');
assert(contentLines[1] === LINE_ARRAY, 'untouched line[1] byte-identical');
assert(contentLines[2] === LINE_TOOL, 'untouched line[2] byte-identical');
assert(contentLines[3] === LINE_RAW, 'untouched raw line byte-identical');

// ── Test: deleteRow drops the line ────────────────────────────────────────────
console.log('\n[deleteRow]');
const afterDelete = deleteRow(rows, rows[1].id);
assert(afterDelete[1].deleted === true, 'row[1] marked deleted');
const deletedContent = serialize(afterDelete);
const deletedLines = deletedContent.split('\n').slice(0, -1);
assert(deletedLines.length === 3, `deleted content has 3 lines (got ${deletedLines.length})`);
assert(!deletedLines.includes(LINE_ARRAY), 'deleted line not in output');

// ── Test: restoreRow un-deletes ───────────────────────────────────────────────
console.log('\n[restoreRow]');
const afterRestore = restoreRow(afterDelete, rows[1].id);
assert(!afterRestore[1].deleted, 'row[1] restored');
const restoredContent = serialize(afterRestore);
assert(restoredContent === content, 'restored content identical to original');

// ── Test: editText — string content ──────────────────────────────────────────
console.log('\n[editText — string content]');
const newText1 = 'Updated string content';
const afterEditStr = editText(rows, rows[0].id, newText1);
assert(afterEditStr[0].dirty === true, 'row[0] marked dirty after editText');
const textContent1 = getTextContent(afterEditStr[0]);
assert(textContent1 === newText1, `getTextContent returns new text: "${textContent1}"`);
// Serialized output should use JSON.stringify (not original string)
const editedStrContent = serialize(afterEditStr);
const editedStrLines = editedStrContent.split('\n').slice(0, -1);
const parsed0 = JSON.parse(editedStrLines[0]);
assert(parsed0.message.content === newText1, 'serialized string content matches newText');
// Other lines stay byte-identical
assert(editedStrLines[1] === LINE_ARRAY, 'untouched array line unchanged');
assert(editedStrLines[3] === LINE_RAW, 'untouched raw line unchanged');

// ── Test: editText — array text-block content ─────────────────────────────────
console.log('\n[editText — array text-block content]');
const newText2 = 'Updated array block content';
const afterEditArr = editText(rows, rows[1].id, newText2);
assert(afterEditArr[1].dirty === true, 'row[1] marked dirty after editText');
const textContent2 = getTextContent(afterEditArr[1]);
assert(textContent2 === newText2, `getTextContent returns new text: "${textContent2}"`);
const editedArrLines = serialize(afterEditArr).split('\n').slice(0, -1);
const parsed1 = JSON.parse(editedArrLines[1]);
const textBlock = parsed1.message.content.find((b) => b.type === 'text');
assert(textBlock?.text === newText2, 'text block in array updated correctly');
// Thinking block preserved
const thinkingBlock = parsed1.message.content.find((b) => b.type === 'thinking');
assert(thinkingBlock?.thinking === 'I am thinking...', 'thinking block preserved');

// ── Test: editText — raw (null obj) row unchanged ────────────────────────────
console.log('\n[editText — null obj row]');
const afterEditRaw = editText(rows, rows[3].id, 'should be ignored');
assert(afterEditRaw[3].dirty === false, 'null-obj row stays clean');
assert(afterEditRaw[3].original === LINE_RAW, 'null-obj row original unchanged');

// ── Test: moveUp / moveDown ───────────────────────────────────────────────────
console.log('\n[moveUp / moveDown]');
const rowIds = rows.map(r => r.id);
const afterMoveDown = moveDown(rows, rows[0].id);
assert(afterMoveDown[0].id === rows[1].id, 'row[1] is now at index 0 after moveDown');
assert(afterMoveDown[1].id === rows[0].id, 'row[0] is now at index 1 after moveDown');
// moveUp should reverse it
const afterMoveUp = moveUp(afterMoveDown, rows[0].id);
assert(afterMoveUp[0].id === rows[0].id, 'row[0] back at index 0 after moveUp');
assert(afterMoveUp[1].id === rows[1].id, 'row[1] back at index 1 after moveUp');
// Boundary: moveUp on first row is no-op
const noOp = moveUp(rows, rows[0].id);
assert(noOp[0].id === rows[0].id, 'moveUp on first row is no-op');
// Boundary: moveDown on last row is no-op
const noOp2 = moveDown(rows, rows[rows.length - 1].id);
assert(noOp2[rows.length - 1].id === rows[rows.length - 1].id, 'moveDown on last row is no-op');

// ── Test: undo / redo ─────────────────────────────────────────────────────────
console.log('\n[undo / redo]');
let h = createHistory();
const r0 = parseRows(RAW_TEXT);

// Delete row[1]
h = pushHistory(h, r0);
const r1 = deleteRow(r0, r0[1].id);
assert(r1[1].deleted, 'r1: row[1] deleted');

// Undo → back to r0 state
const u1 = undo(h, r1);
h = u1.hist;
const rUndo = u1.rows;
assert(!rUndo[1].deleted, 'after undo: row[1] not deleted');
assert(h.future.length === 1, 'one entry in future after undo');

// Redo → back to r1 state
const re1 = redo(h, rUndo);
h = re1.hist;
const rRedo = re1.rows;
assert(rRedo[1].deleted, 'after redo: row[1] deleted again');
assert(h.future.length === 0, 'future empty after redo');

// undo on empty history is no-op
const emptyH = createHistory();
const noUndo = undo(emptyH, r0);
assert(noUndo.rows === r0, 'undo on empty history is no-op');

// ── Test: getPreview ──────────────────────────────────────────────────────────
console.log('\n[getPreview]');
const p0 = getPreview(rows[0]);
assert(p0.role === 'user', `row[0] role: "${p0.role}"`);
assert(p0.isTextEditable === true, 'row[0] (string content) is editable');
assert(p0.summaryText === 'Hello, world!', `row[0] summaryText: "${p0.summaryText}"`);

const p1 = getPreview(rows[1]);
assert(p1.role === 'assistant', `row[1] role: "${p1.role}"`);
assert(p1.isTextEditable === true, 'row[1] (array with text block) is editable');

const p2 = getPreview(rows[2]);
assert(p2.isTextEditable === false, 'row[2] (tool_use only) not editable');
assert(p2.summaryText?.startsWith('Tool:'), `row[2] summaryText: "${p2.summaryText}"`);

const p3 = getPreview(rows[3]);
assert(p3.role === 'raw', `row[3] (null obj) role: "${p3.role}"`);
assert(p3.isTextEditable === false, 'row[3] (null obj) not editable');

// ── Test: markSaved ───────────────────────────────────────────────────────────
console.log('\n[markSaved]');
const editedRows = editText(rows, rows[0].id, 'New content');
assert(editedRows[0].dirty, 'row[0] dirty before markSaved');
const savedRows = markSaved(editedRows);
assert(!savedRows[0].dirty, 'row[0] clean after markSaved');
const expectedOriginal = JSON.stringify(JSON.parse(editedRows[0].original));
// After markSaved, original should reflect new content
const parsedSaved = JSON.parse(savedRows[0].original);
assert(parsedSaved.message.content === 'New content', 'markSaved updates original to serialized form');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
  console.log(`All ${passed} assertions passed.`);
  process.exit(0);
} else {
  console.error(`${failed} FAILED, ${passed} passed.`);
  process.exit(1);
}
