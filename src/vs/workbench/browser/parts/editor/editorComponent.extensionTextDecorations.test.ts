import { packRgb, packRgba } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { EditorElement } from "../../../../editor/browser/editorElement.ts";
import { createRange, type IRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection, createSelection } from "../../../../editor/common/core/iSelection.ts";
import type {
    IExtensionDecorationAttachment,
    IExtensionTextDecoration,
} from "../../../../editor/common/model/iExtensionTextDecoration.ts";
import { TrackedRangeStickiness } from "../../../../editor/common/model/trackedDecorations.ts";

const PAINT = packRgb(0x80, 0x10, 0x10);
const RED_500 = packRgba(239, 68, 68, 255);
const GRAY = packRgb(0x80, 0x80, 0x80);
const NAVY = packRgb(0x10, 0x20, 0x30);
// Gutter: 2 padding + 1 digit + fold margin (3) = 6.
const GUTTER = 6;

const swatch = (color: number): IExtensionDecorationAttachment => ({ kind: "swatch", color });
const text = (value: string, patch: Partial<{ fg: number; bg: number; italic: boolean }> = {}) =>
    ({ kind: "text", text: value, italic: false, ...patch }) as IExtensionDecorationAttachment;
const deco = (range: IRange, patch: Partial<IExtensionTextDecoration> = {}): IExtensionTextDecoration => ({
    range,
    isWholeLine: false,
    ...patch,
});

