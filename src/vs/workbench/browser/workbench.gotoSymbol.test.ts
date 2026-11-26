import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import { createRange } from "../../editor/common/core/iRange.ts";
import { SymbolKind } from "../../editor/common/languages/symbolKinds.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";

const TARGET_LINE = 60;

describe("Workbench — Go to Symbol in Editor", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        const lines = Array.from({ length: 100 }, (_, index) => `line ${String(index)}`);
        lines[TARGET_LINE] = "target here";
        ws = createTempWorkspace({ prefix: "diode-gotosymbol-", files: { "a.txt": lines.join("\n") } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(100, 30), openFile: ws.path("a.txt") });
        h.container.get(LanguageFeaturesServiceDIToken).documentSymbolProvider.register("*", {
            provideDocumentSymbols: () =>
                Promise.resolve(
                    ["first", "target"].map((name, index) => {
                        const line = index === 0 ? 0 : TARGET_LINE;
                        const range = createRange(line, 0, line, 6);
                        return {
                            name,
                            detail: "",
                            kind: SymbolKind.Function,
                            tags: [],
                            range,
                            selectionRange: range,
                            children: [],
                        };
                    }),
                ),
        });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("the command lists the active file's symbols; a preview lights the line on the frame, Escape takes it off", async () => {
        h.commands.execute("workbench.action.gotoSymbol");
        await flushMicrotasks();
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("target");

        h.testApp.sendKey("ArrowDown");
        h.testApp.render();
        const row = h.testApp.backend
            .screenToString()
            .split("\n")
            .findLastIndex((text) => text.includes("target here"));
        expect(row).toBeGreaterThan(0);
        const lit = h.testApp.backend.getBgAt(new Point(50, row));

        h.testApp.sendKey("Escape");
        h.testApp.render();
        expect(h.activeEditor().viewState.scrollTop).toBe(0);
        h.activeEditor().viewState.revealRangeNearBottom(createRange(TARGET_LINE, 0, TARGET_LINE, 6));
        h.testApp.render();
        const plainRow = h.testApp.backend
            .screenToString()
            .split("\n")
            .findLastIndex((text) => text.includes("target here"));
        expect(h.testApp.backend.getBgAt(new Point(50, plainRow))).not.toBe(lit);
    });
});
