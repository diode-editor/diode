"use strict";

/**
 * Фикстура `workspace.registerTextDocumentContentProvider` — срез того, что
 * делает стоковый `redhat.java` для схемы `jdt:`: отдаёт исходник, которого нет
 * на диске (класс из jar, исходник JDK, декомпиляция).
 *
 * Поведение зависит от «пути» ресурса, чтобы одной фикстурой закрыть все три
 * исхода провайдера:
 *   - `/Missing.java`  → `undefined` (провайдер отказался отдать ресурс);
 *   - `/Broken.java`   → исключение (провайдер сломался);
 *   - остальное        → текст, в который вшит сам ресурс.
 *
 * Команда `fixture.bumpContent` меняет отдаваемый текст и стреляет
 * `onDidChange` — так провайдер сообщает редактору, что ресурс обновился.
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

    // Проверка обратной стороны контракта: `openTextDocument` по схеме с
    // провайдером обязан спросить именно его, а не полезть на диск.
    context.subscriptions.push(
        vscode.commands.registerCommand("fixture.readThroughOpenTextDocument", async function (rawUri) {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(rawUri));
            return doc.getText();
        }),
    );
};
