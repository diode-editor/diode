import { cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ANGULAR_SAMPLE_DIR, ensureAngularLibrary, linkAngularLibrary } from "../../src/TestUtils/angularFixture.ts";
import { npmMissing } from "../helpers/npmProject.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Out of the repository, as a real project with its own node_modules: the client takes a file for an Angular one
// only with `@angular/core` there.
const sampleDir = join(tmpdir(), "diode-scenario-angular");
const templateFile = join(sampleDir, "src", "app", "hello.component.html");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

export default defineScenario({
    name: "angular-lsp",
    title: "Angular from the marketplace: ngtsc squiggle in a template, member completion, F12 into the component",
    open: [sampleDir, templateFile],
    installVsix: ["Angular.ng-template"],
    network: true,
    requires: npmMissing,
    cols: 110,
    rows: 30,
    // Extension host scenarios run a subprocess and a language server — Linux only.
    skipOn: ["win32", "darwin"],
    prepare() {
        rmSync(sampleDir, { recursive: true, force: true });
        cpSync(ANGULAR_SAMPLE_DIR, sampleDir, { recursive: true });
        linkAngularLibrary(sampleDir, ensureAngularLibrary());
        return Promise.resolve();
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("missingProp"));
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "the squiggle under missingProp", timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("ngtsc diagnostic in the template");

        // `Clicked {{ count }} times`, line 2: Ctrl+Space at the start of `count` offers the component's members.
        await editor.sendKey("Ctrl+G");
        await editor.sendText("2:42");
        await editor.sendKey("Enter");
        await editor.sendKey("Ctrl+Space");
        await editor.waitForNode("#suggestWidget", { timeoutMs: 60_000 });
        await editor.waitForText((t) => t.includes("increment  method"), { timeoutMs: 60_000 });
        await editor.capture("member completion");

        // `(click)="increment()"`, line 2: F12 opens the component on the method.
        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+G");
        await editor.sendText("2:19");
        await editor.sendKey("Enter");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes("hello.component.ts") && t.includes("Ln 10,"), {
            timeoutMs: 60_000,
        });
        await editor.capture("definition in the component");
    },
});
