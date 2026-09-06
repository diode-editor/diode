import { Point } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { ButtonElement } from "@tuidom/elements/button/buttonElement";
import type { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

import type { ExtensionButtonKind, IExtensionButton } from "./extensionPageButtons.ts";
import type { IExtensionPageContent } from "./extensionPageContent.ts";
import { ExtensionPageElement } from "./extensionPageElement.ts";

const ENTRY: IExtensionListEntry = {
    id: "acme.tools",
    publisher: "acme",
    name: "tools",
    displayName: "Acme Tools",
    description: "Tools for acme",
    kind: "native",
    latestVersion: "1.0.0",
    installedVersion: null,
    availability: "available",
    needsReload: false,
};

function content(overrides: Partial<IExtensionPageContent> = {}): IExtensionPageContent {
    return {
        entry: ENTRY,
        meta: {
            schemaVersion: 1,
            id: ENTRY.id,
            publisher: ENTRY.publisher,
            name: ENTRY.name,
            displayName: ENTRY.displayName,
            description: ENTRY.description,
            kind: "native",
            readme: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron",
            versions: [],
        },
        metaError: null,
        operationError: null,
        ...overrides,
    };
}

const INSTALL: IExtensionButton = { kind: "install", label: "Install", enabled: true };
const UNINSTALL: IExtensionButton = { kind: "uninstall", label: "Uninstall", enabled: true };
const DISABLED_INSTALL: IExtensionButton = { kind: "install", label: "Install", enabled: false };

function createPage(
    options: {
        content?: IExtensionPageContent;
        buttons?: IExtensionButton[];
        onActivate?: (kind: ExtensionButtonKind) => void;
    } = {},
): ExtensionPageElement {
    return new ExtensionPageElement(
        options.content ?? content(),
        options.buttons ?? [INSTALL],
        options.onActivate ?? (() => {}),
    );
}

/**
 * Поднимает страницу в приложении: фокус живёт в `FocusManager` корня, и без
 * настоящего дерева `focus()` некуда было бы поставить.
 */
function mount(element: ExtensionPageElement): void {
    const app = TestApp.createWithContent(element);
    app.render();
}

/** Строки readme, как их показывает элемент (тот же снимок читает инспектор). */
function lines(element: ExtensionPageElement): string[] {
    return element.inspectState()["lines"] as string[];
}

/** Строки шапки — они живут в своём элементе и в свой снимок. */
function headerLines(element: ExtensionPageElement): string[] {
    const header = element.querySelector("#extensionPageHeader")!;
    return header.inspectState()!["lines"] as string[];
}

function buttonElement(element: ExtensionPageElement, kind: ExtensionButtonKind): ButtonElement {
    return element.querySelector(`#extensionPageButton-${kind}`) as ButtonElement;
}

describe("ExtensionPageElement", () => {
    it("до первой раскладки строк нет — переносить нечем", () => {
        const element = createPage();
        expect(lines(element)).toEqual([]);
        expect(headerLines(element)).toEqual([]);

        // И свежие данные до раскладки строк не рождают: ширины всё ещё нет, а
        // без неё перенос посчитался бы по «пустой» ширине и всё бы порвал.
        element.setContent(content({ metaError: "boom" }), [INSTALL]);
        expect(lines(element)).toEqual([]);
        expect(headerLines(element)).toEqual([]);
    });

    it("повторная раскладка той же ширины не пересобирает строки — курсор на месте", () => {
        const element = createPage();
        renderElement(element, 40, 16, { themeVars: true });
        const list = element.querySelector("#extensionPageLines") as ListViewElement;
        list.setCursorTo("extensionPageLine-2");

        renderElement(element, 40, 16, { themeVars: true });
        // Пересборка строк сбросила бы курсор на начало — а вместе с ним и
        // прокрутку длинного readme на каждом кадре.
        expect(list.getCursorElement()?.id).toBe("extensionPageLine-2");
    });

    it("шапка и кнопки попадают в кадр, readme — под ними", () => {
        const element = createPage({ buttons: [INSTALL, UNINSTALL] });
        const screen = renderElement(element, 40, 16, { themeVars: true });
        const frame = screen.screenToString().split("\n");

        expect(frame[0].startsWith(" Acme Tools")).toBe(true);
        const buttonRow = frame.findIndex((row) => row.includes("[ Install ]"));
        const readmeRow = frame.findIndex((row) => row.includes("alpha"));
        expect(frame[buttonRow]).toContain("[ Uninstall ]");
        // Кнопки закреплены над текстом: readme начинается ниже ряда.
        expect(readmeRow).toBeGreaterThan(buttonRow);
    });

    it("перенос учитывает отступ и колонку полосы прокрутки", () => {
        const element = createPage();
        renderElement(element, 20, 16, { themeVars: true });

        // Ширина текста — ширина элемента минус отступ слева и бегунок справа,
        // то есть 18 колонок на строку readme.
        const readme = lines(element);
        expect(readme.length).toBeGreaterThan(1);
        expect(Math.max(...readme.map((l) => l.length))).toBeLessThanOrEqual(18);
    });

    it("смена ширины пересобирает перенос", () => {
        const element = createPage();
        renderElement(element, 40, 16, { themeVars: true });
        const wide = lines(element);

        renderElement(element, 20, 16, { themeVars: true });
        expect(lines(element).length).toBeGreaterThan(wide.length);
    });

    it("тон строки виден цветом: имя, справочная строка и ошибка красятся по-разному", () => {
        const element = createPage({
            content: content({ meta: undefined, metaError: "boom", operationError: "install failed" }),
        });
        const screen = renderElement(element, 60, 20, { themeVars: true });
        const header = headerLines(element);

        const nameRow = header.indexOf("Acme Tools");
        const idRow = header.indexOf("acme.tools");
        const errorRow = header.indexOf("install failed");
        const fg = (row: number): number => screen.getFgAt(new Point(1, row));

        expect(fg(idRow)).not.toBe(fg(nameRow));
        expect(fg(errorRow)).not.toBe(fg(nameRow));
        expect(fg(errorRow)).not.toBe(fg(idRow));
    });

    it("setContent перерисовывает страницу и ряд кнопок под новые данные", () => {
        const element = createPage();
        renderElement(element, 60, 20, { themeVars: true });
        expect(headerLines(element)).toContain("Not installed");

        element.setContent(
            content({ entry: { ...ENTRY, installedVersion: "1.0.0", availability: "installed" } }),
            [UNINSTALL],
        );

        expect(headerLines(element)).toContain("Installed 1.0.0");
        const frame = renderElement(element, 60, 20, { themeVars: true }).screenToString();
        expect(frame).toContain("Installed 1.0.0");
        expect(frame).toContain("[ Uninstall ]");
        expect(frame).not.toContain("[ Install ]");
    });

    it("Enter на кнопке зовёт обработчик с её видом", () => {
        const onActivate = vi.fn();
        const element = createPage({ buttons: [INSTALL, UNINSTALL], onActivate });
        mount(element);

        buttonElement(element, "uninstall").dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onActivate).toHaveBeenCalledExactlyOnceWith("uninstall");
    });

    it("фокус страницы встаёт на первое доступное действие", () => {
        const element = createPage({ buttons: [INSTALL, UNINSTALL] });
        mount(element);

        element.focus();

        expect(buttonElement(element, "install").isFocused).toBe(true);
    });

    it("выключенная кнопка не берёт фокус — он уходит в текст", () => {
        const onActivate = vi.fn();
        const element = createPage({ buttons: [DISABLED_INSTALL], onActivate });
        mount(element);

        element.focus();

        const list = element.querySelector("#extensionPageLines") as ListViewElement;
        expect(list.isFocused).toBe(true);
        expect(buttonElement(element, "install").isFocused).toBe(false);
        // И нажать её нечем: обработчика у выключенной кнопки нет.
        buttonElement(element, "install").dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
        expect(onActivate).not.toHaveBeenCalled();
    });

    it("стрелки ходят по ряду кнопок и не уезжают за края", () => {
        const element = createPage({ buttons: [INSTALL, UNINSTALL] });
        mount(element);
        element.focus();
        const install = buttonElement(element, "install");
        const uninstall = buttonElement(element, "uninstall");

        install.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowRight" }));
        expect(uninstall.isFocused).toBe(true);

        // За последней кнопкой ряд кончается — фокус остаётся на ней.
        uninstall.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowRight" }));
        expect(uninstall.isFocused).toBe(true);

        uninstall.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowLeft" }));
        expect(install.isFocused).toBe(true);

        install.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowLeft" }));
        expect(install.isFocused).toBe(true);
    });

    it("Tab водит фокус между кнопками и текстом readme", () => {
        const element = createPage({ buttons: [INSTALL] });
        mount(element);
        element.focus();
        const install = buttonElement(element, "install");
        const list = element.querySelector("#extensionPageLines") as ListViewElement;

        install.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
        expect(list.isFocused).toBe(true);

        list.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Tab" }));
        expect(install.isFocused).toBe(true);
    });

    it("буквы не листают страницу: строки заводятся без label", () => {
        const element = createPage();
        renderElement(element, 60, 20, { themeVars: true });
        const list = element.querySelector("#extensionPageLines") as ListViewElement;
        list.setCursorTo("extensionPageLine-0");

        // Быстрый поиск списка работает только по label'ам строк; у страницы
        // их нет, поэтому буква курсор не двигает.
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "a" }));
        expect(list.getCursorElement()?.id).toBe("extensionPageLine-0");
    });
});
