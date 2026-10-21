import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `deps-consumer` читает exports `test.deps-provider` в activate(): зависимость поднята раньше, хотя её событие
// не наступило. `deps-broken` зависит от неустановленного и не активируется — тост с причиной.

// Markdown без папки: иначе полосу делят сегменты SCM и спиннер tsserver, и раскладка плывёт.
const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-dependencies-demo");

export default defineScenario({
    name: "extension-dependencies",
    title: "Extension dependencies activate first; a missing one is reported",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText(
            (t) =>
                t.includes("Dep: Started") &&
                t.includes("Cannot activate the 'Deps Broken' extension") &&
                t.includes("'test.not-installed'") &&
                !t.includes("Broken: activated"),
            { timeoutMs: 20_000 },
        );
        await editor.capture("dependency-active-missing-reported");
    },
});
