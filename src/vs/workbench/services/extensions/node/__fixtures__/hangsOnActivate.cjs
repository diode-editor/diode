"use strict";

/**
 * Фикстура: `activate()` не завершается никогда. Перед этим пишет файл-маркер
 * по пути из `DIODE_TEST_HANG_MARKER` — тест по нему знает, что активация
 * уже идёт, и не гадает таймером.
 */
const fs = require("node:fs");

exports.activate = function activate() {
    const marker = process.env.DIODE_TEST_HANG_MARKER;
    if (marker === undefined) throw new Error("DIODE_TEST_HANG_MARKER is not set");
    fs.writeFileSync(marker, "activating");
    return new Promise(() => undefined);
};
exports.deactivate = function deactivate() {};
