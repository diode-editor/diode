"use strict";

/**
 * Разметка `$(name)` во ВСЕХ поверхностях, куда уходит текст расширения: везде, где эталон значок
 * разворачивает, должен быть глиф. Обратная половина: в СОДЕРЖИМОМ канала и в начальном `value`
 * поля ввода стоит `$(no-such-icon)` — их подменять нельзя (лог не разметка, value человек
 * возвращает расширению), а неизвестное имя подменщик выбрасывает, так что ошибка видна сразу.
 */

exports.activate = function activate(context) {
    const vscode = require("vscode");

    // Имя канала — ярлык: оно уезжает и в палитру («Output: Show …»), и в
    // селектор каналов. Строки канала — наоборот, текст как есть.
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

    // `OutputChannel.show()` — настоящий путь расширения: открывает панель и переключает селектор.
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

    // Два поля ввода, а не одно: сообщение валидации ЗАМЕНЯЕТ строку подсказки,
    // поэтому показать и prompt, и validation одним показом нельзя.
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

    // Прогресс держим открытым до отдельной команды: иначе подпись мигнула бы
    // быстрее, чем сценарий успеет снять кадр.
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
