# Phase 19.1 — Before / After Audit Snapshot

Baseline from `audit/baseline/longrun.jsonl` (v18.5 world, pre-liveness unlock).  
After from `audit/after/longrun.jsonl` (canonical Phase 19.1 on `claude/living-kingdom-game-bge9rk`, consolidated to `cursor/phase191-liveness-unlock-246b`).

## Long-run probe (`node audit/probe-longrun.js 8 3000`)

| Metric | Before (8 seeds) | After (8 seeds) | Δ |
|--------|------------------|-----------------|----|
| Seeds with `armiesRaised` > 0 | **0/8** | **6/8** | +6 |
| Seeds with battles (`audit.battles` > 0) | 8* | **8/8** | wars now produce real battles |
| Wars with ≥1 battle (war records) | **0** | **8/8** | +8 |
| Dangling ruler/governor refs (integrity) | **8/8 seeds** | **0** | fixed |
| Caravan trip loss (`liveness` metric) | **~99.7%** | **74–81%** | recoverable, not 0% |
| Route danger (patrol recovery test) | ~0.3 stuck high | **~0.02** | decay + patrol loop |
| Total `armiesRaised` (audit hook) | 0 | 7 | +7 |
| `battles` (audit hook) | 22 | 35 | +13 |
| Crashes / NaN | 0 | 0 | stable |
| ms/day (last block) | ~4.8 | **1.2–5.8** | ~2–10 ms/day |

\*Pre-19.1: `audit.battles` could increment from isolated skirmishes, but **zero armies formed** and **zero wars with recorded battles** — the military loop never closed.

## Caravan robbery (liveness metric, not town-dispatch count)

`test-harness-191-liveness.js` seeds 1/3/6 × 3000d:

| Seed | Trip loss rate |
|------|----------------|
| 1 | 79% |
| 3 | 74% |
| 6 | 81% |

Danger is **recoverable** (route 0.9 → 0.02 with patrol) without driving loss to 0%.

## Per-seed after snapshot (summary)

| Seed | armiesRaised | audit.battles | wars w/ battle | integrity issues |
|------|-------------|---------------|----------------|------------------|
| 1 | 1 | 3 | ✓ | 0 |
| 2 | 2 | 6 | ✓ | 0 |
| 3 | 1 | 2 | ✓ | 0 |
| 4 | 0 | 6 | ✓ | 0 |
| 5 | 1 | 4 | ✓ | 0 |
| 6 | 1 | 5 | ✓ | 0 |
| 7 | 0 | 7 | ✓ | 0 |
| 8 | 1 | 2 | ✓ | 0 |

## Other probes (after)

| Probe | Result |
|-------|--------|
| `probe-war.js` | Army raised day 1066; battles occur |
| `probe-professions.js 3000 1` | Specialists survive on some seeds; no crash |
| `probe-saveload.js` | Schema 19.1 round-trip OK; 0 NaN after load |

## Tests

| Test | Result |
|------|--------|
| `test-harness-191-liveness.js` | PASS |
| `test-harness-184.js` | PASS |
| `test-harness-184b.js` | PASS |
