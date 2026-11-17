// Validate a generated /output against the gate's board rules, independently
// of lib/model.ts's own boardIssue: re-derives the watchlist coverage, rank
// order, farm-step lengths and dossier shape from the raw files.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, snapFile] = process.argv.slice(2);
const snap = JSON.parse(readFileSync(snapFile, 'utf8'));
const board = JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8')).rows;
const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };

ok(Array.isArray(board), 'rows is an array');
ok(board.length >= 100 && board.length <= 4000, `row count ${board.length} in 100..4000`);
const slugs = board.map((r) => r.slug);
ok(new Set(slugs).size === slugs.length, 'slugs unique');
const known = new Set(snap.protocols.map((p) => p.slug));
ok(slugs.every((s) => known.has(s)), 'every slug is a snapshot protocol');
const missing = snap.watchlist.filter((s) => !slugs.includes(s));
ok(missing.length === 0, `watchlist fully covered (missing: ${missing.slice(0, 3)})`);
const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
ok(ranks.every((r, i) => r === i + 1), 'ranks are exactly 1..N');
ok(board.every((r, i) => i === 0 || board[i - 1].implied_value_usd >= r.implied_value_usd), 'implied non-increasing with rank');
ok(board[0].implied_value_usd !== board[board.length - 1].implied_value_usd, 'not all implied values equal');
for (const r of board) {
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) fail.push(`${r.slug}: bad implied ${r.implied_value_usd}`);
  if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) fail.push(`${r.slug}: ${r.farm_steps?.length} farm steps`);
  else for (const s of r.farm_steps) { const t = s.trim(); if (t.length < 20 || t.length > 600) fail.push(`${r.slug}: step of ${t.length} chars`); }
  if (!r.name) fail.push(`${r.slug}: empty name`);
}
// No wrapped/staked/bridged product of a traded token may pose as a launch.
const badNames = board.filter((r) => /\b(wrapped|staked|staking)\b/i.test(r.name) || /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/.test(r.name) || ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'].includes(r.category ?? ''));
ok(badNames.length === 0, `no product rows (found: ${badNames.map((r) => r.name).slice(0, 3)})`);

const dossier = JSON.parse(readFileSync(join(outDir, 'dossier.json'), 'utf8'));
ok(dossier.schema === 'makefun/dossier/v1', 'dossier schema');
ok(dossier.images.length === 3, `dossier has ${dossier.images.length} images`);
const textBytes = Buffer.byteLength(dossier.text, 'utf8');
ok(textBytes <= 65536, `dossier text ${textBytes} bytes <= 65536`);
ok(!/not shown|left out/i.test(dossier.text), 'dossier text shows every dashboard file whole (no cut line)');
const dossierBytes = statSync(join(outDir, 'dossier.json')).size;
ok(dossierBytes <= 1.5 * 1024 * 1024, `dossier ${dossierBytes} bytes <= 1.5 MiB`);

if (fail.length) { console.error('FAIL:\n' + fail.slice(0, 20).join('\n')); process.exit(1); }
console.log(`VALID: ${board.length} rows, watchlist ${snap.watchlist.length}/${snap.watchlist.length} covered, dossier text ${textBytes} B, dossier ${dossierBytes} B`);
