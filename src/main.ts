// Notebook: an Obsidian-style markdown notebook, as an Ava add-on. It works
// on one folder the person picks (a grant from Ava's picker), indexes the
// notes in this page, and offers Ava tools to search, read, list, create and
// append to them.
import '@fontsource/comfortaa/700.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import './style.css'
import { EditorState } from '@codemirror/state'
import { Decoration, EditorView, MatchDecorator, ViewPlugin, drawSelection, keymap, placeholder, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { searchKeymap } from '@codemirror/search'
import { classHighlighter } from '@lezer/highlight'
// The MCP Apps view SDK (the official @modelcontextprotocol/ext-apps, its
// self-contained build): Notebook is an MCP App view whose tools Ava calls.
import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps/app-with-deps'
import manifest from '../public/manifest.json'
import { renderer } from './markdown'
import { backlinks, cleanPath, excerpt, folderOf, quickFind, resolve, safeName, search, titleOf, words, type Note } from './notes'

// ---- Ava's client (served at /ava.js) ----
type Transport = { start(): Promise<void>; send(message: unknown): Promise<void>; close(): Promise<void> }
type Grant = { token: string; name: string; kind: 'folder' | 'file' }
type Entry = { name: string; path: string; kind: 'folder' | 'file'; size: number; modified: number }
type Ava = {
  pickFolder(): Promise<Grant>
  grants(): Promise<Grant[]>
  files: {
    list(token: string, path?: string): Promise<Entry[]>
    read(token: string, path: string): Promise<string>
    write(token: string, path: string, data: string): Promise<Entry>
    mkdir(token: string, path: string): Promise<Entry>
    rename(token: string, from: string, to: string): Promise<Entry>
    delete(token: string, path: string): Promise<void>
    url(token: string, path: string): string
  }
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }
  /** Hear a notification from Ava by its method. */
  on(method: string, fn: (params: Record<string, unknown>) => void): () => void
  /** An MCP transport over Ava's bridge. */
  transport(): Transport
  openExternal(url: string): Promise<void>
}
const ava = (window as unknown as { ava: Ava }).ava

// ---- State ----
let vault: Grant | null = null
const notes = new Map<string, Note>()
const folders = new Set<string>()
let current: string | null = null
let mode: 'edit' | 'read' = 'edit'
let treeOpen = false
const expanded = new Set<string>([''])
let indexing: Promise<void> = Promise.resolve()
let error: string | null = null

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl+'
const all = () => [...notes.values()]

// ---- DOM helpers ----
type Child = Node | string | null | undefined | false
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    else if (k === 'class') el.className = String(v)
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v
    else el.setAttribute(k, String(v))
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}
const svg = (path: string) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '17'); s.setAttribute('height', '17')
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8')
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round')
  s.innerHTML = path
  return s
}
const ICONS = {
  tree: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
  note: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  vault: '<path d="M4 6h16M4 12h16M4 18h10"/>',
}

// ---- Vault: index in this page ----
async function walk(dir: string, depth: number) {
  if (!vault || depth > 12 || notes.size > 5000) return
  const entries = await ava.files.list(vault.token, dir)
  const reads: Promise<void>[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.kind === 'folder') {
      folders.add(e.path)
      await walk(e.path, depth + 1)
    } else if (/\.md$/i.test(e.name)) {
      const token = vault.token
      reads.push(ava.files.read(token, e.path).then(text => { notes.set(e.path, { path: e.path, title: titleOf(e.path), text, modified: e.modified }) }).catch(() => {}))
    }
  }
  await Promise.all(reads)
}

async function index() {
  notes.clear()
  folders.clear()
  await walk('', 0)
}

async function load() {
  error = null
  const grants = (await ava.grants().catch(() => [] as Grant[])).filter(g => g.kind === 'folder')
  const saved = await ava.storage.get('vault').catch(() => null)
  vault = grants.find(g => g.token === saved) ?? grants[grants.length - 1] ?? null
  current = null
  if (!vault) { render(); return }
  indexing = index()
  render()
  await indexing
  const last = await ava.storage.get(`last:${vault.token}`).catch(() => null)
  const first = typeof last === 'string' && notes.has(last) ? last : all().sort((a, b) => b.modified - a.modified)[0]?.path ?? null
  if (first) open(first)
  else render()
}