describe("EditorComponent — setExtensionTextDecorations", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-exttextdeco-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function open(content: string, size = new Size(40, 3)) {
        const pane = createEditorPane();
        pane.openFile(Uri.file(ws.writeFile("a.html", content)));
        const app = TestApp.createWithContent(pane.view, size);
        app.render();
        const row = (y = 0): string => app.backend.getTextAt(new Point(GUTTER, y), size.width - GUTTER).trimEnd();
        const editor = (): EditorElement => app.querySelector("EditorElement") as EditorElement;
        return { pane, app, row, editor };
    }

    it("[api:TextEditor.setDecorations] a set reaches the frame with a repaint, an empty set clears it", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("a.txt", "alpha   \nbeta")));
        const app = TestApp.createWithContent(ctrl.view, new Size(20, 3));
        app.render();
        const rowBgs = () => Array.from({ length: 20 }, (_, x) => app.backend.getBgAt(new Point(x, 0)));
        const editorBg = app.backend.getBgAt(new Point(19, 0));
        expect(ctrl.view.isLayoutDirty).toBe(false);

        ctrl.setExtensionTextDecorations({
            key: 1,
            decorations: [{ range: createRange(0, 5, 0, 8), bg: PAINT, isWholeLine: false }],
        });
        expect(ctrl.view.isLayoutDirty).toBe(true);
        app.render();

        expect(rowBgs().filter((bg) => bg === PAINT)).toHaveLength(3);

        ctrl.setExtensionTextDecorations({ key: 1, decorations: [] });
        app.render();
        expect(rowBgs()).not.toContain(PAINT);
        expect(app.backend.getBgAt(new Point(19, 0))).toBe(editorBg);
    });

    it("[api:TextEditor.setDecorations] a swatch before the range is a square of its color and a space (Tailwind)", () => {
        const { pane, app, row } = open('<p class="bg-red-500">');
        pane.setExtensionTextDecorations({
            key: 1,
            decorations: [deco(createRange(0, 10, 0, 20), { before: swatch(RED_500) })],
        });
        app.render();
        expect(row()).toBe('<p class="■ bg-red-500">');
        expect(app.backend.getFgAt(new Point(GUTTER + 10, 0))).toBe(RED_500);
    });

    it("[api:TextEditor.setDecorations] after text is drawn at the range end in its color, background and italic", () => {
        const { pane, app, row } = open("let x = 1;");
        pane.setExtensionTextDecorations({
            key: 1,
            decorations: [
                deco(createRange(0, 0, 0, 10), { after: text("  You", { fg: GRAY, bg: NAVY, italic: true }) }),
            ],
        });
        app.render();
        expect(row()).toBe("let x = 1;  You");
        const cell = app.app.screen.getCell(new Point(GUTTER + 12, 0));
        expect(cell.style & StyleFlags.Italic).toBe(StyleFlags.Italic);
        expect(app.backend.getFgAt(new Point(GUTTER + 12, 0))).toBe(GRAY);
        expect(app.backend.getBgAt(new Point(GUTTER + 12, 0))).toBe(NAVY);
        // The document text keeps its style.
        expect(app.app.screen.getCell(new Point(GUTTER, 0)).style & StyleFlags.Italic).toBe(0);
    });

    it("text without colors takes the editor's text color and the line's background", () => {
        const { pane, app } = open("ab");
        const editorFg = app.backend.getFgAt(new Point(GUTTER, 0));
        const editorBg = app.backend.getBgAt(new Point(GUTTER + 20, 0));
        pane.setExtensionTextDecorations({
            key: 1,
            decorations: [deco(createRange(0, 1, 0, 1), { before: text("!") })],
        });
        app.render();
        expect(app.backend.getFgAt(new Point(GUTTER + 1, 0))).toBe(editorFg);
        expect(app.backend.getBgAt(new Point(GUTTER + 1, 0))).toBe(editorBg);
    });

    it("an empty range gets both, before first; isWholeLine puts them at the line edges", () => {
        const { pane, app, row } = open("abcd\nefgh");
        pane.setExtensionTextDecorations({
            key: 1,
            decorations: [deco(createRange(0, 2, 0, 2), { before: text("<"), after: text(">") })],
        });
        pane.setExtensionTextDecorations({
            key: 2,
            decorations: [deco(createRange(1, 1, 1, 2), { isWholeLine: true, before: text("["), after: text("]") })],
        });
        app.render();
        expect(row(0)).toBe("ab<>cd");
        expect(row(1)).toBe("[efgh]");
    });

    it("types at one offset go in key order whatever order their sets came in, ranges of a type in theirs", () => {
        const { pane, app, row } = open("ab");
        pane.setExtensionTextDecorations({
            key: 2,
            decorations: [
                deco(createRange(0, 1, 0, 2), { before: text("c") }),
                deco(createRange(0, 1, 0, 2), { before: text("d") }),
            ],
        });
        pane.setExtensionTextDecorations({
            key: 1,
            decorations: [deco(createRange(0, 1, 0, 2), { before: text("b") })],
        });
        app.render();
        expect(row()).toBe("abcdb");
    });

    it("[api:TextEditor.setDecorations] typing in the line moves the cells and the paint with the text", () => {
        const { pane, app, row } = open('<p class="bg-red-500">');
        pane.setExtensionTextDecorations({
            key: 1,
            decorations: [deco(createRange(0, 10, 0, 20), { bg: PAINT, before: swatch(RED_500), after: text("!") })],
        });
        app.render();
        pane.viewState.selections = [createCursorSelection(0, 2)];
        pane.viewState.type("xy");
        app.render();
        expect(row()).toBe('<pxy class="■ bg-red-500!">');
        expect(app.backend.getFgAt(new Point(GUTTER + 12, 0))).toBe(RED_500);
        // The painted range starts after the swatch: "b" of bg-red-500.
        expect(app.backend.getBgAt(new Point(GUTTER + 14, 0))).toBe(PAINT);
        expect(app.backend.getBgAt(new Point(GUTTER + 13, 0))).not.toBe(PAINT);
    });

    it("typing at the range edges grows it by its stickiness", () => {
        const typeAtRange = (stickiness?: TrackedRangeStickiness): string => {
            const { pane, app, row } = open("ab");
            pane.setExtensionTextDecorations({
                key: 1,
                decorations: [
                    deco(createRange(0, 1, 0, 1), {
                        before: text("["),
                        after: text("]"),
                        ...(stickiness === undefined ? {} : { stickiness }),
                    }),
                ],
            });
            pane.viewState.selections = [createCursorSelection(0, 1)];
            pane.viewState.type("x");
            app.render();
            return row();
        };
        // OpenOpen (the default): what is typed at the collapsed range goes inside it.
        expect(typeAtRange()).toBe("a[x]b");
        expect(typeAtRange(TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges)).toBe("a[x]b");
        expect(typeAtRange(TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges)).toBe("ax[]b");
    });

    it("a range collapsed by deleting its text keeps its cells until the next set", () => {
        const { pane, app, row } = open("a bg-red b");
        pane.setExtensionTextDecorations({
            key: 1,
            decorations: [deco(createRange(0, 2, 0, 8), { before: swatch(RED_500) })],
        });
        pane.viewState.selections = [createSelection(0, 2, 0, 8)];
        pane.viewState.deleteLeft();
        app.render();
        expect(row()).toBe("a ■  b");

        pane.setExtensionTextDecorations({ key: 1, decorations: [] });
        app.render();
        expect(row()).toBe("a  b");
    });

    it("a restyle keeps the tracked positions and takes the new colors; a plain set puts the ranges where it says", () => {
        const { pane, app, row } = open("ab cd");
        const at = (color: number, restyle?: boolean) => {
            pane.setExtensionTextDecorations({
                key: 1,
                decorations: [deco(createRange(0, 3, 0, 5), { before: swatch(color) })],
                ...(restyle === true ? { restyle } : {}),
            });
        };
        at(RED_500);
        pane.viewState.selections = [createCursorSelection(0, 0)];
        pane.viewState.type("zz");
        app.render();
        expect(row()).toBe("zzab ■ cd");

        at(GRAY, true);
        app.render();
        expect(row()).toBe("zzab ■ cd");
        expect(app.backend.getFgAt(new Point(GUTTER + 5, 0))).toBe(GRAY);

        // A restyle of another length is a plain set.
        pane.setExtensionTextDecorations({
            key: 1,
            decorations: [deco(createRange(0, 3, 0, 5), { before: swatch(NAVY) }), deco(createRange(0, 0, 0, 1))],
            restyle: true,
        });
        app.render();
        expect(row()).toBe("zza■ b cd");
        expect(app.backend.getFgAt(new Point(GUTTER + 3, 0))).toBe(NAVY);
    });

    it("a plain set of the same length after an edit puts the ranges where it says; a first restyle is a plain set", () => {
        const { pane, app, row } = open("ab cd");
        const set = (restyle?: true) => {
            pane.setExtensionTextDecorations({
                key: 1,
                decorations: [deco(createRange(0, 3, 0, 5), { before: swatch(RED_500) })],
                ...(restyle === undefined ? {} : { restyle }),
            });
        };
        // No set of the type yet: nothing to keep.
        set(true);
        app.render();
        expect(row()).toBe("ab ■ cd");

        pane.viewState.selections = [createCursorSelection(0, 0)];
        pane.viewState.type("zz");
        set();
        app.render();
        expect(row()).toBe("zza■ b cd");
    });

    it("disposing the editor removes its tracked decorations from the document", () => {
        const { pane } = open("ab");
        const document = pane.fileModel!.document;
        const delta = vi.spyOn(document, "deltaDecorations");
        pane.setExtensionTextDecorations({
            key: 1,
            decorations: [deco(createRange(0, 0, 0, 1), { before: text("x") })],
        });
        const ids = delta.mock.results[0].value as string[];
        expect(document.getDecorationRange(ids[0])).not.toBeNull();

        pane.dispose();

        expect(document.getDecorationRange(ids[0])).toBeNull();
    });

    it("the caret stays clear of a swatch, and of a before text that leads the next word; an after text keeps it left", () => {
        const { pane, app, editor } = open("ab cd");
        pane.setExtensionTextDecorations({
            key: 1,
            decorations: [
                deco(createRange(0, 3, 0, 5), { before: swatch(RED_500) }),
                deco(createRange(0, 0, 0, 2), { after: text("=") }),
            ],
        });
        editor().focus();
        // "ab= ■ cd"
        pane.viewState.selections = [createCursorSelection(0, 3)];
        app.render();
        expect(editor().getCaretScreenCell()).toEqual(new Point(GUTTER + 6, 0));
        pane.viewState.selections = [createCursorSelection(0, 2)];
        app.render();
        expect(editor().getCaretScreenCell()).toEqual(new Point(GUTTER + 2, 0));

        pane.setExtensionTextDecorations({
            key: 1,
            decorations: [deco(createRange(0, 3, 0, 5), { before: text("x:") })],
        });
        pane.viewState.selections = [createCursorSelection(0, 3)];
        app.render();
        // "ab x:cd": the caret on "c".
        expect(editor().getCaretScreenCell()).toEqual(new Point(GUTTER + 5, 0));

        // The same text as an `after` of "ab " stays right of the caret, even where it leads the next word.
        pane.setExtensionTextDecorations({
            key: 1,
            decorations: [deco(createRange(0, 0, 0, 3), { after: text("x:") })],
        });
        app.render();
        expect(editor().getCaretScreenCell()).toEqual(new Point(GUTTER + 3, 0));
    });

    it("a selection over a text attachment leaves its cells alone, over a swatch it paints them", () => {
        const { pane, app } = open("ab cd");
        pane.setExtensionTextDecorations({
            key: 1,
            decorations: [
                deco(createRange(0, 1, 0, 1), { before: text("T") }),
                deco(createRange(0, 4, 0, 4), { before: swatch(RED_500) }),
            ],
        });
        const editorBg = app.backend.getBgAt(new Point(GUTTER + 30, 0));
        pane.viewState.selections = [createSelection(0, 0, 0, 5)];
        app.render();
        // "aTb c■ d"
        const selected = app.backend.getBgAt(new Point(GUTTER, 0));
        expect(selected).not.toBe(editorBg);
        expect(app.backend.getBgAt(new Point(GUTTER + 1, 0))).toBe(editorBg);
        expect(app.backend.getBgAt(new Point(GUTTER + 5, 0))).toBe(selected);
    });
});
