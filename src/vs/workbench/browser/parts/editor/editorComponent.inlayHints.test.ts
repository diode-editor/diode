import { compositeOver, packRgb, packRgba } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type { DocumentColorProvider } from "../../../../editor/common/languages/iColorSource.ts";
import {
    type InlayHint,
    InlayHintKind,
    type InlayHintsProvider,
} from "../../../../editor/common/languages/iInlayHintsSource.ts";
import type { ILargeFileOptions } from "../../../../editor/common/model/largeFileOptions.ts";
import { DefaultDocumentColorProvider } from "../../../../editor/contrib/colorPicker/browser/defaultDocumentColorProvider.ts";
import {
    DEFAULT_INLAY_HINTS_OPTIONS,
    MAX_INLAY_HINTS,
} from "../../../../editor/contrib/inlayHints/browser/inlayHintsController.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

// Gutter: 2 padding + 1 digit + fold margin (3) = 6.
const GUTTER = 6;
/** Past the longest recompute delay. */
const SETTLE_MS = 1000;
const DARK_PLUS_BACKGROUND = packRgb(0x1e, 0x1e, 0x1e);
const HINT_FG = packRgb(0x96, 0x96, 0x96);
const HINT_BG = compositeOver(packRgba(0x4d, 0x4d, 0x4d, 0x1a), DARK_PLUS_BACKGROUND);

function hint(line: number, character: number, label: InlayHint["label"], rest: Partial<InlayHint> = {}): InlayHint {
    return { position: { line, character }, label, ...rest };
}

function provider(hints: readonly InlayHint[]): InlayHintsProvider {
    return { provideInlayHints: () => ({ hints, dispose: () => undefined }) };
}

