# Low-Poly 3D Token & Hero Prop Craft Guide

Use this guide when authoring inventory pickups, tools, lanterns, relics, chests, camp gear, or interactive props.

## 1. The 1-Second Silhouette Rule
- A pickup or prop must be **100% identifiable as a solid black silhouette** at 32–48 px.
- **Exaggerate negative space:**
  - Arched carry handles, lantern cages, watering-can handles, and belt loops MUST frame generous open daylight (`>= 25%` of the frame area inside loops).
  - Prefer **`art.tube(id, points, radius, tone, { sides: 6 })`** for curved carry bails, bowed iron cage ribs, pouring spouts, and pipes — silky smooth continuous bends with **zero spikes** and low triangle count!

## 2. Three-Material Contrast & Translucent Glow
- Great indie props pair **3 distinct tactile materials** via `art.palette(role, hex)`:
  1. **Grounded Structural Metal/Wood** (e.g., forged iron `#2d3a48` or seasoned oak)
  2. **Warm Trim Accent** (e.g., burnished brass `#dca84c`, copper, or painted enamel)
  3. **Focal Glow / Glass** — layer an opaque `unlit: 0.96` glowing inner core (ember bed + `teardrop` flame or crystal shard) inside a **closed translucent shell** (`alpha: 0.26–0.34, blend: 'alpha'`, e.g., sea-glass `#8ee4f0`). `auditArtModel` automatically verifies inner core visibility through translucent shells!
- Separate touching bands of the same metal/wood with `shade: -0.18` to `+0.18` so bevels and tiered bases read crisply from 30° isometric elevation.

## 3. 30° Elevation & Grounding Discipline
- Remember that Ridgetop's 8-direction sprite baker views from **30° downward**: seat decorative collars, latches, and base moldings slightly outward so roof caps or lids don't swallow them from above.
- Keep triangle count **<= 1,250 tris** and finish with `art.bakeCreviceShade(0.10)` so interior sockets and cap undersides feel physically seated.
