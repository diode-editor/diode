import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import { Uri } from "../../base/common/uri.ts";
import { createRange } from "../../editor/common/core/iRange.ts";
import { SymbolKind } from "../../editor/common/languages/symbolKinds.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";

const TARGET_LINE = 40;

describe("Workbench — Go to Symbol in Workspace", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const lines = Array.from({ length: 60 }, (_, index) => `line ${String(index)}`);
        ws = createTempWorkspace({
            prefix: "diode-workspacesymbols-",
            files: { "open.txt": "startWord here\n", "src/deep.txt": lines.join("\n") },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(100, 30), openFile: ws.path("open.txt") });
        h.container.get(LanguageFeaturesServiceDIToken).workspaceSymbolProvider.register({
            provideWorkspaceSymbols: () =>
                Promise.resolve([
                    {
                        name: "startWordClass",
                        kind: SymbolKind.Class,
                        tags: [],
                        containerName: "Holder",
                        location: {
                            uri: Uri.file(ws.path("src/deep.txt")).toString(),
                            range: createRange(TARGET_LINE, 2, TARGET_LINE, 6),
                        },
                    },
                ]),
        });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        vi.useRealTimers();
    });

    async function settle(): Promise<void> {
        await vi.advanceTimersByTimeAsync(250);
        await flushMicrotasks();
        h.testApp.render();
    }

    it("Ctrl+T seeds the word under the cursor, shows the row with its path; Enter opens the file on the symbol", async () => {
        h.testApp.sendKey("Ctrl+T");
        h.testApp.render();
        await settle();

        const screen = h.testApp.backend.screenToString();
        expect(screen).toContain("#startWord");
        expect(screen).toContain("startWordClass");
        expect(screen).toContain("Holder • src/deep.txt");

        h.testApp.sendKey("Enter");
        await settle();

        expect(h.activeEditor().uri.fsPath).toBe(ws.path("src/deep.txt"));
        expect(h.activeEditor().viewState.primaryCursorLine).toBe(TARGET_LINE);
        expect(h.activeEditor().viewState.primaryCursorColumn).toBe(2);
        expect(h.testApp.backend.screenToString()).toContain("line 40");
    });

    it("typing replaces the seeded word", async () => {
        h.testApp.sendKey("Ctrl+T");
        h.testApp.render();
        for (const key of "zz") h.testApp.sendKey(key);
        await settle();

        const screen = h.testApp.backend.screenToString();
        expect(screen).toContain("#zz");
        expect(screen).toContain("No matching workspace symbols");
    });

    it("search.quickOpen.includeSymbols adds the symbol to Ctrl+P under the group name", async () => {
        await h.container.get(IConfigurationServiceDIToken).updateValue("search.quickOpen.includeSymbols", true);
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();
        for (const key of "startWord") h.testApp.sendKey(key);
        await settle();

        const screen = h.testApp.backend.screenToString();
        expect(screen).toContain("startWordClass");
        expect(screen).toContain("file and symbol results");
    });

    it("off by default: Ctrl+P stays about files", async () => {
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();
        for (const key of "startWord") h.testApp.sendKey(key);
        await settle();

        expect(h.testApp.backend.screenToString()).not.toContain("startWordClass");
    });
});
