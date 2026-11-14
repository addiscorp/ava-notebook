# Notebook

An Obsidian-style markdown notebook, as an [Ava](https://github.com/addiscorp/ava)
add-on. It opens in Ava's drawer on a folder of `.md` notes the person picks,
with `[[wikilinks]]`, backlinks and a quick switcher, and it gives Ava five
tools over those notes: `search`, `read`, `list` (read only) and `create`,
`append` (they change notes inside the folder, nothing else). It reaches no
host on the internet (`egress` is empty).

Add-ons are MCP servers in sandboxed webviews; the design is addiscorp/ava#33.
What Notebook may ask Ava for is in [`public/manifest.json`](public/manifest.json):
`files` (folders the person picks), `storage` (its own settings) and `tools`.

## Where this came from

Moved out of addiscorp/ava `addons/notebook/` at commit
[`df5323480627a63b8a37104cdad4d39286e85f7e`](https://github.com/addiscorp/ava/commit/df5323480627a63b8a37104cdad4d39286e85f7e)
(main after #39; the last change to the folder was `cc08a31`). Every file is
as it was there, except:
- `package.json` has no `version`: the add-on's version is the manifest's, and
  nowhere else.
- `@types/node` is a dev dependency (26.6.6, Ava's own pin). Inside Ava the
  type check found it in Ava's `node_modules`; on its own it has to bring it.

`npm run build` here gives the same bundle, byte for byte, as building
`addons/notebook` at that commit (all 39 files of `dist/` have the same sha256).

## Build and test

Node 24 or newer.

```sh
npm ci --ignore-scripts
npm run check      # tsc
npm run build      # tsc, then vite build into dist/
npm test           # node --test: the notes logic, and the built bundle (run after build)
```

`dist/` is the add-on: `manifest.json`, `index.html`, `icon.svg` and
`assets/` (one script, one stylesheet, and the fonts as files from
`@fontsource`, never a font CDN; the add-on's CSP only allows its own origin).
CI runs those four commands on every PR and on main, on a mirab VM (APS 11).

To try it in Ava before it's in the catalogue, point Ava's dev add-ons at
`dist/` (see addiscorp/ava `addons/` and `qa/README.md`).

## Versions and releases

The version lives in `public/manifest.json` (`version`, semver). There are no
tags and no releases in this repo, and nothing is published from here.

## The listing

[`listing/`](listing/) is what the catalogue, Ava's Settings › Add-ons and
`ava.addis.gg/addons/notebook` show: `listing.toml` (category, the long
description, screenshot captions), the icon and up to four PNG screenshots.
It isn't part of the bundle: the catalogue reads it at the pinned commit,
checks it (sizes, types, a safe SVG), and copies it into the signed package
and the signed index. Changing it needs a new version, like any change.
The name and the short description stay in the manifest.

## How it reaches the catalogue

[addiscorp/ava-catalogue](https://github.com/addiscorp/ava-catalogue) is a
reviewed list of add-ons, each pinned to a commit. To ship a change:

1. Merge it here, with the manifest's `version` bumped. A published version
   is never published again with other bytes, so every change needs a new one.
2. Open a PR in ava-catalogue that changes `addons/notebook.toml`: `commit` to
   the full SHA of the merge commit here, `version` to the manifest's, and the
   permissions, tools and egress hosts to what the manifest now declares.
3. That PR's CI builds Notebook from exactly that commit in a clean directory
   (`npm ci --ignore-scripts`, `npm run build`), checks the built manifest
   against the entry, packs `dist/` into a `.avapkg` and verifies it.
4. Once it's merged, the catalogue's release workflow builds it again, signs it
   in its `release` environment and uploads it to
   `https://ava-releases.addis.gg/catalogue/`, where Ava finds it.

## License

Proprietary, all rights reserved: see [LICENSE](LICENSE). First-party Ava
add-ons are proprietary, like Ava (Ava APS 1, avacanada/aps#1, under Addis
APS 17). Versions released before that change stay MIT for anyone who has
them. To build your own add-on, start from the SDK,
[@addiscorp/ava-addon](https://github.com/avacanada/ava-addon) (MIT), and the
example add-on, [ava-addon-hello](https://github.com/avacanada/ava-addon-hello).