async function chooseVault() {
  try {
    const g = await ava.pickFolder()
    await ava.storage.set('vault', g.token)
    await load()
  } catch (e) {
    const m = String((e as Error).message ?? e)
    if (!/Nothing was picked/.test(m)) { error = m; render() }
  }
}

// ---- Notes ----
function uniquePath(folder: string, title: string): string {
  const base = safeName(title)
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`
    const path = cleanPath(`${folder}/${name}.md`)
    if (!notes.has(path) && !folders.has(path.replace(/\.md$/, ''))) return path
  }
}

async function writeNote(path: string, text: string) {
  if (!vault) throw new Error('No folder is open in Notebook.')
  const folder = folderOf(path)
  if (folder && !folders.has(folder)) {
    let at = ''
    for (const part of folder.split('/')) {
      at = at ? `${at}/${part}` : part
      if (!folders.has(at)) { await ava.files.mkdir(vault.token, at); folders.add(at) }
    }
  }
  const e = await ava.files.write(vault.token, path, text)
  notes.set(path, { path, title: titleOf(path), text, modified: e.modified || Date.now() })
}

async function createNote(folder: string, title: string, text?: string): Promise<string> {
  const path = uniquePath(folder, title)
  await writeNote(path, text ?? `# ${titleOf(path)}\n\n`)
  return path
}

async function openOrCreate(target: string) {
  const found = resolve(all(), target)
  if (found) { open(found.path); return }
  const path = await createNote(folderOf(cleanPath(target)), cleanPath(target).split('/').pop() ?? target)
  mode = 'edit'
  open(path)
}

async function renamePath(from: string, toName: string) {
  if (!vault) return
  const isFolder = folders.has(from)
  const name = safeName(toName.replace(/\.md$/i, ''))
  const to = cleanPath(`${folderOf(from)}/${isFolder ? name : `${name}.md`}`)
  if (to === from) return
  await ava.files.rename(vault.token, from, to)
  if (isFolder) {
    for (const f of [...folders]) if (f === from || f.startsWith(`${from}/`)) { folders.delete(f); folders.add(to + f.slice(from.length)) }
    for (const [p, n] of [...notes]) if (p.startsWith(`${from}/`)) { notes.delete(p); const np = to + p.slice(from.length); notes.set(np, { ...n, path: np }) }
    if (current?.startsWith(`${from}/`)) current = to + current.slice(from.length)
  } else {
    const n = notes.get(from)
    notes.delete(from)
    if (n) notes.set(to, { ...n, path: to, title: titleOf(to) })
    if (current === from) current = to
  }
  render()
}

async function deletePath(path: string) {
  if (!vault) return
  await ava.files.delete(vault.token, path)
  for (const p of [...notes.keys()]) if (p === path || p.startsWith(`${path}/`)) notes.delete(p)
  for (const f of [...folders]) if (f === path || f.startsWith(`${path}/`)) folders.delete(f)
  if (current && !notes.has(current)) current = null
  render()
}

// ---- Editor ----
const wikiDeco = new MatchDecorator({ regexp: /\[\[[^\]\n]+\]\]/g, decoration: Decoration.mark({ class: 'cm-wikilink' }) })
const wikiPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = wikiDeco.createDeco(view) }
  update(u: ViewUpdate) { this.decorations = wikiDeco.updateDeco(u, this.decorations) }
}, { decorations: v => v.decorations })

let saveTimer: ReturnType<typeof setTimeout> | null = null
let savedLabel: HTMLElement | null = null
function scheduleSave(path: string, text: string) {
  if (saveTimer) clearTimeout(saveTimer)
  if (savedLabel) savedLabel.textContent = '…'
  const n = notes.get(path)
  if (n) n.text = text
  saveTimer = setTimeout(async () => {
    saveTimer = null
    try {
      await writeNote(path, text)
      if (savedLabel) savedLabel.textContent = 'Saved'
    } catch (e) {
      if (savedLabel) savedLabel.textContent = 'Not saved'
      error = String((e as Error).message ?? e)
    }
  }, 500)
}

