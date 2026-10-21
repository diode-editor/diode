import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// The graph ports lazygit's pipe model; Reset to Commit is a deviation: VS Code does not have it.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * A branch and a merge — otherwise the graph degenerates into a straight line. Subjects are short: the 30-column
 * sidebar clips long ones.
 */
function makeRepo(): { repoDir: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-graph-demo-"));
    git(repoDir, "init", "-q", "-b", "main");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");

    const appFile = join(repoDir, "app.ts");
    writeFileSync(appFile, "export const version = 1;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "feat: старт");
    git(repoDir, "tag", "v1.0");

    git(repoDir, "checkout", "-q", "-b", "feature");
    writeFileSync(join(repoDir, "util.ts"), "export const twice = (n: number) => n * 2;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "feat: утилита");

    git(repoDir, "checkout", "-q", "main");
    writeFileSync(appFile, "export const version = 2;\n");
    git(repoDir, "commit", "-aqm", "fix: версия");

    git(repoDir, "merge", "-q", "--no-ff", "feature", "-m", "merge: ветка");

    // A commit on top of the merge: one lane versus two below — shows that the theme sticks to its point.
    writeFileSync(appFile, "export const version = 3;\n");
    git(repoDir, "commit", "-aqm", "chore: полировка");

    // An edit on disk keeps the Source Control section non-empty in the frame.
    writeFileSync(appFile, "export const version = 4;\n");
    return { repoDir };
}

const { repoDir } = makeRepo();

export default defineScenario({
    name: "scm-graph",
    title: "View GRAPH: граф коммитов с ветвлением, бейджи refs и команды на коммите",
    open: [repoDir],
    cols: 100,
    // The commit controls take 5 rows of the section — leave height to spare.
    rows: 30,
    // Needs the extension host — the git extension publishes the commits.
    skipOn: ["win32", "darwin"],
    userKeybindings: [{ key: "alt+c", command: "workbench.view.scm" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("app.ts"));

        // GRAPH opens collapsed — the extension runs no `git log` until it is expanded; status and log arrive
        // asynchronously.
        await editor.sendKey("Alt+C");
        await editor.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("GRAPH"));
        await editor.clickNode("#paneHeader-workbench-scm-graph", { dx: 3 });
        await editor.waitForText((t) => t.includes("merge: ветка") && t.includes("app.ts"));
        await editor.capture("sections");

        // Collapsing Source Control hides the commit controls too — app.ts is visible only there.
        await editor.clickNode("#paneHeader-workbench-scm-changes", { dx: 3 });
        await editor.waitForText((t) => !t.includes("app.ts") && t.includes("feat: старт") && t.includes("◎"));
        await editor.capture("graph");

        const header = await editor.waitForNode("#paneHeader-workbench-scm-graph");
        const rowX = header.box.x + 4;
        const rowY = header.box.y + 1;
        await editor.sendMouse({ action: "press", button: "right", x: rowX, y: rowY });
        await editor.sendMouse({ action: "release", button: "right", x: rowX, y: rowY });
        await editor.waitForText((t) => t.includes("Reset to Commit") && t.includes("Cherry Pick"));
        await editor.capture("commit-menu");
        await editor.sendKey("Escape");

        // "⋯" is the rightmost 3 columns of the header.
        await editor.clickNode("#paneHeader-workbench-scm-graph", { dx: header.box.width - 2 });
        await editor.waitForText((t) => t.includes("Load More"));
        await editor.capture("more-actions-menu");
        await editor.sendKey("Escape");

        // A collapsed GRAPH holds no rows: no layout and no `git log` until it is expanded.
        await editor.clickNode("#paneHeader-workbench-scm-graph", { dx: 3 });
        await editor.waitForText((t) => t.includes("GRAPH") && !t.includes("feat: старт") && !t.includes("◎"));
        await editor.capture("graph-collapsed");

        await editor.clickNode("#paneHeader-workbench-scm-graph", { dx: 3 });
        await editor.waitForText((t) => t.includes("feat: старт") && t.includes("◎"));
        await editor.capture("graph-restored");

        await editor.clickNode("#paneHeader-workbench-scm-changes", { dx: 3 });
        await editor.waitForText((t) => t.includes("app.ts") && t.includes("fix: версия"));
    },
});
