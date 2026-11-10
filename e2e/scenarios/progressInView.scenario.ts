import { resolve } from "node:path";

import { SPINNER_FRAMES } from "../../src/vs/platform/progress/common/progressService.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// `withProgress({ location: { viewId } })` and `ProgressLocation.SourceControl`: the view's header spins while
// the extension's task runs, without the message, the percent or Cancel (upstream shows only the indicator).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-view-progress");

function spins(text: string): boolean {
    return SPINNER_FRAMES.some((glyph) => text.includes(glyph));
}

function headerSpins(frame: string, header: string): boolean {
    return frame.split("\n").some((line) => line.includes(header) && spins(line));
}

async function runProbeCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "progressInView",
    title: "withProgress in a view and in Source Control: a spinner on the view's header",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 30,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.waitForReady();

        await runProbeCommand(editor, "Progress Probe: Index in View");
        await editor.waitForText((t) => headerSpins(t, "INDEXED ITEMS"), { timeoutMs: 20000 });
        await editor.capture("view-spinning");

        await editor.waitForText((t) => t.includes("Probe: indexed in view") && !spins(t), {
            timeoutMs: 20000,
        });
        await editor.capture("view-done");

        await runProbeCommand(editor, "Progress Probe: Index in Source Control");
        await editor.waitForText((t) => headerSpins(t, "CHANGES"), { timeoutMs: 20000 });
        await editor.capture("scm-spinning");

        await editor.waitForText((t) => t.includes("Probe: indexed in SCM") && !spins(t), {
            timeoutMs: 20000,
        });
    },
});
