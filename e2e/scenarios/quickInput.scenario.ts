import { resolve } from "node:path";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// The extension raises THE SAME overlay as the command palette and Quick Open; the answer is printed to the
// "Diode Probe" Output channel, which shows that the input reached the extension.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-quick-input-probe");

async function runProbeCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "quick-input",
    title: "An extension asks for a string and a choice (showInputBox / showQuickPick)",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 30,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Diode Probe"), { timeoutMs: 30000 });

        await runProbeCommand(editor, "Ask Port");
        await editor.waitForText((t) => t.includes("Server port"), { timeoutMs: 20000 });
        await editor.capture("input-box");

        await editor.sendText("ab");
        await editor.waitForText((t) => t.includes("Digits only"));
        await editor.capture("error-message");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Digits only"));

        await editor.sendKey("Backspace");
        await editor.sendKey("Backspace");
        await editor.sendText("80");
        await editor.waitForText((t) => t.includes("Port < 1024"));
        await editor.capture("warning-message");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Port: 80"), { timeoutMs: 20000 });
        await editor.capture("input-accepted");

        // The extension receives the real text — checked by its length.
        await runProbeCommand(editor, "Ask Secret");
        await editor.waitForText((t) => t.includes("Typed text is masked"), { timeoutMs: 20000 });
        await editor.sendText("hunter2");
        await editor.waitForText((t) => t.includes("*******") && !t.includes("hunter2"));
        await editor.capture("password-masked");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Secret length: 7"), { timeoutMs: 20000 });

        await runProbeCommand(editor, "Pick Fruit");
        await editor.waitForText((t) => t.includes("Pick a fruit") && t.includes("cherry"), { timeoutMs: 20000 });
        await editor.capture("quick-pick");

        await editor.sendText("ch");
        await editor.waitForText((t) => t.includes("cherry") && !t.includes("banana"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Fruit: cherry"), { timeoutMs: 20000 });

        await runProbeCommand(editor, "Pick Many (preselected)");
        await editor.waitForText((t) => t.includes("[✓] beta"), { timeoutMs: 20000 });
        await editor.capture("multi-select");

        await editor.sendKey(" ");
        await editor.waitForText((t) => t.includes("[✓] alpha"));
        await editor.capture("multi-select-checked");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Picked: alpha, beta"), { timeoutMs: 20000 });
        await editor.capture("multi-select-accepted");

        // The picker opens empty and items arrive later — like `Go: Maintain gopls` (golang.go, pickLazyEnum).
        await runProbeCommand(editor, "Lazy Pick");
        await editor.waitForText((t) => t.includes("Lazy enum") && t.includes("Alpha module"), {
            timeoutMs: 20000,
        });
        await editor.capture("create-quick-pick");

        await editor.sendText("beta");
        await editor.waitForText((t) => t.includes('Matches for "beta"') && !t.includes("Alpha module"));
        await editor.capture("create-quick-pick-filtered");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Lazy: example.com/beta"), { timeoutMs: 20000 });

        await runProbeCommand(editor, "Open File Dialog");
        // Directories come before files and the root README is below the visible part — wait for a directory that is
        // always visible.
        await editor.waitForText((t) => t.includes("Pick a file") && t.includes(".github"), { timeoutMs: 20000 });
        await editor.capture("file-dialog");
        await editor.sendText("READ");
        await editor.waitForText((t) => t.includes("README.md") && t.includes("Pick a file"));
        await editor.capture("file-dialog-typed");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Opened: ") && t.includes("README"), { timeoutMs: 20000 });

        // Our own overlay consumer is intact: after a multi-select the command palette has no checkboxes.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.waitForText((t) => t.includes("File: Save"));
        await editor.capture("palette-intact");
        await editor.sendKey("Escape");
    },
});
