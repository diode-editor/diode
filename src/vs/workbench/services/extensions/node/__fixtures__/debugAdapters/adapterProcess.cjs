"use strict";

/**
 * The process adapter of the debug adapter tests: DAP over stdin/stdout, its name the first argument. Its answer to
 * `initialize` tells where it runs (`cwd`, `DIODE_TEST_DAP` of its environment) and its name. With
 * `DIODE_TEST_DAP_STDERR` set it first writes that many KB to stderr: a parent that does not drain stderr blocks it.
 */
const { connectStream } = require("./dap.cjs");

const name = process.argv[2] ?? "process";
const capabilities = { cwd: process.cwd(), env: process.env.DIODE_TEST_DAP, name };
const start = () => connectStream(process.stdin, process.stdout, name, () => process.exit(3), capabilities);

const stderrKb = Number(process.env.DIODE_TEST_DAP_STDERR ?? 0);
if (stderrKb > 0) {
    process.stderr.write("x".repeat(stderrKb * 1024), start);
} else {
    start();
}
