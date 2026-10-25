import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";


function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** app.ts is edited, staged and edited again: one file in both Staged Changes and Changes (MM). */
function makeRepo(): { repoDir: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-scm-open-changes-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), 'export const greeting = "hi";\nexport const target = "world";\n');
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    writeFileSync(join(repoDir, "app.ts"), 'export const greeting = "hello";\nexport const target = "world";\n');
    git(repoDir, "add", "app.ts");
    writeFileSync(join(repoDir, "app.ts"), 'export const greeting = "hello";\nexport const target = "diode";\n');
    return { repoDir };
}

const { repoDir } = makeRepo();

export default defineScenario({
    name: "scm-open-changes",
    title: "Source Control: Open Changes shows the change of the row's group — index ↔ working tree, HEAD ↔ index",
    open: [repoDir],
    cols: 100,
    rows: 26,
    // Needs the extension host — the git extension publishes the change set and reads the index.
    skipOn: ["win32", "darwin"],
    userKeybindings: [{ key: "alt+c", command: "workbench.view.scm" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("app.ts"));

        await editor.sendKey("Alt+C");
        await editor.waitForText((t) => t.includes("Staged Changes") && t.includes("Changes"));
        await editor.waitForNode("#scmRow-index-app-ts");
        await editor.waitForNode("#scmRow-worktree-app-ts");
        await editor.capture("groups");

        // Changes: only the second edit (`world` → `diode`), the staged `hello` is on both sides.
        let row = await editor.waitForNode("#scmRow-worktree-app-ts");
        await editor.sendMouse({ action: "press", button: "left", x: row.box.x + 2, y: row.box.y });
        await editor.sendMouse({ action: "release", button: "left", x: row.box.x + 2, y: row.box.y });
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("app.ts (Working Tree)") && t.includes('"diode"'));
        await editor.capture("working-tree");

        // Staged Changes: only the first edit (`hi` → `hello`), the working tree `diode` is not there.
        row = await editor.waitForNode("#scmRow-index-app-ts");
        await editor.sendMouse({ action: "press", button: "left", x: row.box.x + 2, y: row.box.y });
        await editor.sendMouse({ action: "release", button: "left", x: row.box.x + 2, y: row.box.y });
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("app.ts (Index)") && t.includes('"hi"'));
        await editor.capture("index");
    },
});
