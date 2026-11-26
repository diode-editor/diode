import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `demo-type-hierarchy` registers `vscode.languages.registerTypeHierarchyProvider` for typescript. Show Type Hierarchy
// lists the subtypes of `Shape` in the References panel, Enter goes to the declaration, the title button switches to
// the supertypes of the selected row. The command has no key upstream, so the scenario binds one.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-type-hierarchy-"));
const tsFile = join(sampleDir, "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-type-hierarchy");

const TS = `interface Drawable {}
interface Shape extends Drawable {}
class Circle implements Shape {}
class Square implements Shape {}
`;

export default defineScenario({
    name: "type-hierarchy",
    title: "Type hierarchy: subtypes of an interface in the References panel, Enter jumps, the direction switch",
    seedUserData: userData,
    open: [sampleDir, tsFile],
    cols: 90,
    rows: 20,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // J and K: F/E/S/V/G/H are menu bar mnemonics and O is the SS3 prefix. The title button does the same with the mouse.
    userKeybindings: [
        { key: "alt+j", command: "references-view.showSupertypes" },
        { key: "alt+k", command: "references-view.showTypeHierarchy" },
    ],
    async prepare() {
        writeFileSync(tsFile, TS);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("interface Shape"), { timeoutMs: 20_000 });
        await editor.waitForReady();
        // The caret goes down to the second line and onto the name.
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < "interface ".length; i++) await editor.sendKey("ArrowRight");

        await editor.waitForReady();
        await editor.sendKey("Alt+k");
        await editor.waitForText((t) => t.includes("Subtypes Of") && t.includes("Circle") && t.includes("Square"), {
            timeoutMs: 20_000,
        });
        await editor.capture("subtypes of Shape");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Ln 3, Col 7"));
        await editor.capture("Enter jumps to the declaration of Circle");

        // The tree reroots on the selected row: what `Circle` derives from.
        await editor.sendKey("Alt+j");
        await editor.waitForText((t) => t.includes("Supertypes Of") && t.includes("Circle") && t.includes("Shape"));
        await editor.capture("supertypes of Circle");
    },
});