function editorFor(path: string, text: string): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: [
        history(),
        drawSelection(),
        markdown(),
        syntaxHighlighting(classHighlighter),
        wikiPlugin,
        EditorView.lineWrapping,
        placeholder('Write something. [[Double brackets]] link to another note.'),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.updateListener.of(u => { if (u.docChanged) scheduleSave(path, u.state.doc.toString()) }),
        EditorView.domEventHandlers({
          // ⌘/Ctrl-click a [[link]] to follow it.
          mousedown(e, view) {
            if (!(e.metaKey || e.ctrlKey)) return false
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
            if (pos === null) return false
            const line = view.state.doc.lineAt(pos)
            for (const m of line.text.matchAll(/\[\[([^\]\n|#]+)[^\]\n]*\]\]/g)) {
              const from = line.from + (m.index ?? 0)
              if (pos >= from && pos <= from + m[0].length) { e.preventDefault(); void openOrCreate(m[1].trim()); return true }
            }
            return false
          },
        }),
      ],
    }),
  })
  return view
}

const render_md = renderer({
  exists: target => !!resolve(all(), target),
  fileUrl: path => (vault ? ava.files.url(vault.token, path) : ''),
}, () => current ?? '')

// ---- Rendering ----
const app = document.getElementById('app') as HTMLElement
let editor: EditorView | null = null

function open(path: string) {
  current = path
  if (vault) void ava.storage.set(`last:${vault.token}`, path).catch(() => {})
  if (window.innerWidth < 760) treeOpen = false
  render()
}

function render() {
  editor?.destroy()
  editor = null
  savedLabel = null
  app.textContent = ''
  if (!vault) { app.append(emptyVault()); return }
  const note = current ? notes.get(current) : undefined
  const title = h('input', {
    class: 'title', value: note?.title ?? '', placeholder: note ? 'Untitled' : vault.name, disabled: !note, 'aria-label': 'Note title',
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { (e.target as HTMLInputElement).value = note?.title ?? ''; (e.target as HTMLInputElement).blur() } },
    onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value.trim(); if (note && v && v !== note.title) void renamePath(note.path, v) },
  })
  savedLabel = h('span', { class: 'saved' })
  const bar = h('div', { class: 'bar' },
    h('button', { class: `icon${treeOpen ? ' on' : ''}`, title: 'Notes', 'aria-label': 'Show notes', onclick: () => { treeOpen = !treeOpen; render() } }, svg(ICONS.tree)),
    title,
    savedLabel,
    note ? h('div', { class: 'modes', role: 'tablist' },
      h('button', { class: mode === 'edit' ? 'on' : '', onclick: () => { mode = 'edit'; void ava.storage.set('mode', mode); render() } }, 'Edit'),
      h('button', { class: mode === 'read' ? 'on' : '', onclick: () => { mode = 'read'; void ava.storage.set('mode', mode); render() } }, 'Read'),
    ) : null,
    h('button', { class: 'icon', title: `Find a note (${MOD}K)`, 'aria-label': 'Find a note', onclick: () => switcher() }, svg(ICONS.search)),
  )
  const body = h('div', { class: 'body' }, tree())
  const pane = h('div', { class: 'note' })
  body.append(pane)
  app.append(bar, body)
  if (!note) {
    pane.append(h('div', { class: 'empty' }, h('div', { class: 'card' },
      h('h1', {}, notes.size ? 'Pick a note' : 'No notes yet'),
      h('p', {}, notes.size ? 'Choose one on the left, or find one by name.' : `Notebook found no notes in “${vault.name}”. Start one.`),
      h('button', { class: 'primary', onclick: async () => { mode = 'edit'; open(await createNote('', 'Untitled')) } }, 'New note'),
    )))
    return
  }
  if (mode === 'edit') {
    editor = editorFor(note.path, note.text)
    pane.append(editor.dom)
    requestAnimationFrame(() => editor?.focus())
  } else {
    const preview = h('div', { class: 'preview' })
    preview.innerHTML = render_md(note.text)
    preview.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest('a')
      if (!a) return
      e.preventDefault()
      const ext = a.getAttribute('data-external')
      if (ext) { void ava.openExternal(ext).catch(() => {}); return }
      const target = a.getAttribute('data-target')
      if (target) void openOrCreate(target)
    })
    const back = backlinks(all(), note)
    pane.append(preview, h('div', { class: 'backlinks' },
      h('h4', {}, `Linked from ${back.length || 'nowhere yet'}`),
      ...back.map(b => h('button', { onclick: () => open(b.path) }, b.title)),
    ))
  }
}

