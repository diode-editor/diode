"use strict";

/**
 * `workspace.registerTextDocumentContentProvider` fixture: a slice of what
 * the stock extension `redhat.java` does for the `jdt:` scheme: serves source that is not
 * on disk (a class from a jar, JDK source, decompilation).
 *
 * Behavior depends on the resource "path", so a single fixture covers all three
 * provider outcomes:
 *   - `/Missing.java`  → `undefined` (the provider declined to serve the resource);
 *   - `/Broken.java`   → an exception (the provider broke);
 *   - anything else    → text with the resource itself embedded in it.
 *
 * The `fixture.bumpContent` command changes the served text and fires
 * `onDidChange`: this is how the provider tells the editor the resource was updated.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const changed = new vscode.EventEmitter();
    let revision = 1;

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("jdt", {
            onDidChange: changed.event,
            provideTextDocumentContent: function (uri) {
                if (uri.path === "/Missing.java") return undefined;
                if (uri.path === "/Broken.java") throw new Error("java/classFileContents failed");
                return "// rev " + revision + "\n// " + uri.toString() + "\npublic class Generated {}\n";
            },
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("fixture.bumpContent", function (rawUri) {
            revision++;
            changed.fire(vscode.Uri.parse(rawUri));
        }),
    );

    // Checks the other side of the contract: `openTextDocument` for a scheme with
    // a provider must ask that provider rather than go to disk.
    context.subscriptions.push(
        vscode.commands.registerCommand("fixture.readThroughOpenTextDocument", async function (rawUri) {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(rawUri));
            return doc.getText();
        }),
    );
};
