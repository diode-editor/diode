import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// The stock redhat.java: a parameter name before the literal out of the box, reference and implementation counts over
// the methods once the settings ask for them, a click opens the references. A copy of the fixture: the settings
// are written to the workspace on the fly.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-java-lens-"));
const appFile = join(sampleDir, "src", "main", "java", "demo", "App.java");

const COUNTS = "1 reference | 0 implementations";

async function clickTitle(editor: ScenarioDriver, title: string): Promise<void> {
    const frame = await editor.captureFrame();
    for (let y = 0; y < frame.rows; y++) {
        const line = frame.cells
            .slice(y * frame.cols, (y + 1) * frame.cols)
            .map((cell) => cell.char)
            .join("");
        const x = line.indexOf(title);
        if (x >= 0) {
            await editor.click(x, y);
            return;
        }
    }
    throw new Error(`"${title}" is not on screen`);
}

export default defineScenario({
    name: "java-lens-hints",
    title: "Java out of the box: parameter name hints, reference counts over methods, a click opens the references",
    // Folder first: redhat.java has only `workspaceContains:` activation events.
    open: [sampleDir, appFile],
    installVsix: ["redhat.java"],
    network: true,
    settings: { "redhat.telemetry.enabled": false },
    // Installing a 139 MB vsix, importing the maven project and two JVMs, as in java-lsp.
    timeoutMs: 900_000,
    cols: 100,
    rows: 24,
    skipOn: ["win32", "darwin"],
    async prepare() {
        cpSync(resolve(repoRoot, "e2e", "fixtures", "javaSample"), sampleDir, { recursive: true });
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes('greet(who: "world")'), { timeoutMs: 300_000 });
        await editor.capture("parameter name hint");

        const settings = join(sampleDir, ".diode", "settings.json");
        mkdirSync(join(sampleDir, ".diode"), { recursive: true });
        writeFileSync(
            settings,
            JSON.stringify({ "java.referencesCodeLens.enabled": true, "java.implementationCodeLens": "methods" }),
        );
        await editor.waitForText((t) => t.includes(COUNTS), { timeoutMs: 180_000 });
        await editor.capture("counts over the methods");

        // A zero count runs the extension's command with no locations: nothing opens, and the next click still works.
        await clickTitle(editor, "0 references");
        await editor.waitForReady();
        await clickTitle(editor, "1 reference");
        await editor.waitForText((t) => t.includes("Locations"), { timeoutMs: 30_000 });
        await editor.capture("the references view");

        writeFileSync(settings, JSON.stringify({ "java.inlayHints.parameterNames.enabled": "none" }));
        await editor.waitForText((t) => t.includes('greet("world")') && !t.includes("1 reference"), { timeoutMs: 60_000 });
        await editor.capture("the settings remove the hints and the counts");
    },
});
