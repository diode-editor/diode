import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import type { IGhostText } from "../common/model/iGhostText.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

/**
 * Призрачная подсказка при каретке В СЕРЕДИНЕ строки (заявка n-4): фантомные
 * колонки вставляются в отрисовку строки, а хвост строки уезжает вправо — как
 * у upstream (injected-text декорации внутри layout строки). Сегодня рендер
 * рисует фантом ПОВЕРХ хвоста (см. `editorElement.ghostText.test.ts`,
 * «защитный кламп»), поэтому хвост пропадает с экрана.
 */

const GHOST_FG = packRgb(0x6a, 0x6a, 0x6a);
const EDITOR_FG = packRgb(0xd4, 0xd4, 0xd4);
const BG = packRgb(0x1e, 0x1e, 0x1e);

const STYLE_VARS = {
    "editor.background": BG,
    "editor.foreground": EDITOR_FG,
    "editorGhostText.foreground": GHOST_FG,
};

function createEditor(
    text: string,
    ghost: IGhostText | null,
    size = new Size(30, 4),
): { app: TestApp; editor: EditorElement } {
    const viewState = new EditorViewState(new TextDocument(text));
    const editor = new EditorElement(viewState);
    editor.setStyleVars(STYLE_VARS);
    editor.style = { fg: "editor.foreground", bg: "editor.background" };
    editor.setGhostText(ghost);
    const app = TestApp.createWithContent(editor, size);
    app.render();
    return { app, editor };
}

describe("EditorElement — ghost text в середине строки", () => {
    it("фантом вставляется между кареткой и хвостом строки, хвост сдвигается вправо", () => {
        const { app, editor } = createEditor("call();", { line: 0, character: 5, lines: ["arg"] });

        const gutterW = editor.gutterWidth;
        // Пользователь видит целую строку: набранное + серый фантом + свой хвост.
        expect(app.backend.getTextAt(new Point(gutterW, 0), 10)).toBe("call(arg);");
        // Фантомные колонки — призрачным цветом, хвост — цветом редактора.
        expect(app.backend.getFgAt(new Point(gutterW + 5, 0))).toBe(GHOST_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 7, 0))).toBe(GHOST_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 8, 0))).toBe(EDITOR_FG);
        // Документ фантом не трогает.
        expect(editor.viewState.document.getText()).toBe("call();");
    });

    it("снятие подсказки возвращает строку в исходный вид", () => {
        const { app, editor } = createEditor("call();", { line: 0, character: 5, lines: ["arg"] });

        editor.setGhostText(null);
        app.render();

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 10)).toBe("call();   ");
    });
});
