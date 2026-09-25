"use strict";

/**
 * Демо-расширение призрачных подсказок: фейковый «LLM», который отдаёт
 * канированные продолжения по хвосту набранной строки — с искусственной
 * задержкой, как настоящий модельный бэкенд. Используется e2e-сценариями
 * inlineCompletion / inlineSuggestSettings и ручным просмотром
 * (--user-data-dir с этой фикстурой).
 *
 * Две ручки для проверки настроек `editor.inlineSuggest.*` руками:
 *  - `inlineGhost.responseDelay` (мс, по умолчанию 250) — насколько «медленный»
 *    провайдер. Читается на КАЖДЫЙ запрос, так что правка settings.json
 *    применяется без перезапуска редактора;
 *  - канал OUTPUT «Inline Ghost» — по строке на запрос. По нему видно, сколько
 *    раз провайдера дёрнули при наборе (разница `delay: 0` и `delay: 2000`) и
 *    дёргают ли его вообще при `editor.inlineSuggest.enabled: false`.
 */
const SUGGESTIONS = [
    {
        trigger: "function fib",
        insertText: "onacci(n) {\n    if (n <= 1) return n;\n    return fibonacci(n - 1) + fibonacci(n - 2);\n}",
    },
    { trigger: "const greeting", insertText: ' = "Hello from ghost text!";' },
    { trigger: "console.l", insertText: "og(greeting);" },
];

const DEFAULT_RESPONSE_DELAY_MS = 250;

/** Задержка ответа из настроек; мусор в settings.json откатывается на дефолт. */
function responseDelayMs(vscode) {
    const raw = vscode.workspace.getConfiguration("inlineGhost").get("responseDelay");
    if (typeof raw !== "number" || !isFinite(raw) || raw < 0) return DEFAULT_RESPONSE_DELAY_MS;
    return raw;
}

exports.activate = function activate(context) {
    const vscode = require("vscode");

    const output = vscode.window.createOutputChannel("Inline Ghost");
    context.subscriptions.push(output);

    let requestNo = 0;

    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            [{ language: "typescript" }, { language: "javascript" }, { language: "plaintext" }],
            {
                provideInlineCompletionItems: function (document, position, context) {
                    const line = document.getText().split("\n")[position.line] || "";
                    const prefix = line.slice(0, position.character);
                    const match = SUGGESTIONS.find((s) => prefix.endsWith(s.trigger));
                    const delay = responseDelayMs(vscode);
                    requestNo += 1;
                    // triggerKind: 0 — Invoke (Alt+\), 1 — Automatic (набор).
                    const kind = context !== undefined && context.triggerKind === 0 ? "invoke" : "auto";
                    output.appendLine(
                        "request #" +
                            String(requestNo) +
                            " " +
                            kind +
                            " delay=" +
                            String(delay) +
                            "ms prefix=" +
                            JSON.stringify(prefix) +
                            (match === undefined ? " → no match" : " → match"),
                    );
                    if (match === undefined) return Promise.resolve([]);
                    return new Promise(function (resolve) {
                        setTimeout(function () {
                            resolve([new vscode.InlineCompletionItem(match.insertText)]);
                        }, delay);
                    });
                },
            },
        ),
    );
};

exports.deactivate = function deactivate() {};
