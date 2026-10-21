"use strict";

/**
 * A slice of `redhat.java`: F12 on a library class leads to a `jdt:` resource whose content comes
 * from the extension's provider. Not the real `redhat.java`: it isn't in our marketplace registry,
 * and jdt.ls needs a JDK and half a minute. `openMissingScheme` opens a scheme nobody serves: the user
 * must see a message instead of the editor crashing (`TextFileModel.openFile` threw).
 */

const LIBRARY_URI = "jdt://contents/text-utils-1.4.0.jar/com.example.text/TextUtils.java";

const LIBRARY_SOURCE = [
    "package com.example.text;",
    "",
    "/** From a jar archive: this file is not on disk. */",
    "public final class TextUtils {",
    "",
    "    public static String capitalize(String value) {",
    '        if (value == null || value.isEmpty()) return value;',
    "        return Character.toUpperCase(value.charAt(0)) + value.substring(1);",
    "    }",
    "}",
    "",
].join("\n");

exports.activate = function activate(context) {
    const vscode = require("vscode");

    // Readiness marker: `activate()` happens seconds after the first frame; without it
    // the scenario would press F12 against a still empty provider registry.
    const ready = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    ready.name = "Virtual Docs Demo";
    ready.text = "jdt: provider ready";
    ready.show();
    context.subscriptions.push(ready);

    // The extension supplies the content of `jdt:` resources: there's no disk behind them.
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("jdt", {
            provideTextDocumentContent: function (uri) {
                if (uri.toString() !== LIBRARY_URI) return undefined;
                return LIBRARY_SOURCE;
            },
        }),
    );

    // F12 in the sample document leads to the `capitalize` declaration inside the jar.
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { scheme: "file", language: "plaintext" },
            {
                provideDefinition: function () {
                    return new vscode.Location(vscode.Uri.parse(LIBRARY_URI), new vscode.Range(5, 25, 5, 35));
                },
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("virtualDocsDemo.openMissingScheme", async function () {
            await vscode.window.showTextDocument(vscode.Uri.parse("nosuchscheme:///Nowhere.java"));
        }),
    );
};
