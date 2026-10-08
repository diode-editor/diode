"use strict";

/**
 * Фикстура для extensionHost.dependencies.test.ts: расширение с
 * `extensionDependencies: ["test.dep"]`, которое в `activate()` сразу тянется к
 * `exports` зависимости (как bazel-java к `redhat.java` за `exports.status`).
 * Бросает, если зависимость к этому моменту не активна или её `exports` не тот,
 * — то есть зелёная активация доказывает порядок, а не совпадение.
 */
exports.activate = function activate() {
    const vscode = require("vscode");
    const dep = vscode.extensions.getExtension("test.dep");
    if (dep === undefined) throw new Error("dependency test.dep is not in the catalog");
    if (!dep.isActive) throw new Error("dependency test.dep is not active yet");
    if (dep.exports === undefined || dep.exports.marker !== "dep-ready") {
        throw new Error("dependency test.dep has no exports yet");
    }
};
exports.deactivate = function deactivate() {};
