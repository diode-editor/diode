/**
 * ESM-расширение в форме, в которой их раздаёт магазин: каталог со своим
 * `package.json` (`"type": "module"`) и `.js`-точкой входа с ИМЕНОВАННЫМИ
 * import'ами из `"vscode"` — ровно так устроен `esbenp.prettier-vscode` 12.x.
 *
 * Проверяет две вещи сразу: хост решает «это ESM» по `"type"` манифеста, а
 * ESM-loader видит виртуальный модуль `"vscode"`. CJS-кэш субпроцесса
 * ESM-loader'у не виден, поэтому без `module.registerHooks` этот файл падает на
 * `ERR_MODULE_NOT_FOUND: Cannot find package 'vscode'`.
 */
import { commands, languages, Range, TextEdit } from "vscode";

// Top-level await — он здесь не для красоты: `require(esm)` на таком модуле
// падает с `ERR_REQUIRE_ASYNC_MODULE`, поэтому именно он пришпиливает ВЫБОР
// loader'а (`isEsmEntry` → `importModule`). Без него CJS-ветка случайно
// проезжает: Node 22+ умеет `require(esm)` для синхронного графа.
await Promise.resolve();

export function activate(context) {
    context.subscriptions.push(
        commands.registerCommand("test.esm.ping", () => "pong from esm"),
        languages.registerDocumentFormattingEditProvider("plaintext", {
            provideDocumentFormattingEdits(document) {
                // positionAt — то, чем настоящий prettier строит минимальную
                // правку; без него провайдер молча отдавал пустой список.
                const text = document.getText();
                const formatted = text.replace(/ {2,}/g, " ");
                if (formatted === text) return [];
                const range = new Range(document.positionAt(0), document.positionAt(text.length));
                return [TextEdit.replace(range, formatted)];
            },
        }),
    );
    return { marker: "esm exports" };
}
