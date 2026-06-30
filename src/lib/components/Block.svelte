<script lang="ts">
  /**
   * Block.svelte — renders ONE ContentBlock.
   *
   * Handles: text | thinking | tool_use | tool_result
   * Recursive: tool_use blocks with .subagent render nested turns via Turn.svelte.
   */
  import type { ContentBlock } from '$lib/types';
  import { renderMarkdown } from '$lib/markdown';
  // Turn is imported for subagent nesting (creates a Block ↔ Turn circular dep
  // that Svelte/Vite handles correctly at runtime).
  import Turn from './Turn.svelte';

  let {
    block,
    role = 'assistant',
  }: {
    block: ContentBlock;
    role?: 'user' | 'assistant';
  } = $props();

  // Collapsible state — collapsed by default per spec.
  let thinkingOpen = $state(false);
  let toolOpen = $state(false);

  let label = $derived(role === 'user' ? 'User' : 'Assistant');
  let msgClass = $derived(role === 'user' ? 'msg--user' : 'msg--assistant');
</script>

<!-- ── text block ───────────────────────────────────────────────────────── -->
{#if block.blockType === 'text'}
  <div class="msg {msgClass}">
    <div class="msg__inner">
      <div class="msg__label">{label}</div>
      <div class="msg__body">{@html renderMarkdown(block.text ?? '')}</div>
    </div>
  </div>

<!-- ── thinking block ──────────────────────────────────────────────────── -->
{:else if block.blockType === 'thinking'}
  <div class="msg msg--thinking">
    <div class="msg__inner">
      {#if block.signature && !block.thinking}
        <!-- Encrypted thinking — no toggle, just a muted note -->
        <div class="msg__label">Thinking · encrypted</div>
        <div class="msg__body" style="color: var(--text-faint); font-style: normal;">
          [encrypted thinking]
        </div>
      {:else}
        <!-- Normal thinking — collapsible, collapsed by default -->
        <button
          class="collapsible"
          class:open={thinkingOpen}
          onclick={() => (thinkingOpen = !thinkingOpen)}
          type="button"
          style="background:none;border:0;padding:0;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;"
        >
          <span class="msg__label" style="margin-bottom:0;">Thinking</span>
          <span class="toggle-icon">&#9654;</span>
        </button>
        <div class="collapse-body" class:open={thinkingOpen}>
          <div class="msg__body">{@html renderMarkdown(block.thinking ?? block.text ?? '')}</div>
        </div>
      {/if}
    </div>
  </div>

<!-- ── tool_use block ──────────────────────────────────────────────────── -->
{:else if block.blockType === 'tool_use'}
  <div class="msg msg--tool">
    <div class="msg__inner">
      <!-- Header / toggle -->
      <button
        class="collapsible"
        class:open={toolOpen}
        onclick={() => (toolOpen = !toolOpen)}
        type="button"
        style="background:none;border:0;padding:0;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:0.4rem;"
      >
        <span class="msg__label" style="margin-bottom:0;">Tool</span>
        <span style="font-size:0.8rem;color:var(--text-muted);font-weight:500;">{block.toolName ?? 'unknown'}</span>
        <span class="toggle-icon">&#9654;</span>
        {#if block.isAsync}
          <span style="font-size:0.65rem;color:var(--text-faint);margin-left:0.25rem;">async</span>
        {/if}
        {#if block.toolOutput !== undefined || block.isError !== undefined}
          <span style="font-size:0.65rem;color:{block.isError ? 'var(--accent-result-err)' : 'var(--accent-result-ok)'};margin-left:0.25rem;">
            {block.isError ? 'error' : 'ok'}
          </span>
        {/if}
      </button>

      <!-- Collapsible body -->
      <div class="collapse-body" class:open={toolOpen}>
        <!-- Input section -->
        {#if block.toolInput && Object.keys(block.toolInput).length > 0}
          <div class="tool-section">
            <div class="tool-section__heading">Input</div>
            <pre class="tool-json">{JSON.stringify(block.toolInput, null, 2)}</pre>
          </div>
        {/if}

        <!-- Result section (merged onto tool_use per builder.ts) -->
        {#if block.toolOutput !== undefined}
          <div class="msg--result" class:error={block.isError} style="margin-top:0.5rem;">
            <div class="tool-section">
              <div class="tool-section__heading">{block.isError ? 'Error' : 'Result'}</div>
              <pre class="tool-json">{block.toolOutput}</pre>
            </div>
          </div>
        {/if}

        <!-- Subagent box (if this tool_use launched an agent) -->
        {#if block.subagent}
          <div class="subagent">
            <div class="subagent__header">
              Subagent{block.subagent.meta.project ? ' · ' + block.subagent.meta.project : ''}
            </div>
            {#each block.subagent.turns as turn, i (i)}
              <Turn {turn} />
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>

<!-- ── standalone tool_result block ────────────────────────────────────── -->
{:else if block.blockType === 'tool_result'}
  <div class="msg msg--result" class:error={block.isError}>
    <div class="msg__inner">
      <div class="msg__label">{block.isError ? 'Error' : 'Result'}</div>
      <pre class="tool-json">{block.toolOutput ?? block.text ?? ''}</pre>
    </div>
  </div>
{/if}
