import { marked } from 'marked'
import DOMPurify from 'dompurify'

const renderer = new marked.Renderer()
const baseLink = renderer.link.bind(renderer)
renderer.link = (...args) => {
  const html = baseLink(...args)
  return html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ')
}

marked.setOptions({
  gfm: true,
  breaks: true,
  renderer
})

/**
 * Render trusted-but-not-blindly-trusted markdown to safe HTML. Used for the
 * orchestrator's chat output: it's an LLM, so we run the result through
 * DOMPurify before mounting it via `v-html`.
 *
 * SSR fallback: DOMPurify needs a DOM. When called during SSR we just escape
 * the content; the client will re-render with full markdown on hydration.
 */
export function renderMarkdown(input: string): string {
  if (!input) return ''
  const html = marked.parse(input, { async: false }) as string
  if (typeof window === 'undefined') {
    return escapeHtml(input)
  }
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel']
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
