"use strict";

/**
 * Фикстура: первая активация роняет субпроцесс расширений (`process.exit`),
 * следующие — проходят и отдают тот же `exports`, что `exportsMarker.cjs`.
 * Память «уже падал» — файл-маркер по пути из `DIODE_TEST_EXIT_MARKER`: она
 * обязана пережить смерть процесса.
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
