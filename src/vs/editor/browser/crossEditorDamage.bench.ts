import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { bench, describe } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

// "What a NEIGHBOUR widget costs" (docs/TODO/LongLinePerformance.md), `npm run test:perf`:
// with damage tracking a settled Output subtree is not rendered, so a split with a 10k-char
// line must cost the same as with a short one.
//
// Fixtures live at module top level: in `vitest bench` a heavy beforeAll collects no samples.

class SplitElement extends TUIElement {
    public constructor(
        private readonly left: TUIElement,
        private readonly right: TUIElement,
    ) {
        super();
        this.appendChild(left);
        this.appendChild(right);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const half = Math.floor(size.width / 2);
        this.layoutChild(this.left, 0, 0, BoxConstraints.tight(new Size(half, size.height)));
        this.layoutChild(this.right, half, 0, BoxConstraints.tight(new Size(size.width - half, size.height)));
        return size;
    }
}

function makeEditor(text: string): EditorElement {
    return new EditorElement(new EditorViewState(new TextDocument(text)));
}

const EDITOR_TEXT = Array.from({ length: 200 }, (_, i) => `const line${String(i)} = ${String(i)};`).join("\n");

function makeSoloApp(): { app: TestApp } {
    const editor = makeEditor(EDITOR_TEXT);
    const app = TestApp.createWithContent(editor, new Size(120, 40));
    app.app.validateTreeAfterRender = false;
    editor.focus();
    app.render();
    return { app };
}

function makeSplitApp(outputLineLength: number): { app: TestApp } {
    const editor = makeEditor(EDITOR_TEXT);
    const outputLines = Array.from({ length: 40 }, (_, i) => `log line ${String(i)}`);
    outputLines[20] = "x".repeat(outputLineLength);
    const output = makeEditor(outputLines.join("\n"));
    const app = TestApp.createWithContent(new SplitElement(editor, output), new Size(120, 40));
    app.app.validateTreeAfterRender = false;
    editor.focus();
    app.render();
    return { app };
}

const solo = makeSoloApp();
const splitShort = makeSplitApp(20);
const splitLong = makeSplitApp(10_000);

describe("Editor — typing next to a settled Output (2 frames per iteration)", () => {
    bench("single editor — control: absolute cost of a keystroke", () => {
        solo.app.sendKey("x");
        solo.app.sendKey("Backspace");
    });

    bench("split: Output with short lines", () => {
        splitShort.app.sendKey("x");
        splitShort.app.sendKey("Backspace");
    });

    bench("split: Output with a settled 10k line — costs no more than the short one", () => {
        splitLong.app.sendKey("x");
        splitLong.app.sendKey("Backspace");
    });
});
