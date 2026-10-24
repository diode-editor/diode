import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario } from "./framework.ts";

// Problem matchers of tasks.json tasks: the output of `compile` ($msCompile) and `lint` (an inline multi-line matcher
// with `loop`) becomes Problems and squiggles; after the "fix" a rerun clears what the output no longer mentions;
// `revealProblems: onProblem` opens Problems by itself.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-problem-matcher-"));
const mainFile = join(sampleDir, "main.c");
const buildLog = join(sampleDir, "build.log");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

const TASKS_JSON = {
    version: "2.0.0",
    tasks: [
        // The terminal stays hidden: the frame shows only what became Problems.
        {
            label: "compile",
            type: "shell",
            command: "cat build.log",
            presentation: { reveal: "never" },
            problemMatcher: "$msCompile",
        },
        {
            label: "lint",
            type: "shell",
            command: "cat lint.log",
            presentation: { reveal: "never", revealProblems: "onProblem" },
            problemMatcher: {
                owner: "mylint",
                source: "mylint",
                fileLocation: ["relative", "${workspaceFolder}"],
                pattern: [
                    { regexp: "^FILE (.*)$", file: 1 },
                    {
                        regexp: "^\\s+(\\d+):(\\d+) (error|warning) (.*)$",
                        line: 1,
                        column: 2,
                        severity: 3,
                        message: 4,
                        loop: true,
                    },
                ],
            },
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
    name: "problem-matcher-task",
    title: "Task problem matchers: task output in Problems and squiggles, a rerun clears what was fixed",
    open: [sampleDir, mainFile],
    cols: 120,
    rows: 32,
    // The task is a real shell in a PTY.
    skipOn: ["win32"],
    async prepare() {
        mkdirSync(join(sampleDir, ".diode"), { recursive: true });
        writeFileSync(join(sampleDir, ".diode", "tasks.json"), JSON.stringify(TASKS_JSON, undefined, 4));
        writeFileSync(mainFile, "int main(void) {\n    count = 1;\n    return 0;\n}\n");
        writeFileSync(join(sampleDir, "util.c"), '#include <string.h>\nvoid copy(char *d) { strcpy(d, "x"); }\n');
        writeFileSync(
            buildLog,
            `${mainFile}(2,5): error C2065: 'count': undeclared identifier\n` +
                `${join(sampleDir, "util.c")}(2,22): warning C4996: 'strcpy': This function may be unsafe.\n`,
        );
        writeFileSync(
            join(sampleDir, "lint.log"),
            "FILE util.c\n  1:1 warning Prefer <cstring>\n  2:6 error Missing documentation for 'copy'\n",
        );
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("count = 1;"));

        await runTask(editor, "compile");
        // The error on the open file is a squiggle.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle from the task's problem", timeoutMs: 10_000, intervalMs: 200 },
        );
        await runCommand(editor, "View: Toggle Problems (Errors, Warnings, Infos)");
        await editor.waitForText(
            (t) => t.includes("'count': undeclared identifier") && t.includes("'strcpy': This function may be unsafe."),
        );
        await editor.capture("compile-problems");

        // "Fix" main.c: the build no longer reports it, and the rerun takes its problem away.
        writeFileSync(
            buildLog,
            `${join(sampleDir, "util.c")}(2,22): warning C4996: 'strcpy': This function may be unsafe.\n`,
        );
        await runCommand(editor, "Tasks: Rerun Last Task");
        await editor.waitForText(
            (t) =>
                !t.includes("'count': undeclared identifier") && t.includes("'strcpy': This function may be unsafe."),
        );
        await editor.capture("rerun-cleared");

        // Hide Problems: `lint` opens it by itself once it finds something.
        await runCommand(editor, "View: Toggle Problems (Errors, Warnings, Infos)");
        await editor.waitForText((t) => !t.includes("'strcpy': This function may be unsafe."));
        await runTask(editor, "lint");
        await editor.waitForText(
            (t) => t.includes("Missing documentation for 'copy'") && t.includes("Prefer <cstring>"),
        );
        await editor.capture("lint-reveals-problems");
    },
});
