import { resolve } from "node:path";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// A message with buttons is the only way into sign-up for AI completions (Supermaven): this checks that the answer
// reaches the extension (a line in the "Diode Notify" Output channel).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-notifications-probe");

async function runProbeCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "notifications",
    title: "Сообщения расширений с кнопками (show*Message) и env.openExternal",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 30,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Diode Notify"), { timeoutMs: 30000 });

        await runProbeCommand(editor, "Show Error");
        await editor.waitForText((t) => t.includes("tsserver: crashed 3 times") && t.includes("×"), {
            timeoutMs: 20000,
        });
        await editor.capture("error-toast");

        // The toast doesn't take focus; its border says how to reach the buttons.
        await runProbeCommand(editor, "Ask Activate");
        await editor.waitForText((t) => t.includes("Use free version") && t.includes("F6"), { timeoutMs: 20000 });
        await editor.capture("question");

        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("Enter — choose"));
        await editor.capture("question-focused");

        await editor.sendKey("ArrowRight");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Ask returned: Use free version"), { timeoutMs: 20000 });
        await editor.capture("answer-delivered");

        await runProbeCommand(editor, "Show Many");
        await editor.waitForText((t) => t.includes("Message one") && t.includes("more"), { timeoutMs: 20000 });
        await editor.capture("stack");

        await runProbeCommand(editor, "Clear All");
        await editor.waitForText((t) => !t.includes("Message one"), { timeoutMs: 20000 });

        // Escape returns the isCloseAffordance button.
        await runProbeCommand(editor, "Ask Modal");
        await editor.waitForText((t) => t.includes("Delete 12 files permanently?"), { timeoutMs: 20000 });
        await editor.capture("modal");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => t.includes("Modal returned: item:Cancel"), { timeoutMs: 20000 });

        // No browser in a container or over ssh: the URL goes to the clipboard and is shown in a message.
        await runProbeCommand(editor, "Open External");
        await editor.waitForText((t) => t.includes("Ссылка скопирована в буфер обмена"), { timeoutMs: 20000 });
        await editor.capture("open-external-fallback");
        // The toast covers the bottom rows of Output; without clearing it the extension's new line isn't in the frame.
        await runProbeCommand(editor, "Clear All");
        await editor.waitForText((t) => t.includes("openExternal returned: true"), { timeoutMs: 20000 });

        await runProbeCommand(editor, "Clipboard Round Trip");
        // Wait on the line prefix: the full text is clipped by the Output panel width.
        await editor.waitForText((t) => t.includes("clipboard readText: clipboard-from"), { timeoutMs: 20000 });
        await editor.capture("clipboard");
    },
});
