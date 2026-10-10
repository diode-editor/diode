import { createRequire } from "node:module";
import { resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// «Fix with Supermaven» у СТОКОВОГО Supermaven (из магазина по id): действие —
// команда `supermaven.sendFixRequestToChat` с `vscode.Position` в аргументах,
// её обработчик без await зовёт `supermaven-view.focus` (webview-вид чата) и
// шлёт сообщение в панель. Из догфуда: пользователь видел «Code action failed».
// Причин было две: кэш действий в субпроцессе вытеснял ответ быстрого
// провайдера, пока меню собиралось из нескольких (здесь — tsserver, Supermaven
// и три провайдера фикстуры chat-panel), а команды `<вид>.focus` не было вовсе.
// Теперь действие исполняется, а вместо панели чата — тост с причиной.
//
// Тот же контракт герметично — сценарий code-action-to-chat и юниты
// `languagesNamespace.codeActions` / `extensionViewFocusCommands`.

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "quickfixSample");
const mainFile = resolve(sampleDir, "main.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-chat-panel");

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

export default defineScenario({
    name: "supermaven-fix",
    title: "Fix with Supermaven: действие стокового Supermaven исполняется, вместо чата — тост",
    seedUserData: userData,
    installVsix: ["Supermaven.supermaven"],
    network: true,
    open: [sampleDir, mainFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 120,
    rows: 32,
    // Extension-host сценарии гоняют subprocess + спавн сервера — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const bad"));

        // Readiness: undercurl от НАСТОЯЩЕГО tsserver'а — без диагностики у
        // каретки Supermaven своего действия не предлагает.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle от tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );

        // Каретка — на строку с ошибкой типов (`const bad: number = "oops"`).
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+Q");
        await editor.waitForText((t) => t.includes("Fix with Supermaven") && t.includes("Fix with Chat Panel"), {
            timeoutMs: 60_000,
        });
        await editor.sendText("Fix with Supermaven");
        await editor.waitForText((t) => t.includes("Fix with Supermaven") && !t.includes("Fix with Chat Panel"));
        await editor.capture("menu");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes(`view "chat" is a webview`) && !t.includes("Code action failed"), {
            timeoutMs: 30_000,
        });
        await editor.capture("toast");
    },
});
