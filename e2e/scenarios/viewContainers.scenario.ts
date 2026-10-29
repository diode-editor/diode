import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { explorerTitle } from "../helpers/explorerTitle.ts";

import { defineScenario } from "./framework.ts";

// Header frames in a row (<folder> → SEARCH → SOURCE CONTROL): the viewlet title must look the same — in merged it is
// drawn by PaneHeaderElement, in SCM by ViewContainerHeaderElement; both read `sideBarTitle.foreground`.
// A merged header is the single section's title (#898): Explorer reads the folder name, Source Control with GRAPH
// hidden reads CHANGES.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-views-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), 'export const greet = (n: string) => "hi " + n;\n');
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    writeFileSync(join(repoDir, "app.ts"), 'export const greet = (n: string) => "hello " + n;\n');
    return repoDir;
}

const repoDir = makeRepo();

export default defineScenario({
    name: "view-containers",
    title: "View containers: activity title, '⋯' and the section switcher",
    open: [repoDir],
    cols: 100,
    rows: 30,
    // SOURCE CONTROL sections are populated by the git extension — needs an extension host.
    skipOn: ["win32", "darwin"],
    userKeybindings: [{ key: "alt+c", command: "workbench.view.scm" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes(explorerTitle(repoDir)) && t.includes("app.ts"));
        await editor.capture("explorer-title");

        // No custom binding: Alt+<letter> would go to the menu mnemonic, while Ctrl+K F works on any terminal.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("f");
        await editor.waitForText((t) => t.includes("SEARCH"));
        await editor.capture("search-title");

        await editor.sendKey("Alt+C");
        await editor.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("CHANGES") && t.includes("GRAPH"));
        await editor.capture("container-and-sections");

        const header = await editor.waitForNode("#viewContainerHeader-scm");
        await editor.click(header.box.x + header.box.width - 2, header.box.y);
        await editor.waitForText((t) => t.includes("Views"));
        await editor.capture("container-menu");

        // Views is the first item and is selected on open.
        await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("CHANGES") && t.includes("GRAPH"));
        await editor.capture("views-submenu");

        // A single visible section makes the container merged: the header reads CHANGES, not SOURCE CONTROL.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("GRAPH") && !t.includes("SOURCE CONTROL") && t.includes("CHANGES"));
        await editor.capture("merged-after-hide");
    },
});
