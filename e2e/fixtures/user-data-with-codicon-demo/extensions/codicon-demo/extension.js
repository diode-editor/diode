"use strict";

/**
 * `$(name)` markup in ALL surfaces that extension text goes to: wherever upstream expands the icon,
 * there must be a glyph. The flip side: the channel CONTENT and the input box's initial `value`
 * contain `$(no-such-icon)` — these must not be substituted (a log isn't markup, the value is returned
 * to the extension by the user), while the substituter throws on an unknown name, so a mistake shows at once.
 */

exports.activate = function activate(context) {
    const vscode = require("vscode");

    // The channel name is a label: it ends up both in the command palette ("Output: Show …") and in
    // the channel selector. Channel lines, conversely, are text as is.
    const out = vscode.window.createOutputChannel("$(output) Codicon Demo");
    out.appendLine("channel name was written as: $(output) Codicon Demo");
    out.appendLine("log lines stay verbatim: $(no-such-icon) still here");

    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    item.name = "$(gear) Codicon Demo";
    item.text = "$(check) Ready";
    item.show();
    context.subscriptions.push(item, out);

    const register = (id, handler) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };

    // `OutputChannel.show()` is the real extension path: it opens the panel and switches the selector.
    register("codiconDemo.showLog", () => {
        out.show();
    });

    register("codiconDemo.pick", () =>
        vscode.window.showQuickPick(
            [
                { label: "$(file) first target", description: "$(git-branch) main" },
                { label: "$(file) second target", description: "$(git-branch) release" },
            ],
            { title: "$(beaker) Choose", placeHolder: "$(search) type to filter" },
        ),
    );

    // Two input boxes, not one: a validation message REPLACES the prompt line,
    // so prompt and validation can't be shown in one go.
    register("codiconDemo.ask", () =>
        vscode.window.showInputBox({
            title: "$(edit) Port",
            prompt: "$(info) which port should the server use",
            value: "$(no-such-icon) 8080",
        }),
    );

    register("codiconDemo.askValidated", () =>
        vscode.window.showInputBox({
            title: "$(edit) Port",
            placeHolder: "$(search) for example 8080",
            validateInput: (value) => (/^\d+$/u.test(value) ? null : "$(error) digits only"),
        }),
    );

    // Keep the progress open until a separate command: otherwise the label would flash
    // faster than the scenario can capture a frame.
    let finishIndexing;
    register("codiconDemo.index", () =>
        vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: "$(sync) Indexing" },
            async (progress) => {
                progress.report({ message: "$(rocket) phase one" });
                await new Promise((resolve) => {
                    finishIndexing = resolve;
                });
            },
        ),
    );
    register("codiconDemo.done", () => {
        finishIndexing?.();
    });
};
