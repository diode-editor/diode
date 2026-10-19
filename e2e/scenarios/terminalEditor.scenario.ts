import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Терминал вкладкой в области редакторов (`TerminalLocation.Editor`): фикстурное
// расширение `terminal-demo` заводит шелл «Demo Agent» формой
// `claude-vscode.terminal.open` стокового Claude Code —
// `createTerminal({ location: { viewColumn: ViewColumn.Beside } })` + `show()`.
// Кадры: агент вкладкой в группе справа от файла, вывод его команды, в
// `window.terminals` он есть → «Move Terminal into Panel» уводит его в вид
// TERMINAL с тем же выводом → «Move Terminal into Editor Area» возвращает
// вкладкой → Ctrl+W во вкладке-терминале закрывает её вместе с процессом
// (причина User, 3), а вид TERMINAL пуст.

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-terminal-demo");

/** И команда агента, и её вывод в кадре: «agent ready» встречается дважды. */
const echoed = (t: string): boolean => t.split("agent ready").length >= 3;

/** Исполняет команду через палитру (F1 → заголовок → Enter). */
async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "terminal-editor",
    title: "Терминал вкладкой справа: window.createTerminal({ location: { viewColumn: Beside } })",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 30,
    // Extension-host сценарий с настоящим шеллом — только Linux/macOS, как extension-terminal.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("act:-"), { timeoutMs: 20_000 });

        // Агент — вкладкой в новой группе справа, файл остаётся слева.
        await runCommand(editor, "Terminal Demo: Open Agent Beside");
        await editor.waitForText((t) => t.includes("Demo Agent ×") && echoed(t), { timeoutMs: 15_000 });
        await editor.waitForText((t) => t.includes("ls:Demo Agent"));
        await editor.capture("agent-beside");

        // Во вкладку TERMINAL — тот же процесс и вывод.
        await runCommand(editor, "Terminal: Move Terminal into Panel");
        await editor.waitForText((t) => t.includes("TERMINAL") && !t.includes("Demo Agent ×"));
        await editor.waitForText(echoed);
        await editor.capture("moved-to-panel");

        // И обратно вкладкой; Ctrl+W во вкладке-терминале закрывает её с процессом.
        await runCommand(editor, "Terminal: Move Terminal into Editor Area");
        await editor.waitForText((t) => t.includes("Demo Agent ×") && echoed(t));
        await editor.capture("moved-back");
        await editor.sendKey("Ctrl+W");
        await editor.waitForText((t) => !t.includes("Demo Agent ×") && t.includes("ev:close3"));
        await editor.capture("closed");
    },
});
