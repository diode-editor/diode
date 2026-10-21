"use strict";

/** Fixture: `activate()` throws, so the extension never comes up. */
exports.activate = function activate() {
    throw new Error("activate failed on purpose");
};
exports.deactivate = function deactivate() {};
