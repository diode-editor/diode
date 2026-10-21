"use strict";

/**
 * Fixture for extensionHost.extensionIdentity.test.ts: extension "alpha" in its
 * own directory. Puts its `vscode` (and the one a module from its own `lib/`
 * received) into the shared probe registry; fixture "beta" compares them.
 */
const vscode = require("vscode");
const helper = require("./lib/helper.cjs");

const probes = (globalThis[Symbol.for("diode.test.identity")] ??= {});
probes.alpha = vscode;
probes.alphaHelper = helper.vscode;

exports.activate = function activate() {};
