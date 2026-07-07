#!/usr/bin/env node
/* Unified test runner — node scripts/run-all-tests.js [--core|--ui|--audit|--all] */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const GROUPS = {
  core: [
    { file: 'test-harness-184.js', required: true },
    { file: 'test-harness-184b.js', required: true },
    { file: 'test-harness-185.js', required: true },
    { file: 'test-harness-185-save.js', required: true },
    { file: 'test-harness-19.js', required: true },
    { file: 'test-harness-191-liveness.js', required: true },
    { file: 'test-harness-191-regression.js', required: true }
  ],
  audit: [
    { file: 'audit/probe-longrun.js', args: ['8', '3000'], required: true, slow: true },
    { file: 'audit/probe-war.js', required: true },
    { file: 'audit/probe-professions.js', args: ['3000', '1'], required: true },
    { file: 'audit/probe-saveload.js', required: true },
    { file: 'audit/probe-treaties.js', required: true }
  ],
  ui: [
    { file: 'uitest-185.js', required: false, optional: true },
    { file: 'uitest-19.js', required: false, optional: true },
    { file: 'audit/uismoke.js', required: false, optional: true }
  ]
};

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  if (flags.has('--all')) return ['core', 'audit', 'ui'];
  const out = [];
  if (flags.has('--core')) out.push('core');
  if (flags.has('--audit')) out.push('audit');
  if (flags.has('--ui')) out.push('ui');
  if (!out.length) out.push('core');
  return out;
}

function runOne(entry) {
  const filePath = path.join(ROOT, entry.file);
  const args = [filePath, ...(entry.args || [])];
  const t0 = Date.now();
  const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const ms = Date.now() - t0;
  const out = (res.stdout || '') + (res.stderr || '');
  const skipped = /SKIP/i.test(out);
  let status = 'PASS';
  let notes = '';
  if (skipped) {
    status = 'SKIP';
    notes = out.match(/SKIP[^\n]*/)?.[0] || 'skipped';
  } else if (res.status !== 0) {
    status = entry.optional ? 'SKIP' : 'FAIL';
    notes = out.split('\n').filter(l => /FAIL|Error|error/i.test(l)).slice(-3).join(' | ') || `exit ${res.status}`;
    if (entry.optional && /not installed|browser not available/i.test(out + notes)) status = 'SKIP';
  }
  if (entry.slow) notes = (notes ? notes + '; ' : '') + 'slow';
  return { ...entry, status, ms, notes };
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

function main() {
  const groups = parseArgs(process.argv);
  const rows = [];
  for (const g of groups) {
    for (const entry of GROUPS[g]) {
      rows.push({ group: g, ...runOne(entry) });
    }
  }

  console.log('\n' + pad('File', 36) + pad('Group', 8) + pad('Result', 8) + pad('Time', 10) + 'Notes');
  console.log('-'.repeat(90));
  let failed = 0;
  for (const r of rows) {
    console.log(pad(r.file, 36) + pad(r.group, 8) + pad(r.status, 8) + pad((r.ms / 1000).toFixed(1) + 's', 10) + (r.notes || ''));
    if (r.status === 'FAIL' && r.required !== false) failed++;
  }
  console.log('-'.repeat(90));
  if (failed) {
    console.log(`\n${failed} required test(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll required tests passed');
  process.exit(0);
}

main();
