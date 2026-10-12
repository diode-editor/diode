"use strict";

/**
 * Зонд воркспейса: при активации пишет в статус-бар то, что расширение увидело
 * в `vscode.workspace`: имя воркспейса (у окна из файла — «web (Workspace)»,
 * то есть оно же говорит и о `workspaceFile`). Текст короткий: полоса делит
 * ширину с веткой и синхронизацией SCM, длинный пункт усекается (около 24
 * символов). Читает ОДИН раз, в `activate()`, как это делают настоящие
 * расширения (языковой клиент отдаёт папки серверу в `initialize` и больше их
 * не перечитывает):
 * новое значение в полосе значит, что процесс расширений поднят заново уже в
 * новом воркспейсе.
 *
 * Используется e2e-сценарием workspaceSwitchExtensions и ручной проверкой:
 *   diode --user-data-dir=<каталог с этой фикстурой> web.code-workspace
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.name = "Workspace Probe";
    item.text = vscode.workspace.name;
    item.show();
    context.subscriptions.push(item);
};

exports.deactivate = function deactivate() {};
