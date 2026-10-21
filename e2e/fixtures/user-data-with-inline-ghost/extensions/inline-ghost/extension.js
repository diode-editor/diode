"use strict";

/**
 * Fake "LLM": canned continuations keyed by the line tail, with an artificial delay.
 * `inlineGhost.responseDelay` (ms, default 250) applies to EVERY response, even an empty one — otherwise
 * cancellation of a stale request is not observable; it is read on each request.
 * The "Inline Ghost" OUTPUT log is numbered: fast typing makes requests overlap, and without a number
 * you can't tell which cancellation pairs with which start.
 */
const SUGGESTIONS = [
    {
        trigger: "function fib",
        insertText: "onacci(n) {\n    if (n <= 1) return n;\n    return fibonacci(n - 1) + fibonacci(n - 2);\n}",
    },
    { trigger: "const greeting", insertText: ' = "Hello from ghost text!";' },
    { trigger: "console.l", insertText: "og(greeting);" },
    // Single-word trigger: the word under the cursor itself is not a buffer-word popup candidate,
    // otherwise the popup would override the ghost text on every keystroke.
    { trigger: "greeting", insertText: ' = "Hello from ghost text!";' },
];

const DEFAULT_RESPONSE_DELAY_MS = 250;

function responseDelayMs(vscode) {
    const raw = vscode.workspace.getConfiguration("inlineGhost").get("responseDelay");
    if (typeof raw !== "number" || !isFinite(raw) || raw < 0) return DEFAULT_RESPONSE_DELAY_MS;
    return raw;
}

/** Line tail the provider NEVER responds to (timeout check). */
const SILENT_TRIGGER = "never";
/** Line tail the provider responds to late and DESPITE cancellation. */
const STUBBORN_TRIGGER = "stubborn";

exports.activate = function activate(context) {
    const vscode = require("vscode");
    const log = vscode.window.createOutputChannel("Inline Ghost");
    context.subscriptions.push(log);

    // Running request number. Providers are visited in turn within one core
    // request, so the number provider A assigned is this request's number, and
    // the second provider logs under it too.
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
                    // triggerKind: 0 — Invoke (Alt+\), 1 — Automatic (typing).
                    const kind = inlineContext !== undefined && inlineContext.triggerKind === 0 ? "invoke" : "auto";
                    log.appendLine(
                        "#" +
                            n +
                            " start " +
                            kind +
                            " delay=" +
                            String(delay) +
                            "ms prefix=" +
                            JSON.stringify(prefix),
                    );
                    token.onCancellationRequested(function () {
                        log.appendLine("#" + n + " cancelled");
                    });

                    // Silent provider: the promise never resolves — the core
                    // drops the request on timeout, and the log records the cancellation.
                    if (prefix.endsWith(SILENT_TRIGGER)) return new Promise(function () {});

                    const stubborn = prefix.endsWith(STUBBORN_TRIGGER);
                    const match = stubborn
                        ? { insertText: "ate suggestion" }
                        : SUGGESTIONS.find((s) => prefix.endsWith(s.trigger));
                    return new Promise(function (resolve) {
                        setTimeout(function () {
                            // A well-behaved provider does not respond on a cancelled
                            // token; the stubborn one (demo trigger) does —
                            // and the core must discard its response.
                            if (token.isCancellationRequested && !stubborn) {
                                resolve([]);
                                return;
                            }
                            const items = match === undefined ? [] : [new vscode.InlineCompletionItem(match.insertText)];
                            log.appendLine("#" + n + " answered " + items.length + " items");
                            resolve(items);
                        }, delay);
                    });
                },
            },
        ),
    );

    // Second provider: gives no suggestions, only logs. It shows whether the
    // chain walk reached the end — a cancelled request must stop at the very
    // first provider.
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            [{ language: "typescript" }, { language: "javascript" }, { language: "plaintext" }],
            {
                provideInlineCompletionItems: function () {
                    log.appendLine("#" + requestNumber + " B polled");
                    return [];
                },
            },
        ),
    );
};

exports.deactivate = function deactivate() {};
