<script lang="ts">
  /**
   * EditView.svelte — inline JSONL-line editor for a session file.
   *
   * Edits the RAW lines of the file (not the rendered turns) so that
   * untouched lines are written back byte-for-byte unchanged.
   *
   * Props:
   *   path   — source file path (used for read + save + backup operations)
   *   onDone — callback when the user clicks "Done" (returns to viewer)
   */
  import { onMount } from 'svelte';
  import type { BackupVersion } from '$lib/types';
  import {
    readSession,
    writeSession,
    snapshot,
    listBackups,
    restoreBackup,
  } from '$lib/api';
  import { renderMarkdown } from '$lib/markdown';
  import {
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
  } from '$lib/editModel';
  import type { Row, EditHistory } from '$lib/editModel';

  // ── Props ──────────────────────────────────────────────────────────────────
  let { path, onDone }: { path: string; onDone: () => void } = $props();

  // ── State ──────────────────────────────────────────────────────────────────
  let rows = $state<Row[]>([]);
  let hist = $state<EditHistory>(createHistory());
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  // Inline text editing
  let editingId = $state<number | null>(null);
  let editingText = $state('');

  // Modals
  let showOverrideModal = $state(false);
  let showHistoryModal = $state(false);
  let backups = $state<BackupVersion[]>([]);
  let pendingRestore = $state<BackupVersion | null>(null);
  let saving = $state(false);

  // Toast
  let toastMsg = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Load on mount ──────────────────────────────────────────────────────────
  onMount(() => {
    readSession(path)
      .then(raw => {
        rows = parseRows(raw);
        loading = false;
      })
      .catch(e => {
        loadError = e instanceof Error ? e.message : String(e);
        loading = false;
      });

    // Keyboard undo/redo
    function handleKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        doRedo();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  });

  // ── Toast helper ───────────────────────────────────────────────────────────
  function showToast(msg: string) {
    toastMsg = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastMsg = null;
      toastTimer = null;
    }, 3500);
  }

  // ── Undo / Redo ────────────────────────────────────────────────────────────
  function doUndo() {
    const result = undo(hist, rows);
    hist = result.hist;
    rows = result.rows;
  }
  function doRedo() {
    const result = redo(hist, rows);
    hist = result.hist;
    rows = result.rows;
  }

  // ── Row operations ─────────────────────────────────────────────────────────
  function doDelete(id: number) {
    hist = pushHistory(hist, rows);
    rows = deleteRow(rows, id);
  }
  function doUndelete(id: number) {
    hist = pushHistory(hist, rows);
    rows = restoreRow(rows, id);
  }
  function doMoveUp(id: number) {
    hist = pushHistory(hist, rows);
    rows = moveUp(rows, id);
  }
  function doMoveDown(id: number) {
    hist = pushHistory(hist, rows);
    rows = moveDown(rows, id);
  }

  // ── Inline edit ────────────────────────────────────────────────────────────
  function startEdit(id: number) {
    const row = rows.find(r => r.id === id);
    if (!row) return;
    editingId = id;
    editingText = getTextContent(row) ?? '';
  }
  function cancelEdit() {
    editingId = null;
    editingText = '';
  }
  function saveInlineEdit() {
    if (editingId === null) return;
    hist = pushHistory(hist, rows);
    rows = editText(rows, editingId, editingText);
    editingId = null;
    editingText = '';
  }

  // ── Save as copy ───────────────────────────────────────────────────────────
  async function saveAsCopy() {
    saving = true;
    try {
      const content = serialize(rows);
      const lastSlash = path.lastIndexOf('/');
      const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : '.';
      const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
      const stem = filename.endsWith('.jsonl')
        ? filename.slice(0, -6)
        : filename;
      const ts = Math.floor(Date.now() / 1000);
      const copyPath = `${dir}/${stem}-edited-${ts}.jsonl`;
      await writeSession(copyPath, content);
      showToast(`Saved a copy: ${copyPath.split('/').pop()}`);
    } catch (e) {
      showToast(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      saving = false;
    }
  }

  // ── Override original ──────────────────────────────────────────────────────
  async function confirmOverride() {
    showOverrideModal = false;
    saving = true;
    try {
      const bk = await snapshot(path);
      const content = serialize(rows);
      await writeSession(path, content);
      rows = markSaved(rows);
      hist = createHistory();
      showToast(`Original overwritten. Backup v${bk.version} saved.`);
    } catch (e) {
      showToast(`Override failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      saving = false;
    }
  }

  // ── History / restore panel ────────────────────────────────────────────────
  async function openHistory() {
    backups = await listBackups(path);
    pendingRestore = null;
    showHistoryModal = true;
  }

  async function confirmRestoreBackup() {
    if (!pendingRestore) return;
    const bk = pendingRestore;
    pendingRestore = null;
    showHistoryModal = false;
    saving = true;
    try {
      await snapshot(path);
      const restored = await restoreBackup(bk.path);
      await writeSession(path, restored);
      rows = parseRows(restored);
      hist = createHistory();
      showToast(`Restored v${bk.version}`);
    } catch (e) {
      showToast(`Restore failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      saving = false;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function truncate(text: string, max = 300): string {
    if (!text) return '';
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  function formatTimestamp(unix: number): string {
    return new Date(unix * 1000).toLocaleString();
  }
</script>

<!-- ── Loading / error ─────────────────────────────────────────────────────── -->
{#if loading}
  <div class="empty-state">Loading edit view...</div>
{:else if loadError}
  <div class="empty-state">{loadError}</div>
{:else}

<!-- ── Sticky edit toolbar ─────────────────────────────────────────────────── -->
<div class="edit-toolbar">
  <button
    class="btn btn--sm btn--ghost"
    onclick={doUndo}
    disabled={hist.past.length === 0 || saving}
    type="button"
  >Undo</button>
  <button
    class="btn btn--sm btn--ghost"
    onclick={doRedo}
    disabled={hist.future.length === 0 || saving}
    type="button"
  >Redo</button>

  <span class="edit-toolbar__spacer"></span>

  <button class="btn btn--sm" onclick={saveAsCopy} disabled={saving} type="button">
    Save as copy
  </button>
  <button
    class="btn btn--sm btn--danger"
    onclick={() => (showOverrideModal = true)}
    disabled={saving}
    type="button"
  >Override original</button>
  <button class="btn btn--sm btn--ghost" onclick={openHistory} disabled={saving} type="button">
    History
  </button>
  <button class="btn btn--sm btn--primary" onclick={onDone} disabled={saving} type="button">
    Done
  </button>
</div>

<!-- ── Row list ────────────────────────────────────────────────────────────── -->
<div class="edit-list">
  {#each rows as row (row.id)}
    {@const preview = getPreview(row)}
    <div
      class="msg {preview.msgClass}"
      class:edit-row--deleted={row.deleted}
      class:msg--editing={editingId === row.id}
    >
      <div class="msg__inner">
        <span class="msg__label">{preview.role}</span>

        {#if row.deleted}
          <!-- Deleted: struck-through preview -->
          <div class="msg__body edit-row__deleted-text">
            <s>{truncate(preview.summaryText ?? row.original, 200)}</s>
          </div>
          <div class="msg__actions">
            <button
              class="btn btn--sm"
              onclick={() => doUndelete(row.id)}
              type="button"
            >Restore</button>
          </div>

        {:else if editingId === row.id}
          <!-- Active edit: textarea -->
          <textarea
            class="editor-textarea"
            bind:value={editingText}
            rows={8}
          ></textarea>
          <div class="edit-row__edit-actions">
            <button class="btn btn--sm btn--primary" onclick={saveInlineEdit} type="button">
              Save
            </button>
            <button class="btn btn--sm btn--ghost" onclick={cancelEdit} type="button">
              Cancel
            </button>
          </div>

        {:else}
          <!-- Normal: preview + hover actions -->
          {#if preview.summaryText !== null}
            <div class="msg__body">
              {@html renderMarkdown(truncate(preview.summaryText))}
            </div>
          {:else}
            <div class="msg__body" style="font-style:italic;color:var(--text-faint);">
              {truncate(row.original, 120)}
            </div>
          {/if}

          <div class="msg__actions">
            {#if preview.isTextEditable}
              <button
                class="btn btn--sm"
                onclick={() => startEdit(row.id)}
                type="button"
              >Edit</button>
            {/if}
            <button
              class="btn btn--sm"
              onclick={() => doMoveUp(row.id)}
              type="button"
            >Up</button>
            <button
              class="btn btn--sm"
              onclick={() => doMoveDown(row.id)}
              type="button"
            >Down</button>
            <button
              class="btn btn--sm btn--danger"
              onclick={() => doDelete(row.id)}
              type="button"
            >Delete</button>
          </div>
        {/if}
      </div>
    </div>
  {/each}

  {#if rows.length === 0}
    <div class="empty-state">No lines found in this session file.</div>
  {/if}
</div>
{/if}

<!-- ── Override-original warning modal ────────────────────────────────────── -->
{#if showOverrideModal}
  <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="override-title">
    <div class="modal">
      <h3 id="override-title">Override original file</h3>
      <div class="modal__warning">
        This will permanently rewrite your real Claude chat history file at:
        <br /><strong>{path}</strong><br /><br />
        A backup snapshot will be created first, but this action should be used
        with caution.
      </div>
      <p>A snapshot of the current on-disk file will be saved before writing.</p>
      <div class="modal__actions">
        <button
          class="btn btn--sm btn--ghost"
          onclick={() => (showOverrideModal = false)}
          type="button"
        >Cancel</button>
        <button
          class="btn btn--sm btn--danger"
          onclick={confirmOverride}
          type="button"
        >Confirm — overwrite file</button>
      </div>
    </div>
  </div>
{/if}

<!-- ── History / restore modal ─────────────────────────────────────────────── -->
{#if showHistoryModal}
  <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="history-title">
    <div class="modal" style="max-width:520px;">
      <h3 id="history-title">Backup history</h3>
      <p>Snapshots are taken before every override. Restoring also creates a snapshot first.</p>

      {#if backups.length === 0}
        <div class="empty-state" style="padding:1rem 0;">No backups found.</div>
      {:else}
        <div class="history-list">
          {#each backups as bk (bk.version)}
            <div class="history-item">
              <div class="history-item__info">
                <strong>v{bk.version}</strong>
                <span style="color:var(--text-muted);font-size:0.78rem;">
                  {formatTimestamp(bk.timestamp)}
                </span>
                <span style="color:var(--text-faint);font-size:0.72rem;">
                  {(bk.size / 1024).toFixed(1)} KB
                </span>
              </div>
              {#if pendingRestore?.version === bk.version}
                <div class="history-item__confirm">
                  <span style="font-size:0.78rem;color:var(--accent-result-err);">
                    Snapshot current file first, then restore?
                  </span>
                  <button class="btn btn--sm btn--danger" onclick={confirmRestoreBackup} type="button">
                    Yes, restore
                  </button>
                  <button
                    class="btn btn--sm btn--ghost"
                    onclick={() => (pendingRestore = null)}
                    type="button"
                  >Cancel</button>
                </div>
              {:else}
                <button
                  class="btn btn--sm"
                  onclick={() => (pendingRestore = bk)}
                  type="button"
                >Restore</button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="modal__actions">
        <button
          class="btn btn--sm btn--ghost"
          onclick={() => { showHistoryModal = false; pendingRestore = null; }}
          type="button"
        >Close</button>
      </div>
    </div>
  </div>
{/if}

<!-- ── Toast ───────────────────────────────────────────────────────────────── -->
{#if toastMsg}
  <div class="toast" role="status">{toastMsg}</div>
{/if}

<style>
  /* Sticky edit toolbar */
  .edit-toolbar {
    position: sticky;
    top: 0;
    z-index: 9;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0;
    background: color-mix(in srgb, var(--bg) 95%, transparent);
    backdrop-filter: blur(6px);
    border-bottom: 1px solid var(--border);
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }
  .edit-toolbar__spacer {
    flex: 1;
  }

  /* Row list */
  .edit-list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* Deleted row */
  .edit-row--deleted {
    opacity: 0.45;
  }
  .edit-row--deleted .msg__inner {
    border-style: dashed;
  }
  .edit-row__deleted-text {
    font-style: italic;
  }

  /* Edit action buttons below textarea */
  .edit-row__edit-actions {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }

  /* History modal list */
  .history-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    max-height: 320px;
    overflow-y: auto;
    margin: 0.75rem 0;
    padding-right: 0.25rem;
  }
  .history-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.45rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: var(--bg-subtle);
    flex-wrap: wrap;
  }
  .history-item__info {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex: 1;
    min-width: 0;
  }
  .history-item__confirm {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
</style>
