import { Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createRange, type IRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { IExtensionTextDecoration } from "../../../../editor/common/model/iExtensionTextDecoration.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerServiceDIToken } from "../../../../platform/markers/common/markerService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { HoverComponentDIToken } from "./hoverComponent.ts";
import { HoverServiceDIToken } from "./hoverService.ts";

/** Line 0 is 25 characters long. */
const MAIN = "const answer = compute();\nconst other = 1;\n";

const hover = (range: IRange, hoverMessage: readonly string[], patch: Partial<IExtensionTextDecoration> = {}) => ({
    range,
    isWholeLine: false,
    hoverMessage,
    ...patch,
});
const blame = (text: string) => ({ kind: "text" as const, text, style: StyleFlags.None });

describe("HoverService — hoverMessage of extension decorations (upstream MarkdownHoverParticipant)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-hover-deco-", files: { "main.ts": MAIN } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const editor = () => {
        const active = h.container.get(EditorServiceDIToken).getActiveEditor();
        if (active === null) throw new Error("no editor");
        return active;
    };
    const service = () => h.container.get(HoverServiceDIToken);
    const lines = () => h.container.get(HoverComponentDIToken).view.linesFor(30);
    const decorate = (key: number, decorations: readonly IExtensionTextDecoration[]) => {
        editor().setExtensionTextDecorations({ key, decorations });
    };
    const showAt = async (line: number, character: number) => {
        editor().goToPosition(line, character);
        await service().showHover();
    };

    it("[api:DecorationOptions.hoverMessage] Ctrl+K Ctrl+U on gitblame's end-of-line annotation shows the commit in the frame", async () => {
        // gitblame: an empty range at column MAX_SAFE_INTEGER with an `after` annotation and a MarkdownString hover.
        decorate(1, [
            hover(createRange(0, Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER), ["**fix: answer** by *Ann*"], {
                after: blame("  Ann, 2 days ago"),
            }),
        ]);
        editor().goToPosition(0, 25);

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Ctrl+U");
        await new Promise((resolve) => setImmediate(resolve));
        h.testApp.render();

        const screen = h.testApp.backend.screenToString();
        expect(screen).toContain("const answer = compute();  Ann, 2 days ago");
        expect(screen).toContain("fix: answer by Ann");
    });

    it("a range in the middle of the line: the caret on either end or inside opens it, outside does not", async () => {
        decorate(1, [hover(createRange(0, 6, 0, 12), ["answer"])]);

        for (const character of [6, 9, 12]) {
            await showAt(0, character);
            expect(lines()).toEqual(["answer"]);
            service().close();
        }
        for (const character of [5, 13]) {
            await showAt(0, character);
            expect(service().isOpen()).toBe(false);
        }
        await showAt(1, 8);
        expect(service().isOpen()).toBe(false);
    });

    it("a range across lines holds every position in between; a whole-line one holds its whole line", async () => {
        decorate(1, [
            hover(createRange(0, 20, 1, 3), ["span"]),
            hover(createRange(1, 10, 1, 10), ["line"], { isWholeLine: true }),
        ]);

        await showAt(1, 0);
        expect(lines()).toEqual(["span", "─".repeat(30), "line"]);
        service().close();
        await showAt(1, 15);
        expect(lines()).toEqual(["line"]);
        service().close();
        await showAt(0, 19);
        expect(service().isOpen()).toBe(false);
    });

    it("blocks: diagnostics, then decorations by where they start, then the providers; each decoration its own block", async () => {
        h.container
            .get(LanguageFeaturesServiceDIToken)
            .hoverProvider.register("*", { provideHover: () => Promise.resolve({ contents: ["from provider"] }) });
        h.container
            .get(MarkerServiceDIToken)
            .changeOne("lint", editor().uri.toString(), [
                { severity: MarkerSeverity.Info, range: createRange(0, 0, 0, 25), message: "diagnostic" },
            ]);
        decorate(2, [hover(createRange(0, 0, 0, 25), ["outer", "same block"])]);
        decorate(1, [hover(createRange(0, 6, 0, 12), ["inner"]), hover(createRange(0, 6, 0, 12), ["", "  "])]);

        await showAt(0, 8);

        const rule = "─".repeat(30);
        expect(lines()).toEqual(["diagnostic", rule, "outer", "", "same block", rule, "inner", rule, "from provider"]);
    });

    it("a range an edit collapsed, or one the next set removed, gives no hover; a restyle keeps them", async () => {
        decorate(1, [hover(createRange(0, 6, 0, 12), ["answer"])]);
        decorate(2, [hover(createRange(1, 6, 1, 11), ["other"])]);

        editor().setExtensionTextDecorations({
            key: 1,
            decorations: [hover(createRange(0, 6, 0, 12), ["answer"], { fg: 0x112233ff })],
            restyle: true,
        });
        await showAt(0, 6);
        expect(lines()).toEqual(["answer"]);
        service().close();

        editor().model.document.applyEdits([createTextEdit(createRange(0, 6, 0, 12), "")]);
        await showAt(0, 6);
        expect(service().isOpen()).toBe(false);

        decorate(2, []);
        await showAt(1, 8);
        expect(service().isOpen()).toBe(false);
    });

    it("a decoration without hoverMessage adds nothing", async () => {
        decorate(1, [{ range: createRange(0, 0, 0, 25), isWholeLine: false, after: blame("x") }]);

        await showAt(0, 3);

        expect(service().isOpen()).toBe(false);
    });
});
