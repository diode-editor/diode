import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/all/common/geometryPromitives";
import type { WheelDirection } from "@tuidom/all/dom/events/tuiMouseEvent";
import { TUIMouseEvent } from "@tuidom/all/dom/events/tuiMouseEvent";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

function createEditor(text: string, width = 30, height = 5): { app: TestApp; editor: EditorElement } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor };
}

function fireWheel(editor: EditorElement, direction: WheelDirection): void {
    editor.dispatchEvent(
        new TUIMouseEvent("wheel", {
            button: "none",
            screenX: 0,
            screenY: 0,
            localX: 0,
            localY: 0,
            wheelDirection: direction,
        }),
    );
}

// Generate text with N lines, each line is "line{i}" (5 chars wide)
function makeLines(count: number): string {
    return Array.from({ length: count }, (_, i) => `line${i}`).join("\n");
}

describe("EditorElement – wheel scroll", () => {
    describe("vertical scroll (scrollTop)", () => {
        it("wheel down increases scrollTop by 3", () => {
            const { editor } = createEditor(makeLines(20), 30, 5);
            expect(editor.viewState.scrollTop).toBe(0);

            fireWheel(editor, "down");

            expect(editor.viewState.scrollTop).toBe(3);
        });

        it("wheel up decreases scrollTop by 3", () => {
            const { editor } = createEditor(makeLines(20), 30, 5);
            editor.viewState.scrollTop = 6;

            fireWheel(editor, "up");

            expect(editor.viewState.scrollTop).toBe(3);
        });

        it("wheel up does not go below 0", () => {
            const { editor } = createEditor(makeLines(20), 30, 5);
            editor.viewState.scrollTop = 1;

            fireWheel(editor, "up");

            expect(editor.viewState.scrollTop).toBe(0);
        });

        it("wheel up from 0 stays at 0", () => {
            const { editor } = createEditor(makeLines(20), 30, 5);
            expect(editor.viewState.scrollTop).toBe(0);

            fireWheel(editor, "up");

            expect(editor.viewState.scrollTop).toBe(0);
        });

        it("wheel down does not exceed maxScrollTop", () => {
            // 7 lines, viewport height 5 → maxScrollTop = 2
            const { editor } = createEditor(makeLines(7), 30, 5);
            editor.viewState.scrollTop = 1;

            fireWheel(editor, "down");

            // Would be 1+3=4, clamped to maxScrollTop=2
            expect(editor.viewState.scrollTop).toBe(2);
        });

        it("wheel down when already at maxScrollTop stays there", () => {
            // 7 lines, viewport height 5 → maxScrollTop = 2
            const { editor } = createEditor(makeLines(7), 30, 5);
            editor.viewState.scrollTop = 2;

            fireWheel(editor, "down");

            expect(editor.viewState.scrollTop).toBe(2);
        });
    });

    describe("horizontal scroll (scrollLeft)", () => {
        it("wheel right increases scrollLeft by 3", () => {
            // Each line is 60 chars wide to allow horizontal scroll
            const longLine = "a".repeat(60);
            const { editor } = createEditor(longLine, 20, 5);

            fireWheel(editor, "right");

            expect(editor.viewState.scrollLeft).toBe(3);
        });

        it("wheel left decreases scrollLeft by 3", () => {
            const longLine = "a".repeat(60);
            const { editor } = createEditor(longLine, 20, 5);
            editor.viewState.scrollLeft = 6;

            fireWheel(editor, "left");

            expect(editor.viewState.scrollLeft).toBe(3);
        });

        it("wheel left does not go below 0", () => {
            const longLine = "a".repeat(60);
            const { editor } = createEditor(longLine, 20, 5);
            editor.viewState.scrollLeft = 1;

            fireWheel(editor, "left");

            expect(editor.viewState.scrollLeft).toBe(0);
        });

        it("wheel left from 0 stays at 0", () => {
            const longLine = "a".repeat(60);
            const { editor } = createEditor(longLine, 20, 5);

            fireWheel(editor, "left");

            expect(editor.viewState.scrollLeft).toBe(0);
        });
    });
});
