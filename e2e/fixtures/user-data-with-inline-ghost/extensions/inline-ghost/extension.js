"use strict";

/**
 * Демо-расширение призрачных подсказок: фейковый «LLM», который отдаёт
 * канированные продолжения по хвосту набранной строки — с искусственной
 * задержкой, как настоящий модельный бэкенд. Используется e2e-сценариями
 * inlineCompletion / inlineSuggestSettings / inlineCompletionCancel,
 * функциональным e2e/inlineCompletions.test.ts и ручным просмотром
 * (--user-data-dir с этой фикстурой).
 *
 * Ручка `inlineGhost.responseDelay` (мс, по умолчанию 250) задаёт, насколько
 * «медленный» провайдер: задержка держится на ЛЮБОМ ответе — и там, где есть
 * что предложить, и там, где нечего, иначе отмену устаревшего запроса не
 * увидеть. Читается на КАЖДЫЙ запрос, так что правка settings.json
 * применяется без перезапуска редактора.
 *
 * Каждый запрос виден в канале OUTPUT «Inline Ghost» строками
 * `#<n> старт <kind> delay=<мс> prefix=<…>`, `#<n> отменён`,
 * `#<n> ответ <k> пунктов`, `#<n> B опрошен` (второй провайдер). Нумерация
 * обязательна: на быстром наборе запросы идут внахлёст, и без номера в ленте
 * не разобрать, какая отмена какому старту пара. По тем же строкам видно,
 * сколько раз провайдера дёрнули при наборе (разница `delay: 0` и
 * `delay: 2000`) и дёргают ли его вообще при
 * `editor.inlineSuggest.enabled: false`.
 */
const SUGGESTIONS = [
    {
        trigger: "function fib",
        insertText: "onacci(n) {\n    if (n <= 1) return n;\n    return fibonacci(n - 1) + fibonacci(n - 2);\n}",
    },
    { trigger: "const greeting", insertText: ' = "Hello from ghost text!";' },
    { trigger: "console.l", insertText: "og(greeting);" },
    // Однословный триггер для демо отмены: слово целиком лежит под кареткой,
    // и попап автодополнения по словам буфера на него не открывается (своё же
    // слово в кандидаты не идёт) — иначе попап перебивал бы призрака на
    // каждом набранном символе.
    { trigger: "greeting", insertText: ' = "Hello from ghost text!";' },
];

const DEFAULT_RESPONSE_DELAY_MS = 250;

/** Задержка ответа из настроек; мусор в settings.json откатывается на дефолт. */
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
