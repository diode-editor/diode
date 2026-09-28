"use strict";

/**
 * Демо `workspace.registerTextDocumentContentProvider` — среза того, чем живёт
 * стоковый `redhat.java`: Go to Definition на классе из библиотеки уводит не в
 * файл на диске, а на `jdt:`-ресурс, содержимое которого отдаёт сам провайдер
 * расширения (класс из jar, исходник JDK, результат декомпиляции).
 *
 * Настоящим `redhat.java` это демо не сделать: его нет в нашем реестре
 * магазина, ему нужен JDK и добрых полминуты на подъём jdt.ls. Поэтому здесь
 * тот же контракт на фикстуре — провайдер для схемы `jdt:` плюс
 * definition-провайдер, который на эту схему указывает.
 *
 * Вторая половина демо — команда `virtualDocsDemo.openMissingScheme`: она
 * просит открыть ресурс схемы, которой не обслуживает НИКТО. Раньше такой
 * запрос уносил редактор целиком (`TextFileModel.openFile` бросал, отказ
 * команды никто не ловил), теперь человек видит сообщение и продолжает
 * работать.
 *
 * Ручная проверка:
 *   diode --user-data-dir=<каталог с этой фикстурой> e2e/fixtures/virtualDocsSample
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

    // Маркер готовности: провайдеры регистрируются в `activate()`, а он
    // случается через секунды после первого кадра. Без видимого «готов»
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

    // Схема, которой не обслуживает никто: открыть нечем — и это должно быть
    // видно человеку, а не уронить редактор.
    context.subscriptions.push(
        vscode.commands.registerCommand("virtualDocsDemo.openMissingScheme", async function () {
            await vscode.window.showTextDocument(vscode.Uri.parse("nosuchscheme:///Nowhere.java"));
        }),
    );
};
