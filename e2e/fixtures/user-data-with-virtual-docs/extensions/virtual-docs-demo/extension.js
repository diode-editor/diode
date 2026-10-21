"use strict";

/**
 * Срез `redhat.java`: F12 на классе из библиотеки уводит на `jdt:`-ресурс, содержимое которого
 * отдаёт провайдер расширения. Не настоящий `redhat.java`: его нет в нашем реестре магазина, а
 * jdt.ls нужен JDK и полминуты. `openMissingScheme` — схема, которую не обслуживает никто: раньше
 * роняла редактор (`TextFileModel.openFile` бросал), теперь человек видит сообщение.
 */

const LIBRARY_URI = "jdt://contents/text-utils-1.4.0.jar/com.example.text/TextUtils.java";

const LIBRARY_SOURCE = [
    "package com.example.text;",
    "",
    "/** Из jar-архива: этого файла нет на диске. */",
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

    // Маркер готовности: `activate()` случается через секунды после первого кадра — без него
    // сценарий жал бы F12 в ещё пустой реестр провайдеров.
    const ready = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    ready.name = "Virtual Docs Demo";
    ready.text = "jdt: provider ready";
    ready.show();
    context.subscriptions.push(ready);

    // Содержимое `jdt:`-ресурсов даёт расширение — диска за ними нет.
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("jdt", {
            provideTextDocumentContent: function (uri) {
                if (uri.toString() !== LIBRARY_URI) return undefined;
                return LIBRARY_SOURCE;
            },
        }),
    );

    // F12 в документе-образце уводит на объявление `capitalize` внутри jar.
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
