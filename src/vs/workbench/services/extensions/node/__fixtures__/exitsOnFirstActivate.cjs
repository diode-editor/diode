"use strict";

/**
 * Fixture: the first activation kills the extension subprocess (`process.exit`),
 * later ones succeed and return the same `exports` as `exportsMarker.cjs`.
 * The "already crashed" memory is a marker file at the path from
 * `DIODE_TEST_EXIT_MARKER`: it must survive the process's death.
 */
const fs = require("node:fs");

exports.activate = function activate() {
    const marker = process.env.DIODE_TEST_EXIT_MARKER;
    if (marker === undefined) throw new Error("DIODE_TEST_EXIT_MARKER is not set");
    if (!fs.existsSync(marker)) {
        fs.writeFileSync(marker, "crashed once");
        process.exit(1);
    }
    return { marker: "dep-ready" };
};
exports.deactivate = function deactivate() {};
