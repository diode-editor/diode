import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `.gitignore` фикстуры: `generated/` и `*.log`. Проигнорированное в дереве видно (`explorer.excludeGitIgnore`
// у эталона `false`), но не ищется. Файлы фикстуры добавлены через `git add -f` — её же `.gitignore` их игнорирует.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "ignoreFiles");

export default defineScenario({
    name: "ignore-files",
    title: "search.useIgnoreFiles: .gitignore в Quick Open и поиске",
    open: [sampleDir],
    cols: 110,
    rows: 26,
    // Ctrl+Shift+F в key-DSL не выражается — команда на F6.
    userKeybindings: [{ key: "f6", command: "workbench.view.search" }],
    async run(editor) {
        await editor.waitForText(
            (t) => t.includes("EXPLORER") && t.includes("generated") && t.includes("server.log") && t.includes("src"),
        );
        await editor.capture("tree");

        await editor.sendKey("Ctrl+P");
        await editor.waitForText((t) => {
            const list = quickOpenText(t);
            return (
                list.includes("app.ts") &&
                list.includes(".gitignore") &&
                !list.includes("client.ts") &&
                !list.includes("server.log")
            );
        });
        await editor.capture("quick-open");
        await editor.sendKey("Escape");

        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("SEARCH"));
        for (const ch of "quietHarborLamp") {
            await editor.sendKey(ch);
        }
        await editor.waitForText((t) => t.includes("1 results in 1 file") && t.includes("app.ts"));
        await editor.capture("search");
    },
});

/** Правее левой рамки попапа и ниже заголовка: дерево слева на тех же строках показывает `server.log`. */
function quickOpenText(frame: string): string {
    const lines = frame.split("\n");
    const top = lines.findIndex((line) => line.includes("Go to File"));
    if (top === -1) return "";
    const left = lines[top].lastIndexOf("│", lines[top].indexOf("Go to File"));
    return lines
        .slice(top)
        .map((line) => line.slice(left))
        .join("\n");
}
