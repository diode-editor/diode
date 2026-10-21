import { Point } from "@tuidom/core/common/geometryPromitives";
import type { ButtonElement } from "@tuidom/elements/button/buttonElement";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

import type { IExtensionButton } from "./extensionPageButtons.ts";
import type { IExtensionPageContent } from "./extensionPageContent.ts";
import { ExtensionPageHeaderElement } from "./extensionPageHeaderElement.ts";

const ENTRY: IExtensionListEntry = {
    id: "acme.tools",
    publisher: "acme",
    name: "tools",
    displayName: "Acme Tools",
    description: "Tools for acme",
    kind: undefined,
    support: undefined,
    latestVersion: "1.0.0",
    installedVersion: null,
    availability: "available",
    needsReload: false,
};

function content(overrides: Partial<IExtensionPageContent> = {}): IExtensionPageContent {
    return { entry: ENTRY, meta: undefined, metaError: null, operationError: null, ...overrides };
}

const INSTALL: IExtensionButton = { kind: "install", label: "Install", enabled: true };
const UNINSTALL: IExtensionButton = { kind: "uninstall", label: "Uninstall", enabled: true };

function createHeader(
    options: { content?: IExtensionPageContent; buttons?: IExtensionButton[]; onActivate?: () => void } = {},
): ExtensionPageHeaderElement {
    const header = new ExtensionPageHeaderElement(
        options.content ?? content(),
        options.buttons ?? [INSTALL],
        options.onActivate ?? (() => {}),
    );
    header.id = "extensionPageHeader";
    return header;
}

function lines(header: ExtensionPageHeaderElement): string[] {
    return header.inspectState().lines as string[];
}

function frame(screen: MockTerminalBackend): string[] {
    return screen
        .screenToString()
        .split("\n")
        .map((row) => row.replace(/\s+$/, ""));
}

