import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Слои кейбиндов: пользовательский бинд сильнее бинда расширения на той же
// комбинации — как в VS Code, и независимо от того, что слой расширений
// регистрируется при старте ПОЗЖЕ keybindings.json. Фикстурное расширение
// `ext-storage-demo` вешает `alt+q` на свою команду под `extStorageDemo.armed`;
// пользователь в keybindings.json вешает ту же `alt+q` на Quick Open с
// префиллом. После `Arm` оба бинда активны, и клавиша обязана уйти
// пользовательскому: открывается Quick Open, счётчик расширения стоит на нуле.

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-ext-storage-demo");

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "user-overrides-extension-keybinding",
    title: "Пользовательский бинд сильнее бинда расширения на той же комбинации",
    seedUserData: userData,
    userKeybindings: [{ key: "alt+q", command: "workbench.action.quickOpen", args: "AGENTS" }],
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux (как extension-storage).
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("idle · fired 0"), { timeoutMs: 20_000 });

        // Бинд расширения оживает — теперь на alt+q активны оба.
        await runCommand(editor, "Ext Storage Demo: Arm");
        await editor.waitForText((t) => t.includes("armed · fired 0"), { timeoutMs: 5000 });
        await editor.capture("both-active");

        // Клавиша уходит пользовательскому бинду: Quick Open с префиллом.
        await editor.sendKey("Alt+q");
        await editor.waitForNode("#quickInput");
        const frame = frameToText(await editor.waitForText((t) => t.includes("AGENTS.md"), { timeoutMs: 5000 }));
        await editor.capture("user-wins");

        // Счётчик расширения не сдвинулся — его команда не исполнялась.
        if (!frame.includes("armed · fired 0")) {
            throw new Error("alt+q ушёл бинду расширения: пользовательский слой не сильнее слоя extension");
        }
    },
});
