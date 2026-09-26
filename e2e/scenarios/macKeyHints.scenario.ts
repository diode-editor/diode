import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Подсказки с комбинациями в тексте UI строятся из действующего бинда, а не
// зашиты: на маке с Cmd плейсхолдер поля коммита — «Message (⌘Enter to commit)»
// (commit — `mod+enter`, как `CtrlCmd+Enter` в эталоне). На pc — прежний
// «Ctrl+Enter», его держит сценарий scm-staging.

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
    // Переключение на Source Control — user-кейбиндом, без палитры.
    userKeybindings: [{ key: "f6", command: "workbench.view.scm" }],
    cols: 100,
    rows: 24,
    // Изменения публикует git-расширение в extension host — как у scm-staging.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("mac-cmd"));
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("Message (⌘Enter to commit)") && t.includes("app.ts"));
        await editor.capture("commit-placeholder");
    },
});
