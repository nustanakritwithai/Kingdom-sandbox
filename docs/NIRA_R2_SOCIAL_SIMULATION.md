# The Realm of Nira — R2 Living Society

**Canonical code:** `Kingdom-sandbox/main` after gated merge. `AstraLife/nira` is a read-only Pages presentation mirror.

## Delivery and boundaries

- 30 autonomous NPCs (or optional 132 demo NPCs) keep their R1 occupations, route graph travel, energy, hunger, market inventory, simulated clock and local saves.
- Rule/Utility AI, **not** LLM. Simulation advances only when the browser tab is open/visible; not a 24/7 server.
- NPC encounters happen only when both characters are in the same known location and neither is in transit. Maximum three pairs per location at 10:00 and 17:00 (simulation time).
- Relationship state is directional with `trust` 0..100 and contact/help counters. Personality (`sociability`, `risk`) affects cooperation, speech and occasional disagreement.
- First-hand market observations (`status: observed`, confidence=1) are made locally. A second-hand report (`status: reported`) records `sourceAgentId`, `originAgentId`, `relayDepth`, and reduced confidence. A reported belief cannot alter the authoritative market state.
- Assistance consumes one existing food item from the giver and adds it to the recipient; no inventory can be duplicated. No unbounded memory: 20 social memories, 16 beliefs per agent, 120 recent global social events.
- Replay remains deterministic by seed and full R2 snapshot state, including social records. R1 snapshots are recognized and upgraded to R2 without changing prior economic state or inventory.
- UI shows acquaintances/trust, individual NPC market knowledge with provenance, aggregate counters and recent social events. Strings are rendered via `textContent` only.

## Storage and migration

New R2 save key: `nira-r2-world-save-v1`.
On initial visit: load R2 if present, otherwise load `nira-r1-world-save-v1`, call `restoreLivingWorld`, and write the migrated R2 save. Leave the old R1 key intact.
Only `nira-living-world-r1-v1` and `nira-living-world-r2-v1` are allowed snapshot formats. R2 social data is validated before restore and invalid trust/knowledge refs are rejected.

## Tests

```sh
node --check nira.js
node --check world/nira/living-world.mjs
node --check world/nira/social-world.mjs
node --test tests/nira-map-contract.test.mjs
node tests/nira-living-world.test.mjs
node tests/nira-social-world.test.mjs
```

Social test coverage: co-location, no cross-city leakage, resource-backed help, gossip provenance, caps over 120 simulated days, R1 migration, replay determinism, invalid snapshot rejection and optional 132 NPC profile.

## Still unknown / out of scope

- Live phone/browser UI and device performance unless browser tests actually complete; screenshot smoke != production guarantee.
- Pixel-level collision and physical boat simulation. Routes remain schematic edges.
- Full economy, governance, war and free-form LLM cognition.
- 24/7 server persistence; needs separate server/worker milestone and explicit deployment approval.
