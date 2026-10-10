import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// explorer.compactFolders (дефолт true, как в эталоне): Java-раскладка
// `src/main/java/com/example` — цепочка папок с единственным ребёнком-каталогом
// — показывается в дереве одной строкой «src/main/java/com/example».
//
// Сжатие ленивое, как у эталона: цепочку узнают, когда раскрывают её голову.
// Здесь её раскрывает автоподсветка открытого файла (explorer.autoReveal) —
// reveal идёт сквозь компактную строку и выделяет файл под ней.

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
