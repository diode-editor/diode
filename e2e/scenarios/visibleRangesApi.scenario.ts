import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// A file of unknown language and no workspace folder: no language server to shift the status bar (as in
// themeSelectionApi). 30 sections of a header and three indented items: folds by indentation.
const sampleFile = resolve(repoRoot, "e2e", "fixtures", "visible-ranges.hello");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-visible-ranges");

export default defineScenario({
    name: "visible-ranges-api",
    title: "TextEditor.visibleRanges and window.onDidChangeTextEditorVisibleRanges",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    userKeybindings: [
        { key: "ctrl+alt+f", command: "editor.fold" },
        { key: "ctrl+alt+s", command: "workbench.action.splitEditor" },
    ],
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        // `C<column> <first-last,...> #<events>`, lines 1-based, from the demo extension in the status bar.
        await editor.waitForText((t) => /C1 1-\d+ #/.test(t), { timeoutMs: 20_000 });
        await editor.capture("activated");

        await editor.sendKey("Ctrl+End");
        await editor.waitForText((t) => /C1 \d+-121 #[1-9]/.test(t), { timeoutMs: 5000 });
        await editor.capture("scrolled-to-end");

        // A fold on screen splits the ranges: section 1's items (lines 2-4) are left out.
        await editor.sendKey("Ctrl+Home");
        await editor.waitForText((t) => /C1 1-\d+ #/.test(t), { timeoutMs: 5000 });
        await editor.sendKey("Ctrl+Alt+f");
        await editor.waitForText((t) => /C1 1-1,5-\d+ #/.test(t), { timeoutMs: 5000 });
        await editor.capture("folded");

        // A taller terminal shows more lines.
        const before = /C1 1-1,5-(\d+)/.exec(frameToText(await editor.captureFrame()))?.[1];
        await editor.resize(120, 34);
        await editor.waitForText(
            (t) => {
                const last = /C1 1-1,5-(\d+)/.exec(t)?.[1];
                return last !== undefined && before !== undefined && Number(last) > Number(before);
            },
            { timeoutMs: 5000 },
        );
        await editor.capture("resized");

        // The second split reports its own ranges; scrolling it leaves the first one alone.
        await editor.sendKey("Ctrl+Alt+s");
        await editor.waitForText((t) => /C2 1-\d+ #/.test(t), { timeoutMs: 5000 });
        await editor.sendKey("Ctrl+End");
        await editor.waitForText((t) => /C2 \d+-121 #[1-9]/.test(t) && /C1 1-1,5-/.test(t), { timeoutMs: 5000 });
        await editor.capture("split");
    },
});
