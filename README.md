# Clippings for Obsidian

Syncs the clips you save with [Clippings](https://clippingsapp.xyz) — short
videos from TikTok, Instagram, YouTube Shorts, X and Facebook, transcribed
with takeaways — into your vault as Markdown notes, with control over where
they land and what they look like.

> **Status: in development, not yet released.** Nothing below works until the
> first release is tagged.

## How it works

1. Install the plugin and open its settings.
2. Click **Connect**. Your browser opens clippingsapp.xyz, you sign in, and
   you are sent back to Obsidian.
3. On the web, turn on **Obsidian** for the notebooks you want synced
   (notebook → Edit → Manage connections).
4. New clips land in your vault on launch, on a timer, or when you run
   **Clippings: Sync now**.

Folders, filenames and the note itself come from templates in the plugin's
settings, so you decide the shape of every note.

## What this plugin does and does not do

- **Network use.** The plugin talks only to the Clippings server named in its
  settings (`https://clippingsapp.xyz` by default): to sign you in, to fetch
  clips your vault has not received yet, and to report which ones it wrote.
  Nothing else is contacted, and nothing is sent that is not needed for that.
- **Account required.** You need a Clippings account. Reading your library
  into Obsidian works on every plan; saving new clips is Clippings' paid
  service.
- **No telemetry.** The plugin collects no usage data.
- **What is stored where.** Settings and the map of which clip became which
  note are in this plugin's `data.json`. Sign-in tokens are kept in
  Obsidian's per-device local storage, not in the vault, so syncing the vault
  does not sync your credentials.
- **Never deletes.** Deleting a clip in Clippings never touches a note in
  your vault.

## Development

```bash
npm install
npm run dev      # esbuild watch → main.js
npm run build    # type-check + production bundle
npm run lint
```

Symlink this folder into a test vault as
`.obsidian/plugins/clippings` and use the Hot Reload plugin.

## Licence

MIT.
