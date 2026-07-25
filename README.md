# SteamGridDB for Millennium

SteamGridDB for Millennium is a Steam artwork browser and manager built for the Millennium plugin loader. It lets you search SteamGridDB from inside Steam, browse artwork by type, and apply new library assets without leaving the client.

![GitHub Downloads (all assets, all releases)](
https://img.shields.io/github/downloads/DevsNate/SteamGridDB-Millennium/total
)

## Features

- Search SteamGridDB games from inside Steam.
- Browse grids, wide grids, heroes, logos, and icons.
- Apply artwork directly to Steam apps through Steam's frontend artwork APIs.
- Download and apply Steam app icons through the Lua backend.
- Reset custom artwork back to Steam defaults.
- Add grids, wide grids, heroes, logos, and icons to SteamGridDB account collections.
- Big Picture/controller-friendly artwork browsing with smooth focus scrolling and automatic loading.
- Responsive artwork labels that scale with the selected column count.
- Optional Desktop library setting to hide game-page logos without changing artwork files.
- Theme-aware interface designed to blend with Fluenty-style dark Steam themes.
- Built-in Fluenty Dark, Steam Blue, OLED Black, Midnight Violet, and Ember theme presets.
- Configurable theme colors for background, selected/hover surfaces, grid hover borders, slider track, and slider thumb.
- Desktop popout view with a compact floating tab bar.

## Installation

Download `SteamGridDB-Millennium-v2.0.0.zip` from the latest GitHub release.

Extract the zip so the `SteamGridDB` folder is placed in Steam's Millennium plugins directory:

```text
Steam/millennium/plugins/SteamGridDB
```

Restart Steam or reload Millennium plugins after installing.

## SteamGridDB API Key

A personal SteamGridDB API key is required. Open the plugin settings, paste your key into the **SteamGridDB API Key** field, and select **Save Key**. The key is stored locally in the plugin's `settings.json` file and is used for artwork browsing and account collection requests.

## Account Collections

Hover or focus an artwork tile and select the `+` button in its top-right corner. Choose a collection from the Steam context menu to add that artwork to your SteamGridDB account. Collections support grids, wide grids, heroes, logos, and icons.

SteamGridDB's collection endpoints are not part of its public API documentation and may change without notice. The plugin keeps collection requests isolated in its backend and reports API failures through Steam notifications.

## Building

```bash
pnpm install
pnpm run build
```

The production bundle is written to:

```text
.millennium/Dist/index.js
```

## Releases

GitHub Actions builds the plugin on every `v*` tag and attaches a versioned `SteamGridDB-Millennium-vX.Y.Z.zip` archive to the release.

## Credits

Powered by artwork data from SteamGridDB.

This plugin is based on the SteamGridDB artwork workflow and adapted for the Millennium plugin environment.
