import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * A 400-line file with a 60-line block added in the middle, two single changed lines and a word
 * to search for: the scrollbar marks get a solid bar, thin marks and density glyphs.
 */
function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-scrollbar-markers-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i} plain text`);
    // The cursor starts on a line without words: no occurrence marks drown the frame.
    lines[0] = "# --";
    writeFileSync(join(repoDir, "notes.txt"), `${lines.join("\n")}\n`);
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    lines[20] = "line 20 changed needle";
    lines[320] = "line 320 changed needle";
    lines.splice(150, 0, ...Array.from({ length: 60 }, (_, i) => `added ${i}`));
    lines[100] = "line 100 needle";
    writeFileSync(join(repoDir, "notes.txt"), `${lines.join("\n")}\n`);
    return repoDir;
}

const repoDir = makeRepo();

export default defineScenario({
    name: "scrollbar-markers",
    title: "Scrollbar marks: SCM changes and find matches, in a column of their own or inside the bar",
    open: [repoDir, join(repoDir, "notes.txt")],
    cols: 140,
    rows: 36,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        // The gutter bar of the changed line 20 says the SCM decorations have arrived.
        await editor.waitForText((t) => t.includes("┋"));
        await editor.capture("wide-scm");

        await editor.sendKey("Ctrl+F");
        await editor.sendText("needle");
        await editor.waitForText((t) => t.includes("of 3"));
        await editor.capture("wide-find");

        // Under 80 editor columns `auto` moves the marks inside the bar, the thumb in whole cells.
        await editor.resize(80, 36);
        await editor.waitForText((t) => t.includes("# --") && t.split("\n").every((line) => line.length <= 80));
        await editor.capture("narrow-find");
    },
});
