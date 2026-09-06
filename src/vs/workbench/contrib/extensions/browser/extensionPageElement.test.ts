import { Point } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

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
            readme: "alpha beta gamma delta epsilon zeta",
            versions: [],
        },
        metaError: null,
        ...overrides,
    };
}

/** Строки, как их показывает элемент (тот же снимок читает инспектор). */
function lines(element: ExtensionPageElement): string[] {
    return element.inspectState()["lines"] as string[];
}

describe("ExtensionPageElement", () => {
    it("строки страницы попадают в кадр с колонкой отступа слева", () => {
        const element = new ExtensionPageElement(content());
        const screen = renderElement(element, 40, 12, { themeVars: true });

        const first = screen.screenToString().split("\n")[0]!;
        expect(first.startsWith(" Acme Tools")).toBe(true);
    });

    it("перенос учитывает отступ и колонку полосы прокрутки", () => {
        const element = new ExtensionPageElement(content());
        renderElement(element, 20, 12, { themeVars: true });

        // Ширина текста — ширина элемента минус отступ слева и бегунок справа,
        // то есть 18 колонок на строку readme (справочные строки шапки не
        // переносятся: они короткие по построению).
        const readme = lines(element).filter((l) => /^(alpha|gamma|epsilon|delta|beta|zeta)/.test(l));
        expect(readme.length).toBeGreaterThan(1);
        expect(Math.max(...readme.map((l) => l.length))).toBeLessThanOrEqual(18);
    });

    it("смена ширины пересобирает перенос", () => {
        const element = new ExtensionPageElement(content());
        renderElement(element, 40, 12, { themeVars: true });
        const wide = lines(element);

        renderElement(element, 20, 12, { themeVars: true });
        expect(lines(element).length).toBeGreaterThan(wide.length);
    });

    it("тон строки виден цветом: имя, справочная строка и ошибка красятся по-разному", () => {
        const element = new ExtensionPageElement(content({ meta: undefined, metaError: "boom" }));
        const screen = renderElement(element, 60, 20, { themeVars: true });
        const rendered = lines(element);

        const nameRow = rendered.indexOf("Acme Tools");
        const idRow = rendered.indexOf("acme.tools");
        const errorRow = rendered.findIndex((l) => l.startsWith("Cannot read this extension"));
        const fg = (row: number): number => screen.getFgAt(new Point(1, row));

        expect(fg(idRow)).not.toBe(fg(nameRow));
        expect(fg(errorRow)).not.toBe(fg(nameRow));
        expect(fg(errorRow)).not.toBe(fg(idRow));
    });

    it("setContent перерисовывает страницу под новые данные", () => {
        const element = new ExtensionPageElement(content());
        renderElement(element, 60, 20, { themeVars: true });
        expect(lines(element)).toContain("Not installed");

        element.setContent(content({ entry: { ...ENTRY, installedVersion: "1.0.0", availability: "installed" } }));
        expect(lines(element)).toContain("Installed 1.0.0");
        expect(renderElement(element, 60, 20, { themeVars: true }).screenToString()).toContain("Installed 1.0.0");
    });

    it("буквы не листают страницу: typeahead в списке строк выключен", () => {
        const element = new ExtensionPageElement(content());
        renderElement(element, 60, 20, { themeVars: true });
        const list = element.querySelector("#extensionPageLines") as ListViewElement;
        list.setCursorTo("extensionPageLine-0");

        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "a" }));
        expect(list.getCursorElement()?.id).toBe("extensionPageLine-0");
    });
});
