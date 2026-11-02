import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { YAML_SETTINGS } from "../../src/TestUtils/yamlFixture.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Stock YAML by Red Hat from the marketplace on a GitHub workflow: the schema from the schemastore.org catalog in the
// status bar and its lens, a squiggle on a duplicate key, completion from the schema, hover and Go to Symbol.

const projectRoot = join(tmpdir(), "diode-scenario-yaml");
const workflow = join(projectRoot, ".github", "workflows", "ci.yml");

const WORKFLOW = [
    "name: CI",
    "name: again",
    "on: push",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "",
].join("\n");

export default defineScenario({
    name: "yaml",
    title: "YAML from the marketplace: a workflow schema, a duplicate key, completion, hover and symbols",
    open: [projectRoot, workflow],
    installVsix: ["redhat.vscode-yaml"],
    network: true,
    cols: 120,
    rows: 24,
    // Extension host scenarios run a subprocess: Linux only.
    skipOn: ["win32", "darwin"],
    settings: YAML_SETTINGS,
    prepare() {
        rmSync(projectRoot, { recursive: true, force: true });
        mkdirSync(dirname(workflow), { recursive: true });
        writeFileSync(workflow, WORKFLOW);
        return Promise.resolve();
    },
    async run(editor) {
        const runFromPalette = async (title: string): Promise<void> => {
            await editor.sendKey("F1");
            await editor.waitForNode("#quickInput");
            await editor.sendText(title);
            await editor.waitForText((t) => t.includes(title), { timeoutMs: 20_000 });
            await editor.sendKey("Enter");
        };
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
            { describe: "undercurl under the duplicate key", timeoutMs: 60_000, intervalMs: 500 },
        );
        await editor.waitForText((t) => t.trimEnd().endsWith("GitHub Workflow"), { timeoutMs: 30_000 });
        await editor.capture("schema-and-diagnostics");

        await editor.sendKey("Ctrl+End");
        await editor.sendText("      - run: echo\n        shell: ");
        await editor.sendKey("b");
        await editor.waitForText((t) => t.includes("bash"), { timeoutMs: 20_000 });
        await editor.capture("completion-in-a-plain-scalar");
        await editor.sendKey("Escape");

        await editor.sendKey("Ctrl+Home");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        // Into the `runs-on` key: Home lands on its first character.
        await editor.sendKey("Home");
        await editor.sendKey("ArrowRight");
        await runFromPalette("Show Hover");
        await editor.waitForText((t) => t.includes("The type of machine to run the job on"), { timeoutMs: 20_000 });
        await editor.capture("hover");
        await editor.sendKey("Escape");

        await runFromPalette("Go to Symbol in Editor");
        await editor.waitForText((t) => /runs-on +build/.test(t), { timeoutMs: 20_000 });
        await editor.capture("go-to-symbol");
        await editor.sendKey("Escape");
    },
});
