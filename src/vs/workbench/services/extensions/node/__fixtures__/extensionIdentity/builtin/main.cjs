"use strict";

/**
 * Fixture for extensionHost.extensionIdentity.test.ts: a builtin. The test passes
 * it as source (`source`) under a synthetic `filename` that does not exist on disk,
 * which is how built-in extensions load under SEA (`Module._compile`).
 */
const vscode = require("vscode");

const probes = (globalThis[Symbol.for("diode.test.identity")] ??= {});
probes.builtin = vscode;

exports.activate = function activate() {};
