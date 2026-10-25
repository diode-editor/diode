import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario } from "./framework.ts";

// Matchers contributed by extensions: `$tsc` of diode-lsp-typescript turns a real `tsc --noEmit` into Problems for a
// closed file, `$nvcc` of builtin cpp — a line in nvcc's format. Neither is in the core registry.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-tsc-matcher-"));
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

const TASKS_JSON = {
    version: "2.0.0",
    tasks: [
        {
            label: "typecheck",
            type: "shell",
            command: `"${process.execPath}" "${tsc}" --noEmit -p .`,
            presentation: { reveal: "never" },
            problemMatcher: "$tsc",
        },
        {
            label: "nvcc",
            type: "shell",
            command: "cat nvcc.log",
            presentation: { reveal: "never" },
            problemMatcher: "$nvcc",
        },
    ],
};

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

async function runTask(editor: ScenarioDriver, label: string): Promise<void> {
    await runCommand(editor, "Tasks: Run Task");
    await editor.waitForText((t) => t.includes("Select the task to run"));
    await editor.sendText(label);
    await editor.waitForText((t) => t.includes(label));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "tsc-problem-matcher-task",
    title: "Extension problem matchers: `tsc --noEmit` with $tsc and a $nvcc task put their errors into Problems",
    open: [sampleDir],
    cols: 120,
    rows: 30,
    // The task is a real shell in a PTY.
    skipOn: ["win32"],
    async prepare() {
        mkdirSync(join(sampleDir, ".diode"), { recursive: true });
        mkdirSync(join(sampleDir, "src"), { recursive: true });
        writeFileSync(join(sampleDir, ".diode", "tasks.json"), JSON.stringify(TASKS_JSON, undefined, 4));
        writeFileSync(
            join(sampleDir, "tsconfig.json"),
            JSON.stringify({ compilerOptions: { strict: true, pretty: false }, include: ["src"] }),
        );
        writeFileSync(join(sampleDir, "src", "a.ts"), 'export const n: number = "one";\n');
        writeFileSync(join(sampleDir, "nvcc.log"), 'kernel.cu(12): error: identifier "y" is undefined\n');
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("tsconfig.json"));

        await runTask(editor, "typecheck");
        await runCommand(editor, "View: Toggle Problems (Errors, Warnings, Infos)");
        await editor.waitForText(
            (t) => t.includes("a.ts") && t.includes("Type 'string' is not assignable to type 'number'."),
            { timeoutMs: 30_000 },
        );
        await editor.capture("tsc-problems");

        await runTask(editor, "nvcc");
        await editor.waitForText((t) => t.includes("kernel.cu") && t.includes('identifier "y" is undefined'));
        await editor.capture("nvcc-problems");
    },
});
