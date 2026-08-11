import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Дифф v2 (docs/TODO/DiffEditable.md, PR-3): вкладка из двух НАСТОЯЩИХ
// редакторов — зоны-филлеры выравнивают стороны, unchanged свёрнут обычным
// фолдингом с парной плашкой, маркеры -/+ в гуттерах, intra-line декорациями.
// Разворот плашки шевроном раскрывает кусок на обеих сторонах.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): { repoDir: string; trackedFile: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "vexx-diffv2-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    const trackedFile = join(repoDir, "greeting.ts");
    const body = Array.from({ length: 14 }, (_, i) => `const value${String(i)} = ${String(i)};`);
    writeFileSync(
        trackedFile,
        [...body, "export function greet(name: string) {", '    return "hi " + name;', "}", ""].join("\n"),
    );
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    return { repoDir, trackedFile };
}

const { repoDir, trackedFile } = makeRepo();

export default defineScenario({
    name: "diff-v2",
    title: "Дифф v2: два настоящих редактора с зонами и свёрткой",
    open: [repoDir, trackedFile],
    cols: 132,
    rows: 22,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greet"));

        // Правка без сохранения: замена строки и добавление новой.
        await editor.sendKey("Ctrl+End");
        await editor.sendKey("ArrowUp");
        await editor.sendKey("ArrowUp");
        await editor.sendKey("End");
        await editor.sendText(" // changed");
        await editor.sendKey("Ctrl+End");
        await editor.sendText("export const VERSION = 2;");
        await editor.waitForText((t) => t.includes("VERSION"));

        await editor.sendKey("Ctrl+P");
        await editor.sendText(">Compare Active File with HEAD (v2)");
        await editor.waitForText((t) => t.includes("(v2)"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("↔ HEAD"));
        await editor.capture("diff");

        // Раскрытие свёрнутого куска: Ctrl+K Ctrl+0?? Нет — разворот кликом
        // недоступен в сценарном DSL по координатам стабильно; раскроем через
        // команду фолдинга активной стороны (unfoldAll).
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+J");
        await editor.waitForText((t) => !t.includes("unchanged lines"));
        await editor.capture("unfolded");
    },
});
