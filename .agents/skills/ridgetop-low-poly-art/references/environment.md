# Low-Poly 3D Environment & Architecture Craft Guide

Use this guide when authoring cottages, towers, bridges, shrines, foliage, cliffs, and modular world scenery.

## 1. Figure-Ground Hierarchy (Let Heroes Pop!)
- Environments should look **rich, cozy, and handcrafted** while staying **cohesive and grounded** so player characters and bright pickups always read clearly in front of them.
- Anchor every building/landmark with a **tiered stone foundation / plinth** (slightly wider than the walls, `stone` + `shade: -0.15` base step) so it looks rooted into uneven terrain rather than floating on grass.

## 2. Architectural Depth & Faceted Trim (Never a Plain Box!)
- **Recessed Gable + Overhanging Pitched Roof:**
  - Build the attic gable wall with **`gable`** recessed slightly inside the roof footprint.
  - Build the overhanging roof slopes with tilted `box` slabs + crisp **fascia trim** + flared coastal **`wedge` eaves** (remember Euler order is `roll -> pitch -> yaw`, so yawed `±Math.PI/2` eaves tilt via `pitch`!).
  - Top with a ridge beam and an **asymmetric crooked chimney** (`stone` + terracotta pot) to break symmetry and create an iconic silhouette.
- **Layered Facade Storytelling:**
  - Frame every doorway and window with protruding trim (`wood`/`light` frames, recessed dark or `unlit: 0.95` glowing glass, mullions/crossbars, tiny flower boxes, sloped porch awning on thin posts, porch steps, and a side prop like a rain barrel or crate).
  - Add subtle `art.bakeCreviceShade(0.12)` so walls tucked under roof overhangs and porch awnings naturally darken like a real miniature diorama!

## 3. World Budget & Back-Side Completeness
- Target **<= 950 triangles** per environment landmark so dozens can batch cleanly across WebGPU, WebGL 2, and Canvas 2D.
- Never leave the back or side walls completely blank: add at least one side window, buttress, chimney stack, or barrel so the building rewards 360° camera rotation.
