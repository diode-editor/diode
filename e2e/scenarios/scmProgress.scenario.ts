import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Медленным `git commit` делает настоящий pre-commit-хук со `sleep` — наш код не подменяется ничем.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): { repoDir: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-scm-progress-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), 'export const greeting = "hi";\n');
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    writeFileSync(join(repoDir, "app.ts"), 'export const greeting = "hello";\n');
    git(repoDir, "add", "-A");

    const hook = join(repoDir, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nsleep 5\n");
    chmodSync(hook, 0o755);
    return { repoDir };
}

const { repoDir } = makeRepo();

export default defineScenario({
    name: "scm-progress",
    title: "Source Control: прогресс операции — спиннер в заголовке и в кнопке",
    open: [repoDir],
    cols: 100,
    rows: 26,
    // Нужен extension host — коммит исполняет git-расширение.
    skipOn: ["win32", "darwin"],
    userKeybindings: [
        { key: "alt+c", command: "workbench.view.scm" },
        { key: "alt+m", command: "workbench.scm.focus" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("app.ts"));
        await editor.sendKey("Alt+M");
        await editor.waitForText((t) => t.includes("Staged Changes"));
        await editor.sendText("feat: greet louder");
        await editor.waitForText((t) => t.includes("feat: greet louder"));
        await editor.capture("ready");

        await editor.sendKey("Alt+Enter");
        // Settling-ввод не шлём: пока тикает спиннер, кадр не «затихает».
        await editor.waitForText((t) => t.includes("Committing"));
        await editor.capture("committing");

        await editor.waitForText((t) => !t.includes("Committing") && !t.includes("Staged Changes"), {
            timeoutMs: 30_000,
        });
        await editor.capture("done");
    },
});
