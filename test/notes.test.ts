import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backlinks, cleanPath, quickFind, resolve, safeName, search, titleOf, wikilinks, type Note } from '../src/notes.ts'

const note = (path: string, text: string, modified = 0): Note => ({ path, title: titleOf(path), text, modified })
const vault = [
  note('Recipes/Bread.md', '# Bread\nFeed the sourdough starter twice a day. See [[Flour]] and [[Recipes/Pizza|pizza]].', 2),
  note('Flour.md', 'Strong white flour, 13% protein.', 1),
  note('Recipes/Pizza.md', 'Dough from [[Bread#Starter]]. Bake at 280°C.', 3),
  note('Trips/Lisbon.md', 'Flight on 14 December.', 4),
]

test('wikilinks are read with aliases and headings', () => {
  assert.deepEqual(wikilinks('a [[Flour]] b [[Recipes/Pizza|pizza]] c [[Bread#Starter]] [[ ]] [[x\ny]]'), ['Flour', 'Recipes/Pizza', 'Bread'])
})

test('links resolve by path, then by title in any folder', () => {
  assert.equal(resolve(vault, 'Recipes/Pizza')?.path, 'Recipes/Pizza.md')
  assert.equal(resolve(vault, 'bread')?.path, 'Recipes/Bread.md')
  assert.equal(resolve(vault, 'Nope'), undefined)
  assert.equal(resolve(vault, '../Flour')?.path, 'Flour.md', 'never outside the vault')
})

test('backlinks are the notes that link here', () => {
  assert.deepEqual(backlinks(vault, vault[1]).map(n => n.path), ['Recipes/Bread.md'])
  assert.deepEqual(backlinks(vault, vault[0]).map(n => n.path), ['Recipes/Pizza.md'])
})

test('search ranks titles over text and finds the passage', () => {
  const hits = search(vault, 'what do my notes say about sourdough?')
  assert.equal(hits[0].note.path, 'Recipes/Bread.md')
  assert.match(hits[0].excerpt, /sourdough/)
  assert.equal(search(vault, 'pizza')[0].note.path, 'Recipes/Pizza.md', 'the title beats a mention')
  assert.deepEqual(search(vault, 'what about the'), [], 'only common words')
})

test('names and paths are safe', () => {
  assert.equal(safeName('a/b:c*?'), 'a b c')
  assert.equal(safeName('..hidden'), 'hidden')
  assert.equal(safeName('   '), 'Untitled')
  assert.equal(cleanPath('../x/./y\\z'), 'x/y/z')
})

test('the quick switcher fits typed pieces', () => {
  assert.equal(quickFind(vault, 'pi')[0].path, 'Recipes/Pizza.md')
  assert.deepEqual(quickFind(vault, 'rec br').map(n => n.path), ['Recipes/Bread.md'])
  assert.equal(quickFind(vault, '')[0].path, 'Trips/Lisbon.md', 'nothing typed: newest first')
})
