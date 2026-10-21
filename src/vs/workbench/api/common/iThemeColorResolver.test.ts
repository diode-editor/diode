import { describe, expect, it } from "vitest";

import { NULL_THEME_COLOR_RESOLVER } from "./iThemeColorResolver.ts";
import { ColorThemeKind } from "./vscodeTypes.ts";

describe("NULL_THEME_COLOR_RESOLVER", () => {
    it("theme kind is Dark, not undefined: extensions read activeColorTheme.kind without checks", () => {
        // A profile without a theme bridge still gives the extension a real kind: the VS Code default.
        expect(NULL_THEME_COLOR_RESOLVER.kind()).toBe(ColorThemeKind.Dark);
    });

    it("does not resolve colors and does not promise theme changes", () => {
        expect(NULL_THEME_COLOR_RESOLVER.resolve("editor.background")).toBeUndefined();
        let fired = 0;
        const sub = NULL_THEME_COLOR_RESOLVER.onDidChange(() => fired++);
        sub.dispose();
        expect(fired).toBe(0);
    });
});
