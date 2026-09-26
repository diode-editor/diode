import { describe, expect, it } from "vitest";

import { NULL_THEME_COLOR_RESOLVER } from "./iThemeColorResolver.ts";
import { ColorThemeKind } from "./vscodeTypes.ts";

describe("NULL_THEME_COLOR_RESOLVER", () => {
    it("вид темы — Dark, а не undefined: расширение читает activeColorTheme.kind без проверок", () => {
        // Профиль без моста темы (тесты, минимальные контейнеры) всё равно
        // обязан отдать расширению настоящий вид — дефолт VS Code без настройки.
        expect(NULL_THEME_COLOR_RESOLVER.kind()).toBe(ColorThemeKind.Dark);
    });

    it("цвета не резолвит и смену темы не обещает", () => {
        expect(NULL_THEME_COLOR_RESOLVER.resolve("editor.background")).toBeUndefined();
        let fired = 0;
        const sub = NULL_THEME_COLOR_RESOLVER.onDidChange(() => fired++);
        sub.dispose();
        expect(fired).toBe(0);
    });
});
