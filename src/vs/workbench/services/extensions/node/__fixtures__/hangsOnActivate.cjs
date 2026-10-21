"use strict";

/**
 * Fixture: `activate()` never completes. Before that it writes a marker file
 * at the path from `DIODE_TEST_HANG_MARKER`, so the test knows activation is
 * already in progress instead of guessing with a timer.
 */
const fs = require("node:fs");

exports.activate = function activate() {
    const marker = process.env.DIODE_TEST_HANG_MARKER;
    if (marker === undefined) throw new Error("DIODE_TEST_HANG_MARKER is not set");
    fs.writeFileSync(marker, "activating");
    return new Promise(() => undefined);
};
exports.deactivate = function deactivate() {};
