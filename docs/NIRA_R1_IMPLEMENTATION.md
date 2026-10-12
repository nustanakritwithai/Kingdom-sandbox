# Nira R1 — Autonomous NPC World Design / Implementation Notes

## Scope

R1 creates 30 standalone deterministic NPCs atop the **same 1536×1536 image and route graph** used by R0. It does not alter the Kingdom-sandbox `script.js`, its save format, or existing world generation. The simulation operates only while the web page is open and visible.

### Data boundaries

- Input: static immutable JSON (`manifest`, `locations`, `routes`, `spawn_setup`, `resources`, `region_economy`).
- World truth: returned state object from `createLivingWorld(pack)`.
- Decisions: rule-based deterministic utility choices; no hidden information from other agents, no LLM.
- Mutations: `stepLivingWorld(world,pack,hours)` only; `nira.js` reads state and renders, never fabricates an action.
- Distance/path: Dijkstra on R0 graph; schematic image-path interpolation is not physical collision.
- Saved world: complete JSON Snapshot `nira-living-world-r1-v1`; restore validates map ID, count, identities, coordinates, stocks and event cap.

### Actions

**Eat:** consume 1 food; if absent buy from the market using NPC gold and market stock.  
**Work:** farm / chop / mine / fish / gather herbs → produce a limited item; crafting consumes wood + ore to produce tools; guard consumes the market treasury as salary.  
**Trade:** choose a reachable market and resource with price difference, buy cargo from origin, travel route legs, sell at destination if market has treasury.  
**Explore:** visit reachable neighboring nodes with bound path; return home on the evening schedule when possible.  
**Rest:** recover energy at night. Hunger and energy increment/decrement on each simulated hour.

### Time, controls and persistence

One simulation tick = one in-game hour. UI speeds `x1`,`x5`,`x20` advance that many simulated hours every ~850ms browser time. Pausing prevents advancement; hidden tabs skip ticks rather than attempting indefinite catch-up. Autosave on advancing into a new day, manual save, reload, export/import.

### Caveats and next phase

NPC statistics and market rules are **simulation mechanics**, not a verified macroeconomic model. There is no physical ship asset, mount collision, weather hazards, interpersonal cognition, or server-side autonomous clock yet. Sea graph edges are route metadata only, not a complete transport system.

### Acceptance commands

```sh
node --check nira.js
node --check world/nira/living-world.mjs
node --test tests/nira-map-contract.test.mjs
node tests/nira-living-world.test.mjs
```

Do not treat static Node tests as browser visual QA. Preserve R0 tests and do not merge if any required assertion fails.