function emptyVault(): HTMLElement {
  const mark = h('img', { class: 'mark', src: '/icon.svg', alt: '' })
  return h('div', { class: 'empty' }, h('div', { class: 'card' },
    mark,
    h('h1', {}, 'Your notes, in a folder you choose'),
    h('p', {}, 'Notebook keeps plain markdown files in one folder on this computer. Pick an existing vault or an empty folder to start.'),
    h('button', { class: 'primary', onclick: chooseVault }, 'Choose a folder…'),
    h('p', { class: 'small' }, 'Notebook only sees that folder. You can take it back any time in Ava’s Settings › Add-ons.'),
    error ? h('div', { class: 'error' }, error) : null,
  ))
}

type Pending = { kind: 'rename' | 'confirm'; path: string } | null
let pending: Pending = null

function tree(): HTMLElement {
  const list = h('div', { class: 'tree-list', role: 'tree' })
  const childrenOf = (dir: string) => {
    const fs = [...folders].filter(f => folderOf(f) === dir).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    const ns = all().filter(n => folderOf(n.path) === dir).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    return { fs, ns }
  }
  const row = (path: string, depth: number, isFolder: boolean) => {
    const name = isFolder ? path.split('/').pop() ?? path : titleOf(path)
    if (pending?.kind === 'rename' && pending.path === path) {
      const input = h('input', {
        class: 'rename', value: name,
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value; pending = null; void renamePath(path, v) }
          if (e.key === 'Escape') { pending = null; render() }
        },
        onblur: (e: FocusEvent) => { if (pending?.path === path) { const v = (e.target as HTMLInputElement).value; pending = null; void renamePath(path, v) } },
      })
      requestAnimationFrame(() => { input.focus(); input.select() })
      list.append(h('div', { style: `padding-left:${8 + depth * 14}px` }, input))
      return
    }
    const open_ = isFolder && expanded.has(path)
    list.append(h('div', {
      class: `row${!isFolder && path === current ? ' active' : ''}`, role: 'treeitem', tabindex: '0', style: `padding-left:${8 + depth * 14}px`,
      onclick: () => { if (isFolder) { if (open_) expanded.delete(path); else expanded.add(path); render() } else open(path) },
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') (e.currentTarget as HTMLElement).click() },
    },
      h('span', { class: 'chev' }, isFolder ? (open_ ? '▾' : '▸') : ''),
      h('span', { class: 'name', title: path }, name),
      isFolder ? h('button', { class: 'act', title: 'New note here', onclick: async (e: Event) => { e.stopPropagation(); expanded.add(path); mode = 'edit'; open(await createNote(path, 'Untitled')) } }, '+') : null,
      h('button', { class: 'act', title: 'Rename', onclick: (e: Event) => { e.stopPropagation(); pending = { kind: 'rename', path }; render() } }, '✎'),
      h('button', { class: 'act bad', title: 'Delete', onclick: (e: Event) => { e.stopPropagation(); pending = { kind: 'confirm', path }; render() } }, '✕'),
    ))
    if (pending?.kind === 'confirm' && pending.path === path) {
      list.append(h('div', { class: 'confirm' },
        `Move “${name}” to the Trash?`,
        h('button', { class: 'bad', onclick: () => { pending = null; void deletePath(path) } }, 'Delete'),
        h('button', { onclick: () => { pending = null; render() } }, 'Keep'),
      ))
    }
    if (open_) walkRows(path, depth + 1)
  }
  const walkRows = (dir: string, depth: number) => {
    const { fs, ns } = childrenOf(dir)
    for (const f of fs) row(f, depth, true)
    for (const n of ns) row(n.path, depth, false)
  }
  walkRows('', 0)
  if (notes.size === 0 && folders.size === 0) list.append(h('div', { class: 'row' }, h('span', { class: 'name' }, 'Empty folder')))
  return h('aside', { class: `tree${treeOpen ? ' open' : ''}`, 'aria-label': 'Notes' },
    h('div', { class: 'tree-head' },
      h('span', { class: 'vault-name', title: vault?.name }, vault?.name ?? ''),
      h('button', { class: 'icon', title: 'New note', 'aria-label': 'New note', onclick: async () => { mode = 'edit'; open(await createNote('', 'Untitled')) } }, svg(ICONS.note)),
      h('button', {
        class: 'icon', title: 'New folder', 'aria-label': 'New folder',
        onclick: async () => {
          if (!vault) return
          const path = uniquePath('', 'New folder').replace(/\.md$/, '')
          await ava.files.mkdir(vault.token, path)
          folders.add(path)
          pending = { kind: 'rename', path }
          render()
        },
      }, svg(ICONS.folder)),
      h('button', { class: 'icon', title: 'Choose another folder', 'aria-label': 'Choose another folder', onclick: chooseVault }, svg(ICONS.vault)),
    ),
    list,
  )
}

