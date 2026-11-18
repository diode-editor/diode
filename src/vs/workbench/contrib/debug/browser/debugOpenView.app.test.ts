// No debugger installed (Diode bundles none): F5 on a JavaScript file opens Run and Debug, its button asks to find a
// JavaScript debugger and the answer searches the Marketplace for one — upstream's `debug.openView` and `guessDebugger`.

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { LanguageServiceDIToken } from "../../../../editor/common/languages/iLanguageService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { LanguageRegistry } from "../../../services/language/common/languageRegistry.ts";
import { ExtensionsComponentDIToken } from "../../extensions/browser/extensionsComponent.ts";

describe("F5 without a debugger", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-no-debugger-", files: { "app.js": "const total = 2 + 3;\n" } });
        // What the JavaScript language pack contributes.
        const languages = new LanguageRegistry();
        languages.register({
            id: "vscode.javascript",
            location: "builtin:javascript/",
            isBuiltin: true,
            manifest: {
                name: "javascript",
                publisher: "vscode",
                version: "1.0.0",
                engines: { vscode: "*" },
                contributes: { languages: [{ id: "javascript", aliases: ["JavaScript"], extensions: [".js"] }] },
            },
        });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 30),
            containerOverrides: (container) => {
                container.bind(LanguageServiceDIToken, () => languages);
            },
        });
        await h.workbench.activate();
        h.container.get(EditorServiceDIToken).openFile(ws.path("app.js"));
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function screen(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    it("opens Run and Debug, and its button offers the Marketplace's JavaScript debuggers", async () => {
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("debuggersAvailable")).toBe(false);
        expect(screen()).not.toContain("RUN AND DEBUG");

        h.testApp.sendKey("F5");
        await flushMicrotasks();
        expect(screen()).toContain("RUN AND DEBUG");

        // The view took the focus: the cursor is on the Run and Debug button.
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(screen()).toContain("You don't have an extension for debugging JavaScript.");
        });
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(h.container.get(ExtensionsComponentDIToken).getQuery()).toBe("@category:debuggers JavaScript");
        });
    });

    it("Ctrl+F5 opens Run and Debug too", async () => {
        h.testApp.sendKey("Ctrl+F5");
        await flushMicrotasks();
        expect(screen()).toContain("RUN AND DEBUG");
    });
});
