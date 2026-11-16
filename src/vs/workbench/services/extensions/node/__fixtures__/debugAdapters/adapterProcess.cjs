"use strict";

/**
 * The process adapter of the debug adapter tests: DAP over stdin/stdout, its name the first argument. Its answer to
 * `initialize` tells where it runs (`cwd`, `DIODE_TEST_DAP` of its environment).
 */
const { connectStream } = require("./dap.cjs");

connectStream(process.stdin, process.stdout, process.argv[2] ?? "process", () => process.exit(3), {
    cwd: process.cwd(),
    env: process.env.DIODE_TEST_DAP,
});
