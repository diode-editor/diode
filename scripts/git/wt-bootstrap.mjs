#!/usr/bin/env node
// npm run git:wt-bootstrap [-- --force]: make the worktree's node_modules match package-lock.json.
//
// An old worktree rebased onto main carries stale node_modules (this has already
// broken typecheck and the engine): the lock file's sha256 is compared with the stamp
// of the previous run, and on a mismatch it runs `npm ci`.
//
// If the engine is swapped in (npm run engine:link, .engine-link/STAMP), npm ci
// would wipe it, so without --force it refuses.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { die, loud } from "./lib.mjs";

const HASH_FILE = "node_modules/.lock-hash";
const force = process.argv.includes("--force");

if (!existsSync("package-lock.json")) die("No package-lock.json: run from the worktree root.");
const want = createHash("sha256").update(readFileSync("package-lock.json")).digest("hex");
const have = existsSync(HASH_FILE) ? readFileSync(HASH_FILE, "utf8").trim() : undefined;

if (have === want && !force) {
    console.log("node_modules is fresh (the lock has not changed since the last npm ci).");
    if (existsSync(".engine-link/STAMP")) console.log("⚠ But the engine in it is swapped (npm run engine:status).");
    process.exit(0);
}

if (existsSync(".engine-link/STAMP")) {
    const stamp = JSON.parse(readFileSync(".engine-link/STAMP", "utf8"));
    const msg = `The engine in node_modules is swapped: tuidom ${stamp.version} from ${stamp.tuidom} (npm run engine:link).`;
    if (!force) {
        die(`${msg}
npm ci would wipe it. Remove the swap (npm run engine:unlink) or retry with --force.`);
    }
    console.log(`⚠ ${msg} npm ci will remove it.`);
}

console.log(
    !existsSync("node_modules")
        ? "No node_modules: installing."
        : have === undefined
          ? "No freshness stamp: reinstalling to know what is installed."
          : "package-lock.json changed, node_modules is stale: reinstalling.",
);
const code = loud("npm", ["ci", "--no-audit", "--no-fund"]);
if (code !== 0) process.exit(code);
writeFileSync(HASH_FILE, `${want}\n`);
console.log("Done: node_modules matches package-lock.json.");
