import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// `diode -d <a> <b>` — открыть сравнение двух файлов прямо с командной строки
// (вход для `git difftool` и скриптов). Папка при этом НЕ открывается: окно
// поднимается одной дифф-вкладкой, как у `code -d`.

function makeFiles(): { left: string; right: string } {
    const dir = mkdtempSync(join(tmpdir(), "diode-diff-arg-"));
    const base = ["export function greet(name: string) {", '    return "hi " + name;', "}", ""];
    const left = join(dir, "greeting.ts");
    const right = join(dir, "greeting.v2.ts");
    writeFileSync(left, base.join("\n"));
    writeFileSync(right, base.join("\n").replace('"hi " + name', '"hello, " + name + "!"'));
    return { left, right };
}

const { left, right } = makeFiles();

export default defineScenario({
    name: "diff-arg",
    title: "CLI -d <a> <b> — дифф-вкладка сразу на старте",
    extraArgs: ["-d"],
    open: [left, right],
    cols: 132,
    rows: 20,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting.ts ↔ greeting.v2.ts"));
        // Сторон диффа две, а воркспейса нет — сайдбар держит welcome Explorer'а.
        await editor.waitForText((t) => t.includes("You have not yet opened a"));
        await editor.capture("diff");
    },
});
