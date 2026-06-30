<script lang="ts">
  /**
   * BrowseView.svelte — session browser.
   *
   * Loads listSessions(), enriches with extractMeta(), groups by decoded
   * project name, supports search (title/project) and sort (newest/oldest/title).
   * Calls onOpen(meta) when the user selects a session.
   */
  import { onMount } from 'svelte';
  import type { SessionMeta } from '$lib/types';
  import { listSessions } from '$lib/api';
  import { extractMeta, decodeProject } from '$lib/parser';

  let { onOpen }: { onOpen: (meta: SessionMeta) => void } = $props();

  // ── state ──────────────────────────────────────────────────────────────────
  let sessions = $state<SessionMeta[]>([]);
  let loadError = $state<string | null>(null);
  let loading = $state(true);
  let search = $state('');
  let sortBy = $state<'newest' | 'oldest' | 'title'>('newest');

  // ── lifecycle ───────────────────────────────────────────────────────────────
  onMount(async () => {
    try {
      sessions = await listSessions();
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  });

  // ── derived data ────────────────────────────────────────────────────────────

  /** Sessions enriched with extracted meta (title, date, model, project). */
  let enriched = $derived(
    sessions.map((s) => {
      const m = extractMeta(s.preview);
      return {
        meta: s,
        title: m.title,
        date: m.date,
        model: m.model,
        project: decodeProject(s.project_raw),
      };
    })
  );

  /** After search filter. */
  let filtered = $derived(
    enriched.filter((s) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return s.title.toLowerCase().includes(q) || s.project.toLowerCase().includes(q);
    })
  );

  /** After sort. */
  let sorted = $derived(
    [...filtered].sort((a, b) => {
      if (sortBy === 'newest') return (b.date || '').localeCompare(a.date || '');
      if (sortBy === 'oldest') return (a.date || '').localeCompare(b.date || '');
      return a.title.localeCompare(b.title);
    })
  );

  /** Grouped by project name → entries. */
  let groups = $derived.by(() => {
    const g = new Map<string, typeof sorted>();
    for (const s of sorted) {
      const existing = g.get(s.project);
      if (existing) {
        existing.push(s);
      } else {
        g.set(s.project, [s]);
      }
    }
    return g;
  });

  // ── helpers ─────────────────────────────────────────────────────────────────
  function fmtDate(ts: string): string {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return ts;
    }
  }

  function fmtModel(model: string): string {
    // Trim anything after '[' (usage info appended by some Claude versions).
    return model ? model.replace(/\[.*/, '').trim() : '';
  }
</script>

<!-- ── toolbar ────────────────────────────────────────────────────────────── -->
<div class="toolbar">
  <input
    type="search"
    placeholder="Search sessions or projects..."
    bind:value={search}
    aria-label="Search sessions"
  />
  <select bind:value={sortBy} aria-label="Sort order">
    <option value="newest">Newest</option>
    <option value="oldest">Oldest</option>
    <option value="title">Title</option>
  </select>
</div>

<!-- ── content ───────────────────────────────────────────────────────────── -->
{#if loading}
  <div class="empty-state">Loading sessions...</div>
{:else if loadError}
  <div class="empty-state">{loadError}</div>
{:else if groups.size === 0}
  <div class="empty-state">
    {search.trim() ? 'No sessions match your search.' : 'No sessions found.'}
  </div>
{:else}
  {#each groups as [project, items]}
    <div class="project-group">
      <div class="project-group__name">{project}</div>

      {#each items as s (s.meta.id)}
        <button
          class="session-card"
          type="button"
          onclick={() => onOpen(s.meta)}
        >
          <span class="session-card__title">{s.title}</span>
          <span class="session-card__meta">
            {fmtDate(s.date)}{fmtModel(s.model) ? ' · ' + fmtModel(s.model) : ''}
          </span>
        </button>
      {/each}
    </div>
  {/each}
{/if}
