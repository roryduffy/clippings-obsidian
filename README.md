# Clippings for Obsidian

Syncs the clips you save with [Clippings](https://clippingsapp.xyz) — short
videos and photo carousels from TikTok, Instagram, YouTube Shorts, X and
Facebook, transcribed with key takeaways — into your vault as Markdown
notes, with control over where they land and what they look like.

> **Status: pre-release.** Not yet in the community plugin directory.

## How it works

1. Install the plugin and open its settings.
2. Press **Connect**. Your browser opens clippingsapp.xyz, you sign in, and
   you are sent straight back to Obsidian.
3. On your [Clippings settings](https://clippingsapp.xyz/settings), press
   **Connect Obsidian**. On Pro, each notebook's edit page can opt out.
4. Clips arrive when Obsidian opens, on a timer, or when you run
   **Clippings: Sync now** from the command palette.

## What you control

- **Folders.** A base folder, a folder template (`{{notebook}}` by default;
  `{{platform}}`, `{{creator}}`, `{{year}}`, `{{month}}` also work), and a
  per-notebook override for any notebook that belongs somewhere else.
- **Filenames.** A template, `{{saved|date:YYYY-MM-DD}} {{title|truncate:60}}`
  by default.
- **The note itself.** A template with typed frontmatter, your note as a
  callout, the takeaways and the transcript (or slide text for a carousel).
  Variables: `title creator platform platform_label url clippings_url
  notebook note takeaways transcript transcript_method caption media_kind
  carousel slide_count duration duration_label thumbnail_url saved completed
  year month clip_id`. Filters: `date:FORMAT slug upper lower truncate:N yaml
  wikilink list quote tag`. Blocks: `{{#if note}} … {{else}} … {{/if}}`.
  The editor validates as you type; **Reset to default** brings the built-in
  note back. Keep `clippings_id` in the frontmatter — it is how the plugin
  recognises its own notes.
- **Existing notes.** When a clip's note is already in the vault: leave it
  alone, overwrite it if you have not edited it, or overwrite it regardless.
  **Re-render notes** applies your current template to every note under
  that rule, so a template change can reach notes already written.
- **History.** Whether clips saved before this vault was connected come
  across.

## Things to know

- **Network use.** The plugin talks only to the Clippings server named in
  its settings (`https://clippingsapp.xyz` unless you change it): to sign
  you in, to fetch clips your vault has not received, to fetch a clip again
  when you re-render, and to report which notes it wrote. Nothing else is
  contacted.
- **Account required.** You need a Clippings account. Obsidian is a
  connection like NotebookLM and Notion: one connection at a time on
  Starter, every connection on Pro. Saving clips is Clippings' paid service.
- **No telemetry.** The plugin collects no usage data.
- **What is stored where.** Settings, the map of which clip became which
  note, and the hashes that tell an edited note from an untouched one are in
  this plugin's `data.json`. Your sign-in is kept in Obsidian's per-device
  local storage, not in the vault, so syncing the vault never syncs your
  credentials. A vault opened on another device connects separately, and
  every connected vault is listed on your Clippings settings page with a
  Disconnect button.
- **Never deletes.** Deleting a clip in Clippings never touches a note. A
  note you delete in the vault is not written again.
- **Moved notes are fine.** The plugin finds its notes by `clippings_id`, so
  rename them or move them anywhere in the vault.
- **Several vaults.** Each connected vault gets every clip. A vault that
  reconnects picks up where it left off.
- **Offline.** A sync that cannot reach the server says so in the status bar
  and tries again next time; it never signs you out. Only the server
  rejecting the sign-in does that.

## Development

```bash
npm install
npm run dev      # esbuild watch → main.js
npm run build    # type-check + production bundle
npm run lint
```

Symlink this folder into a test vault as `.obsidian/plugins/clippings` and
use the Hot Reload plugin. Under **Advanced** in the settings, point
**Server** at a local backend.

## Licence

MIT.
