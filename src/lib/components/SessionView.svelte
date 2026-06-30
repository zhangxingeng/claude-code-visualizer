<script lang="ts">
  /**
   * SessionView.svelte — renders all turns of a Session.
   * Props: session (Session).
   */
  import type { Session } from '$lib/types';
  import Turn from './Turn.svelte';

  let { session }: { session: Session } = $props();
</script>

<div class="session-turns">
  {#each session.turns as turn, i (i)}
    <Turn {turn} />
  {/each}

  {#if session.turns.length === 0}
    <div class="empty-state">No conversation turns found in this session.</div>
  {/if}
</div>
