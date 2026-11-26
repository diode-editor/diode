import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { SHAPES_JAVA } from "../../src/TestUtils/javaFixture.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The stock redhat.java, the only stock server with both hierarchies: the subtypes of an interface with two
// implementations in the References panel. A copy of the fixture: the interface and its classes are written on top.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-java-hierarchy-"));
const sources = join(sampleDir, "src", "main", "java", "demo");
const shapeFile = join(sources, "Shape.java");

export default defineScenario({
    name: "java-hierarchy",
    title: "Java out of the box: the subtypes of an interface from jdt.ls in the References panel",
    // Folder first: redhat.java has only `workspaceContains:` activation events.
    open: [sampleDir, shapeFile],
    installVsix: ["redhat.java"],
    network: true,
    settings: { "redhat.telemetry.enabled": false },
    // Installing a 139 MB vsix, importing the maven project and two JVMs, as in java-lsp.
    timeoutMs: 900_000,
    cols: 100,
    rows: 24,
    skipOn: ["win32", "darwin"],
    // The command has no key upstream, so the scenario binds one, as in type-hierarchy.
    userKeybindings: [{ key: "alt+k", command: "references-view.showTypeHierarchy" }],
    async prepare() {
        cpSync(resolve(repoRoot, "e2e", "fixtures", "javaSample"), sampleDir, { recursive: true });
        for (const [name, text] of Object.entries(SHAPES_JAVA)) writeFileSync(join(sources, name), text);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("public interface Shape"), { timeoutMs: 60_000 });
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < "public interface ".length; i++) await editor.sendKey("ArrowRight");

        // Only the standard server answers, and until its import ends nothing opens: press until the tree shows up.
        const deadline = Date.now() + 300_000;
        for (;;) {
            await editor.sendKey("Alt+k");
            try {
                await editor.waitForText((t) => t.includes("Subtypes Of") && t.includes("Circle") && t.includes("Square"), {
                    timeoutMs: 15_000,
                });
                break;
            } catch (err) {
                if (Date.now() > deadline) throw err;
            }
        }
        await editor.capture("subtypes of Shape");
    },
});
