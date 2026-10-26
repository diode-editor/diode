import { Size } from "@tuidom/core/common/geometryPromitives";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import type { InMemoryConfigurationService } from "../../platform/configuration/common/inMemoryConfigurationService.ts";

/** `editor.cursorStyle` (#887): the terminal cursor takes the focused editor's shape, per language. */
describe("Workbench: editor.cursorStyle reaches the terminal cursor", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let configuration: InMemoryConfigurationService;

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-cursor-style-",
            files: { "a.ts": "const a = 1;\n", "notes.md": "# Notes\n" },
        });
        configuration = createTestConfigurationService({
            "editor.cursorStyle": "line",
            "[markdown]": { "editor.cursorStyle": "block" },
        });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 30),
            configurationService: configuration,
        });
        await h.workbench.activate();
        h.workbench.openFile(ws.path("a.ts"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const cursorStyle = () => {
        h.testApp.render();
        return h.testApp.backend.cursorStyle;
    };

    it("a TypeScript editor gets a blinking bar", () => {
        expect(cursorStyle()).toEqual({ shape: "bar", blinking: true });
    });

    it("two split editors keep their own language's shape; moving focus switches it", () => {
        h.commands.execute("workbench.action.splitEditor");
        h.workbench.openFile(ws.path("notes.md"));
        h.workbench.focusEditor();
        // The harness registers no languages: the pane gets one the way "Change Language Mode" does.
        h.activeEditor().setLanguage("markdown");
        expect(cursorStyle()).toEqual({ shape: "block", blinking: true });

        h.commands.execute("workbench.action.focusFirstEditorGroup");
        expect(cursorStyle()).toEqual({ shape: "bar", blinking: true });

        h.commands.execute("workbench.action.focusSecondEditorGroup");
        expect(cursorStyle()).toEqual({ shape: "block", blinking: true });
    });

    it("quick open's input has the terminal's shape; back in the editor the bar returns", () => {
        h.commands.execute("workbench.action.quickOpen");
        h.testApp.render();
        expect(h.testApp.focusedElement).toBeInstanceOf(InputElement);
        expect(cursorStyle()).toBeNull();

        h.testApp.sendKey("Escape");
        expect(cursorStyle()).toEqual({ shape: "bar", blinking: true });
    });

    it("a settings change applies at once, without reopening the file", async () => {
        await configuration.updateValue("editor.cursorBlinking", "solid");
        expect(cursorStyle()).toEqual({ shape: "bar", blinking: false });

        await configuration.updateValue("editor.cursorStyle", "underline-thin");
        expect(cursorStyle()).toEqual({ shape: "underline", blinking: false });

        await configuration.updateValue("editor.cursorStyle", undefined);
        expect(cursorStyle()).toBeNull();
    });

    it("an invalid value is treated as unset: the terminal keeps its shape", async () => {
        await configuration.updateValue("editor.cursorStyle", "beam");
        expect(cursorStyle()).toBeNull();
    });
});
