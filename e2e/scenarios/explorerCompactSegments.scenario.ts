import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Compact row segments mirror upstream `CompressedNavigationController`. The fixture is copied to a temp directory:
// the scenario writes to disk.

const workspace = mkdtempSync(join(tmpdir(), "diode-compact-segments-demo-"));
cpSync(resolve(repoRoot, "e2e", "fixtures", "compactFolders"), workspace, { recursive: true });

// Tree row " ⌄ src/main/java/com/example": indent 1, chevron, space, then the
// label from column 3: src 3–5, main 7–10, java 12–15, com 17–19.
const JAVA_COLUMN = 13;
const MAIN_COLUMN = 8;

export default defineScenario({
    name: "explorer-compact-segments",
    title: "explorer.compactFolders: сегменты компактной строки — выбор и действия в папку сегмента",
    open: [workspace],
    cols: 100,
    rows: 20,
    async run(editor) {
        await editor.waitForText((t) => t.includes("src") && t.includes("README.md"));
        await editor.clickNode("TreeViewElement", { dx: 4, dy: 0 });
        await editor.waitForText((t) => t.includes("src/main/java/com/example") && t.includes("App.java"));
        await editor.capture("last-segment");

        await editor.sendKey("ArrowLeft");
        await editor.capture("left-to-com");

        // As upstream, clicking a segment also toggles the whole row; a second click expands it back.
        await editor.clickNode("TreeViewElement", { dx: MAIN_COLUMN, dy: 0 });
        await editor.waitForText((t) => t.includes("src/main/java/com/example") && !t.includes("App.java"));
        await editor.capture("click-main");
        await editor.clickNode("TreeViewElement", { dx: MAIN_COLUMN, dy: 0 });
        await editor.waitForText((t) => t.includes("App.java"));

        const tree = await editor.waitForNode("TreeViewElement");
        const x = tree.box.x + JAVA_COLUMN;
        await editor.sendMouse({ action: "press", button: "right", x, y: tree.box.y });
        await editor.sendMouse({ action: "release", button: "right", x, y: tree.box.y });
        await editor.waitForText((t) => t.includes("New File..."));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Enter file name"));
        await editor.sendText("Probe.java");
        await editor.waitForText((t) => t.includes("Probe.java"));
        await editor.sendKey("Enter");
        // The "com" tail stays collapsed, as upstream: a new compressed row doesn't inherit the head's state.
        await editor.waitForText(
            (t) => t.includes("src/main/java") && !t.includes("src/main/java/com") && t.includes("Probe.java"),
        );
        if (!existsSync(join(workspace, "src", "main", "java", "Probe.java"))) {
            throw new Error("New File… на сегменте «java» создал файл не в src/main/java");
        }
        await editor.capture("new-file-in-segment");
    },
});
