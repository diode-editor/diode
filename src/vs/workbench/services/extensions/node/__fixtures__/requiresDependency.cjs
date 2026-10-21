"use strict";

/**
 * Fixture for extensionHost.dependencies.test.ts: an extension with
 * `extensionDependencies: ["test.dep"]` that reaches for the dependency's `exports`
 * right in `activate()` (as bazel-java reaches for `redhat.java`'s `exports.status`).
 * Throws if by then the dependency is not active or its `exports` is wrong,
 * so a green activation proves the ordering rather than a coincidence.
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
