import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";

let ws: ITempWorkspace;
let repaintCounter = 0;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-ec-wordwrap-" });
});
afterEach(() => {
    ws.dispose();
});

function openPane(content = "aaaa bbbb cccc"): TextEditorPane {
    const pane = createEditorPane();
    pane.openFile(Uri.file(ws.writeFile(`ww-${String(repaintCounter++)}.txt`, content)));
    return pane;
}

/** Попал ли редактор в кадр после `act` — см. editorComponent.test.ts. */
function repaintsEditor(act: (pane: TextEditorPane) => void): boolean {
    const pane = openPane();
    const app = TestApp.createWithContent(pane.view, new Size(20, 3));
    app.render();

    const renderSpy = vi.spyOn(EditorElement.prototype, "render");
    act(pane);
    app.render();
    const repainted = renderSpy.mock.calls.length > 0;
    renderSpy.mockRestore();
    return repainted;
}

describe("EditorComponent.setWordWrap", () => {
    it("смена режима доезжает до экрана (markDirty)", () => {
        expect(repaintsEditor((pane) => pane.setWordWrap("on", 80))).toBe(true);
    });

    it("повторное применение тех же значений — no-op без перерисовки", () => {
        expect(repaintsEditor((pane) => pane.setWordWrap("off", 80))).toBe(false);
    });

    it("включение переноса сбрасывает горизонтальный скролл и показывает ряд каретки", () => {
        const pane = openPane(`${"aaaa bbbb ".repeat(250)}end`);
        const viewState = pane.viewState;
        viewState.goToPosition(0, 2400); // хвост длинной строки — скролл уехал вправо
        expect(viewState.scrollLeft).toBeGreaterThan(0);
        expect(viewState.scrollTop).toBe(0);

        pane.setWordWrap("on", 80);
        expect(viewState.wordWrap).toBe("on");
        expect(viewState.scrollLeft).toBe(0);
        // Каретка глубоко в проекции рядов — reveal прокрутил вьюпорт к её ряду.
        expect(viewState.scrollTop).toBeGreaterThan(0);
    });

    it("смена колонки при выключенном переносе скролл не трогает", () => {
        const pane = openPane(`${"aaaa bbbb ".repeat(20)}end`);
        const viewState = pane.viewState;
        // Каретка внутри видимого окна — reveal в setWordWrap не двигает скролл.
        viewState.goToPosition(0, 50);
        viewState.scrollLeft = 5;

        pane.setWordWrap("off", 120);
        expect(viewState.wordWrapColumn).toBe(120);
        expect(viewState.scrollLeft).toBe(5);
    });
});
