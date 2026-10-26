import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// #194. A `#region` header sits at its body's indent, so the folding guide would land on the first
// character of every wrapped line ("const" → "▏onst"); the resting screenshot is the assertion.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "regionFolding.ts");

export default defineScenario({
    name: "region-folding",
    title: "Extension-provided #region folds (maptz.regionfolder)",
    open: [repoRoot, sampleFile],
    installVsix: ["maptz.regionfolder"],
    network: true,
    cols: 100,
    rows: 20,
    // Extension host scenarios run the subprocess — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const sum"));

        // Fold FIRST: the provider activates on onStartupFinished, after the file opens, so an early fold
        // collapses the indentation range. A fold starting on the `#region` line proves the provider's
        // ranges landed — retry until it appears (slow runners activate seconds later).
        // Ctrl+K Ctrl+L: the headless key DSL can't serialize Ctrl+Shift+[.
        // Navigate by the Ln in the status bar, not by counting key presses: presses get lost while extensions
        // start, and collapse moves the cursor to the end of the document.
        const gotoLine = async (line: number): Promise<void> => {
            for (let i = 0; i < 20; i++) await editor.sendKey("ArrowUp");
            for (let i = 0; i < 15; i++) {
                if (new RegExp(`Ln ${String(line)}, `).test(frameToText(await editor.captureFrame()))) return;
                await editor.sendKey("ArrowDown");
            }
        };
        const toggleFoldAt = async (line: number): Promise<void> => {
            await gotoLine(line);
            await editor.sendKey("Ctrl+K");
            await editor.sendKey("Ctrl+L");
        };
        // Always unfold via unfoldAll (Ctrl+K Ctrl+J): cursor navigation OVER
        // a folded region is unreliable (jumps across hidden lines + collapse
        // moves the cursor to the end), and status-bar gotoLine flakes on it.
        // unfoldAll needs no positioning at all.
        const unfoldAll = async (): Promise<void> => {
            // Like the fold loop above, the chord can get lost while the extension
            // host/LSP is busy — a single uncaught 10s wait failed the scenario on
            // a slow runner. Retry the chord with a short caught wait.
            for (let attempt = 0; attempt < 10; attempt++) {
                await editor.sendKey("Ctrl+K");
                await editor.sendKey("Ctrl+J");
                try {
                    await editor.waitForText((t) => t.includes("const sum"), { timeoutMs: 1000 });
                    return;
                } catch {
                    // Still folded — press the chord again.
                }
            }
            throw new Error("region-folding: unfoldAll did not unfold the document in 10 attempts");
        };
        let regionFolded = false;
        for (let attempt = 0; attempt < 20 && !regionFolded; attempt++) {
            await toggleFoldAt(6);
            let folded: string;
            try {
                // Short caught wait: the chord can be a complete no-op (no ranges
                // at all — neither provider nor indentation ones on the marker
                // line) — that is "too early", not a failure, so retry. An
                // uncaught 10s wait failed the scenario on fast input that
                // reaches the chord before the extension host starts.
                folded = frameToText(await editor.waitForText((t) => !t.includes("const sum"), { timeoutMs: 1000 }));
            } catch {
                continue;
            }
            regionFolded = folded.split("\n").some((l) => l.includes("#region") && l.includes("⋯"));
            if (!regionFolded) {
                // An indentation fold collapsed, not the region: the provider has
                // not arrived yet — unfold everything and retry.
                await unfoldAll();
            }
        }
        if (!regionFolded) {
            throw new Error("region-folding: the provider fold did not appear in 20 attempts");
        }
        await editor.capture("region-folded");

        // Unfold: the resting frame now provably has the provider region in the
        // model, which is what makes it the assertion — the `#region` header and
        // its body share an indent, and the code must survive intact.
        await unfoldAll();
        await editor.capture("rest");
    },
});
