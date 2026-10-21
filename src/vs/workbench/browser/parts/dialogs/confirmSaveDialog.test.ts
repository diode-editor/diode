import { DEFAULT_COLOR } from "@tuidom/core/common/colorUtils";
import { BoxConstraints, Offset, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it } from "vitest";

import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { ConfirmSaveDialog } from "./confirmSaveDialog.ts";

const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);

function renderDialog(filename: string): MockTerminalBackend {
    const dialog = new ConfirmSaveDialog(filename);
    const view = dialog.view;
    const w = view.getMaxIntrinsicWidth(0);
    const h = view.getMaxIntrinsicHeight(w);
    const size = new Size(w, h);
    const backend = new MockTerminalBackend(size);
    const termScreen = new TerminalScreen(size);

    view.localPosition = new Offset(0, 0);
    view.performStyleResolution(ROOT_STYLE_CONTEXT);
    view.layout(BoxConstraints.tight(size));
    view.render(new RenderContext(termScreen));
    termScreen.flush(backend);
    return backend;
}

describe("ConfirmSaveDialog", () => {
    it("padding cells use the themed dialog background, not transparent", () => {
        const backend = renderDialog("test.ts");
        const bg = theme.getRequiredColor("editorWidget.background");

        // Border at x=0; header (title y=1 + separator y=2) → first content row y=3; padding left=2 → x=1..2.
        const leftPad0 = new Point(1, 3);
        const leftPad1 = new Point(2, 3);

        expect(backend.getBgAt(leftPad0)).toBe(bg);
        expect(backend.getBgAt(leftPad0)).not.toBe(DEFAULT_COLOR);
        expect(backend.getBgAt(leftPad1)).toBe(bg);
        expect(backend.getBgAt(leftPad1)).not.toBe(DEFAULT_COLOR);
    });
});
