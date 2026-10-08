import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Терминал расширения (`window.createTerminal`): фикстурное расширение
// `terminal-demo` по команде заводит шелл «Demo Runner» со своим окружением,
// шлёт в него `sendText` и показывает (`show`) — так работают cleanup-команды
// bazel-java и Code Runner. Что расширение видит в ответ (`window.terminals`,
// `activeTerminal`, события, `exitStatus`), оно пишет в свои пункты статус-бара.
// Кадры: шелл расширения в панели с выводом его команды → шелл человека рядом,
// оба в списке вкладок и в `window.terminals` → `dispose()` расширения закрыл
// свой терминал с причиной Extension (4).

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-terminal-demo");

/** Исполняет команду через палитру (F1 → заголовок → Enter). */
async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "extension-terminal",
    title: "Терминал расширения: createTerminal + sendText + show в панели TERMINAL",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 30,
    // Extension-host сценарий с настоящим шеллом: как status-bar-extension —
    // только Linux/macOS.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("act:-"), { timeoutMs: 20_000 });

        // Команда расширения: шелл с его env, вывод его команды, вкладка TERMINAL.
        await runCommand(editor, "Terminal Demo: Run in Terminal");
        await editor.waitForText((t) => t.includes("hello from Demo Runner"), { timeoutMs: 15_000 });
        await editor.waitForText((t) => t.includes("act:Demo Runner"));
        await editor.capture("run");

        // Шелл человека рядом: список вкладок, оба — в window.terminals.
        await runCommand(editor, "Terminal: Create New Terminal");
        await runCommand(editor, "Terminal Demo: List Terminals");
        await editor.waitForText((t) => t.includes("ev:list") && /ls:Demo Runner,\S/u.test(t) && !t.includes("act:Demo"));
        await editor.capture("two-terminals");

        // dispose() расширения закрывает его терминал: причина Extension.
        await runCommand(editor, "Terminal Demo: Dispose");
        await editor.waitForText((t) => t.includes("ev:close4") && !t.includes("ls:Demo Runner"));
        await editor.capture("disposed");
    },
});
