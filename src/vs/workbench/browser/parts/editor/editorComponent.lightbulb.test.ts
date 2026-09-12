import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";

const LIGHTBULB = "\uea61"; //  nf-cod-lightbulb

describe("EditorComponent — setLightbulbLine", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-lightbulb-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("прокидывает лампочку в элемент с перерисовкой; повтор значения — no-op", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("a.txt", "l0\nl1\nl2")));

        const app = TestApp.createWithContent(ctrl.view, new Size(20, 3));
        app.render();
        expect(ctrl.view.isLayoutDirty).toBe(false);

        ctrl.setLightbulbLine(1);
        expect(ctrl.view.isLayoutDirty).toBe(true);

        app.render();
        // Лампочка — в fold-колонке слева от шеврона (как change-bar): гуттер
        // 2 pad + 1 цифра + fold margin → колонка 3.
        const x = 3;
        expect(app.backend.getTextAt(new Point(x, 1), 1)).toBe(LIGHTBULB);

        // Повтор того же значения не дёргает layout заново.
        expect(ctrl.view.isLayoutDirty).toBe(false);
        ctrl.setLightbulbLine(1);
        expect(ctrl.view.isLayoutDirty).toBe(false);

        ctrl.setLightbulbLine(null);
        app.render();
        expect(app.backend.getTextAt(new Point(x, 1), 1)).toBe(" ");
    });
});
