import { afterEach, describe, expect, it } from "vitest";

import type { SuggestContext } from "./workbench.suggest.testUtils.ts";
import { createSuggestApp, disposeSuggestApp } from "./workbench.suggest.testUtils.ts";

/**
 * Интеграция suggest-попапа с клавиатурным слоем: попап не забирает фокус,
 * навигация/принятие/скрытие идут командами по `suggestWidgetVisible` и
 * перебивают editor-команды (cursorDown), а Enter принимает без вставки \n.
 */
describe("Workbench — suggest widget keyboard integration", () => {
    let ctx: SuggestContext;

    afterEach(() => {
        disposeSuggestApp(ctx);
    });

    /** Открывает попап у конца строки со словами (word-based, без провайдеров). */
    async function open(): Promise<void> {
        ctx.testApp.sendKey("End"); // каретка в конец строки → префикс "i"
        await ctx.completion.trigger();
    }

    it("попап открывается, не забирая фокус у редактора", async () => {
        ctx = createSuggestApp("indent_style indent_size i");
        await open();
        expect(ctx.completion.isOpen()).toBe(true);
        expect(ctx.testApp.focusedElement?.constructor.name).toBe("EditorElement");
        expect(ctx.completion.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
    });

    it("ArrowDown при открытом попапе двигает выбор (не курсор редактора)", async () => {
        ctx = createSuggestApp("indent_style indent_size i");
        await open();
        const caretBefore = ctx.activeEditor().viewState.selections[0].active;
        expect(ctx.completion.view.selectedIndex).toBe(0);

        ctx.testApp.sendKey("ArrowDown");

        expect(ctx.contextKeys.get("suggestWidgetVisible")).toBe(true);
        expect(ctx.completion.view.selectedIndex).toBe(1);
        // Курсор редактора не двигался (сработал selectNextSuggestion, а не cursorDown).
        expect(ctx.activeEditor().viewState.selections[0].active).toEqual(caretBefore);
    });

    it("ArrowUp / PageDown / PageUp тоже маршрутизируются в suggest-команды", async () => {
        ctx = createSuggestApp("indent_style indent_size i");
        await open();
        ctx.testApp.sendKey("ArrowDown"); // → 1
        expect(ctx.completion.view.selectedIndex).toBe(1);
        ctx.testApp.sendKey("ArrowUp"); // → 0 (selectPrevious)
        expect(ctx.completion.view.selectedIndex).toBe(0);
        ctx.testApp.sendKey("PageDown"); // → последний (selectNextPage)
        expect(ctx.completion.view.selectedIndex).toBe(1);
        ctx.testApp.sendKey("PageUp"); // → первый (selectPreviousPage)
        expect(ctx.completion.view.selectedIndex).toBe(0);
        // Курсор редактора не двигался ни на одном из этих нажатий.
        expect(ctx.activeEditor().viewState.selections[0].active.line).toBe(0);
    });

    it("Enter принимает выбранный пункт без вставки перевода строки", async () => {
        ctx = createSuggestApp("indent_style indent_size i");
        await open();
        ctx.testApp.sendKey("ArrowDown"); // выбираем indent_size

        ctx.testApp.sendKey("Enter");

        const text = ctx.activeEditor().getText();
        expect(text).toBe("indent_style indent_size indent_size");
        expect(text).not.toContain("\n"); // парный Enter-keypress не вставил \n
        expect(ctx.completion.isOpen()).toBe(false);
    });

    it("Escape закрывает попап, фокус остаётся в редакторе", async () => {
        ctx = createSuggestApp("indent_style indent_size i");
        await open();
        expect(ctx.completion.isOpen()).toBe(true);

        ctx.testApp.sendKey("Escape");

        expect(ctx.completion.isOpen()).toBe(false);
        expect(ctx.testApp.focusedElement?.constructor.name).toBe("EditorElement");
    });

    it("Ctrl+Space при открытом попапе переключает панель описания, а не перезапрашивает список", async () => {
        ctx = createSuggestApp("indent_style indent_size i");
        await open();
        expect(ctx.completion.isOpen()).toBe(true);
        // Дефолт — панель свёрнута (как в VS Code).
        expect(ctx.component.detailsVisible).toBe(false);

        ctx.testApp.sendKey("Ctrl+Space");
        expect(ctx.component.detailsVisible).toBe(true);

        ctx.testApp.sendKey("Ctrl+Space");
        expect(ctx.component.detailsVisible).toBe(false);
        expect(ctx.completion.isOpen()).toBe(true);
    });

    it("ArrowDown при закрытом попапе двигает курсор редактора (cursorDown)", () => {
        ctx = createSuggestApp("aa\nbb");
        expect(ctx.completion.isOpen()).toBe(false);
        expect(ctx.activeEditor().viewState.selections[0].active.line).toBe(0);

        ctx.testApp.sendKey("ArrowDown");

        expect(ctx.contextKeys.get("suggestWidgetVisible")).toBe(false);
        expect(ctx.activeEditor().viewState.selections[0].active.line).toBe(1);
    });
});
