import { Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

describe("EditorElement — onDidChangeViewportSize", () => {
    /** Subscribes past the first layout's own event. */
    async function open(wordWrap: "on" | "off" = "off"): Promise<{ app: TestApp; heights: number[] }> {
        const state = new EditorViewState(new TextDocument("abc"));
        state.wordWrap = wordWrap;
        const editor = new EditorElement(state);
        const app = TestApp.createWithContent(editor, new Size(20, 4));
        app.render();
        await Promise.resolve();
        const heights: number[] = [];
        editor.onDidChangeViewportSize(() => {
            heights.push(state.viewportHeight);
        });
        return { app, heights };
    }

    it("fires once, after layout has stored the new height", async () => {
        const { app, heights } = await open();
        app.backend.resize(new Size(20, 7));
        app.render();
        await Promise.resolve();
        expect(heights).toEqual([7]);
    });

    it("fires on a width change under wrap: the rows move", async () => {
        const { app, heights } = await open("on");
        app.backend.resize(new Size(30, 4));
        app.render();
        await Promise.resolve();
        expect(heights).toEqual([4]);
    });

    it("stays quiet when only the width changes without wrap", async () => {
        const { app, heights } = await open();
        app.backend.resize(new Size(30, 4));
        app.render();
        await Promise.resolve();
        expect(heights).toEqual([]);
    });
});
