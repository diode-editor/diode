import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Folding ranges contributed by a STOCK extension (#194): the real
// maptz.regionfolder `.vsix` is installed into the scenario's user-data dir, and
// its `#region`/`#endregion` markers become foldable ranges on top of the
// indentation folds.
//
// The demo exists because the visible half of this feature is what unit tests
// can't see: a `#region` header sits at the same indent as its body, so the
// folding indent guide would land on the first character of every wrapped line
// ("const" rendering as "│onst"). The resting screenshot is the assertion.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "regionFolding.ts");
const vsix = resolve(repoRoot, "e2e", "fixtures", "maptz-regionfolder", "maptz.regionfolder-1.0.22.vsix");

export default defineScenario({
    name: "region-folding",
    title: "Extension-provided #region folds (maptz.regionfolder)",
    open: [repoRoot, sampleFile],
    installVsix: [vsix],
    cols: 100,
    rows: 20,
    // Extension-host scenarios run the subprocess — Linux only, like
    // editorconfig-stock / sea-git (see docs/TODO/E2E.md).
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const sum"));

        // Fold FIRST, and only then shoot the resting frame. The provider
        // activates on onStartupFinished — after the file is already open — so a
        // fold pressed too early collapses the indentation range (the function
        // body) instead of the region. A fold that starts on the `#region`
        // marker line is something indentation folding can never produce, so it
        // doubles as proof that the provider's ranges have landed — retry the
        // toggle until exactly that fold appears (on slow runners activation
        // lands seconds later; git-расширение added its own startup git calls,
        // pushing the window wider).
        // Ctrl+K Ctrl+L: both keys are Ctrl+letter, which the headless key DSL can
        // serialize (Ctrl+Shift+[ cannot).
        // Навигация по статус-бару (Ln N), а не слепым счётом нажатий: нажатия
        // теряются, пока стартуют расширения/LSP, а collapse уводит курсор в
        // конец документа.
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
        let regionFolded = false;
        for (let attempt = 0; attempt < 20 && !regionFolded; attempt++) {
            await toggleFoldAt(6);
            const folded = frameToText(await editor.waitForText((t) => !t.includes("const sum")));
            regionFolded = folded.split("\n").some((l) => l.includes("#region") && l.includes("⋯"));
            if (!regionFolded) {
                // Свернулся indentation-фолд (header — строка 5): провайдер ещё
                // не доехал — развернуть и повторить.
                await toggleFoldAt(5);
                await editor.waitForText((t) => t.includes("const sum"));
            }
        }
        await editor.capture("region-folded");

        // Unfold: the resting frame now provably has the provider region in the
        // model, which is what makes it the assertion — the `#region` header and
        // its body share an indent, and the code must survive intact.
        await toggleFoldAt(6);
        await editor.waitForText((t) => t.includes("const sum"));
        await editor.capture("rest");
    },
});
