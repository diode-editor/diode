"use strict";

/**
 * Фейковый «LLM»: канированные продолжения по хвосту строки с искусственной задержкой.
 * `inlineGhost.responseDelay` (мс, дефолт 250) держится на ЛЮБОМ ответе, даже пустом, — иначе
 * отмену устаревшего запроса не увидеть; читается на каждый запрос.
 * Лог в OUTPUT «Inline Ghost» нумерован: на быстром наборе запросы идут внахлёст, и без номера
 * не разобрать, какая отмена какому старту пара.
 */
const SUGGESTIONS = [
    {
        trigger: "function fib",
        insertText: "onacci(n) {\n    if (n <= 1) return n;\n    return fibonacci(n - 1) + fibonacci(n - 2);\n}",
    },
    { trigger: "const greeting", insertText: ' = "Hello from ghost text!";' },
    { trigger: "console.l", insertText: "og(greeting);" },
    // Однословный триггер: своё же слово под кареткой в кандидаты попапа слов буфера не идёт,
    // иначе попап перебивал бы призрака на каждом символе.
    { trigger: "greeting", insertText: ' = "Hello from ghost text!";' },
];

const DEFAULT_RESPONSE_DELAY_MS = 250;

function responseDelayMs(vscode) {
    const raw = vscode.workspace.getConfiguration("inlineGhost").get("responseDelay");
    if (typeof raw !== "number" || !isFinite(raw) || raw < 0) return DEFAULT_RESPONSE_DELAY_MS;
    return raw;
}

/** Хвост строки, на который провайдер не отвечает НИКОГДА (проверка таймаута). */
const SILENT_TRIGGER = "never";
/** Хвост строки, на который провайдер отвечает поздно и ВОПРЕКИ отмене. */
const STUBBORN_TRIGGER = "stubborn";

exports.activate = function activate(context) {
    const vscode = require("vscode");
    const log = vscode.window.createOutputChannel("Inline Ghost");
    context.subscriptions.push(log);

    // Сквозной номер запроса. Провайдеры обходятся по очереди в рамках одного
    // запроса ядра, поэтому номер, который завёл A, — номер этого запроса, и
    // второй провайдер пишет в лог под ним же.
    let requestNumber = 0;

    const prefixAt = (document, position) => {
        const line = document.getText().split("\n")[position.line] || "";
        return line.slice(0, position.character);
    };

    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            [{ language: "typescript" }, { language: "javascript" }, { language: "plaintext" }],
            {
                provideInlineCompletionItems: function (document, position, inlineContext, token) {
                    const n = ++requestNumber;
                    const prefix = prefixAt(document, position);
                    const delay = responseDelayMs(vscode);
                    // triggerKind: 0 — Invoke (Alt+\), 1 — Automatic (набор).
                    const kind = inlineContext !== undefined && inlineContext.triggerKind === 0 ? "invoke" : "auto";
                    log.appendLine(
                        "#" +
                            n +
                            " старт " +
                            kind +
                            " delay=" +
                            String(delay) +
                            "ms prefix=" +
                            JSON.stringify(prefix),
                    );
                    token.onCancellationRequested(function () {
                        log.appendLine("#" + n + " отменён");
                    });

                    // Молчащий провайдер: промис не резолвится вовсе — ядро
                    // снимает запрос по таймауту, и в логе остаётся «отменён».
                    if (prefix.endsWith(SILENT_TRIGGER)) return new Promise(function () {});

                    const stubborn = prefix.endsWith(STUBBORN_TRIGGER);
                    const match = stubborn
                        ? { insertText: "ate suggestion" }
                        : SUGGESTIONS.find((s) => prefix.endsWith(s.trigger));
                    return new Promise(function (resolve) {
                        setTimeout(function () {
                            // Дисциплинированный провайдер на отменённом токене
                            // не отвечает; упрямый (демо-триггер) отвечает —
                            // и его ответ обязан быть отброшен ядром.
                            if (token.isCancellationRequested && !stubborn) {
                                resolve([]);
                                return;
                            }
                            const items = match === undefined ? [] : [new vscode.InlineCompletionItem(match.insertText)];
                            log.appendLine("#" + n + " ответ " + items.length + " пунктов");
                            resolve(items);
                        }, delay);
                    });
                },
            },
        ),
    );

    // Второй провайдер: сам подсказок не даёт, только отмечается в логе. По
    // нему видно, доехал ли обход цепочки до конца, — отменённый запрос обязан
    // остановиться на первом же провайдере.
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            [{ language: "typescript" }, { language: "javascript" }, { language: "plaintext" }],
            {
                provideInlineCompletionItems: function () {
                    log.appendLine("#" + requestNumber + " B опрошен");
                    return [];
                },
            },
        ),
    );
};

exports.deactivate = function deactivate() {};
