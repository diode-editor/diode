import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { describe, expect, it, vi } from "vitest";

import { expectScreen, screen } from "../../../../../TestUtils/expectScreen.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";

import { MASK_CHAR, QuickPickElement } from "./quickPickElement.ts";

// Поле пароля (`InputBoxOptions.password`): набранное закрыто маской. Маска —
// это ТОЛЬКО представление: модель, валидация и результат показа работают с
// настоящим текстом, поэтому тесты смотрят на обе стороны сразу — что видно на
// кадре и что при этом лежит в запросе.

function makePicker(width = 24): QuickPickElement {
    const picker = new QuickPickElement();
    picker.preferredWidth = width;
    picker.placeholder = "";
    return picker;
}

function render(picker: QuickPickElement, width = 24) {
    return renderElement(picker, width, picker.getMinIntrinsicHeight(width), { themeVars: true });
}

/** Символ прямо в строку запроса — так же, как его туда кладёт терминал. */
function type(picker: QuickPickElement, text: string): void {
    for (const char of text) {
        picker.inputElement.dispatchEvent(new TUIKeyboardEvent("keydown", { key: char }));
    }
}

describe("QuickPickElement — поле пароля", () => {
    it("без password набранное видно как есть", () => {
        const picker = makePicker();
        picker.setQuery("hunter2");
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │ hunter2              │
                ╰──────────────────────╯
            `,
        );
    });

    it("с password на кадре маска по символу на символ, самого секрета нет", () => {
        const picker = makePicker();
        picker.password = true;
        picker.setQuery("hunter2");
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │ *******              │
                ╰──────────────────────╯
            `,
        );
    });

    it("маска — только представление: запрос и onQueryChange несут настоящий текст", () => {
        const picker = makePicker();
        picker.password = true;
        const onQueryChange = vi.fn();
        picker.onQueryChange = onQueryChange;

        type(picker, "abc");

        expect(picker.getQuery()).toBe("abc");
        expect(onQueryChange).toHaveBeenLastCalledWith("abc");
    });

    it("Enter отдаёт настоящее значение, а не маску", () => {
        const picker = makePicker();
        picker.password = true;
        picker.acceptMode = "value";
        const onAcceptValue = vi.fn();
        picker.onAcceptValue = onAcceptValue;

        picker.setQuery("hunter2");
        picker.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onAcceptValue).toHaveBeenCalledWith("hunter2");
    });

    it("инспектор под маской отдаёт то же, что на экране — секрет наружу не уходит", () => {
        const picker = makePicker();
        picker.password = true;
        picker.setQuery("hunter2");

        expect(picker.inspectState().query).toBe(MASK_CHAR.repeat(7));
    });

    it("без маски инспектор отдаёт сам запрос", () => {
        const picker = makePicker();
        picker.setQuery("hunter2");

        expect(picker.inspectState().query).toBe("hunter2");
    });

    it("графемный кластер закрывается ОДНОЙ маской — и на кадре, и в инспекторе", () => {
        const picker = makePicker();
        picker.password = true;
        // «е» с комбинирующим акутом плюс эмодзи: три графемы из шести кодовых единиц.
        picker.setQuery("éx\u{1F512}");

        expect(picker.inspectState().query).toBe(MASK_CHAR.repeat(3));
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │ ***                  │
                ╰──────────────────────╯
            `,
        );
    });

    it("пустое поле под маской показывает плейсхолдер, а не нули масок", () => {
        const picker = makePicker();
        picker.password = true;
        picker.placeholder = "пароль";
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │ пароль               │
                ╰──────────────────────╯
            `,
        );
    });

    it("resetFlavorState снимает маску — следующий показ на общем виджете не слепой", () => {
        const picker = makePicker();
        picker.password = true;
        picker.setQuery("hunter2");
        render(picker);

        picker.resetFlavorState();
        picker.setQuery("query");

        expect(picker.password).toBe(false);
        expectScreen(
            render(picker),
            screen`
                ╭──────────────────────╮
                │ query                │
                ╰──────────────────────╯
            `,
        );
    });
});
