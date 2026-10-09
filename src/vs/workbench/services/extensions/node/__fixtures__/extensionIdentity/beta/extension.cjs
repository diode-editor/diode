"use strict";

/**
 * Фикстура extensionHost.extensionIdentity.test.ts — расширение «beta».
 * Команда `test.identity.report` сравнивает `vscode` всех расширений из реестра
 * проб В МОМЕНТ ВЫЗОВА (геттеры читаются тогда же — проверка, что они живые) и
 * отдаёт хосту сериализуемый отчёт.
 */
const vscode = require("vscode");

const probes = (globalThis[Symbol.for("diode.test.identity")] ??= {});
probes.beta = vscode;

function activeFile(api) {
    const editor = api.window.activeTextEditor;
    return editor === undefined ? null : editor.document.fileName;
}

function compare(other) {
    if (other === undefined) return null;
    return {
        distinctWindow: other.window !== probes.alpha.window && other.window !== vscode.window,
        samePosition: other.Position === vscode.Position,
        sameEnv: other.env === vscode.env,
        activeFile: activeFile(other),
    };
}

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("test.identity.report", function () {
            const alpha = probes.alpha;
            return {
                distinct: alpha !== vscode,
                distinctCommands: alpha.commands !== vscode.commands,
                helperSame: probes.alphaHelper === alpha,
                samePosition: alpha.Position === vscode.Position,
                sameEnv: alpha.env === vscode.env,
                activeAlpha: activeFile(alpha),
                activeBeta: activeFile(vscode),
                esm: compare(probes.esm),
                builtin: compare(probes.builtin),
            };
        }),
    );
};
