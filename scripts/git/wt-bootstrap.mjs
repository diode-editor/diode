#!/usr/bin/env node
// npm run git:wt-bootstrap [-- --force] — node_modules worktree соответствует package-lock.json.
//
// Свежий worktree приходит без node_modules, а старый — с протухшими после
// rebase на main (lock уехал вперёд, в node_modules старые версии; так уже
// ломались typecheck и движок). Сверяем sha256 lock-файла с отметкой,
// оставленной прошлым запуском, и при расхождении ставим заново `npm ci`.
//
// Если стоит подмена движка (npm run engine:link, .engine-link/STAMP), npm ci
// её снесёт — без --force отказываемся.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { die, loud } from "./lib.mjs";

const HASH_FILE = "node_modules/.lock-hash";
const force = process.argv.includes("--force");

if (!existsSync("package-lock.json")) die("Нет package-lock.json — запускать из корня worktree.");
const want = createHash("sha256").update(readFileSync("package-lock.json")).digest("hex");
const have = existsSync(HASH_FILE) ? readFileSync(HASH_FILE, "utf8").trim() : undefined;

if (have === want && !force) {
    console.log("node_modules свежие (lock не менялся с прошлого npm ci).");
    if (existsSync(".engine-link/STAMP")) console.log("⚠ Но движок в них подменён (npm run engine:status).");
    process.exit(0);
}

if (existsSync(".engine-link/STAMP")) {
    const stamp = JSON.parse(readFileSync(".engine-link/STAMP", "utf8"));
    const msg = `В node_modules подменён движок: tuidom ${stamp.version} из ${stamp.tuidom} (npm run engine:link).`;
    if (!force) {
        die(`${msg}
npm ci его снесёт. Сними подмену (npm run engine:unlink) или повтори с --force.`);
    }
    console.log(`⚠ ${msg} npm ci её снимет.`);
}

console.log(
    !existsSync("node_modules")
        ? "node_modules нет — ставлю."
        : have === undefined
          ? "Отметки свежести нет — ставлю заново, чтобы знать, что стоит."
          : "package-lock.json поменялся — node_modules протухли, ставлю заново.",
);
const code = loud("npm", ["ci", "--no-audit", "--no-fund"]);
if (code !== 0) process.exit(code);
writeFileSync(HASH_FILE, `${want}\n`);
console.log("Готово: node_modules соответствуют package-lock.json.");
