# Ridgetop

Dependency-free low-poly WebGPU / WebGL 2 / Canvas 2D game framework, Canvas UI SDK, authoritative multiplayer rooms, Testing Mode, and multi-platform packager (Web, Steam/Electron, Mobile/Capacitor, Portable Offline HTML Player, and Godot 4 with TypeScript-to-GDScript compilation).

## Entry Points

- `ridgetop` — browser & shared game runtime (3D renderer, geometry, instancing, sprites, animation rigs, physics, input, audio, platform bridge, art kit)
- `ridgetop/server` — HTTP game host (`createGameHost`), multiplayer rooms (`createRoomService`), records/sessions, packager (`packageGame`), Godot exporter (`exportGodotProject`)
- `ridgetop/ui` — cross-platform Canvas UI & pure-math layout SDK (`createCanvasUi`, `createUiTheme`, `resolveLayout`, `column`, `row`, `overlay`, `boxNode`, `spacerNode`)
- `ridgetop/art-review` & `ridgetop/art-review/server` — 3D/2D picking and art review store
- `ridgetop/testing` — Testing Mode runtime hooks

## CLI

```sh
ridgetop create <dir>
ridgetop package [--project <dir>] [--target web|steam|mobile|godot|player|all] [options]
ridgetop compile-godot <out-dir> <entry1.ts> [entry2.ts ...]
ridgetop preview-art <recipe.art.json> [out-dir]
ridgetop art-library list [query] | start <reference-id> <new-asset-name> [out-dir]
```
