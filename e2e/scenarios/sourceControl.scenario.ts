import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OPEN_FILE_BUTTON_WIDTH } from "../../src/vs/workbench/contrib/scm/browser/scmChangeRows.ts";

import { defineScenario } from "./framework.ts";

// Changes are made ON DISK: the list comes from `git status`, which sees only saved content.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): { repoDir: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-scm-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    // The name sorts before extra.ts so the modified (diffable) file is the
    // first row of the list — that is the one the diff opens on.
    const trackedFile = join(repoDir, "app.ts");
    writeFileSync(trackedFile, ["export function greet(name: string) {", '    return "hi " + name;', "}", ""].join("\n"));
    // A nested file for the tree-mode frame (the compact src/util chain as one node).
    const nestedFile = join(repoDir, "src", "util", "format.ts");
    execFileSync("mkdir", ["-p", join(nestedFile, "..")]);
    writeFileSync(nestedFile, "export const pad = (s: string) => s.padEnd(8);\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    writeFileSync(trackedFile, ["export function greet(name: string) {", '    return "hello " + name;', "}", ""].join("\n"));
    writeFileSync(nestedFile, "export const pad = (s: string) => s.padEnd(12);\n");
    writeFileSync(join(repoDir, "extra.ts"), "export const answer = 42;\n");
    return { repoDir };
}

const { repoDir } = makeRepo();

export default defineScenario({
    name: "source-control",
    title: "Source Control in the sidebar: change list and diff on click",
    open: [repoDir],
    cols: 100,
    // The top 4 rows of the section are the commit controls; the height must fit both groups as well.
    rows: 30,
    // Needs the extension host — the git extension publishes the change set.
    skipOn: ["win32", "darwin"],
    // Letters avoid mnemonics: F/E/S/V/G/H belong to the menu bar.
    userKeybindings: [
        { key: "alt+c", command: "workbench.view.scm" },
        { key: "alt+t", command: "scm.action.viewAsTree" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("app.ts") && t.includes("extra.ts"));

        await editor.sendKey("Alt+C");
        await editor.waitForText(
            (t) => t.includes("SOURCE CONTROL") && t.includes("app.ts") && t.includes("extra.ts"),
        );
        const list = await editor.waitForNode("#changesView");
        await editor.capture("changes");

        // Shift+F10 goes through the engine's single contextmenu event; the list cursor is on the "Changes" header.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Shift+F10");
        await editor.waitForText((t) => t.includes("Open File") && t.includes("Open Changes"));
        await editor.capture("context-menu");
        await editor.sendKey("Escape");

        // Double click: a single click in the tree only selects. 4 events in a row without settling — within the
        // double-click window (300 ms).
        const x = list.box.x + 2;
        const y = list.box.y + 1; // the first row is the "Changes" group header
        await editor.sendMouse({ action: "press", button: "left", x, y });
        await editor.sendMouse({ action: "release", button: "left", x, y });
        await editor.sendMouse({ action: "press", button: "left", x, y });
        await editor.sendMouse({ action: "release", button: "left", x, y });
        await editor.waitForText((t) => t.includes("(Working Tree)"));
        await editor.capture("diff");

        await editor.sendKey("Alt+T");
        await editor.waitForText((t) => t.includes("src/util") && !t.includes("src/util/format.ts"));
        await editor.capture("changes-tree");

        // The tree has Changes, src/util, format.ts, app.ts — app.ts is the fourth row.
        const rows = await editor.waitForNode("#changesList");
        const menuX = rows.box.x + 2;
        const menuY = rows.box.y + 3;
        await editor.sendMouse({ action: "press", button: "right", x: menuX, y: menuY });
        await editor.sendMouse({ action: "release", button: "right", x: menuX, y: menuY });
        await editor.waitForText((t) => t.includes("Open File") && t.includes("Open Changes"));
        await editor.capture("context-menu");
        await editor.sendKey("Escape");

        // The inline button appears only under the pointer — hover first. extra.ts is the fifth tree row
        // (untracked files go in the same group).
        const buttonRowY = rows.box.y + 4;
        await editor.sendMouse({ action: "move", button: "none", x: rows.box.x, y: buttonRowY });
        await editor.capture("open-file-button");

        const buttonX = rows.box.x + rows.box.width - 1 - OPEN_FILE_BUTTON_WIDTH;
        await editor.sendMouse({ action: "press", button: "left", x: buttonX, y: buttonRowY });
        await editor.sendMouse({ action: "release", button: "left", x: buttonX, y: buttonRowY });
        await editor.waitForText((t) => t.includes("export const answer = 42;"));
        await editor.capture("open-file");
    },
});
