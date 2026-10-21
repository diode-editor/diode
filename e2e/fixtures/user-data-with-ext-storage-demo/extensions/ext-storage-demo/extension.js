"use strict";

/**
 * Storage directories and `setContext` — in a real extension they go together. Like AI autocompletion extensions,
 * `activate()` writes a file to `globalStorageUri` (where such extensions put a downloaded engine);
 * the launch counter in the status bar is read from it. The `alt+q` keybinding is under `when: "extStorageDemo.armed"`.
 */
const fs = require("node:fs");
const path = require("node:path");

exports.activate = function activate(context) {
    const vscode = require("vscode");

    const out = vscode.window.createOutputChannel("Ext Storage Demo");

    // We create the directory OURSELVES: the host only guarantees the parent. Extensions crashed on this line without the field.
    const globalDir = context.globalStorageUri.fsPath;
    fs.mkdirSync(globalDir, { recursive: true });
    const runsFile = path.join(globalDir, "runs.json");
    let runs = 0;
    try {
        runs = JSON.parse(fs.readFileSync(runsFile, "utf-8")).runs;
    } catch {
        runs = 0;
    }
    runs += 1;
    fs.writeFileSync(runsFile, JSON.stringify({ runs }), "utf-8");

    out.appendLine("globalStorageUri: " + globalDir);
    out.appendLine("storageUri: " + (context.storageUri === undefined ? "(нет: папка не открыта)" : context.storageUri.fsPath));
    out.appendLine("logUri: " + context.logUri.fsPath);
    out.appendLine("runs.json прочитан и перезаписан: runs=" + runs);

    // Two items, not one: an extension item's text is truncated at 24 glyphs
    // (MAX_ITEM_WIDTH in ExtensionStatusBarAdapter), and we need to show both the launch
    // counter from globalStorage and the state of the when-key.
    let fired = 0;
    let armed = false;
    const storageItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    storageItem.name = "Ext Storage Demo: storage";
    storageItem.text = "Storage run " + runs;
    storageItem.show();

    // The key state goes into the item text NOT for looks: the scenario needs
    // an observable "setContext has arrived" signal, otherwise the keypress
    // outruns the RPC and the demo becomes a race.
    const gateItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    gateItem.name = "Ext Storage Demo: gate";
    const render = () => {
        gateItem.text = (armed ? "armed" : "idle") + " · fired " + fired;
    };
    render();
    gateItem.show();
    context.subscriptions.push(storageItem, gateItem, out);

    const register = (id, handler) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };

    register("extStorageDemo.fire", () => {
        fired += 1;
        render();
    });
    const setArmed = async (value) => {
        await vscode.commands.executeCommand("setContext", "extStorageDemo.armed", value);
        armed = value;
        render();
    };
    register("extStorageDemo.arm", () => setArmed(true));
    register("extStorageDemo.disarm", () => setArmed(false));
    register("extStorageDemo.showPaths", () => {
        out.show();
    });
};
