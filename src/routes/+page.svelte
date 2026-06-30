<script lang="ts">
  /**
   * +page.svelte — top-level SPA shell for Claude Code Visualizer.
   *
   * States: browse | viewer
   * Orchestrates: session loading, subagent linking, HTML export, theme toggle.
   */
  import type { Session, SessionMeta } from '$lib/types';
  import { readSession, readSubagents } from '$lib/api';
  import { parseJsonl, decodeProject } from '$lib/parser';
  import { buildSession, linkSubagents } from '$lib/builder';
  import { getTheme, toggleTheme } from '$lib/theme';
  import { cleanFilename } from '$lib/markdown';
  import BrowseView from '$lib/components/BrowseView.svelte';
  import SessionView from '$lib/components/SessionView.svelte';
  import EditView from '$lib/components/EditView.svelte';

  // Inline app.css for the standalone HTML export.
  import appCss from '../app.css?inline';

  // ── app state ─────────────────────────────────────────────────────────────
  let view = $state<'browse' | 'viewer'>('browse');
  let current = $state<Session | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let theme = $state(getTheme());

  // DOM ref for the rendered session — used by exportHtml().
  let viewerEl: HTMLDivElement | undefined = $state(undefined);

  // Edit mode — when true, show EditView instead of the read-only SessionView.
  let editMode = $state(false);

  // ── session opening ───────────────────────────────────────────────────────
  async function openSession(meta: SessionMeta): Promise<void> {
    loading = true;
    loadError = null;
    try {
      const text = await readSession(meta.path);
      const entries = parseJsonl(text);
      const session = buildSession(entries, {
        project: decodeProject(meta.project_raw),
        sourcePath: meta.path,
      });
      const subagentFiles = await readSubagents(meta.path);
      linkSubagents(session, subagentFiles);
      current = session;
      view = 'viewer';
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function backToBrowse(): void {
    view = 'browse';
    current = null;
    loadError = null;
    editMode = false;
  }

  // ── theme ─────────────────────────────────────────────────────────────────
  function handleToggleTheme(): void {
    theme = toggleTheme();
  }

  // ── HTML export ───────────────────────────────────────────────────────────
  function exportHtml(): void {
    if (!current || !viewerEl) return;

    const title = current.meta.title;
    const project = current.meta.project;
    const dataTheme = document.documentElement.getAttribute('data-theme') ?? 'light';
    const contentHtml = viewerEl.innerHTML;

    const htmlDoc = `<!DOCTYPE html>
<html lang="en" data-theme="${dataTheme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
<style>
${appCss}
</style>
</head>
<body>
<div class="container-main">
${contentHtml}
</div>
</body>
</html>`;

    const fname = cleanFilename(project || 'project') + '_' + cleanFilename(title || 'session') + '.html';
    const blob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
</script>

<!-- ── header ──────────────────────────────────────────────────────────────── -->
<header class="app-header">
  <div>
    <h1>Claude Code Visualizer</h1>
    {#if view === 'viewer' && current}
      <div class="subtitle">
        {current.meta.project} · {current.turns.length} turn{current.turns.length === 1 ? '' : 's'}
      </div>
    {/if}
  </div>

  <div class="app-header__actions">
    {#if view === 'viewer'}
      <button class="back-link" onclick={backToBrowse} type="button">
        Back
      </button>
      {#if !editMode}
        <button class="btn btn--sm" onclick={exportHtml} type="button">
          Export HTML
        </button>
        <button class="btn btn--sm" onclick={() => (editMode = true)} type="button">
          Edit
        </button>
      {/if}
    {/if}
    <button class="btn btn--ghost btn--sm" onclick={handleToggleTheme} type="button">
      {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  </div>
</header>

<!-- ── main content ────────────────────────────────────────────────────────── -->
<main class="container-main">
  {#if loadError}
    <div class="empty-state">{loadError}</div>
  {:else if loading}
    <div class="empty-state">Loading session...</div>
  {:else if view === 'browse'}
    <BrowseView onOpen={openSession} />
  {:else if view === 'viewer' && current}
    {#if editMode}
      <EditView path={current.meta.sourcePath} onDone={() => (editMode = false)} />
    {:else}
      <div bind:this={viewerEl}>
        <SessionView session={current} />
      </div>
    {/if}
  {/if}
</main>

<!-- ── footer ──────────────────────────────────────────────────────────────── -->
<footer class="app-footer">
  <a href="https://github.com/zhangxingeng/claude-code-visualizer" target="_blank" rel="noopener noreferrer">
    Claude Code Visualizer — offline, open-source chat history viewer
  </a>
</footer>
