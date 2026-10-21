import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TerminalEnvironmentServiceDIToken } from "../services/terminalEnvironment/node/terminalEnvironmentService.ts";

describe("Workbench — Keyboard Doctor", () => {
    let harness: IAppHarness;
    let workspace: ITempWorkspace;

    afterEach(() => {
        harness.dispose();
        workspace.dispose();
    });

    it("the command opens the doctor, it sees the real keybindings and environment, the report goes to a document", async () => {
        workspace = createTempWorkspace({ prefix: "diode-keyboard-doctor-", files: { "file.txt": "hello" } });
        harness = createAppTestHarness({
            openFile: workspace.path("file.txt"),
            focusEditor: true,
            size: new Size(160, 40),
        });
        const { testApp, commands } = harness;
        const screen = (): string => {
            testApp.render();
            return testApp.backend.screenToString();
        };

        const done = commands.execute("diode.keyboardDoctor");
        expect(screen()).toContain("Keyboard Doctor");
        expect(screen()).toContain("Step 1/");
        expect(screen()).not.toContain("super");

        // Changing the environment on the fly (Cmd was seen) redraws the header.
        harness.container.get(TerminalEnvironmentServiceDIToken).noteSuperObserved();
        expect(screen()).toContain("super");

        // Ctrl+S is looked up in the live registry: save uses mod and is active in this environment.
        testApp.sendKey("Ctrl+S");
        expect(screen()).toContain("keybinding: workbench.action.files.save [when: !(macKeys >= 3)]");

        for (let i = 0; i < 30 && screen().includes("Keyboard Doctor"); i++) {
            testApp.sendKey(screen().includes("now release the modifier") ? "Enter" : "Escape");
        }
        await done;
        expect(harness.activeEditor().getText()).toMatch(/^Diode Keyboard Doctor\n/);
    });
});
