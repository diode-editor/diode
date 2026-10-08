"use strict";

/** Фикстура: `activate()` бросает — расширение не поднимается. */
exports.activate = function activate() {
    throw new Error("activate failed on purpose");
};
exports.deactivate = function deactivate() {};