describe("ExtensionPageHeaderElement", () => {
    it("до раскладки строк нет, но кнопки уже собраны — страницу фокусируют раньше первого кадра", () => {
        const header = createHeader({ buttons: [INSTALL, UNINSTALL] });

        expect(lines(header)).toEqual([]);
        expect(header.getButtons().map((b) => b.getLabel())).toEqual(["Install", "Uninstall"]);
    });

    it("высота = строки под этой шириной плюс ряд кнопок с зазором", () => {
        const header = createHeader();

        // The answer must be honest before layout: the parent ("header on
        // top, body below") allots space by it in the same pass.
        const height = header.getMaxIntrinsicHeight(40);
        expect(height).toBe(lines(header).length + 2);
        expect(lines(header)).toEqual([
            "Acme Tools",
            "acme.tools",
            "Tools for acme",
            "",
            "Not installed",
            "Latest version: 1.0.0",
            "",
        ]);
    });

    it("раскладка сама собирает строки — шапку можно рисовать и без родителя", () => {
        const header = createHeader();
        const screen = renderElement(header, 40, 12, { themeVars: true });

        expect(lines(header).length).toBeGreaterThan(0);
        // One-column left indent, like the page body.
        expect(frame(screen)[0]).toBe(" Acme Tools");
        expect(header.querySelector("#extensionPageHeaderLine-0")).not.toBeNull();
    });

    it("ряд кнопок идёт под текстом: два пробела между кнопками и пустая строка под ними", () => {
        const header = createHeader({ buttons: [INSTALL, UNINSTALL] });
        const rows = frame(renderElement(header, 40, 12, { themeVars: true }));
        const buttonRow = rows.findIndex((row) => row.includes("[ Install ]"));

        expect(rows[buttonRow]).toBe(" [ Install ]  [ Uninstall ]");
        // The spacer under the buttons separates the header from the readme.
        expect(rows[buttonRow + 1]).toBe("");
    });

    it("перенос считает по ширине минус отступ и колонку под бегунок", () => {
        const long = content({ entry: { ...ENTRY, description: "alpha beta gamma delta epsilon zeta eta theta" } });
        const header = createHeader({ content: long });
        renderElement(header, 20, 12, { themeVars: true });

        // Reference lines ("Latest version: …") don't wrap, they are short
        // by construction; look at the description, which is longer than the width.
        const wrapped = lines(header).filter((l) => /^(alpha|delta|eta|zeta|beta|gamma|epsilon|theta)/.test(l));
        expect(wrapped.length).toBeGreaterThan(1);
        expect(Math.max(...wrapped.map((l) => l.length))).toBeLessThanOrEqual(18);
    });

    it("смена ширины пересобирает перенос", () => {
        const long = content({ entry: { ...ENTRY, description: "alpha beta gamma delta epsilon zeta eta theta" } });
        const header = createHeader({ content: long });
        renderElement(header, 60, 12, { themeVars: true });
        const wide = lines(header).length;

        renderElement(header, 20, 12, { themeVars: true });
        expect(lines(header).length).toBeGreaterThan(wide);
    });

    it("тон строки виден цветом: имя, справочная строка и ошибка операции", () => {
        const header = createHeader({ content: content({ operationError: "install failed" }) });
        const screen = renderElement(header, 60, 12, { themeVars: true });
        const rendered = lines(header);
        const fg = (row: number): number => screen.getFgAt(new Point(1, row));

        expect(fg(rendered.indexOf("acme.tools"))).not.toBe(fg(rendered.indexOf("Acme Tools")));
        expect(fg(rendered.indexOf("install failed"))).not.toBe(fg(rendered.indexOf("Acme Tools")));
        expect(fg(rendered.indexOf("install failed"))).not.toBe(fg(rendered.indexOf("acme.tools")));
    });

    it("выключенная кнопка не берёт фокус, гаснет текстом, но остаётся кнопкой", () => {
        const disabled = createHeader({ buttons: [{ kind: "install", label: "Install", enabled: false }] });
        const disabledScreen = renderElement(disabled, 40, 12, { themeVars: true });
        const enabled = createHeader();
        const enabledScreen = renderElement(enabled, 40, 12, { themeVars: true });

        expect(disabled.getButtons()[0].focusable).toBe(false);
        expect(disabled.focusFirstEnabledButton()).toBe(false);

        const row = frame(disabledScreen).findIndex((r) => r.includes("[ Install ]"));
        const at = new Point(3, row);
        // The text is dimmed…
        expect(disabledScreen.getFgAt(at)).not.toBe(enabledScreen.getFgAt(at));
        // …but the background is the same: a disabled button stays a button and doesn't turn
        // into a line of text.
        expect(disabledScreen.getBgAt(at)).toBe(enabledScreen.getBgAt(at));
    });

    it("Enter на кнопке зовёт обработчик, фокус встаёт на первую доступную", () => {
        const onActivate = vi.fn();
        const header = createHeader({ buttons: [INSTALL, UNINSTALL], onActivate });
        TestApp.createWithContent(header).render();

        expect(header.focusFirstEnabledButton()).toBe(true);
        const install = header.querySelector("#extensionPageButton-install") as ButtonElement;
        expect(install.isFocused).toBe(true);
        install.onActivate?.();
        expect(onActivate).toHaveBeenCalledExactlyOnceWith("install");
    });

    it("setContent перерисовывает и текст, и ряд кнопок", () => {
        const header = createHeader();
        const app = TestApp.createWithContent(header);
        app.render();
        expect(app.backend.screenToString()).toContain("[ Install ]");

        header.setContent(content({ entry: { ...ENTRY, installedVersion: "1.0.0", availability: "installed" } }), [
            UNINSTALL,
        ]);
        app.render();

        // The frame updated without a resize, so the rebuild marked the tree dirty.
        const screen = app.backend.screenToString();
        expect(screen).toContain("Installed 1.0.0");
        expect(screen).toContain("[ Uninstall ]");
        expect(screen).not.toContain("[ Install ]");
    });
});
