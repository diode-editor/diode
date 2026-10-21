import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";


// Markdown, а не .ts, и без папки-воркспейса: иначе полосу делят с нами
// сегменты SCM и спиннер запуска tsserver, и её раскладка плывёт по ходу
// сценария.
const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-status-bar-demo");

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "status-bar-extension",
    title: "Status bar item contributed by an extension",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Только Linux: субпроцесс расширений на Windows флейкает.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForNode("#statusBarItem-extensions-test-status-bar-demo-status-bar-demo", {
            timeoutMs: 20_000,
        });
        await editor.capture("item");

        // clickNode, а не координаты из `item`: сегменты полосы переезжают, когда соседи меняют ширину.
        await editor.clickNode("#statusBarItem-extensions-test-status-bar-demo-status-bar-demo");
        await editor.waitForText((t) => t.includes("Demo · clicked 1"), { timeoutMs: 5000 });
        await editor.capture("clicked");

        await runCommand(editor, "Status Bar Demo: Create Left Pair");
        await editor.waitForText((t) => t.includes("L-high") && t.includes("L-low"), { timeoutMs: 5000 });
        await editor.capture("left-pair");

        await runCommand(editor, "Status Bar Demo: Long Text");
        await editor.waitForText((t) => t.includes("Long Long") && t.includes("…"), { timeoutMs: 5000 });
        await editor.capture("truncated");

        await runCommand(editor, "Status Bar Demo: Dispose");
        await editor.waitForText((t) => !t.includes("Long Long"), { timeoutMs: 5000 });
        await editor.capture("disposed");
    },
});
