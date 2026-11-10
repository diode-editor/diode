// `workspace.decode` / `workspace.encode`: what an extension gets through the real host, settings included.
const vscode = require("vscode");

/** A uri goes over the command bus as a path string. */
function toOptions(options) {
    if (options === undefined) return undefined;
    return options.path !== undefined ? { uri: vscode.Uri.file(options.path) } : options;
}

function activate(context) {
    const register = (id, run) => context.subscriptions.push(vscode.commands.registerCommand(id, run));

    register("test.encoding.decode", async (bytes, options) => {
        try {
            return { text: await vscode.workspace.decode(new Uint8Array(bytes), toOptions(options)) };
        } catch (error) {
            return { error: String(error.message) };
        }
    });

    register("test.encoding.encode", async (text, options) => {
        const encoded = await vscode.workspace.encode(text, toOptions(options));
        return { bytes: Array.from(encoded), isBuffer: Buffer.isBuffer(encoded), asString: encoded.toString() };
    });

    register("test.encoding.setting", (key, value) =>
        vscode.workspace.getConfiguration("files").update(key, value, vscode.ConfigurationTarget.Global),
    );
}

module.exports = { activate };
