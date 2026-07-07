# Phase 19.1 — Liveness Unlock / Break Dark Age Loop

## Executive summary

Phase 19.1 breaks the **dark-age feedback loop** from the v18.5 audit: empty capitals blocking recruitment, route-danger spirals killing caravans, and dead rulers paralyzing factions. All fixes use **real agents** — no spawn soldiers, no teleport recruits, no clone agents.

**Canonical implementation:** `claude/living-kingdom-game-bge9rk` (consolidated to PR branch `cursor/phase191-liveness-unlock-246b`).

**Recommendation: merge** after review. Remaining polish belongs in Phase 19.2/19.3.

---

## Before metrics (baseline audit)

From `audit/baseline/longrun.jsonl` (8 seeds × 3000 days, v18.5):

- **armiesRaised:** 0 total (0/8 seeds)
- **Wars with battles:** 0
- **Faction ruler invalid:** integrity warnings every seed (8/8); factions skipped in `updateFactions`
- **Caravan trip loss:** ~99.7%
- **Route danger:** ~0.3 average, no recovery loop
- **Performance:** ~4.8 ms/day
- **Crashes / NaN:** 0

---

## After metrics

From `audit/after/longrun.jsonl` + `test-harness-191-liveness.js` (8 seeds × 3000 days):

- **armiesRaised:** 7 total; **6/8 seeds** form armies
- **Wars with battles:** **every seed** has `audit.battles` > 0; war records show battles on all seeds
- **Dangling ruler refs:** **8/8 → 0**
- **Caravan trip loss:** **74–81%** on test seeds (recoverable danger, not 0%)
- **Route danger:** ~0.3 → **~0.02** with patrol/decay loop
- **Performance:** **~2–10 ms/day**
- **Crashes / NaN:** 0
- **Save/load:** schema 19.1 continuity OK

---

## F1 — Faction-wide recruitment / armies

**Problem:** `royal_conscription` only evaluated `agentsAt(capital)`; empty capital → 0 applicants → 0 armies → 0 battles.

**Fix:**
- `recruitmentOffer.reach`: `local | nearby | faction | realm | route_network`
- `OrganizationSystem.getRecruitmentCandidates(offer)` — cross-settlement pool, capped, eval every 5 days
- Join-score modifiers: duty, home defense, anti-bandit, food security, ruler legitimacy
- `rulerCallToArms()` + `world.militaryNeeds` levy relay via governor sub-offers
- `raiseCallToArms()` uses `reach: 'faction'`; failed offers escalate pay/reach

**Result:** armies on 6/8 seeds; muster succeeds; wars produce battles.

---

## F2 — Route danger / caravans / travel

**Problem:** Raid success stacked route danger → 99%+ caravan loss → starvation spiral.

**Fix:**
- Route fields: `dangerDecay`, `securityPressure`, `recentRaidGain`, `patrolPresence`
- `RouteSecuritySystem` daily decay + capped raid gains + anti-bandit offer posting
- `spawnTownCaravan()` — danger assessment, guard job posting, safer-route pick, travel food provisioning
- `calculateRequiredTravelFood()` + migration food checks
- Caravan cargo used as travel rations

**Result:** Caravan loss 99.7% → **74–81%**; danger recovers to ~0.02 with patrol; not driven to 0% (preserves risk).

---

## F3 — Leadership recovery

**Problem:** Dead `faction.rulerId` permanently paralyzed factions.

**Fix:**
- `FactionLeadershipSystem`: `clearDanglingRulerRefs`, `retryLeadershipElection`, `ensureFactionHasActingLeader`, `repairInvalidGovernors`, `chooseEmergencyRulerCandidate`
- Ticks every 10–30 days + post-integrity repair
- `GovernanceSystem.updateFactions()` no longer skips dead-ruler factions
- Metrics: `rulersRecovered`, `interregnumDays`, `invalidRulerRepairs`

**Result:** 0 dangling refs after 2000 days; faction recovers leader within 30 days in harness.

---

## Labor market + liveness metrics

- `LaborMarketSystem` posts `labor_offer_*` when settlements lack specialists
- `ensureProfessionDiversity()` prevents miner/crafter/woodcutter extinction
- `world.balanceMetrics.liveness` tracks musters, armies, caravans, rulers recovered
- World Health UI surfaces liveness counters
- `SAVE_SCHEMA_VERSION = '19.1'`

---

## Verification commands

```bash
node test-harness-191-liveness.js
node test-harness-184.js
node test-harness-184b.js
node audit/probe-longrun.js 8 3000
node audit/probe-war.js
node audit/probe-professions.js 3000 1
node audit/probe-saveload.js
```
