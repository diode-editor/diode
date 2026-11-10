// Runs a snippet against `vscode` inside the real extension host: decode/encode edge cases.
const vscode = require("vscode");

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("test.encodingProbe.run", async (source) => {
            try {
                return { value: await new AsyncFunction("vscode", source)(vscode) };
            } catch (error) {
                return { error: String(error && error.message) };
            }
        }),
    );
}

module.exports = { activate };
