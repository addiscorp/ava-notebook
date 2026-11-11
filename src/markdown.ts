// Markdown to HTML for the preview. Raw HTML in a note is escaped, never
// rendered (html: false). [[Wikilinks]] become in-app links; links to the web
// open through Ava (which asks first); images come from the vault through Ava.
import MarkdownIt from 'markdown-it'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'
import { cleanPath, folderOf } from './notes'

export type Resolver = {
  /** Whether a wikilink target is a note that exists. */
  exists: (target: string) => boolean
  /** A URL for a file in the vault (relative to the note's folder). */
  fileUrl: (path: string) => string
}

function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  if (src.charCodeAt(state.pos) !== 0x5b || src.charCodeAt(state.pos + 1) !== 0x5b) return false
  const end = src.indexOf(']]', state.pos + 2)
  if (end < 0) return false
  const inner = src.slice(state.pos + 2, end)
  if (!inner.trim() || inner.includes('\n') || inner.includes('[')) return false
  if (!silent) {
    const [targetPart, shown] = inner.split('|')
    const target = targetPart.split('#')[0].trim()
    const token = state.push('wikilink', '', 0)
    token.meta = { target, shown: (shown ?? targetPart).trim() }
  }
  state.pos = end + 2
  return true
}

export function renderer(r: Resolver, notePath: () => string) {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false })
  md.inline.ruler.before('link', 'wikilink', wikilinkRule)
  md.renderer.rules.wikilink = (tokens, i) => {
    const { target, shown } = tokens[i].meta as { target: string; shown: string }
    const missing = r.exists(target) ? '' : ' missing'
    return `<a href="#" class="wikilink${missing}" data-target="${md.utils.escapeHtml(target)}">${md.utils.escapeHtml(shown)}</a>`
  }
  // Every link: web links are marked external (opened through Ava); others are notes.
  const defaultOpen = md.renderer.rules.link_open ?? ((tokens, i, o, _e, self) => self.renderToken(tokens, i, o))
  md.renderer.rules.link_open = (tokens, i, options, env, self) => {
    const t = tokens[i]
    const href = t.attrGet('href') ?? ''
    if (/^(https?:|mailto:)/i.test(href)) {
      t.attrSet('data-external', href)
    } else {
      t.attrSet('data-target', decodeURIComponent(href).replace(/\.md$/i, ''))
    }
    t.attrSet('href', '#')
    return defaultOpen(tokens, i, options, env, self)
  }
  // Images: files in the vault through Ava; anything from the web is shown as its text.
  md.renderer.rules.image = (tokens, i) => {
    const t = tokens[i]
    const src = t.attrGet('src') ?? ''
    const alt = md.utils.escapeHtml(t.content || src)
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return `<span class="ext-image" title="Images from the web aren't loaded">${alt}</span>`
    const path = cleanPath(src.startsWith('/') ? src : `${folderOf(notePath())}/${decodeURIComponent(src)}`)
    return `<img src="${md.utils.escapeHtml(r.fileUrl(path))}" alt="${alt}">`
  }
  return (text: string) => md.render(text)
}
