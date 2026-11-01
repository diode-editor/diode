import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// A multi-step extension wizard on `window.createInputBox`: the step count and the Back arrow in the title, typing
// replaces the pre-filled value, the validation message, Alt+Left back to the previous answer, the result at the end.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-quick-input-probe");

export default defineScenario({
    name: "quick-input-wizard",
    title: "Multi-step input from an extension: createInputBox and the Back button",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 30,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Diode Probe"), { timeoutMs: 30000 });
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Wizard");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("New Project (1/2)") && t.includes("demo"), { timeoutMs: 20000 });
        await editor.capture("first-step");

        await editor.sendText("app");
        await editor.waitForText((t) => t.includes("app") && !t.includes("demo"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("← New Project (2/2)") && t.includes("com.example"));
        await editor.capture("second-step-with-back");

        await editor.sendText("BAD");
        await editor.waitForText((t) => t.includes("Lowercase only"));
        await editor.capture("validation");

        await editor.sendKey("Alt+ArrowLeft");
        await editor.waitForText((t) => t.includes("New Project (1/2)") && t.includes("app"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("← New Project (2/2)") && t.includes("com.example"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Wizard: com.example:app"), { timeoutMs: 20000 });
        await editor.capture("result");
    },
});
