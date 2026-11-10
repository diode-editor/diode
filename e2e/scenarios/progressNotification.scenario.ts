import { resolve } from "node:path";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// `withProgress({ location: Notification, cancellable: true })`: a sticky toast with `title: message`, the percent and
// Cancel; Cancel fires the extension's token, and the probe prints what `withProgress` resolved to.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-notifications-probe");

async function runProbeCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "progressNotification",
    title: "withProgress in a notification: percent, Cancel and the cancellation token",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 30,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Diode Notify"), { timeoutMs: 30000 });

        await runProbeCommand(editor, "Long Progress");
        await editor.waitForText((t) => t.includes("Diode Notify: Long Progress step") && /\b[1-9]\d?%/u.test(t), {
            timeoutMs: 20000,
        });
        await editor.capture("progress-toast");

        // The toast doesn't take focus: F6 (Notifications: Focus Message) reaches its Cancel.
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("Enter — choose"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Long progress: cancelled") && !t.includes("Long Progress step"), {
            timeoutMs: 20000,
        });
        await editor.capture("cancelled");
    },
});
