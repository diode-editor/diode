"use strict";

/** Dependency for extensionHost.dependencies.test.ts: exposes a recognizable `exports`. */
exports.activate = function activate() {
    return { marker: "dep-ready" };
};
exports.deactivate = function deactivate() {};
