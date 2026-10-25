import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { ViewMessageElement } from "./viewMessageElement.ts";

describe("ViewMessageElement", () => {
    it("is as tall as its wrapped lines, paragraphs kept; empty is no rows", () => {
        const message = new ViewMessageElement();
        expect(message.getMaxIntrinsicHeight(20)).toBe(0);
        expect(message.getMinIntrinsicHeight(20)).toBe(0);
        message.setText("first line\nsecond one that wraps");
        expect(message.getText()).toBe("first line\nsecond one that wraps");
        expect(message.getMaxIntrinsicHeight(16)).toBe(3);
        expect(message.getMinIntrinsicHeight(16)).toBe(3);
        // Even a sliver of width keeps one column for the text.
        expect(message.getMaxIntrinsicHeight(1)).toBeGreaterThan(3);
    });

    it("paints the lines one column in, dimmed", () => {
        const message = new ViewMessageElement();
        message.setText("hello world");
        const app = TestApp.createWithContent(message, new Size(8, 3));
        app.render();
        expect(
            app.backend
                .screenToString()
                .split("\n")
                .map((line) => line.trimEnd()),
        ).toEqual([" hello", " world", ""]);
        const vars = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));
        expect(vars.descriptionForeground).not.toBe(vars.foreground);
        expect(app.backend.getFgAt(new Point(1, 0))).toBe(vars.descriptionForeground);
    });
});
