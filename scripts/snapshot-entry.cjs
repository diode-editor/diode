"use strict";
// Entry of the core V8 snapshot build: runs `main.cjs` the way node itself would,
// but compiles **eagerly**, so the bytecode of every function goes into the blob and startup
// does not pay for lazy compilation (a third of the window before the first text frame, docs/arch/Common.md).
//
// `--no-lazy` applies only to compiling `main.cjs`: as a build flag it would also compile node
// builtins, doubling the blob (17.9 -> 29.1 MB). The path comes from an env variable, not a
// string literal: the entry source lives in the blob, and the build machine path stays out of it.
//
// No `createRequire`: after deserialization node fails the `initializeModuleLoaders` assert;
// the builder's `require` serves only builtins, and that is all `main.cjs` needs.
const fs = require("node:fs");
const v8 = require("node:v8");
const vm = require("node:vm");

const mainPath = process.env.DIODE_SNAPSHOT_MAIN;
if (mainPath === undefined || mainPath === "") {
    throw new Error("snapshot-entry: main.cjs path is not set (env DIODE_SNAPSHOT_MAIN)");
}
const source = fs.readFileSync(mainPath, "utf8");

v8.setFlagsFromString("--no-lazy");
let runMain;
try {
    runMain = new vm.Script(`(function (require, __filename, __dirname) {${source}\n})`, {
        filename: __filename,
    }).runInThisContext();
} finally {
    v8.setFlagsFromString("--lazy");
}
runMain(require, __filename, __dirname);
