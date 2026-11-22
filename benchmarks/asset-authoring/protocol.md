# Blind art review protocol

Each GPT-5.6 variant receives the same 20 briefs, Ridgetop source references and medium reasoning setting. Each authors one batch. Authors may validate the JSON before submitting. The first batch receives no rendered feedback or human edits. The judge knows the brief and has no access to the model key while scoring. Shuffle the three authors independently by brief, balancing how often each appears in each column. Preserve the first renders for comparison.

## Technical checks

Use Ridgetop's version-1 model loader, the starter palette, standard lighting, 30-degree camera elevation and eight sprite directions. Each recipe must match its brief ID, inherit the palette, request 32-pixel frames, use at most 32 named parts and draw something in every direction. Each 32-pixel frame must leave at least one clear pixel at every edge. Allow a ground offset up to 5% of the submitted camera span. Count actual triangles from the framework meshes.

## Visual scores

Judge the eight actual-size sprites alongside larger views of the same 3D asset. Inspect from front, three-quarter, side and rear as needed. Score each dimension from 0 to 2 and write down an observation for each submission before revealing its author.

| Dimension | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Recognition at 32 px | Object is unreadable | Needs the caption or an enlarged view | Silhouette and major forms identify it at game size |
| Fidelity to the brief | Most identifying features are absent | A requested feature is missing, obscured or substantially ambiguous | All requested features are legible in at least one useful view |
| Construction in 3D | Major broken or disconnected forms | Minor awkward joins or proportions that are tolerable in play | Convincing volumes and joins from multiple angles |

Count a first pass as accepted when it passes all technical checks, earns 2 in recognition, 2 in fidelity and at least 1 in construction. A technically valid file may still need art direction. One AI reviewer makes these judgments. The prompts form a small, paired convenience sample, with one generation per model per brief.

## Revision check

After the first submission, give all authors the same two change requests and their own original rendered views. Save revised recipes separately. For the trail pack, double the local X width of the two main straps, change their tone to glow, and leave their centers, the bedroll, the bag body, and camera untouched. For the survey crab, widen its primary bright sensor lens by 50% on local X and set its tone to light, keeping its center, depth, height, mount and the rest of the robot unchanged. Keep all part names. When a visible strap is built from multiple segments, the matching segments may change together. Check both the file diff and the visual change. Report this edit exercise separately from first-pass acceptance.

Record observed results and any missing usage telemetry. Token prices and cost per accepted asset require actual billed usage.
