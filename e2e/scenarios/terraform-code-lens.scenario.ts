import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario, type ScenarioDriver } from "./framework.ts";

// `terraform.codelens.referenceCount` is read once, when the language client starts, in VS Code as well: turning it
// off offers a reload, and the rows are gone after it.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-terraform-code-lens-"));
const mainFile = join(sampleDir, "main.tf");
const settingsDir = join(sampleDir, ".diode");
const settingsFile = join(settingsDir, "settings.json");

const MAIN_TF = `variable "region" {
  type = string
}

output "first" {
  value = var.region
}

output "second" {
  value = var.region
}
`;

const OFFER = "Reload VSCode window";

async function clickTitle(editor: ScenarioDriver, title: string): Promise<void> {
    const frame = await editor.captureFrame();
    for (let y = 0; y < frame.rows; y++) {
        const line = frame.cells
            .slice(y * frame.cols, (y + 1) * frame.cols)
            .map((cell) => cell.char)
            .join("");
        const x = line.indexOf(title);
        if (x >= 0) {
            await editor.click(x, y);
            return;
        }
    }
    throw new Error(`"${title}" is not on screen`);
}

export default defineScenario({
    name: "terraform-code-lens",
    title: "Terraform from the marketplace: reference counts over blocks, a click opens the references view",
    open: [sampleDir, mainFile],
    installVsix: ["hashicorp.terraform"],
    network: true,
    cols: 100,
    rows: 28,
    // Extension host scenarios run a subprocess + a native server — Linux only.
    skipOn: ["win32", "darwin"],
    async prepare() {
        mkdirSync(settingsDir, { recursive: true });
        writeFileSync(settingsFile, JSON.stringify({ "terraform.codelens.referenceCount": true }));
        writeFileSync(mainFile, MAIN_TF);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("2 references"), { timeoutMs: 180_000 });
        await editor.capture("the row over the variable");

        await clickTitle(editor, "2 references");
        await editor.waitForText((t) => t.includes("Locations"), { timeoutMs: 60_000 });
        await editor.capture("the references view");

        writeFileSync(settingsFile, JSON.stringify({ "terraform.codelens.referenceCount": false }));
        await editor.waitForText((t) => t.includes(OFFER), { timeoutMs: 60_000 });
        await editor.capture("turning the setting off offers the reload");

        // The button, not the word in the message. The reply may never arrive: the window restarts along with the socket.
        await clickTitle(editor, "Reload ]").catch(() => undefined);
        await editor.reconnect();
        await editor.waitForReady();
        await editor.waitForText(
            (t) => t.includes('variable "region"') && !t.includes(OFFER) && !t.includes("2 references"),
            { timeoutMs: 60_000 },
        );
        await editor.capture("no rows after the reload");
    },
});
