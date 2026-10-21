import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import { defineScenario } from "./framework.ts";


function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Repository with a staged change + modified + untracked — all three groups are visible. */
function makeRepo(): { repoDir: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-scm-stage-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), 'export const greeting = "hi";\n');
    writeFileSync(join(repoDir, "staged.ts"), "export const staged = 1;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    writeFileSync(join(repoDir, "staged.ts"), "export const staged = 2;\n");
    git(repoDir, "add", "staged.ts");
    writeFileSync(join(repoDir, "app.ts"), 'export const greeting = "hello";\n');
    writeFileSync(join(repoDir, "extra.ts"), "export const answer = 42;\n");
    return { repoDir };
}

const { repoDir } = makeRepo();

export default defineScenario({
    name: "scm-staging",
    title: "Source Control: resource groups, commit input box and staging from the menu",
    open: [repoDir],
    cols: 100,
    rows: 26,
    // Needs the extension host — the git extension publishes the change set.
    skipOn: ["win32", "darwin"],
    userKeybindings: [
        { key: "alt+c", command: "workbench.view.scm" },
        { key: "alt+m", command: "workbench.scm.focus" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("app.ts") && t.includes("extra.ts"));

        await editor.sendKey("Alt+C");
        await editor.waitForText(
            (t) => t.includes("Staged Changes") && t.includes("Changes") && t.includes("app.ts"),
        );
        await editor.capture("groups");

        await editor.sendKey("Alt+M");
        // e2e is pinned to tier=legacy, where Ctrl+Enter is just Enter: the hint names the reachable Alt+Enter (see
        // mac-key-hints).
        await editor.waitForText((t) => t.includes("Message (Alt+Enter"));
        await editor.sendText("feat: greet louder");
        await editor.waitForText((t) => t.includes("feat: greet louder"));
        await editor.capture("commit-input");

        const row = await editor.waitForNode("#scmRow-worktree-app-ts");
        const x = row.box.x + 2;
        const y = row.box.y;
        await editor.sendMouse({ action: "press", button: "right", x, y });
        await editor.sendMouse({ action: "release", button: "right", x, y });
        await editor.waitForText((t) => t.includes("Stage Changes") && t.includes("Discard Changes"));
        await editor.capture("context-menu");

        // The "Stage Changes" item coordinates come from the frame text.
        const menuFrame = frameToText(await editor.captureFrame());
        const menuLines = menuFrame.split("\n");
        const menuY = menuLines.findIndex((l) => l.includes("Stage Changes"));
        const menuX = menuLines[menuY].indexOf("Stage Changes") + 1;
        await editor.sendMouse({ action: "press", button: "left", x: menuX, y: menuY });
        await editor.sendMouse({ action: "release", button: "left", x: menuX, y: menuY });
        await editor.waitForNode("#scmRow-index-app-ts");
        await editor.capture("staged");
    },
});
