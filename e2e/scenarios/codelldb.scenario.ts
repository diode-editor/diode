import { spawnSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Stock CodeLLDB from the marketplace debugs a C program built by `gcc -g`: the first activation fetches the platform
// package from GitHub, F9 on the loop's line, F5 runs the build task and stops there with VARIABLES and CALL STACK
// filled, F10 steps, Continue comes back to the next iteration, the Debug Console evaluates an expression, CodeLLDB's
// Modules view sits in Run and Debug, Shift+F5 stops.

const projectRoot = join(tmpdir(), "diode-scenario-codelldb");

function gccMissing(): string | undefined {
    const found = spawnSync("gcc", ["--version"], { stdio: "ignore" });
    return found.status === 0 ? undefined : "gcc not found in PATH: the debuggee cannot be built";
}

export default defineScenario({
    name: "codelldb",
    title: "CodeLLDB from the marketplace: F9, F5 with the build task, stepping, Continue, Debug Console, Stop",
    open: [projectRoot, join(projectRoot, "hello.c")],
    installVsix: ["vadimcn.vscode-lldb"],
    network: true,
    cols: 140,
    // Tall enough for VARIABLES to show `sum` and `i` under the six locals before them: the framed sidebar spends
    // a line under every expanded section's header and one above every next header.
    rows: 76,
    // Extension host scenarios run a subprocess; CodeLLDB's platform package is fetched for the host: Linux only.
    skipOn: ["win32", "darwin"],
    requires: gccMissing,
    // The glyphs as plain characters the frame text shows.
    settings: { "diode.icons.nerdFont": "off" },
    timeoutMs: 420_000,
    prepare() {
        rmSync(projectRoot, { recursive: true, force: true });
        cpSync(join(repoRoot, "e2e", "fixtures", "codelldbSample"), projectRoot, { recursive: true });
        return Promise.resolve();
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("sum += numbers[i];"));
        await editor.waitForReady();
        // `onStartupFinished`: the platform package is downloaded and installed before the debugger can start.
        await editor.waitForText((t) => !t.includes("Acquiring CodeLLDB platform package"), { timeoutMs: 180_000 });

        // `sum += numbers[i];` is line 23.
        for (let i = 0; i < 22; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("F9");
        await editor.waitForText((t) => t.includes("● 23"));

        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("◉ 23") && t.includes("sum: 0") && t.includes("main  hello.c:23"), {
            timeoutMs: 180_000,
        });
        await editor.waitForText((t) => t.includes("MODULES") && t.includes("hello"));
        await editor.capture("stopped-on-breakpoint");

        await editor.sendKey("F10");
        await editor.waitForText((t) => t.includes("main  hello.c:24") && t.includes("sum: 10"), { timeoutMs: 30_000 });
        await editor.capture("stepped-over");

        // Continue: the next iteration stops on the breakpoint again.
        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("◉ 23") && t.includes("i: 1"), { timeoutMs: 30_000 });

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Debug: Focus on Debug Console View");
        await editor.waitForText((t) => t.includes("Focus on Debug Console View"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Console is in 'commands' mode"));
        await editor.sendText("?sum * 3");
        await editor.sendKey("Enter");
        // The result alone on its console row, between the panel's frame lines.
        await editor.waitForText((t) => /│\s*30\s*│\s*$/m.test(t), { timeoutMs: 30_000 });
        await editor.capture("debug-console");

        await editor.sendKey("Shift+F5");
        await editor.waitForText((t) => t.includes("● 23") && !t.includes("◉ 23"), { timeoutMs: 30_000 });
    },
});
