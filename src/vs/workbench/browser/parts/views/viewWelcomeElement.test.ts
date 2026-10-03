import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import type { IViewWelcomeBlock } from "./viewWelcomeElement.ts";
import { ViewWelcomeElement } from "./viewWelcomeElement.ts";

/** Пустое состояние Explorer — ровно то, что рисуется без открытой папки. */
const EXPLORER_WELCOME: readonly IViewWelcomeBlock[] = [
    { kind: "text", text: "You have not yet opened a folder." },
    { kind: "text", text: "" },
    { kind: "button", label: "Open Folder", command: "workbench.action.files.openFolder" },
];

/** Собирает welcome и журнал запущенных им команд. */
function make(blocks: readonly IViewWelcomeBlock[] = EXPLORER_WELCOME): {
    readonly welcome: ViewWelcomeElement;
    readonly ran: { command: string; args: readonly unknown[] }[];
} {
    const ran: { command: string; args: readonly unknown[] }[] = [];
    const welcome = new ViewWelcomeElement(blocks, (command, args) => {
        ran.push({ command, args });
    });
    return { welcome, ran };
}

function buttons(welcome: ViewWelcomeElement): ButtonElement[] {
    return welcome.getChildren().filter((child): child is ButtonElement => child instanceof ButtonElement);
}

/**
 * Строки кадра без отступа слева и без хвостовых пробелов: отступ welcome — его
 * выравнивание с заголовком секции, а тест читает содержимое.
 */
function lines(backend: MockTerminalBackend, count: number): string[] {
    const width = backend.size.width;
    return Array.from({ length: count }, (_, y) => backend.getTextAt(new Point(0, y), width).trimEnd().trimStart());
}

describe("ViewWelcomeElement — отрисовка", () => {
    it("текст переносится по словам под ширину секции, кнопка — на своей строке", () => {
        const { welcome } = make();
        const backend = renderElement(welcome, 29, 6, { themeVars: true });

        // Ширина 29 рубит эталонную фразу на две строки, зазор остаётся пустым.
        expect(lines(backend, 6)).toEqual(["You have not yet opened a", "folder.", "", "[ Open Folder ]", "", ""]);
    });

    it("на широкой секции абзац умещается в строку — перенос ничего не придумывает", () => {
        const { welcome } = make();
        const backend = renderElement(welcome, 40, 4, { themeVars: true });

        expect(lines(backend, 4)).toEqual(["You have not yet opened a folder.", "", "[ Open Folder ]", ""]);
    });

    it("перерисовка на другой ширине пересчитывает перенос", () => {
        const { welcome } = make();
        renderElement(welcome, 40, 4, { themeVars: true });
        const backend = renderElement(welcome, 29, 6, { themeVars: true });

        expect(lines(backend, 6)).toEqual(["You have not yet opened a", "folder.", "", "[ Open Folder ]", "", ""]);
    });

    it("несколько кнопок встают каждая на свою строку, в порядке блоков", () => {
        const { welcome } = make([
            { kind: "text", text: "Nothing here yet." },
            { kind: "button", label: "First", command: "first" },
            { kind: "button", label: "Second", command: "second" },
        ]);
        const backend = renderElement(welcome, 30, 3, { themeVars: true });

        expect(lines(backend, 3)).toEqual(["Nothing here yet.", "[ First ]", "[ Second ]"]);
    });

    it("слово шире секции режется, а не теряется", () => {
        const { welcome } = make([{ kind: "text", text: "unsplittableverylongword" }]);
        const backend = renderElement(welcome, 10, 3, { themeVars: true });

        // Ширина секции 10, одну колонку забирает отступ — режем по девяти.
        expect(lines(backend, 3)).toEqual(["unsplitta", "bleverylo", "ngword"]);
    });

    it("текст подписан descriptionForeground — тем же токеном, что и плоская подсказка", () => {
        const { welcome } = make();
        const backend = renderElement(welcome, 40, 3, { themeVars: true });

        expect(backend.getFgAt(new Point(1, 0))).toBe(welcome.resolvedStyle.fg);
    });
});

describe("ViewWelcomeElement — кнопки", () => {
    it("кнопка запускает свою команду с объявленными аргументами", () => {
        const { welcome, ran } = make([
            { kind: "button", label: "Open Folder", command: "workbench.action.files.openFolder" },
            { kind: "button", label: "Clone", command: "git.clone", args: ["https://example.invalid/r.git"] },
        ]);

        buttons(welcome)[0].onActivate?.();
        buttons(welcome)[1].onActivate?.();

        expect(ran).toEqual([
            { command: "workbench.action.files.openFolder", args: [] },
            { command: "git.clone", args: ["https://example.invalid/r.git"] },
        ]);
    });

    it("кнопки фокусируемые — значит достижимы Tab-обходом движка", () => {
        const { welcome } = make();
        expect(welcome.getDepthFirstFocusableOrder()).toEqual(buttons(welcome));
    });

    it("focusFirstButton ставит фокус на первую кнопку, и Enter по ней запускает команду", () => {
        const { welcome, ran } = make();
        const app = TestApp.createWithContent(welcome, new Size(30, 4));

        expect(welcome.focusFirstButton()).toBe(true);
        expect(app.focusedElement).toBe(buttons(welcome)[0]);

        app.sendKey("Enter");
        expect(ran).toEqual([{ command: "workbench.action.files.openFolder", args: [] }]);
    });

    it("Tab доводит фокус до кнопки и без focusFirstButton — обход движка её видит", () => {
        const { welcome, ran } = make();
        const app = TestApp.createWithContent(welcome, new Size(30, 4));

        app.sendKey("Tab");
        expect(app.focusedElement).toBe(buttons(welcome)[0]);
        app.sendKey(" ");
        expect(ran).toEqual([{ command: "workbench.action.files.openFolder", args: [] }]);
    });

    it("пустое состояние без кнопок — focusFirstButton отвечает false и фокус не трогает", () => {
        const { welcome } = make([{ kind: "text", text: "No output yet." }]);
        const app = TestApp.createWithContent(welcome, new Size(30, 2));

        expect(welcome.focusFirstButton()).toBe(false);
        expect(app.focusedElement).toBeNull();
    });
});
