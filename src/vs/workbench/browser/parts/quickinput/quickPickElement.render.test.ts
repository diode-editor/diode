import { Point } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../../../TestUtils/expectScreen.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickPickElement } from "./quickPickElement.ts";

function makePicker(width = 30): QuickPickElement {
    const picker = new QuickPickElement();
    picker.preferredWidth = width;
    // Дефолтный плейсхолдер в кадре мешает — тест, которому он нужен, ставит свой.
    picker.placeholder = "";
    return picker;
}

function render(picker: QuickPickElement, width = 30) {
    return renderElement(picker, width, picker.getMinIntrinsicHeight(width), { themeVars: true });
}

function makeItems(count: number): QuickPickItem[] {
    return Array.from({ length: count }, (_, i) => ({ label: `file-${String(i + 1)}.ts` }));
}

describe("QuickPickElement — раскладка", () => {
    // Тот самый баг, ради которого виджет и переехал: строка запроса рисовалась
    // вплотную к рамке, а строки списка и сообщение — на колонку правее.
    it("запрос, сообщение и строки списка начинаются в одной колонке", () => {
        const picker = makePicker(24);
        picker.setQuery("cfg");
        picker.validationMessage = "Name is taken";
        picker.items = [{ label: "Alpha" }, { label: "Beta" }];

        expectScreen(
            render(picker, 24),
            screen`
                ╭──────────────────────╮
                │ cfg                  │
                │ Name is taken        │
                ├──────────────────────┤
                │ Alpha                │
                │ Beta                 │
                ╰──────────────────────╯
            `,
        );
    });

    it("пустой пикер — рамка, строка запроса с плейсхолдером, рамка", () => {
        const picker = makePicker(20);
        picker.placeholder = "Go to file...";

        expectScreen(
            render(picker, 20),
            screen`
                ╭──────────────────╮
                │ Go to file...    │
                ╰──────────────────╯
            `,
        );
    });

    it("заголовок врезан в верхнюю рамку", () => {
        const picker = makePicker(24);
        picker.title = "Save As";
        picker.setQuery("note.txt");

        expectScreen(
            render(picker, 24),
            screen`
                ╭─────┤ Save As ├──────╮
                │ note.txt             │
                ╰──────────────────────╯
            `,
        );
    });

    it("описание прижато к правому краю контента, отступ от рамки — один", () => {
        const picker = makePicker(30);
        picker.items = [{ label: "main.ts", description: "src/vs" }];

        expectScreen(
            render(picker, 30),
            screen`
                ╭────────────────────────────╮
                │                            │
                ├────────────────────────────┤
                │ main.ts             src/vs │
                ╰────────────────────────────╯
            `,
        );
    });

    it("длинное сообщение обрезается по тому же правому отступу, что и строки", () => {
        const picker = makePicker(24);
        picker.validationMessage = "This message is far too long to fit";
        picker.items = [{ label: "Alpha" }];
        const backend = render(picker, 24);

        // Контент кончается на колонке w-3, дальше — паддинг и рамка.
        expect(backend.getTextAt(new Point(21, 2), 1)).not.toBe(" ");
        expect(backend.getTextAt(new Point(22, 2), 1)).toBe(" ");
        expect(backend.getTextAt(new Point(23, 2), 1)).toBe("│");
    });

    it("колонка иконки отводится всем строкам, если иконка есть хоть у одной", () => {
        const picker = makePicker(24);
        picker.items = [{ icon: "A", label: "Alpha" }, { label: "Beta" }];

        expectScreen(
            render(picker, 24),
            screen`
                ╭──────────────────────╮
                │                      │
                ├──────────────────────┤
                │ A Alpha              │
                │   Beta               │
                ╰──────────────────────╯
            `,
        );
    });

    it("шорткат и подсказка идут после описания, справа", () => {
        const picker = makePicker(34);
        picker.items = [{ label: "Save", shortcut: "Ctrl+S" }];
        const row = render(picker, 34).getTextAt(new Point(0, 3), 34);

        expect(row).toContain("Save");
        expect(row).toContain("Ctrl+S");
    });

    it("лейбл в приоритете: описание ужимается, а не лейбл", () => {
        const picker = makePicker(28);
        picker.items = [{ label: "main.ts", description: "src/vs/workbench/browser/parts" }];
        const row = render(picker, 28).getTextAt(new Point(0, 3), 28);

        expect(row).toContain("main.ts");
        expect(row).toContain("…");
    });

    it("выделенная строка красится цветом активного выделения", () => {
        const picker = makePicker(24);
        picker.items = makeItems(2);
        const backend = render(picker, 24);

        // Строка 3 — первый элемент (он же выделен по умолчанию), строка 4 — второй.
        const selectedBg = backend.getBgAt(new Point(2, 3));
        const plainBg = backend.getBgAt(new Point(2, 4));
        expect(selectedBg).not.toBe(plainBg);
    });

    // Регрессия #94: подсветка выделения не должна залезать на рамку.
    it("выделение заливает интерьер целиком и не трогает колонки рамки", () => {
        const picker = makePicker(24);
        picker.items = makeItems(2);
        const backend = render(picker, 24);

        const frameBg = backend.getBgAt(new Point(0, 4)); // рамка невыделенной строки
        expect(backend.getBgAt(new Point(0, 3))).toBe(frameBg);
        expect(backend.getBgAt(new Point(23, 3))).toBe(frameBg);

        // Интерьер выделенной строки — включая паддинги — залит цветом выделения.
        const selectionBg = backend.getBgAt(new Point(2, 3));
        expect(selectionBg).not.toBe(frameBg);
        expect(backend.getBgAt(new Point(1, 3))).toBe(selectionBg);
        expect(backend.getBgAt(new Point(22, 3))).toBe(selectionBg);
    });

    it("высота = рамка + запрос + [сообщение] + [сепаратор + строки] + рамка", () => {
        const picker = makePicker();
        expect(picker.getMinIntrinsicHeight(30)).toBe(3);

        picker.prompt = "Enter a name";
        expect(picker.getMinIntrinsicHeight(30)).toBe(4);

        picker.prompt = undefined;
        picker.items = makeItems(3);
        expect(picker.getMinIntrinsicHeight(30)).toBe(7); // 1 + 1 + 1 + 3 + 1
    });

    it("список не длиннее maxVisibleItems", () => {
        const picker = makePicker();
        picker.maxVisibleItems = 2;
        picker.items = makeItems(10);
        expect(picker.getMinIntrinsicHeight(30)).toBe(6); // 1 + 1 + 1 + 2 + 1
    });

    // Контракт низкого терминала: пикер обязан ужаться в выделенную высоту с
    // целой нижней рамкой, а не рисовать natural под обрезку клипом.
    it("на низком терминале окно списка ужимается, нижняя рамка цела", () => {
        const picker = makePicker(24);
        picker.items = makeItems(10);
        const backend = renderElement(picker, 24, 6, { themeVars: true });

        expect(backend.getTextAt(new Point(0, 5), 1)).toBe("╰");
        expect(backend.getTextAt(new Point(2, 3), 9)).toBe("file-1.ts");
        expect(backend.getTextAt(new Point(2, 4), 9)).toBe("file-2.ts");
    });
});
