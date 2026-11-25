# Pixel-Art 2D Environment, Tile & Prop Craft Guide

Use this guide whenever authoring 2D pixel tilesets, trees, rocks, cottages, crates, fences, or background scenery.

## 1. Figure-Ground Discipline (Characters Always Win Contrast!)
- Keep environment palettes **slightly lower contrast and more cohesive** (`lumRange` 95–155) than hero characters & glowing pickups (`lumRange` 180–230), and use softer tinted **`outline('selout', { palette })`** (or interior-only shading on seamless ground tiles) instead of heavy black outlines!
- Reserve deepest ink and brightest highlights strictly for interactive edges (ledge tops, doors, glowing windows, climbable surfaces).

## 2. Big-Medium-Small Texture Clusters (Zero Noisy Static)
- Group stone bricks, roof shingles, wood planks, and grass tufts into **readable 3×2 to 6×4 clusters** lit consistently from the top-left.
- Break repeating edges with small overlapping overhangs (tufts of grass hanging 1–2px over cliff edges, moss draping over stone blocks, eaves overhanging cottage walls).
- Ground every standing prop (trees, crates, cottages, lamps) with a clean flat base edge and optional dark contact base line so it sits firmly on tilemaps.

## 3. Modular Snapping & Audit Constraints
- Keep standing scenery sprites within **<= 12–14 colors** sharing the game's unified ink & highlight tones, `orphans === 0`, and clean bounding alignment for predictable tile placement.
