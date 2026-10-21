import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `deps-consumer` reads the exports of `test.deps-provider` in activate(): the dependency is activated first even
// though its own activation event has not fired. `deps-broken` depends on a missing extension and does not
// activate; a toast gives the reason.

// Markdown without a folder: otherwise SCM segments and the tsserver spinner share the status bar and layout shifts.
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
