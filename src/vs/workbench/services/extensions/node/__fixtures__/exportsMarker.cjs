"use strict";

/** Зависимость для extensionHost.dependencies.test.ts: отдаёт узнаваемый `exports`. */
exports.activate = function activate() {
    return { marker: "dep-ready" };
};
exports.deactivate = function deactivate() {};
