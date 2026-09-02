/**
 * Версия VS Code, которую объявляет наш vscode-шим (`vscode.version`) и против
 * которой матчится `engines.vscode` расширений при установке из реестра.
 *
 * Лок-степ с `extensions/VSCODE_VERSION` и пином `src/vscode-dts/vscode.d.ts` —
 * проверяет `vscodeNamespace.identity.test.ts`. Отдельный модуль (а не экспорт
 * из `vscodeNamespace.ts`), чтобы потребителям константы (`main.ts`) не тянуть
 * сборку всего namespace.
 */
export const VSCODE_SHIM_VERSION = "1.127.0";
