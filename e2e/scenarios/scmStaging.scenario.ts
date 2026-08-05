import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import { defineScenario } from "./framework.ts";

// Стейджинг в Source Control (спека docs/TODO/SourceControl.md): группы
// ресурсов Staged/Changes/Untracked со счётчиками, commit input box над
// секциями, контекстное меню строки со Stage/Discard, стейдж из меню.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Репозиторий: staged-правка + modified + untracked — все три группы видны. */
function makeRepo(): { repoDir: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "vexx-scm-stage-demo-"));
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
    title: "Source Control: группы ресурсов, commit input box и staging из меню",
    open: [repoDir],
    cols: 100,
    rows: 26,
    // Нужен extension host — набор изменений публикует git-расширение.
    skipOn: ["win32", "darwin"],
    userKeybindings: [
        { key: "alt+c", command: "workbench.view.scm" },
        { key: "alt+m", command: "workbench.scm.focus" },
    ],
    async run(editor) {
        // Готовность: Explorer видит файлы, расширение считает git status.
        await editor.waitForText((t) => t.includes("app.ts") && t.includes("extra.ts"));

        // Source Control: input box над секциями, три группы со счётчиками.
        await editor.sendKey("Alt+C");
        await editor.waitForText(
            (t) => t.includes("Staged Changes") && t.includes("Changes") && t.includes("app.ts"),
        );
        await editor.capture("groups");

        // Черновик сообщения в commit input box.
        await editor.sendKey("Alt+M");
        await editor.waitForText((t) => t.includes("Message (Ctrl"));
        await editor.sendText("feat: greet louder");
        await editor.waitForText((t) => t.includes("feat: greet louder"));
        await editor.capture("commit-input");

        // Контекстное меню modified-строки: Open/Stage/Discard по группе.
        const row = await editor.waitForNode("#scmRow-worktree-app-ts");
        const x = row.box.x + 2;
        const y = row.box.y;
        await editor.sendMouse({ action: "press", button: "right", x, y });
        await editor.sendMouse({ action: "release", button: "right", x, y });
        await editor.waitForText((t) => t.includes("Stage Changes") && t.includes("Discard Changes"));
        await editor.capture("context-menu");

        // Стейдж из меню: клик по пункту «Stage Changes» (координаты — по тексту
        // кадра), строка мигрирует в Staged Changes.
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
