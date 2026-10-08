import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `extensionDependencies`. Три фикстурных расширения в user-data:
// - `deps-consumer` объявляет зависимость `test.deps-provider` и в activate()
//   читает её exports — в статус-баре «Dep: Started», если зависимость
//   поднялась раньше него, хотя её собственное событие так и не наступило;
// - `deps-broken` зависит от неустановленного `test.not-installed` — он не
//   активируется вовсе, а человек видит тост с причиной (как в VS Code).

// Markdown и без папки-воркспейса — как в status-bar-сценариях: иначе полосу
// делят сегменты SCM и спиннер tsserver, и её раскладка плывёт.
const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-dependencies-demo");

export default defineScenario({
    name: "extension-dependencies",
    title: "Extension dependencies activate first; a missing one is reported",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText(
            (t) =>
                t.includes("Dep: Started") &&
                t.includes("Cannot activate the 'Deps Broken' extension") &&
                t.includes("'test.not-installed'") &&
                // Сломанное расширение так и не поднялось: его пункта в статус-баре нет.
                !t.includes("Broken: activated"),
            { timeoutMs: 20_000 },
        );
        await editor.capture("dependency-active-missing-reported");
    },
});