// ---- Quick switcher (⌘K / Ctrl+K, ⌘O) ----
function switcher() {
  if (document.querySelector('.switcher-back')) return
  const input = h('input', { placeholder: 'Find or create a note…', 'aria-label': 'Find a note' })
  const ul = h('ul', { role: 'listbox' })
  let picks: { label: string; path?: string; sub?: string; hit?: boolean; create?: string }[] = []
  let at = 0
  const close = () => back.remove()
  const choose = async (i: number) => {
    const p = picks[i]
    close()
    if (!p) return
    if (p.path) open(p.path)
    else if (p.create) { mode = 'edit'; open(await createNote('', p.create)) }
  }
  const update = () => {
    const q = input.value
    const names = quickFind(all(), q, 8).map(n => ({ label: n.title, path: n.path, sub: folderOf(n.path) || undefined }))
    const text = words(q).length ? search(all(), q, 6).filter(hit => !names.some(n => n.path === hit.note.path)).map(hit => ({ label: hit.note.title, path: hit.note.path, sub: hit.excerpt, hit: true })) : []
    picks = [...names, ...text]
    if (q.trim() && !resolve(all(), q.trim())) picks.push({ label: `Create “${safeName(q)}”`, create: q.trim() })
    at = Math.min(at, Math.max(0, picks.length - 1))
    ul.textContent = ''
    picks.forEach((p, i) => ul.append(h('li', { class: i === at ? 'on' : '', role: 'option', onmousedown: (e: Event) => { e.preventDefault(); void choose(i) } },
      p.label,
      p.sub ? h('span', { class: p.hit ? 'hit' : 'path' }, p.sub) : null,
    )))
  }
  input.addEventListener('input', () => { at = 0; update() })
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { at = Math.min(at + 1, picks.length - 1); update(); e.preventDefault() }
    if (e.key === 'ArrowUp') { at = Math.max(at - 1, 0); update(); e.preventDefault() }
    if (e.key === 'Enter') { void choose(at); e.preventDefault() }
    if (e.key === 'Escape') close()
  })
  const back = h('div', { class: 'switcher-back', onmousedown: (e: Event) => { if (e.target === back) close() } },
    h('div', { class: 'switcher', role: 'dialog', 'aria-label': 'Find a note' }, input, ul, h('div', { class: 'hint' }, '↑↓ to move · Enter to open · Esc to close')))
  document.body.append(back)
  update()
  input.focus()
}

addEventListener('keydown', e => {
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (mod && (e.key === 'k' || e.key === 'o')) { e.preventDefault(); switcher() }
  if (mod && e.key === 'e' && current) { e.preventDefault(); mode = mode === 'edit' ? 'read' : 'edit'; render() }
})

// ---- Ava's tools ----
// Tools register at once (so Ava can call in while the page starts); calls
// wait for the first load of the vault, then for any re-index.
let markLoaded: () => void = () => {}
const loaded = new Promise<void>(r => { markLoaded = r })
const ready = async () => {
  await loaded
  await indexing
  if (!vault) throw new Error('No folder is open in Notebook: the person needs to choose one first.')
}
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown, d: number, most: number) => (typeof v === 'number' && v > 0 ? Math.min(Math.floor(v), most) : d)
const find = (args: Record<string, unknown>): Note => {
  const path = str(args.path)
  const n = (path && notes.get(cleanPath(path))) || resolve(all(), path || str(args.title))
  if (!n) throw new Error(`There's no note ${path || str(args.title)}: find it with notebook_search or notebook_list.`)
  return n
}