describe("EditorComponent — inlay hints", () => {
    let ws: ITempWorkspace;
    let providers: LanguageFeatureRegistry<InlayHintsProvider>;

    beforeEach(() => {
        vi.useFakeTimers();
        ws = createTempWorkspace({ prefix: "diode-inlay-hints-" });
        providers = new LanguageFeatureRegistry<InlayHintsProvider>();
    });
    afterEach(() => {
        vi.useRealTimers();
        ws.dispose();
    });

    async function open(
        content: string,
        { size = new Size(60, 6), largeFileOptions }: { size?: Size; largeFileOptions?: ILargeFileOptions } = {},
    ): Promise<{ pane: TextEditorPane; app: TestApp; row: (y?: number) => string; settle: () => Promise<void> }> {
        const pane = createEditorPane({
            inlayHintsProviders: providers,
            file: Uri.file(ws.writeFile("a.ts", content)),
            largeFileOptions,
        });
        const app = TestApp.createWithContent(pane.view, size);
        const settle = async (): Promise<void> => {
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            app.render();
        };
        await settle();
        const row = (y = 0): string => app.backend.getTextAt(new Point(GUTTER, y), size.width - GUTTER).trimEnd();
        return { pane, app, row, settle };
    }

    it("a new editor asks the providers after it is built: its document reaches the extension host only then", async () => {
        const provideInlayHints = vi.fn(() => ({ hints: [], dispose: () => undefined }));
        providers.register("*", { provideInlayHints });
        const pane = createEditorPane({
            inlayHintsProviders: providers,
            file: Uri.file(ws.writeFile("a.ts", "let x = 1")),
        });
        expect(provideInlayHints).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(0);
        expect(provideInlayHints).toHaveBeenCalledTimes(1);
        pane.dispose();
    });

    describe("frame", () => {
        it("draws the label at its position in the hint colors; the tail moves right", async () => {
            providers.register("*", provider([hint(0, 5, ": number")]));
            const { app, row, pane } = await open("let x = 1");
            expect(row()).toBe("let x: number = 1");
            expect(app.backend.getFgAt(new Point(GUTTER + 5, 0))).toBe(HINT_FG);
            expect(app.backend.getBgAt(new Point(GUTTER + 5, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 12, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 4, 0))).toBe(DARK_PLUS_BACKGROUND);
            expect(app.backend.getBgAt(new Point(GUTTER + 13, 0))).toBe(DARK_PLUS_BACKGROUND);
            pane.dispose();
        });

        it("each kind reads its own theme tokens", async () => {
            providers.register(
                "*",
                provider([
                    hint(0, 0, "A", { kind: InlayHintKind.Type }),
                    hint(0, 1, "B", { kind: InlayHintKind.Parameter }),
                    hint(0, 2, "C"),
                ]),
            );
            const { app, row, pane } = await open("xyz");
            expect(row()).toBe("AxByCz");
            app.root.setStyleVars({
                ...computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
                "editorInlayHint.foreground": 0x010101,
                "editorInlayHint.background": 0x020202,
                "editorInlayHint.typeForeground": 0x030303,
                "editorInlayHint.typeBackground": 0x040404,
                "editorInlayHint.parameterForeground": 0x050505,
                "editorInlayHint.parameterBackground": 0x060606,
            });
            app.render();
            expect(app.backend.getFgAt(new Point(GUTTER, 0))).toBe(0x030303);
            expect(app.backend.getBgAt(new Point(GUTTER, 0))).toBe(0x040404);
            expect(app.backend.getFgAt(new Point(GUTTER + 2, 0))).toBe(0x050505);
            expect(app.backend.getBgAt(new Point(GUTTER + 2, 0))).toBe(0x060606);
            expect(app.backend.getFgAt(new Point(GUTTER + 4, 0))).toBe(0x010101);
            expect(app.backend.getBgAt(new Point(GUTTER + 4, 0))).toBe(0x020202);
            pane.dispose();
        });

        it("the provider's padding is a cell of the line's background, on its own side only", async () => {
            providers.register(
                "*",
                provider([hint(0, 1, "L", { paddingLeft: true }), hint(0, 2, "R", { paddingRight: true })]),
            );
            const { app, row, pane } = await open("abc");
            expect(row()).toBe("a LbR c");
            expect(app.backend.getBgAt(new Point(GUTTER + 1, 0))).toBe(DARK_PLUS_BACKGROUND);
            expect(app.backend.getBgAt(new Point(GUTTER + 2, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 4, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 5, 0))).toBe(DARK_PLUS_BACKGROUND);
            pane.dispose();
        });

        it("editor.inlayHints.padding is a cell of the pill's background on each side", async () => {
            providers.register("*", provider([hint(0, 1, "H")]));
            // The word under the caret is only "a": its occurrence highlight stays off the cells below.
            const { app, row, pane, settle } = await open("a b");
            pane.setInlayHints({ ...DEFAULT_INLAY_HINTS_OPTIONS, padding: true });
            await settle();
            expect(row()).toBe("a H  b");
            for (const x of [1, 2, 3]) expect(app.backend.getBgAt(new Point(GUTTER + x, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 4, 0))).toBe(DARK_PLUS_BACKGROUND);
            pane.dispose();
        });

        it("label parts are glued into one pill", async () => {
            providers.register("*", provider([hint(0, 0, [{ label: "ab" }, { label: "cd" }])]));
            const { row, pane } = await open("x");
            expect(row()).toBe("abcdx");
            pane.dispose();
        });

        it("font style: normal has no flags, italic and dim have theirs, applied live", async () => {
            providers.register("*", provider([hint(0, 0, "H")]));
            const { app, pane } = await open("x");
            const flags = (): number => app.app.screen.getCell(new Point(GUTTER, 0)).style;
            expect(flags()).toBe(StyleFlags.None);
            pane.setInlayHints({ ...DEFAULT_INLAY_HINTS_OPTIONS, fontStyle: "italic" });
            app.render();
            expect(flags()).toBe(StyleFlags.Italic);
            pane.setInlayHints({ ...DEFAULT_INLAY_HINTS_OPTIONS, fontStyle: "dim" });
            app.render();
            expect(flags()).toBe(StyleFlags.Dim);
            pane.dispose();
        });

        it("the caret at a hint's point stands left of it, the right arrow jumps over it, typing goes left", async () => {
            providers.register("*", provider([hint(0, 1, "HH")]));
            const { app, row, pane } = await open("ab");
            pane.goToPosition(0, 1);
            app.render();
            expect(pane.viewState.primaryCursorColumn).toBe(1);
            pane.viewState.cursorRight();
            expect(pane.viewState.primaryCursorColumn).toBe(2);
            pane.goToPosition(0, 1);
            pane.viewState.type("x");
            app.render();
            expect(row()).toBe("axHHb");
            pane.dispose();
        });

        it("a selection across a hint leaves the hint's cells alone and does not copy them", async () => {
            providers.register("*", provider([hint(0, 2, "HH", { paddingLeft: true })]));
            const { app, row, pane } = await open("abcd");
            expect(row()).toBe("ab HHcd");
            pane.viewState.selections = [createSelection(0, 1, 0, 3)];
            app.render();
            const selected = app.backend.getBgAt(new Point(GUTTER + 1, 0));
            expect(selected).not.toBe(DARK_PLUS_BACKGROUND);
            // "ab HHcd": the padding at 2, the pill at 3 and 4, "c" at 5.
            expect(app.backend.getBgAt(new Point(GUTTER + 2, 0))).toBe(DARK_PLUS_BACKGROUND);
            expect(app.backend.getBgAt(new Point(GUTTER + 3, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 4, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 5, 0))).toBe(selected);
            expect(pane.viewState.getSelectedText()).toBe("bc");
            pane.dispose();
        });

        it("an occurrence highlight of a word split by a hint leaves the hint's cells alone", async () => {
            providers.register("*", provider([hint(0, 1, "H")]));
            const { app, row, pane, settle } = await open("ab ab");
            await settle();
            expect(row()).toBe("aHb ab");
            expect(app.backend.getBgAt(new Point(GUTTER + 1, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 2, 0))).not.toBe(DARK_PLUS_BACKGROUND);
            pane.dispose();
        });

        it("a multi-line selection leaves a hint at the end of its first line alone", async () => {
            providers.register("*", provider([hint(0, 2, "HH")]));
            const { app, row, pane } = await open("ab\ncd");
            expect(row()).toBe("abHH");
            pane.viewState.selections = [createSelection(0, 0, 1, 1)];
            app.render();
            expect(app.backend.getBgAt(new Point(GUTTER + 2, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 3, 0))).toBe(HINT_BG);
            pane.dispose();
        });

        it("a selection across two hints of one line leaves each of them alone", async () => {
            providers.register("*", provider([hint(0, 1, "H"), hint(0, 2, "I")]));
            const { app, row, pane } = await open("abc");
            expect(row()).toBe("aHbIc");
            pane.viewState.selections = [createSelection(0, 0, 0, 3)];
            app.render();
            const selected = app.backend.getBgAt(new Point(GUTTER, 0));
            expect(selected).not.toBe(DARK_PLUS_BACKGROUND);
            expect(app.backend.getBgAt(new Point(GUTTER + 1, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 2, 0))).toBe(selected);
            expect(app.backend.getBgAt(new Point(GUTTER + 3, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 4, 0))).toBe(selected);
            pane.dispose();
        });

        it("a selection over a hint under horizontal scroll finds the hint's cells", async () => {
            providers.register("*", provider([hint(0, 12, "HH")]));
            const { app, row, pane } = await open("abcdefghijklmnopqrstuvwxyz".repeat(2), { size: new Size(20, 4) });
            pane.viewState.scrollLeft = 10;
            pane.viewState.selections = [createSelection(0, 0, 0, 20)];
            app.render();
            expect(row().startsWith("klHHmn")).toBe(true);
            const selected = app.backend.getBgAt(new Point(GUTTER + 1, 0));
            expect(selected).not.toBe(DARK_PLUS_BACKGROUND);
            expect(app.backend.getBgAt(new Point(GUTTER + 2, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 3, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 4, 0))).toBe(selected);
            pane.dispose();
        });

        it("a selection over a hint on a wrapped row finds the hint's cells", async () => {
            providers.register("*", provider([hint(0, 13, "HH")]));
            const { app, row, pane } = await open("abcdefghijklmnopqrstuvwxyz", { size: new Size(16, 4) });
            pane.setWordWrap("on", 80);
            await vi.advanceTimersByTimeAsync(0);
            app.render();
            pane.viewState.selections = [createSelection(0, 0, 0, 20)];
            app.render();
            const column = row(1).indexOf("HH");
            expect(column).toBeGreaterThan(0);
            const selected = app.backend.getBgAt(new Point(GUTTER, 0));
            expect(selected).not.toBe(DARK_PLUS_BACKGROUND);
            expect(app.backend.getBgAt(new Point(GUTTER + column - 1, 1))).toBe(selected);
            expect(app.backend.getBgAt(new Point(GUTTER + column, 1))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + column + 1, 1))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + column + 2, 1))).toBe(selected);
            pane.dispose();
        });

        it("a color square keeps taking the selection: only hints stay outside", async () => {
            const colors = new LanguageFeatureRegistry<DocumentColorProvider>();
            colors.register("*", new DefaultDocumentColorProvider());
            const pane = createEditorPane({
                colorProviders: colors,
                inlayHintsProviders: providers,
                file: Uri.file(ws.writeFile("c.css", "x: #fff")),
            });
            const app = TestApp.createWithContent(pane.view, new Size(40, 4));
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            pane.viewState.selections = [createSelection(0, 0, 0, 7)];
            app.render();
            const selected = app.backend.getBgAt(new Point(GUTTER, 0));
            expect(selected).not.toBe(DARK_PLUS_BACKGROUND);
            expect(app.backend.getTextAt(new Point(GUTTER + 3, 0), 1)).toBe("■");
            expect(app.backend.getBgAt(new Point(GUTTER + 3, 0))).toBe(selected);
            pane.dispose();
        });
    });

    describe("edges", () => {
        it("an empty label draws nothing, not even its padding", async () => {
            providers.register(
                "*",
                provider([hint(0, 1, "", { paddingLeft: true, paddingRight: true }), hint(0, 1, [{ label: "" }])]),
            );
            const { row, pane } = await open("ab");
            expect(row()).toBe("ab");
            pane.dispose();
        });

        it("only a real pair moves a position: a lone surrogate on either side keeps it", async () => {
            providers.register("*", provider([hint(0, 1, "H")]));
            // Typed, not written to the file: UTF-8 has no lone surrogates, reading one back gives U+FFFD.
            const lowAfterText = await open("ab");
            lowAfterText.pane.goToPosition(0, 1);
            lowAfterText.pane.viewState.type("\uDC00");
            await lowAfterText.settle();
            expect(lowAfterText.pane.viewState.document.getLineContent(0)).toBe("a\uDC00b");
            expect(lowAfterText.row().startsWith("aH")).toBe(true);
            lowAfterText.pane.dispose();
            const highBeforeText = await open("a");
            highBeforeText.pane.goToPosition(0, 0);
            highBeforeText.pane.viewState.type("\uD83D");
            await highBeforeText.settle();
            expect(highBeforeText.pane.viewState.document.getLineContent(0)).toBe("\uD83Da");
            expect(highBeforeText.row().endsWith("Ha")).toBe(true);
            highBeforeText.pane.dispose();
        });

        it("a position past the line end clamps to the line; a line past the document is dropped", async () => {
            providers.register("*", provider([hint(0, 99, "H"), hint(9, 0, "G"), hint(1, 0, "F"), hint(-1, 0, "N")]));
            const { row, pane } = await open("ab");
            expect(row()).toBe("abH");
            pane.dispose();
        });

        it("a label stays on one line: a newline or a tab becomes a space", async () => {
            providers.register("*", provider([hint(0, 0, "a\nb\tc\r\n")]));
            const { row, pane } = await open("x");
            expect(row()).toBe("a b c  x");
            pane.dispose();
        });

        it("a wide label takes its cells: the tail lands right after them", async () => {
            providers.register("*", provider([hint(0, 1, "日本")]));
            const { app, pane } = await open("a b");
            expect(app.backend.getBgAt(new Point(GUTTER + 1, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 4, 0))).toBe(HINT_BG);
            expect(app.backend.getBgAt(new Point(GUTTER + 5, 0))).toBe(DARK_PLUS_BACKGROUND);
            expect(app.backend.getTextAt(new Point(GUTTER + 6, 0), 1)).toBe("b");
            pane.dispose();
        });

        it("two hints at one offset keep the order of their answer", async () => {
            providers.register("*", provider([hint(0, 1, "1"), hint(0, 1, "2")]));
            const { row, pane } = await open("ab");
            expect(row()).toBe("a12b");
            pane.dispose();
        });

        it("next to a color square: the square first, then the hint", async () => {
            const colors = new LanguageFeatureRegistry<DocumentColorProvider>();
            colors.register("*", new DefaultDocumentColorProvider());
            providers.register("*", provider([hint(0, 3, "H")]));
            const pane = createEditorPane({
                colorProviders: colors,
                inlayHintsProviders: providers,
                file: Uri.file(ws.writeFile("b.css", "x: #fff")),
            });
            const size = new Size(40, 4);
            const app = TestApp.createWithContent(pane.view, size);
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            app.render();
            expect(app.backend.getTextAt(new Point(GUTTER, 0), size.width - GUTTER).trimEnd()).toBe("x: ■ H#fff");
            pane.dispose();
        });

        it("next to ghost text at the caret: the ghost first, as before", async () => {
            providers.register("*", provider([hint(0, 1, "H")]));
            const { app, row, pane } = await open("ab");
            pane.setGhostText({ line: 0, character: 1, lines: ["ghost"] });
            app.render();
            expect(row()).toBe("aghostHb");
            pane.dispose();
        });

        it("a folded line shows no hints", async () => {
            providers.register("*", provider([hint(1, 0, "H")]));
            const { app, row, pane } = await open("if\n  body\nend");
            expect(row(1)).toContain("H");
            pane.goToPosition(0, 0);
            pane.viewState.setFoldingRegions([{ startLine: 0, endLine: 1, isCollapsed: true }]);
            app.render();
            expect(app.backend.getTextAt(new Point(0, 0), 60) + row(1)).not.toContain("H");
            pane.dispose();
        });

        it("a narrow terminal cuts the hint at the edge and keeps painting", async () => {
            providers.register("*", provider([hint(0, 1, "long hint text")]));
            const { app, pane } = await open("ab", { size: new Size(GUTTER + 4, 3) });
            expect(app.backend.getTextAt(new Point(GUTTER, 0), 4)).toBe("alon");
            pane.dispose();
        });
    });

    describe("maximumLength", () => {
        const options = (maximumLength: number) => ({ ...DEFAULT_INLAY_HINTS_OPTIONS, maximumLength });

        it("cuts the label that crosses the limit with an ellipsis and drops the line's later hints", async () => {
            providers.register("*", provider([hint(0, 0, "aaaa"), hint(0, 1, "bbbb"), hint(0, 2, "cccc")]));
            const { app, row, pane } = await open("xyz");
            pane.setInlayHints(options(6));
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            app.render();
            expect(row()).toBe("aaaaxbb…yz");
            pane.dispose();
        });

        it("the count starts again on every line", async () => {
            providers.register("*", provider([hint(0, 0, "aaaa"), hint(1, 0, "bbbb")]));
            const { app, row, pane, settle } = await open("x\ny");
            pane.setInlayHints(options(2));
            await settle();
            app.render();
            expect(row(0)).toBe("aa…x");
            expect(row(1)).toBe("bb…y");
            pane.dispose();
        });

        it("exactly at the limit there is no ellipsis, and the next hint is only an ellipsis, as upstream", async () => {
            providers.register("*", provider([hint(0, 0, "aaaa"), hint(0, 1, "bbbb"), hint(0, 2, "cccc")]));
            const { row, pane, settle } = await open("xyz");
            pane.setInlayHints(options(4));
            await settle();
            expect(row()).toBe("aaaax…yz");
            pane.dispose();
        });

        it("counts one line's hints together whatever order the answer has them in", async () => {
            providers.register("*", provider([hint(1, 0, "aaaa"), hint(0, 0, "b"), hint(1, 1, "cccc")]));
            const { row, pane, settle } = await open("x\nyz");
            pane.setInlayHints({ ...DEFAULT_INLAY_HINTS_OPTIONS, maximumLength: 5 });
            await settle();
            expect(row(1)).toBe("aaaayc…z");
            pane.dispose();
        });

        it("0 never truncates", async () => {
            const long = "a".repeat(50);
            providers.register("*", provider([hint(0, 0, long)]));
            const { row, pane, settle } = await open("x", { size: new Size(80, 3) });
            pane.setInlayHints(options(0));
            await settle();
            expect(row()).toBe(`${long}x`);
            pane.dispose();
        });

        it("the default limit is 43", async () => {
            providers.register("*", provider([hint(0, 0, "a".repeat(50))]));
            const { row, pane } = await open("x", { size: new Size(80, 3) });
            expect(row()).toBe(`${"a".repeat(43)}…x`);
            pane.dispose();
        });

        it("counts graphemes, not UTF-16 units", async () => {
            const family = "👨‍👩‍👧";
            providers.register("*", provider([hint(0, 0, family.repeat(3))]));
            const { app, pane, settle } = await open("x", { size: new Size(40, 3) });
            pane.setInlayHints(options(2));
            await settle();
            expect(app.backend.getTextAt(new Point(GUTTER + 2, 0), 40)).toContain("…");
            pane.dispose();
        });
    });

    describe("requests", () => {
        function recording(hints: readonly InlayHint[] = []) {
            const ranges: IRange[] = [];
            const disposed: number[] = [];
            let answers = 0;
            const value: InlayHintsProvider = {
                provideInlayHints: (_model, range) => {
                    ranges.push(range);
                    const answer = answers++;
                    return { hints, dispose: () => disposed.push(answer) };
                },
            };
            return { value, ranges, disposed };
        }

        const lines = (count: number): string =>
            Array.from({ length: count }, (_, i) => `line ${String(i)}`).join("\n");

        it("does not ask while the pane is being built: the document reaches the subprocess only after that", async () => {
            const p = recording();
            providers.register("*", p.value);
            const pane = createEditorPane({
                inlayHintsProviders: providers,
                file: Uri.file(ws.writeFile("a.ts", lines(3))),
            });
            expect(p.ranges).toEqual([]);
            await vi.advanceTimersByTimeAsync(0);
            expect(p.ranges.length).toBe(1);
            pane.dispose();
        });

        it("asks for the visible lines plus a viewport above and below", async () => {
            const p = recording();
            providers.register("*", p.value);
            const { pane } = await open(lines(100), { size: new Size(40, 10) });
            pane.viewState.scrollTop = 50;
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            expect(p.ranges.at(-1)).toEqual({
                start: { line: 40, character: 0 },
                end: { line: 69, character: "line 69".length },
            });
            pane.dispose();
        });

        it("a viewport taller than the state's default is asked for once layout has measured it", async () => {
            const p = recording();
            providers.register("*", p.value);
            const { pane } = await open(lines(200), { size: new Size(40, 100) });
            expect(p.ranges.at(-1)?.end.line).toBeGreaterThanOrEqual(99);
            pane.dispose();
        });

        it("a scroll inside the requested window asks nobody; past it, it asks again", async () => {
            const p = recording();
            providers.register("*", p.value);
            const { pane } = await open(lines(100), { size: new Size(40, 10) });
            const before = p.ranges.length;
            pane.viewState.scrollTop = 5;
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            expect(p.ranges.length).toBe(before);
            pane.viewState.scrollTop = 60;
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            expect(p.ranges.length).toBe(before + 1);
            pane.dispose();
        });

        it("an edit moves the hints at once and asks again after a debounce, not on the keystroke", async () => {
            const p = recording([hint(1, 0, "H")]);
            providers.register("*", p.value);
            const { app, row, pane, settle } = await open("a\nb");
            const before = p.ranges.length;
            pane.goToPosition(0, 1);
            pane.viewState.type("\n");
            app.render();
            expect(row(2)).toBe("Hb");
            expect(p.ranges.length).toBe(before);
            await settle();
            expect(p.ranges.length).toBe(before + 1);
            pane.dispose();
        });

        it("a fast provider is asked again after the shortest debounce", async () => {
            const p = recording();
            providers.register("*", p.value);
            const { pane } = await open("a");
            const before = p.ranges.length;
            pane.viewState.type("b");
            await vi.advanceTimersByTimeAsync(30);
            expect(p.ranges.length).toBe(before + 1);
            pane.dispose();
        });

        it("a scroll above the requested window asks again", async () => {
            const p = recording();
            providers.register("*", p.value);
            const { pane } = await open(lines(100), { size: new Size(40, 10) });
            pane.viewState.scrollTop = 60;
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            const before = p.ranges.length;
            pane.viewState.scrollTop = 0;
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            expect(p.ranges.length).toBe(before + 1);
            pane.dispose();
        });

        it("a look option asks again", async () => {
            const p = recording();
            providers.register("*", p.value);
            const { pane, settle } = await open("x");
            const before = p.ranges.length;
            pane.setInlayHints({ ...DEFAULT_INLAY_HINTS_OPTIONS, maximumLength: 7 });
            await settle();
            expect(p.ranges.length).toBe(before + 1);
            pane.dispose();
        });

        it("turning off drops a request still waiting for its debounce", async () => {
            const p = recording();
            providers.register("*", p.value);
            const { pane, settle } = await open("x");
            const before = p.ranges.length;
            pane.viewState.type("y");
            pane.setInlayHints({ ...DEFAULT_INLAY_HINTS_OPTIONS, enabled: false });
            await settle();
            expect(p.ranges.length).toBe(before);
            pane.dispose();
        });

        it("after turning off, a resize asks nobody", async () => {
            const p = recording();
            providers.register("*", p.value);
            const { pane, app, settle } = await open(lines(100), { size: new Size(40, 6) });
            pane.setInlayHints({ ...DEFAULT_INLAY_HINTS_OPTIONS, enabled: false });
            const before = p.ranges.length;
            app.backend.resize(new Size(40, 30));
            await settle();
            await settle();
            expect(p.ranges.length).toBe(before);
            pane.dispose();
        });

        it("closing the editor cancels the pending request", async () => {
            const tokens: { isCancellationRequested: boolean }[] = [];
            providers.register("*", {
                provideInlayHints: (_model, _range, token) => {
                    tokens.push(token);
                    return new Promise(() => undefined);
                },
            });
            const { pane } = await open("x");
            expect(tokens.at(-1)?.isCancellationRequested).toBe(false);
            pane.dispose();
            expect(tokens.at(-1)?.isCancellationRequested).toBe(true);
        });

        it("a new answer removes the decorations of the previous one", async () => {
            const change = new Emitter<void>();
            providers.register("*", { ...provider([hint(0, 0, "H")]), onDidChangeInlayHints: change.event });
            const { pane, settle } = await open("x");
            const delta = vi.spyOn(pane.viewState.document, "deltaDecorations");
            change.fire();
            await settle();
            change.fire();
            await settle();
            expect(delta.mock.calls[1][0]).toEqual(delta.mock.results[0].value);
            expect(delta.mock.calls[1][0]).toHaveLength(1);
            pane.dispose();
        });

        it("an answer of undefined costs only that provider", async () => {
            providers.register("*", { provideInlayHints: () => undefined });
            providers.register("*", provider([hint(0, 0, "H")]));
            const { row, pane } = await open("x");
            expect(row()).toBe("Hx");
            pane.dispose();
        });

        it("an answer for a stale version is dropped and its list disposed", async () => {
            let release: (() => void) | undefined;
            const disposed: string[] = [];
            let first = true;
            providers.register("*", {
                provideInlayHints: async () => {
                    if (first) {
                        first = false;
                        await new Promise<void>((resolve) => {
                            release = resolve;
                        });
                        return { hints: [hint(0, 0, "STALE")], dispose: () => disposed.push("stale") };
                    }
                    return { hints: [hint(0, 0, "FRESH")], dispose: () => disposed.push("fresh") };
                },
            });
            const { pane, row, settle } = await open("x");
            pane.viewState.type("y");
            release?.();
            await settle();
            expect(disposed).toContain("stale");
            expect(row()).toContain("FRESH");
            expect(row()).not.toContain("STALE");
            pane.dispose();
            expect(disposed).toContain("fresh");
        });

        it("a request superseded while pending cannot overwrite the newer answer", async () => {
            let release: (() => void) | undefined;
            const change = new Emitter<void>();
            let first = true;
            providers.register("*", {
                onDidChangeInlayHints: change.event,
                provideInlayHints: async () => {
                    if (first) {
                        first = false;
                        await new Promise<void>((resolve) => {
                            release = resolve;
                        });
                        return { hints: [hint(0, 0, "OLD")], dispose: () => undefined };
                    }
                    return { hints: [hint(0, 0, "NEW")], dispose: () => undefined };
                },
            });
            const { row, pane, settle } = await open("x");
            change.fire();
            await settle();
            release?.();
            await settle();
            expect(row()).toBe("NEWx");
            pane.dispose();
        });

        it("a new answer disposes the previous list; closing the editor disposes the last one", async () => {
            const change = new Emitter<void>();
            const p = recording([hint(0, 0, "H")]);
            providers.register("*", { ...p.value, onDidChangeInlayHints: change.event });
            const { pane, settle } = await open("x");
            expect(p.disposed).toEqual([]);
            change.fire();
            await settle();
            expect(p.disposed).toEqual([0]);
            pane.dispose();
            expect(p.disposed).toEqual([0, 1]);
        });

        it("onDidChangeInlayHints of any provider asks again", async () => {
            const change = new Emitter<void>();
            let label = "one";
            providers.register("*", provider([hint(0, 1, "other")]));
            providers.register("*", {
                onDidChangeInlayHints: change.event,
                provideInlayHints: () => ({ hints: [hint(0, 0, label)], dispose: () => undefined }),
            });
            const { row, pane, settle } = await open("x");
            expect(row()).toBe("onexother");
            label = "two";
            change.fire();
            await settle();
            expect(row()).toBe("twoxother");
            pane.dispose();
        });

        it("merges all providers by position; a failed one costs only its own hints", async () => {
            const errors: unknown[] = [];
            setUnexpectedErrorHandler((e) => errors.push(e));
            providers.register("*", provider([hint(0, 2, "second")]));
            providers.register("*", {
                provideInlayHints: () => {
                    throw new Error("sync failure");
                },
            });
            providers.register("*", { provideInlayHints: () => Promise.reject(new Error("async failure")) });
            providers.register("*", { provideInlayHints: () => null });
            providers.register("*", provider([hint(0, 0, "first")]));
            const { row, pane } = await open("abc");
            expect(row()).toBe("firstabsecondc");
            expect(errors.map((e) => (e as Error).message).sort()).toEqual(["async failure", "sync failure"]);
            setUnexpectedErrorHandler(() => undefined);
            pane.dispose();
        });

        it("keeps the first 1500 hints by position", async () => {
            const count = MAX_INLAY_HINTS + 5;
            const hints = Array.from({ length: count }, (_, i) => hint(0, count - 1 - i, "h"));
            const seen: number[] = [];
            providers.register("*", provider(hints));
            const { pane, settle } = await open("x".repeat(count), { size: new Size(40, 3) });
            pane.setInlayHints({ ...DEFAULT_INLAY_HINTS_OPTIONS, maximumLength: 0 });
            await settle();
            for (const insertion of pane.viewState.inlineInsertions) seen.push(insertion.offset);
            expect(seen.length).toBe(1500);
            expect(seen[0]).toBe(0);
            expect(seen.at(-1)).toBe(1499);
            pane.dispose();
        });

        it("a change of language asks the new language's providers and drops the old one's hints", async () => {
            providers.register({ language: "css" }, provider([hint(0, 0, "CSS")]));
            const { row, pane, settle } = await open("x");
            expect(row()).toBe("x");
            pane.setLanguage("css");
            await settle();
            expect(row()).toBe("CSSx");
            pane.setLanguage("plaintext");
            await settle();
            expect(row()).toBe("x");
            pane.dispose();
        });

        it("a provider registered later is asked; its removal takes the hints away", async () => {
            const { row, pane, settle } = await open("x");
            expect(row()).toBe("x");
            const registration = providers.register("*", provider([hint(0, 0, "H")]));
            await settle();
            expect(row()).toBe("Hx");
            registration.dispose();
            await settle();
            expect(row()).toBe("x");
            pane.dispose();
        });

        it("turning off removes the hints and stops asking; turning on asks at once", async () => {
            const p = recording([hint(0, 0, "H")]);
            providers.register("*", p.value);
            const { pane, app, row, settle } = await open("x");
            pane.setInlayHints({ ...DEFAULT_INLAY_HINTS_OPTIONS, enabled: false });
            app.render();
            expect(row()).toBe("x");
            const before = p.ranges.length;
            pane.viewState.type("y");
            await settle();
            expect(p.ranges.length).toBe(before);
            pane.setInlayHints(DEFAULT_INLAY_HINTS_OPTIONS);
            await settle();
            expect(row()).toContain("H");
            pane.dispose();
        });

        it("the same options again ask nobody", async () => {
            const p = recording([hint(0, 0, "H")]);
            providers.register("*", p.value);
            const { pane, settle } = await open("x");
            const before = p.ranges.length;
            pane.setInlayHints({ ...DEFAULT_INLAY_HINTS_OPTIONS });
            await settle();
            expect(p.ranges.length).toBe(before);
            pane.dispose();
        });

        it("a theme change repaints the pills without asking", async () => {
            const p = recording([hint(0, 0, "H")]);
            providers.register("*", p.value);
            const { app, pane } = await open("x");
            const before = p.ranges.length;
            app.root.setStyleVars({
                ...computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
                "editorInlayHint.foreground": 0x112233,
                "editorInlayHint.background": 0x445566,
            });
            app.render();
            expect(app.backend.getFgAt(new Point(GUTTER, 0))).toBe(0x112233);
            expect(app.backend.getBgAt(new Point(GUTTER, 0))).toBe(0x445566);
            expect(p.ranges.length).toBe(before);
            pane.dispose();
        });

        it("the large-file mode asks nobody until it ends", async () => {
            const p = recording([hint(0, 0, "H")]);
            providers.register("*", p.value);
            const { pane, row, settle } = await open("a\nb\nc\nd", {
                largeFileOptions: { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 2 },
            });
            expect(p.ranges).toEqual([]);
            expect(row()).toBe("a");
            pane.model.forcefullyEnableFeatures();
            await settle();
            expect(row()).toBe("Ha");
            pane.dispose();
        });
    });
});
