import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Contract of stock `redhat.java`: F12 navigates to the provider's `jdt:` resource. An unknown scheme is not cosmetic:
// `TextFileModel.openFile` used to throw on a non-`file:` scheme, nobody awaited the promise, and Node closed the
// editor.

/** Read-only lock on the tab (nf-cod-lock; drawn by the engine's `EditorTabItemElement`). */
const READONLY_LOCK = "\uea75";

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "virtualDocsSample");
const sampleFile = resolve(sampleDir, "app.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-virtual-docs");

export default defineScenario({
    name: "virtual-document",
    title: "Read-only документ от registerTextDocumentContentProvider (F12 в библиотеку)",
    seedUserData: userData,
    open: [sampleDir, sampleFile],
    cols: 110,
    rows: 26,
    // Extension host scenario: the CI safety net runs on Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Документ-образец"), { timeoutMs: 20_000 });
        // Providers register in `activate()` after a few seconds; the status bar marker means "the registry is no
        // longer empty".
        await editor.waitForText((t) => t.includes("jdt: provider ready"), { timeoutMs: 30_000 });
        await editor.sendKey("F12");

        await editor.waitForText((t) => t.includes("public final class TextUtils"), { timeoutMs: 20_000 });
        await editor.waitForText((t) => t.includes(`${READONLY_LOCK} TextUtils.java`));
        await editor.capture("definition");

        // Scheme without a provider: the reason is named, the editor is alive and keeps responding (the tab with the
        // jar source is still there).
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Open Unknown Scheme");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Unable to open") && t.includes("nosuchscheme"), {
            timeoutMs: 20_000,
        });
        await editor.capture("unknown-scheme");
    },
});
