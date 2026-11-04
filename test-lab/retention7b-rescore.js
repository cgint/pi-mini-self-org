#!/usr/bin/env node
// Step 7b — convenience: score retention7b session JSONLs.
// Usage: node test-lab/retention7b-rescore.js <sess.jsonl> [more...]
// Prints a one-line summary per file and writes <name>.score.json alongside.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, basename } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);
const files = process.argv.slice(2);
if (!files.length) { console.error("usage: retention7b-rescore.js <sess.jsonl> [more...]"); process.exit(2); }

const SCORE = join(here, "retention7b-check.ts");
function score(path) {
  const r = execFileSync("node", ["--experimental-strip-types", SCORE, path], { encoding: "utf8" });
  return JSON.parse(r.trim());
}

for (const f of files) {
  const d = score(f);
  const out = f.replace(/\.jsonl$/, ".score.json");
  writeFileSync(out, JSON.stringify(d, null, 2));
  const msFillers = d.fillers.filter((x) => x.hasMsUnit).length;
  const post = d.fillers.slice(8);
  const msPost = post.filter((x) => x.hasMsUnit).length;
  console.log(`${basename(f)}: probes=${d.probeCount} fillers=${d.fillerCount} mathCorrect=${d.fillerMathCorrect}/${d.fillerCount} fillersWithMs=${msFillers} msAfterChange=${msPost}/${post.length} sheets=${d.sheetCount} drift=${JSON.stringify(d.driftScore)}`);
}
