import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { npmMissing } from "../helpers/npmProject.ts";
import {
    TAILWIND_EMPTY_CLASS_COLUMN,
    TAILWIND_P4_COLUMN,
    writeTailwindProject,
} from "../helpers/tailwindFixture.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Stock Tailwind CSS IntelliSense from the marketplace on a v4 project: a conflict squiggle, completion with
// color squares, CSS on hover, the quick fix menu and the "Generates N classes" lens in the CSS file.

const projectRoot = join(tmpdir(), "diode-scenario-tailwind");

export default defineScenario({
    name: "tailwind",
    title: "Tailwind CSS IntelliSense from the marketplace: completion, hover, conflicts, lens",
    open: [projectRoot, join(projectRoot, "index.html")],
    installVsix: ["bradlc.vscode-tailwindcss"],
    network: true,
    cols: 120,
    rows: 24,
    // Extension host scenarios run a subprocess: Linux only.
    skipOn: ["win32", "darwin"],
    requires: npmMissing,
    prepare() {
        rmSync(projectRoot, { recursive: true, force: true });
        writeTailwindProject(projectRoot);
        return Promise.resolve();
    },
    async run(editor) {
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
            { describe: "undercurl of the p-4/p-6 conflict", timeoutMs: 60_000, intervalMs: 500 },
        );
        await editor.capture("conflict");

        await editor.sendKey("ArrowDown");
        for (let i = 0; i < TAILWIND_EMPTY_CLASS_COLUMN; i++) await editor.sendKey("ArrowRight");
        for (const char of "bg-sky-") await editor.sendKey(char);
        await editor.waitForText((t) => t.includes("bg-sky-500"), { timeoutMs: 20_000 });
        await editor.capture("completion");
        await editor.sendKey("Escape");

        await editor.sendKey("Ctrl+Home");
        for (let i = 0; i < TAILWIND_P4_COLUMN; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Show Hover");
        await editor.waitForText((t) => t.includes("Show Hover"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("calc(var(--spacing) * 4)"), { timeoutMs: 20_000 });
        await editor.capture("hover");
        await editor.sendKey("Escape");

        await editor.sendKey("Ctrl+.");
        await editor.waitForText((t) => t.includes("Delete 'p-6'"), { timeoutMs: 20_000 });
        await editor.capture("quick-fix");
        await editor.sendKey("Escape");

        await editor.sendKey("Ctrl+p");
        await editor.waitForNode("#quickInput");
        await editor.sendText("app.css");
        await editor.waitForText((t) => t.includes("app.css"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Generates 11 classes"), { timeoutMs: 30_000 });
        await editor.capture("lens");
    },
});
