import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Подсказка в плейсхолдере строится из действующего бинда: на маке — «⌘Enter», pc-вариант держит scm-staging.

function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-mac-hints-"));
    const git = (...args: string[]): void => {
        execFileSync("git", args, { cwd: repoDir, stdio: "ignore" });
    };
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), "export const answer = 42;\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    writeFileSync(join(repoDir, "app.ts"), "export const answer = 43;\n");
    return repoDir;
}

export default defineScenario({
    name: "mac-key-hints",
    title: "Мак: подсказка ⌘Enter в поле коммита — из бинда, а не литералом",
    open: [makeRepo()],
    settings: {
        "keyboard.platform": "mac",
        "terminal.capabilities": { "extended-keys": true, super: true },
    },
    userKeybindings: [{ key: "f6", command: "workbench.view.scm" }],
    cols: 100,
    rows: 24,
    // Нужен extension host: изменения публикует git-расширение.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("mac-cmd"));
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("Message (⌘Enter to commit)") && t.includes("app.ts"));
        await editor.capture("commit-placeholder");
    },
});
