// Two overrides of `type` in one extension host. Upstream refuses the second registration with an error, so the
// fixture tolerates a throw: either way the first override has to survive the second one going away.
const vscode = require("vscode");

function activate(context) {
    const register = (id, run) => context.subscriptions.push(vscode.commands.registerCommand(id, run));
    const received = [];
    const overrides = new Map();

    register("test.twoOverrides.register", (name) => {
        try {
            overrides.set(
                name,
                vscode.commands.registerCommand("type", (args) => {
                    received.push(`${name}:${args.text}`);
                }),
            );
        } catch {
            // The upstream outcome for a second registration: this override simply does not exist.
        }
    });
    register("test.twoOverrides.dispose", (name) => {
        overrides.get(name)?.dispose();
    });
    register("test.twoOverrides.exec", (text) => vscode.commands.executeCommand("type", { text }));
    register("test.twoOverrides.received", () => received);
}

module.exports = { activate };
