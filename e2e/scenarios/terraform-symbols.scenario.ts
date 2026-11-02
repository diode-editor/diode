import { resolve } from "node:path";

import { StyleFlags } from "@tuidom/core/common/styleFlags";

import { findTextCell } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// terraform-ls links only the label of a `provider` block. The run has no graphical session, so the link ends in the
// toast with the link copied.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "tfSample");
const mainFile = resolve(sampleDir, "main.tf");

export default defineScenario({
    name: "terraform-symbols",
    title: "Terraform from the marketplace: registry link, Go to Symbol in Editor, Go to Declaration, a menu without what the server lacks",
    open: [sampleDir, mainFile],
    installVsix: ["hashicorp.terraform"],
    network: true,
    env: { DISPLAY: "", WAYLAND_DISPLAY: "" },
    userKeybindings: [
        { key: "ctrl+alt+o", command: "editor.action.openLink" },
        { key: "ctrl+alt+d", command: "editor.action.revealDeclaration" },
    ],
    cols: 100,
    rows: 30,
    // Extension host scenarios run a subprocess + a native server — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => {
                const at = findTextCell(frame, '"aws"');
                return at !== null && (frame.cells[at.y * frame.cols + at.x].style & StyleFlags.Underline) !== 0;
            },
            { describe: 'the underline of "aws"', timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("provider-link");

        // `aws` in `provider "aws"`: line 13, character 10.
        for (let i = 0; i < 13; i++) await editor.sendKey("ArrowDown");
        for (let i = 0; i < 10; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+Alt+O");
        await editor.waitForText((t) => t.includes("Link copied to clipboard") && t.includes("registry.terraform.io"), {
            timeoutMs: 30_000,
        });
        await editor.capture("link-copied");

        await editor.sendKey("Ctrl+Shift+O");
        await editor.waitForNode("#quickInput");
        await editor.waitForText((t) => t.includes("symbols (") && t.includes('resource "aws_instance" "web"'), {
            timeoutMs: 60_000,
        });
        await editor.capture("go-to-symbol");
        await editor.sendKey("Escape");

        // `var.region` is on the next line: from character 10 to character 17, inside `region`.
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 7; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Shift+F10");
        await editor.waitForText((t) => t.includes("Go to Declaration"), { timeoutMs: 10_000 });
        await editor.capture("context-menu");
        const menu = await editor.captureFrame();
        for (const absent of ["Go to Implementations", "Go to Type Definition", "Show Call Hierarchy"]) {
            if (findTextCell(menu, absent) !== null) throw new Error(`"${absent}" is in the menu without a provider`);
        }
        await editor.sendKey("Escape");

        await editor.sendKey("Ctrl+Alt+D");
        await editor.waitForText((t) => t.includes("Ln 9,"), { timeoutMs: 60_000 });
        await editor.capture("declaration");
    },
});
