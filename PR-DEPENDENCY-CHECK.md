# PR Dependency Check — Phase 19.1 / 19.2 / 19.3 Prep

**Date:** 2026-07-07  
**Repo:** nustanakritwithai/Kingdom-sandbox

---

## Executive summary

| Question | Answer |
|----------|--------|
| PR #19 merged? | **yes** → `main` @ `3ae6fc7` |
| PR #21 rebased? | **yes** → cherry-picked `34765fa` onto `main` |
| PR #21 diff clean? | **yes** — 20 files, zero `script.js`/`index.html`/`style.css` |
| PR #21 tests | **PASS** (core/audit/ui; test-19 SKIP = CourtSystem pending) |
| PR #20 rebased? | **yes** → `3e5b306` on `main` (force-pushed to `claude/phase193-data-hygiene-audit`) |
| PR #20 audit-only clean? | **yes** — 12 audit files only vs `main` |
| Ready for Phase 19.3 implementation? | **no** — wait for PR #21 + #20 merge |

---

## Source of truth

| Phase | Canonical branch | PR |
|-------|------------------|-----|
| 19.1 Liveness | `cursor/phase191-liveness-unlock-246b` (merged) | #19 ✓ MERGED |
| 19.2 Test infra | `cursor/phase192-test-infra-246b` | #21 OPEN |
| 19.3 Prep audit | `claude/phase193-data-hygiene-audit` | #20 OPEN |

Gameplay canonical: **`main` after PR #19** (`3ae6fc7`).

---

## PR #19 — Phase 19.1: Liveness Unlock

| Field | Value |
|-------|-------|
| State | **MERGED** 2026-07-07 |
| Base | `main` |
| Head | `cursor/phase191-liveness-unlock-246b` |
| Merge commit | `3ae6fc7` |

**Contents:** F1/F2/F3 liveness unlock, schema 19.1, audit probes, `test-harness-191-liveness.js`.

**Must merge first:** ✓ Done — blocks everything else.

---

## PR #21 — Phase 19.2: Test Infrastructure Repair

| Field | Before cleanup | After cleanup |
|-------|----------------|---------------|
| State | OPEN (draft) | OPEN (**ready**) |
| Base | `main` (stacked 19.1+19.2 diff) | `main` (post-#19) |
| Head | `cursor/phase192-test-infra-246b` | `34765fa` |
| Diff vs `main` | 32 files incl. `script.js` | **20 files, test-only** |

### Rebase method

Squash-merge of #19 made linear rebase noisy. Used:

```bash
git reset --hard origin/main
git cherry-pick 006cf29   # single 19.2 commit
git push --force-with-lease
```

### Diff cleanliness (vs `main`)

**Allowed files only:**

- `test-utils/`, `scripts/run-all-tests.js`, `package.json`
- `TESTING.md`, `QUALITY-AUDIT-19.2-TEST-INFRA.md`
- `test-harness*.js`, `uitest*.js`
- `audit/lib.js`, `audit/uismoke.js` (+ screenshot)

**No gameplay files:** `script.js`, `index.html`, `style.css` — **absent from diff** ✓

### Tests run (post-rebase)

```bash
npm run test:core   # PASS (~4.5 min)
npm run test:audit  # PASS (~2 min)
npm run test:ui     # PASS (uitest-185, uismoke) + SKIP (uitest-19, CourtSystem)
```

Regression gate (`test-harness-191-regression.js`): **PASS**

- 0 crash / 0 NaN
- no clone / no spawned soldiers
- dangling refs = 0
- armies/musters/battles on some seeds
- caravan not ~99%, not 0% all seeds
- route danger recovery
- save/load schema 19.1

### Merge order

- **After:** PR #19 ✓
- **Before:** PR #20 rebase-to-main (clean), Phase 19.3 implementation
- **Do not merge** if diff regains gameplay files

---

## PR #20 — Phase 19.3 Prep: Data Hygiene Audit

| Field | Before cleanup | After cleanup |
|-------|----------------|---------------|
| State | OPEN (draft) | OPEN (head rebased) |
| Base | `cursor/phase191-liveness-unlock-246b` | **should be `main`** (manual GH edit may be needed) |
| Head | `claude/phase193-data-hygiene-audit` | `3e5b306` |

### Rebase method

```bash
git reset --hard origin/main
git cherry-pick 36caf71
git push origin cursor/phase193-data-hygiene-prep-246b:claude/phase193-data-hygiene-audit --force-with-lease
```

### Diff cleanliness (vs `main`)

12 files — audit only:

- `audit/probe-data-growth.js`, `probe-treaty-duplicates.js`, `probe-muster-growth.js`, `probe-save-attribution.js`
- `audit/data-growth/*.jsonl`
- `QUALITY-AUDIT-19.3-DATA-HYGIENE-PREP.md`

**Forbidden files absent:** `script.js`, test infra, gameplay ✓

### Probes run (post-rebase)

```bash
node audit/probe-save-attribution.js 6 25000    # PASS
node audit/probe-treaty-duplicates.js 3000 42   # PASS
node audit/probe-muster-growth.js 5000 7        # PASS
```

### Merge order

- **After:** PR #19 ✓, preferably PR #21
- **Before:** Phase 19.3 implementation
- **Action needed:** Change PR #20 base branch to `main` in GitHub UI if still showing `phase191`

---

## Recommended merge order

```
1. PR #19  Phase 19.1 Liveness     ✓ MERGED
2. PR #21  Phase 19.2 Test Infra   → merge next
3. PR #20  Phase 19.3 Prep Audit   → merge after #21
4. Phase 19.3 Implementation     → branch after all three merged
```

---

## Phase 19.3 implementation — prep notes (NOT started)

**Branch to create (after #19+#21+#20 merge):**

```
cursor/phase193-data-hygiene-implementation-246b
```

**Base:** `main` latest

**Scope (from audit prep):**

- `DataHygieneSystem.tick()` — archive-before-prune
- Treaty dedupe at source (`setTreaty`)
- Cleanup: `tradeContracts`, `recruitmentOffers`, `musterPoints`, stale `treaties`
- Idempotent `migrate()` prune pass
- Save growth reduction (~50 KB/1000d → bounded)
- **Must not regress 19.1 liveness** — run `npm run test:core` + `test:audit`

**Do not create implementation branch until PR #21 and #20 are merged.**

---

## Final answers

| # | Question | Answer |
|---|----------|--------|
| 1 | PR #19 merged? | **yes** |
| 2 | PR #21 rebased? | **yes** |
| 3 | PR #21 diff clean? | **yes** |
| 4 | PR #21 tests | core PASS, audit PASS, ui PASS/SKIP |
| 5 | PR #20 rebased? | **yes** (vs `main`, 1 commit) |
| 6 | PR #20 audit-only clean? | **yes** |
| 7 | Ready Phase 19.3 implementation? | **no** — merge #21 + #20 first |
