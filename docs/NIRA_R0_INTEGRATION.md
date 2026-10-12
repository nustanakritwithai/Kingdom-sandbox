# The Realm of Nira — R0 Integration Handoff

## Scope / status

- Canon source: exact user-selected image `world/nira/assets/nira_world_map.webp`, source 1536×1536 pixels, encoded as an optimized WebP derivative for GitHub Pages.
- 13 regions, 11 factions, 55 locations, 68 indicative route edges, 28 resources, 13 economy profiles.
- MVP population profile 30; expanded profile 132. These are **configuration targets, not spawned NPCs**.
- `nira.html` is an **independent read-only atlas**: show map, filter regions, inspect location markers, toggle route edges, and find a shortest path in the declared graph.
- Geographic points are *manually approximate*. Edges and waypoints are **SCHEMATIC / unverified**; cannot be used as collision/pathfinding ground truth.
- Legacy adapter is **preview-only**, returns data objects but does **not** mutate Kingdom-sandbox `world`.

## How to run

1. From the repository root serve via `python3 -m http.server 8000` (or any static web server).
2. Open `http://localhost:8000/nira.html`.
3. The full visual works when `world/nira/assets/nira_world_map.webp` is present. If the image is absent, click **เลือกภาพแผนที่** to select the user-owned map image on your device. The browser does not upload it.
4. Run `node --test tests/nira-map-contract.test.mjs` for schema and graph consistency. This does not test real walking clearance or rendering in all browsers.

## R0 assets and contracts

- `manifest.json`: coordinate frame; source image path and caveats
- `regions.json`: exact region IDs / approximate center points
- `factions.json`: faction identifiers, starting diplomacy
- `locations.json`: map pixel anchors and services; `anchor_status`
- `routes.json`: directional graph connectivity, movement modes, abstract weights, indicative waypoints
- `resources.json`: trade resource catalog; values are design defaults
- `region_economy.json`: economic specialization; no live supply/demand mutation
- `spawn_setup.json`: two population *plans*, not live agents
- `legacy_adapter.mjs`: read-only projection into Kingdom-sandbox 1000×640 coordinate frame
- `navigation.mjs`: tested weighted graph routing for the atlas

## Why not activate inside script.js yet?

Kingdom-sandbox `generateWorld()` seeds legacy factions, settlements, routes and agents directly. Settlement IDs are created by `uid()`, movement expects route endpoints to be those IDs, and renderer uses a 1000×640 world (`MAP_W/MAP_H`). Replacing the live world with Nira requires versioned import/migration and a renderer that can display the square map. Directly inserting objects into `world` or patching `MAP_W` would break old save files and/or route references.

Do **not** merge old experimental court branches into this work, change default world generation, or enable LLM/API calls during R0.

## Next integration phases (implementation not yet included)

1. **R1a** Introduce scenario selection (`legacy` vs `nira`) and a versioned importer converting *external IDs* to `uid()` IDs, safely remapping relationships and routes.
2. **R1b** Adapt rendering to a square image-space map; add coast/passage constraints, bridge and sea-ferry mechanics. Never treat a straight graphic edge as validated walkable terrain.
3. **R1c** Spawn 30 NPC from `spawn_setup` with known jobs, inventories and households, and verify 7 days of activity.
4. **R2** Add autonomous memory/decision system using AstraLife *design patterns*, not runtime code copied without integration audit.
5. **R3** Use an isolated Server-Manager-style persistent worker + DB for real offline simulation; never imply browser app already runs 24/7.

## PR acceptance checklist

- Existing `npm run test:core` and `npm run test:audit` stay green in CI (not tested solely by this R0 pack).
- `node --test tests/nira-map-contract.test.mjs` passes.
- Atlas renders same-source map and 55 POI anchors; browser smoke requires real Chrome and is **UNKNOWN** until executed.
- No changes to original `script.js`, `index.html`, or game default behavior.
- No credentials, private data, or external AI billing. Pages static publication is a separate operation.
