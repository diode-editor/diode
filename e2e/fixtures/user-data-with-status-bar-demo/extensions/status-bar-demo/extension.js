"use strict";

/** Command titles live in package.json: without `contributes.commands` a runtime registration is invisible in the command palette. */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const demo = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    demo.name = "Status Bar Demo";
    demo.text = "Demo";
    demo.command = "statusBarDemo.click";
    demo.show();

    let clicks = 0;
    /** The item made by the Create Hidden command (created but not shown). */
    let hidden = null;

    const register = (id, handler) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };

    register("statusBarDemo.click", () => {
        clicks += 1;
        demo.text = "Demo · clicked " + clicks;
    });
    register("statusBarDemo.setText", () => {
        demo.text = "Demo 42";
    });
    register("statusBarDemo.setTooltip", () => {
        demo.tooltip = "Подсказка демо-расширения";
    });
    // Hides the most recently created item: `Hidden Demo` if it exists, otherwise
    // `Demo` itself. This way the command always applies to the item in question.
    register("statusBarDemo.hide", () => {
        if (hidden !== null) hidden.hide();
        else demo.hide();
    });
    register("statusBarDemo.createHidden", () => {
        if (hidden !== null) hidden.dispose();
        hidden = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
        hidden.name = "Status Bar Demo Hidden";
        hidden.text = "Hidden Demo";
        // show() is deliberately NOT called: the item exists but is not in the bar.
    });
    register("statusBarDemo.showHidden", () => {
        if (hidden === null) return;
        hidden.show();
    });
    register("statusBarDemo.dispose", () => {
        demo.dispose();
    });
    register("statusBarDemo.createLeftPair", () => {
        const high = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        high.name = "Status Bar Demo L-high";
        high.text = "L-high";
        high.show();
        const low = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
        low.name = "Status Bar Demo L-low";
        low.text = "L-low";
        low.show();
        context.subscriptions.push(high, low);
    });
    register("statusBarDemo.createNoPriority", () => {
        const plain = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        plain.name = "Status Bar Demo L-none";
        plain.text = "L-none";
        plain.show();
        context.subscriptions.push(plain);
    });
    register("statusBarDemo.iconText", () => {
        demo.text = "$(check) Demo";
    });
    register("statusBarDemo.iconOnly", () => {
        demo.text = "$(sync~spin)";
    });
    register("statusBarDemo.longText", () => {
        demo.text = "Long ".repeat(40).trim();
    });
    register("statusBarDemo.killHost", () => {
        // Deferred exit: the command call's response must reach the editor first.
        setTimeout(() => process.exit(1), 10);
    });

    context.subscriptions.push(demo);
};
