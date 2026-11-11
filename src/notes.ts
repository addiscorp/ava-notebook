// Notebook's index: pure functions over the notes it has read, so they can be
// tested without Ava. Wikilinks, titles, search, backlinks, paths.

export type Note = { path: string; title: string; text: string; modified: number }

/** `[[Target]]`, `[[Target|Shown]]`, `[[Target#Heading]]`: the target, as written. */
export function wikilinks(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g)) if (m[1].trim()) out.push(m[1].trim())
  return out
}

/** A note's title: its file name without `.md`. */
export const titleOf = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '')

export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** A name that's safe as a file name on every platform. */
export function safeName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
  return name.slice(0, 120) || 'Untitled'
}

/** A path inside the vault, `/`-separated, never leaving it. */
export function cleanPath(path: string): string {
  return path.split(/[\\/]/).filter(p => p && p !== '.' && p !== '..').join('/')
}

/** The note a link points to: by path, then by title (any folder), ignoring case. */
export function resolve(notes: Iterable<Note>, target: string): Note | undefined {
  const t = cleanPath(target).toLowerCase().replace(/\.md$/, '')
  let byTitle: Note | undefined
  for (const n of notes) {
    const p = n.path.toLowerCase().replace(/\.md$/, '')
    if (p === t) return n
    if (!byTitle && n.title.toLowerCase() === t.split('/').pop()) byTitle = n
  }
  return byTitle
}

/** Notes that link to `note`. */
export function backlinks(notes: Note[], note: Note): Note[] {
  return notes.filter(n => n.path !== note.path && wikilinks(n.text).some(l => resolve(notes, l)?.path === note.path))
}

const COMMON = new Set(['the', 'and', 'for', 'you', 'your', 'are', 'was', 'what', 'when', 'where', 'which', 'who', 'how', 'did', 'does', 'about', 'with', 'that', 'this', 'have', 'has', 'had', 'our', 'can', 'any', 'tell', 'say', 'said', 'notes', 'note', 'my'])

export function words(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3 && !COMMON.has(w)))]
}

/** A short passage around the first word found. */
export function excerpt(text: string, ws: string[], max = 280): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const lower = flat.toLowerCase()
  const at = Math.min(...ws.map(w => lower.indexOf(w)).filter(i => i >= 0), Infinity)
  const start = Number.isFinite(at) ? Math.max(0, Math.min(at - Math.floor(max / 3), flat.length - max)) : 0
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + max)}${start + max < flat.length ? '…' : ''}`
}

export type Hit = { note: Note; score: number; excerpt: string }

/** Notes that match `query`: a word in the title counts three, in the text one (each word once). */
export function search(notes: Iterable<Note>, query: string, limit = 5): Hit[] {
  const ws = words(query)
  if (ws.length === 0) return []
  const hits: Hit[] = []
  for (const note of notes) {
    const title = note.title.toLowerCase()
    const text = note.text.toLowerCase()
    let score = 0
    for (const w of ws) score += (title.includes(w) ? 3 : 0) + (text.includes(w) ? 1 : 0)
    if (score > 0) hits.push({ note, score, excerpt: excerpt(note.text, ws) })
  }
  hits.sort((a, b) => b.score - a.score || b.note.modified - a.note.modified)
  return hits.slice(0, limit)
}

/** Quick switcher: titles and paths that contain every typed piece, in order of fit. */
export function quickFind(notes: Iterable<Note>, typed: string, limit = 12): Note[] {
  const q = typed.trim().toLowerCase()
  const all = [...notes]
  if (!q) return all.sort((a, b) => b.modified - a.modified).slice(0, limit)
  const pieces = q.split(/\s+/)
  return all
    .filter(n => pieces.every(p => n.path.toLowerCase().includes(p)))
    .sort((a, b) => Number(!a.title.toLowerCase().startsWith(q)) - Number(!b.title.toLowerCase().startsWith(q)) || a.title.length - b.title.length)
    .slice(0, limit)
}
