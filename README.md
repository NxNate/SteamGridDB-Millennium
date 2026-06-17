# SteamGridDB for Millennium

An early Millennium port of the SteamGridDB Decky plugin.

This version focuses on the core workflow:

- Search SteamGridDB games.
- Browse capsules, wide capsules, heroes, logos, and icons.
- Apply artwork to a Steam app through Steam's frontend artwork API.
- Download Steam app icons into Steam's library cache through the Lua backend.

The original Decky plugin also includes context-menu routing, shortcut VDF icon editing, local file selection, invisible assets, logo positioning, square capsules, and recent-game capsule patches. Those are planned follow-up ports because Millennium exposes different frontend and backend integration points than Decky.

## Building

```bash
pnpm install
pnpm run build
```

The production bundle is written to `.millennium/Dist/index.js`.

## Releases

GitHub Actions builds the plugin on every `v*` tag and attaches `SteamGridDB-Millennium.zip` to the release. Extract the zip so the `SteamGridDB` folder is placed in Steam's `millennium/plugins` directory.
