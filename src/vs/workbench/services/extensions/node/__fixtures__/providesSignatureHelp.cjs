"use strict";

/**
 * Фикстура провайдеров подсказки параметров: регистрирует ДВА провайдера для
 * typescript — правило «первый непустой ответ выигрывает» проверяется через
 * настоящий субпроцесс, а не только на стабе RPC.
 *   - первый  → на строке 0 молчит (возвращает null), на строке 1 отдаёт свою
 *     сигнатуру (значит, порядок соблюдается);
 *   - второй  → на строке 0 отдаёт сигнатуру с двумя параметрами, эхом
 *     контекста в документации (проверка, что triggerCharacter/isRetrigger
 *     доезжают до расширения настоящим `SignatureHelpContext`).
 *
 * Метаданные объявлены объектом — той перегрузкой, которую выбирает стоковый
 * vscode-languageclient, когда сервер прислал `retriggerCharacters`.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: function (document, position) {
                    if (position.line !== 1) return null;
                    const help = new vscode.SignatureHelp();
                    const signature = new vscode.SignatureInformation("first(): void");
                    signature.parameters = [];
                    help.signatures = [signature];
                    return help;
                },
            },
            { triggerCharacters: ["("], retriggerCharacters: [")"] },
        ),
        vscode.languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: function (document, position, token, sigContext) {
                    if (position.line !== 0) return null;
                    const help = new vscode.SignatureHelp();
                    const signature = new vscode.SignatureInformation(
                        "greet(name: string, age: number): void",
                        new vscode.MarkdownString(
                            "kind=" +
                                String(sigContext.triggerKind) +
                                " char=" +
                                String(sigContext.triggerCharacter) +
                                " retrigger=" +
                                String(sigContext.isRetrigger) +
                                " active=" +
                                String(sigContext.activeSignatureHelp && sigContext.activeSignatureHelp.activeSignature),
                        ),
                    );
                    signature.parameters = [
                        new vscode.ParameterInformation("name: string", "кого приветствуем"),
                        new vscode.ParameterInformation([20, 31]),
                    ];
                    help.signatures = [signature];
                    help.activeSignature = 0;
                    help.activeParameter = 1;
                    return help;
                },
            },
            ",",
            "<",
        ),
    );
};
