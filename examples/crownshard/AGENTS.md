# Working on Crownshard

Crownshard is a mobile-first tactical RPG (targeting non-Max phones such as ~390×844 portrait / 844×390 landscape) that also supports full desktop keyboard & mouse play. Any new feature, mechanic, screen, or HUD control added to Crownshard **must** follow these rules:

## 1. Progressive Disclosure (Never Dump Everything on Battle 0/1)
- Gate every new system, Camp tab, currency, Battle tool, or replay difficulty in `crownshard/progression-unlocks.ts` (re-exported from `crownshard/simulation.ts`).
- **New-player flow**: Fresh campaigns launch directly into Battle 1 (`border_watch`). The World Map, Camp (`Squad` + `Armory`), Codex, Mastery, and advanced Battle tools unlock after Victory 1; `Tactic Deck` + `Packs` unlock at Win 2; `Forge`, `Gear Tempering`, `Bulk Salvage`, `Squad Bonds`, and secondary currencies (`Dust`/`Shards`) unlock at Win 3+.
- **Codex mystery**: New Heroes, Gear, and Enemies must remain masked (`???`) until discovered (owned, encountered, or unlocked by progression) — match `codex.ts` discovery helpers.
- **Re-battles & Boss Rematches**: Early stages replay at standard difficulty only; higher tiers (`veteran`, `mythic`) and Mutators unlock progressively on later stages. Replaying a cleared boss stage runs a boss-less garrison skirmish with reduced rewards (`BOSS_REMATCH_REWARD_SCALE`).
- Keep existing mid/late-game saves unaffected when adding new unlock gates.

## 2. Cross-Screen First-Encounter Discovery Tips
- Whenever a new mechanic, map landmark/event, Camp subsystem, or Codex feature appears for the first time, add a 1-time tip in `crownshard/discovery-tips.ts` (and its ID in `crownshard/types.ts` `DiscoveryTipId`).
- Tips apply across **all screens** (`battle`, `world_map`, `camp`, `codex`) via `checkDiscoveryTipForBattle`, `checkDiscoveryTipForWorldMap`, `checkDiscoveryTipForCamp`, and `checkDiscoveryTipForCodex`.
- Every tip spec **must** provide both `body` (desktop) and touch-native `touchBody` (no `"Click"`, `"Press X"`, or `"(Space)"`). Always render tips via `getDiscoveryTipBody(spec, vp.isTouchPrimary)` and `getDiscoveryTipHotkey(spec, vp.isTouchPrimary)`.

## 3. Mobile-First HUD & Non-Max Phone Ergonomics
- Use the unified `ViewportProfile` from `crownshard/viewport-profile.ts` (`computeViewportProfile`, `readDomSafeAreaInsets`) instead of ad-hoc pixel breakpoints. Always respect live `vp.safeArea` insets (`env(safe-area-inset-*)` in `game-ui.css`).
- Target `>= 44pt` effective touch targets on phones/touch devices and visually verify both `390×844` portrait and `844×390` landscape for zero overlaps.
- Never add persistent side rails on phones — use touch gestures (pinch-zoom, 2-finger rotate/pan) and keep Focus Mode (`focusMode` on Battle & World Map) unobstructed.
- **No hover-only information**: Anything revealed on mouse hover (tile terrain/cover/ZoC, move-path OA danger, status effects, skill descriptions, gear diff) must have a tap or 2-tap confirm equivalent on touch.

## 4. Input-Modality Awareness (Keep Keyboard, Hide It on Touch)
- Keep all keyboard shortcuts working on desktop and tablets with hardware keyboards — never remove keyboard support.
- Suppress **all** visual keycap badges (`1-4`, `Space`, `F`, `T`, `C`, `Esc`, `Q/E`, `H`, etc.) and mouse-only wording (`"Click..."`, `"Hover..."`, `"Right-click..."`) when `vp.isTouchPrimary` / `!vp.showKeycaps` is true. Use `uiCopy(vp.isTouchPrimary, desktopText, touchText)` and pass `hideKeycap` / `isTouch` to `ui-art.ts` helpers.

## 5. Pure Simulation & Godot Compatibility
- Keep simulation modules (`progression-unlocks.ts`, `discovery-tips.ts`, `codex.ts`, `simulation.ts`, etc.) free of browser globals (`window`, `document`, `localStorage`) and register new pure modules in `examples/crownshard/package.json` `ridgetop.godotEntries`.
- Verify changes with `pnpm --filter @ridgetop/crownshard build`, `pnpm typecheck`, and `node --test test/crownshard-*.test.ts`.
