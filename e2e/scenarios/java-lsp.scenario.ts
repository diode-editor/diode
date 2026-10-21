import { resolve } from "node:path";

import type { CellSnapshot, GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The fixture project has no external dependencies: the JDK classpath is enough for go-to-definition, and an extra
// artifact would add minutes; no `~/.m2` needed, so it works with an isolated HOME too.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "javaSample");
const appFile = resolve(sampleDir, "src", "main", "java", "demo", "App.java");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

/** `variable.parameter` in Dark Modern: only the jdt.ls semantic token makes `who` a parameter, TextMate does not. */
const PARAMETER_FG = 0x9cdcfe;

function findCell(frame: GridSnapshot, needle: string): CellSnapshot | undefined {
    for (let row = 0; row < frame.rows; row++) {
        const cells = frame.cells.slice(row * frame.cols, (row + 1) * frame.cols);
        const index = cells
            .map((cell) => cell.char || " ")
            .join("")
            .lastIndexOf(needle);
        if (index !== -1) return cells[index];
    }
    return undefined;
}

export default defineScenario({
    name: "java-lsp",
    title: "Java out of the box: jdt.ls — squiggle, semantic highlighting, code actions, go to JDK",
    // Folder first: redhat.java has only `workspaceContains:` activation events.
    open: [sampleDir, appFile],
    installVsix: ["redhat.java"],
    network: true,
    // Otherwise the telemetry consent toast covers the right side of the editor, exactly the squiggled lines.
    settings: { "redhat.telemetry.enabled": false },
    // Installing a 139 MB vsix, importing the maven project and two JVMs (syntax + standard server).
    timeoutMs: 900_000,
    cols: 100,
    rows: 24,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("int broken = message;"));

        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle from jdt.ls", timeoutMs: 300_000, intervalMs: 1000 },
        );
        await editor.capture("diagnostics");

        await waitUntil(
            () => editor.captureFrame(),
            (frame) => findCell(frame, "who;")?.fg === PARAMETER_FG,
            { describe: "semantic color of the `who` parameter", timeoutMs: 120_000, intervalMs: 1000 },
        );
        await editor.capture("semantic-tokens");

        // `int broken = message;` is line 10. The menu snapshots code actions when it opens: the squiggle
        // arrives before jdt.ls can serve fixes, leaving only "Source Actions…", so reopen until the fix shows up.
        for (let i = 0; i < 9; i++) await editor.sendKey("ArrowDown");
        const fixTitle = "Change type of 'broken' to 'String'";
        const deadline = Date.now() + 180_000;
        for (;;) {
            await editor.sendKey("Ctrl+K");
            await editor.sendKey("Ctrl+Q");
            try {
                await editor.waitForText((t) => t.includes(fixTitle), { timeoutMs: 15_000 });
                break;
            } catch (err) {
                if (Date.now() > deadline) throw err;
                await editor.sendKey("Escape");
            }
        }
        await editor.capture("code-actions");

        // The F12 target is `jdt://contents/java.base/java.lang/String.java`:
        // before #363 such a uri crashed the editor.
        await editor.sendKey("Escape");
        await editor.sendKey("ArrowUp");
        for (let i = 0; i < 10; i++) await editor.sendKey("ArrowRight");
        // Until jdt.ls finishes indexing the JRE the definition comes back empty, and a single F12 got lost
        // (a flake in half the runs on 4 cores), so press until the tab opens.
        const jumpDeadline = Date.now() + 180_000;
        for (;;) {
            await editor.sendKey("F12");
            try {
                await editor.waitForText((t) => t.includes("String.java"), { timeoutMs: 15_000 });
                break;
            } catch (err) {
                if (Date.now() > jumpDeadline) throw err;
            }
        }
        await editor.capture("jdk-source");
    },
});
