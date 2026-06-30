/**
 * Markdown rendering with sanitization.
 * Uses marked (GFM + line-breaks) + DOMPurify — both installed locally.
 * No CDN. Works in browser only (SSR is disabled for this app).
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked globally once.
marked.setOptions({ gfm: true, breaks: true });

/**
 * Parse markdown to sanitized HTML.
 * Returns safe HTML suitable for {@html ...} in Svelte templates.
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  // async: false overload guarantees string return type.
  const html = marked(text, { async: false, gfm: true, breaks: true });
  // Guard for any server-side / build-time execution path (SSR is off but be safe).
  if (typeof window === 'undefined') return html;
  return DOMPurify.sanitize(html);
}

/**
 * Convert an arbitrary string to a safe filename fragment.
 * Keeps only ASCII alphanumeric, collapses runs of other chars to single
 * underscores, trims leading/trailing underscores, lowercases.
 *
 * e.g. "My Cool Project!" → "my_cool_project"
 */
export function cleanFilename(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}
