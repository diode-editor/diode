"use strict";

/** The process adapter of extensionHost.debugAdapters.test.ts: DAP over stdin/stdout, its name the first argument. */
const { connectStream } = require("./dap.cjs");

connectStream(process.stdin, process.stdout, process.argv[2] ?? "process", () => process.exit(3));
