"use strict";

/**
 * Fixture for ExtensionHost.Commands.test.ts: the subprocess → host direction
 * (fall-through). Command `test.hostApply` is not in the subprocess's local Map,
 * so executeCommand goes over RPC to the host and runs in CommandRegistry.
 * We return a thenable from activate; the host waits for it.
 */
exports.activate = function activate(_context) {
    const vscode = require("vscode");
    return vscode.commands.executeCommand("test.hostApply", 7);
};
