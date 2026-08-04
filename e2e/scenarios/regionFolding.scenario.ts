import { resolve } from "node:path";

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
        // frame taken right away can still be indentation-only, and the demo
        // would silently document nothing. A fold that starts on the `#region`
        // marker line is something indentation folding can never produce, so it
        // doubles as proof that the provider's ranges have landed.
        // Ctrl+K Ctrl+L: both keys are Ctrl+letter, which the headless key DSL can
        // serialize (Ctrl+Shift+[ cannot).
        for (let i = 0; i < 5; i++) await editor.sendKey("ArrowDown");
        // Диапазоны провайдера долетают асинхронно, и на медленной машине (CI)
        // аккорд может прийти раньше них: курсор стоит на строке маркера, где
        // indentation-фолд невозможен, — аккорд no-op. Ретраим до появления
        // свёртки: «const sum скрыт» и есть доказательство, что диапазоны
        // провайдера долетели. Раньше гонку прятала стоимость кадров ввода
        // (2–3 полных кадра на каждое нажатие давали ext-host фору).
        let folded = false;
        for (let attempt = 0; attempt < 10 && !folded; attempt++) {
            await editor.sendKey("Ctrl+K");
            await editor.sendKey("Ctrl+L");
            try {
                await editor.waitForText((t) => !t.includes("const sum"), { timeoutMs: 1000 });
                folded = true;
            } catch {
                // диапазонов ещё нет — следующая попытка
            }
        }
        await editor.waitForText((t) => !t.includes("const sum"));
        await editor.capture("region-folded");

        // Unfold: the resting frame now provably has the provider region in the
        // model, which is what makes it the assertion — the `#region` header and
        // its body share an indent, and the code must survive intact.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+L");
        await editor.waitForText((t) => t.includes("const sum"));
        await editor.capture("rest");
    },
});