type Args = Record<string, unknown>
const handlers: Record<string, (args: Args) => Promise<unknown>> = {
  async search(args) {
    await ready()
    const query = str(args.query)
    if (!words(query).length) throw new Error('Give a few distinctive words in `query`.')
    const hits = search(all(), query, num(args.limit, 5, 20))
    // Short notes come whole; long ones as the passage around the match (notebook_read has the rest).
    const ws = words(query)
    return {
      query,
      notes: hits.map(x => ({ path: x.note.path, title: x.note.title, ...(x.note.text.length <= 1500 ? { text: x.note.text } : { passage: excerpt(x.note.text, ws, 900), cut: true }) })),
      open: hits[0] ? { path: hits[0].note.path } : null,
    }
  },
  async read(args) {
    await ready()
    const n = find(args)
    return { path: n.path, title: n.title, text: n.text.length > 12000 ? `${n.text.slice(0, 12000)}…` : n.text, open: { path: n.path } }
  },
  async list(args) {
    await ready()
    const folder = cleanPath(str(args.folder))
    const list = all().filter(n => !folder || n.path.startsWith(`${folder}/`)).sort((a, b) => b.modified - a.modified)
    const limit = num(args.limit, 30, 200)
    return { folder: folder || null, notes: list.slice(0, limit).map(n => ({ path: n.path, title: n.title, modified: new Date(n.modified).toISOString().slice(0, 16).replace('T', ' ') })), more: Math.max(0, list.length - limit) }
  },
  async create(args) {
    await ready()
    const title = str(args.title)
    if (!title) throw new Error('Give the note a `title`.')
    const text = typeof args.text === 'string' ? args.text : ''
    const path = await createNote(cleanPath(str(args.folder)), title, text)
    render()
    return { path, title: titleOf(path), created: true, open: { path } }
  },
  async append(args) {
    await ready()
    const n = find(args)
    const add = typeof args.text === 'string' ? args.text.trim() : ''
    if (!add) throw new Error('Give the text to add in `text`.')
    const text = `${n.text.replace(/\s*$/, '')}\n\n${add}\n`
    await writeNote(n.path, text)
    if (current === n.path) render()
    return { path: n.path, title: n.title, appended: true, open: { path: n.path } }
  },
}

// ---- Notebook as an MCP App view ----
// Its tools are the manifest's (one list), with the MCP annotations of each
// one's class; Ava treats them as hints and holds the manifest's class.
const ANNOTATIONS = {
  read: { readOnlyHint: true, openWorldHint: false },
  inside: { readOnlyHint: false, openWorldHint: false },
  outside: { readOnlyHint: false, openWorldHint: true },
} as const
const TOOLS = manifest.tools.map(t => ({
  name: t.name,
  description: t.description,
  inputSchema: t.input_schema,
  annotations: ANNOTATIONS[t.effect as keyof typeof ANNOTATIONS],
}))

/** Ava's theme and colours (MCP Apps' host context) onto this page. */
function applyContext(ctx: { theme?: 'light' | 'dark'; styles?: { variables?: Record<string, string | undefined> } } | undefined) {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles as never)
}

const view = new App({ name: manifest.name, version: manifest.version }, { tools: { listChanged: false } })
view.onlisttools = async () => ({ tools: TOOLS }) as never
view.oncalltool = async params => {
  const fn = handlers[params.name]
  try {
    if (!fn) throw new Error(`Notebook has no tool ${params.name}.`)
    const value = await fn((params.arguments ?? {}) as Args)
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: String((e as Error).message ?? e) }] }
  }
}
view.onhostcontextchanged = ctx => applyContext(ctx as never)
void view.connect(ava.transport() as never).then(() => applyContext(view.getHostContext() as never)).catch(e => console.error('Notebook: connecting to Ava failed', e))

// ---- Messages from Ava ----
ava.on('ava/notifications/open', async m => {
  await indexing
  const p = cleanPath(str(m.path))
  if (p && notes.has(p)) { mode = 'read'; open(p) }
})
// The folders Ava gave Notebook changed (picked, or taken back in Settings).
ava.on('notifications/roots/list_changed', () => { void load() })

void (async () => {
  const m = await ava.storage.get('mode').catch(() => null)
  if (m === 'read' || m === 'edit') mode = m
  if (window.innerWidth >= 760) treeOpen = true
  try {
    await load()
  } finally {
    markLoaded()
  }
})()
