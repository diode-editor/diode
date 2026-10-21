import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Compression is lazy, as upstream: revealing the open file (explorer.autoReveal) expands the chain.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "compactFolders");
const appFile = resolve(sampleDir, "src", "main", "java", "com", "example", "App.java");

export default defineScenario({
    name: "explorer-compact-folders",
    title: "explorer.compactFolders: цепочка единственных папок — одной строкой",
    open: [sampleDir, appFile],
    cols: 110,
    rows: 20,
    async run(editor) {
        await editor.waitForText(
            (t) =>
                t.includes("src/main/java/com/example") &&
                t.includes("App.java") &&
                t.includes("Util.java") &&
                t.includes("README.md"),
        );
        await editor.capture("compact-row");
    },
});
