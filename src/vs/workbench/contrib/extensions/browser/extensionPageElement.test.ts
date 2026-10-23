import { Point } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
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
    support: undefined,
    latestVersion: "1.0.0",
    installedVersion: null,
    availability: "available",
    pinned: false,
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
            support: undefined,
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

/** Focus lives in the root `FocusManager`; without a real tree `focus()` has nowhere to go. */
function mount(element: ExtensionPageElement): void {
    const app = TestApp.createWithContent(element);
    app.render();
}

/** Sends a key to the element; `true` means the page handled it (`preventDefault`). */
function press(target: TUIElement, key: string): boolean {
    const event = new TUIKeyboardEvent("keydown", { key });
    target.dispatchEvent(event);
    return event.defaultPrevented;
}

function lines(element: ExtensionPageElement): string[] {
    return element.inspectState().lines as string[];
}

function headerLines(element: ExtensionPageElement): string[] {
    const header = element.querySelector("#extensionPageHeader")!;
    return header.inspectState()!.lines as string[];
}

function buttonElement(element: ExtensionPageElement, kind: ExtensionButtonKind): ButtonElement {
    return element.querySelector(`#extensionPageButton-${kind}`) as ButtonElement;
}

describe("ExtensionPageElement", () => {
    it("before the first layout there are no lines — nothing to wrap", () => {
        const element = createPage();
        expect(lines(element)).toEqual([]);
        expect(headerLines(element)).toEqual([]);

        // Fresh data before layout produces no lines either: there is still no width, and
        // wrapping against an "empty" width would break everything.
        element.setContent(content({ metaError: "boom" }), [INSTALL]);
        expect(lines(element)).toEqual([]);
        expect(headerLines(element)).toEqual([]);
    });

    it("a repeated layout at the same width does not rebuild lines — the cursor stays put", () => {
        const element = createPage();
        renderElement(element, 40, 16, { themeVars: true });
        const list = element.querySelector("#extensionPageLines") as ListViewElement;
        list.setCursorTo("extensionPageLine-2");

        renderElement(element, 40, 16, { themeVars: true });
        // Rebuilding lines would reset the cursor to the start, and with it the
        // scroll of a long readme on every frame.
        expect(list.getCursorElement()?.id).toBe("extensionPageLine-2");
    });

    it("the header and buttons are in the frame, the readme below them", () => {
        const element = createPage({ buttons: [INSTALL, UNINSTALL] });
        const screen = renderElement(element, 40, 16, { themeVars: true });
        const frame = screen.screenToString().split("\n");

        expect(frame[0].startsWith(" Acme Tools")).toBe(true);
        const buttonRow = frame.findIndex((row) => row.includes("[ Install ]"));
        const readmeRow = frame.findIndex((row) => row.includes("alpha"));
        expect(frame[buttonRow]).toContain("[ Uninstall ]");
        // Buttons are pinned above the text: the readme starts below the row.
        expect(readmeRow).toBeGreaterThan(buttonRow);
    });

    it("the readme is indented by a column on the left — like sidebar lists", () => {
        const element = createPage();
        const rows = renderElement(element, 40, 16, { themeVars: true }).screenToString().split("\n");

        const readmeRow = rows.find((row) => row.includes("alpha"))!;
        expect(readmeRow.startsWith(" alpha")).toBe(true);
    });

    it("wrapping accounts for the padding and the scrollbar column", () => {
        const element = createPage();
        renderElement(element, 20, 16, { themeVars: true });

        // Text width is the element width minus the left indent and the scrollbar on the right,
        // i.e. 18 columns per readme line.
        const readme = lines(element);
        expect(readme.length).toBeGreaterThan(1);
        expect(Math.max(...readme.map((l) => l.length))).toBeLessThanOrEqual(18);
    });

    it("a width change rewraps", () => {
        const element = createPage();
        renderElement(element, 40, 16, { themeVars: true });
        const wide = lines(element);

        renderElement(element, 20, 16, { themeVars: true });
        expect(lines(element).length).toBeGreaterThan(wide.length);
    });

    it("the line tone shows as color: name, info line and error are colored differently", () => {
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

    it("setContent redraws the page and the button row for new data", () => {
        const element = createPage();
        renderElement(element, 60, 20, { themeVars: true });
        expect(headerLines(element)).toContain("Not installed");

        element.setContent(content({ entry: { ...ENTRY, installedVersion: "1.0.0", availability: "installed" } }), [
            UNINSTALL,
        ]);

        expect(headerLines(element)).toContain("Installed 1.0.0");
        const frame = renderElement(element, 60, 20, { themeVars: true }).screenToString();
        expect(frame).toContain("Installed 1.0.0");
        expect(frame).toContain("[ Uninstall ]");
        expect(frame).not.toContain("[ Install ]");
    });

    it("Enter on a button calls the handler with its kind", () => {
        const onActivate = vi.fn();
        const element = createPage({ buttons: [INSTALL, UNINSTALL], onActivate });
        mount(element);

        buttonElement(element, "uninstall").dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onActivate).toHaveBeenCalledExactlyOnceWith("uninstall");
    });

    it("page focus lands on the first enabled action", () => {
        const element = createPage({ buttons: [INSTALL, UNINSTALL] });
        mount(element);

        element.focus();

        expect(buttonElement(element, "install").isFocused).toBe(true);
    });

    it("a disabled button takes no focus — it goes to the text", () => {
        const onActivate = vi.fn();
        const element = createPage({ buttons: [DISABLED_INSTALL], onActivate });
        mount(element);

        element.focus();

        const list = element.querySelector("#extensionPageLines") as ListViewElement;
        expect(list.isFocused).toBe(true);
        expect(buttonElement(element, "install").isFocused).toBe(false);
        // And it cannot be pressed: a disabled button has no handler.
        buttonElement(element, "install").dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
        expect(onActivate).not.toHaveBeenCalled();
    });

    it("arrows move along the button row and do not go past the edges", () => {
        const element = createPage({ buttons: [INSTALL, UNINSTALL] });
        mount(element);
        element.focus();
        const install = buttonElement(element, "install");
        const uninstall = buttonElement(element, "uninstall");

        expect(press(install, "ArrowRight")).toBe(true);
        expect(uninstall.isFocused).toBe(true);

        // The row ends after the last button: focus stays, and the page does not
        // swallow the key; otherwise nobody after it would see it.
        expect(press(uninstall, "ArrowRight")).toBe(false);
        expect(uninstall.isFocused).toBe(true);

        expect(press(uninstall, "ArrowLeft")).toBe(true);
        expect(install.isFocused).toBe(true);

        expect(press(install, "ArrowLeft")).toBe(false);
        expect(install.isFocused).toBe(true);
    });

    it("arrows outside the button row leave the page alone — that is readme navigation", () => {
        const element = createPage({ buttons: [INSTALL, UNINSTALL] });
        mount(element);
        const list = element.querySelector("#extensionPageLines") as ListViewElement;
        list.focus();

        // Focus is in the text: horizontal arrows must not pull it into the buttons.
        expect(press(list, "ArrowRight")).toBe(false);
        expect(press(list, "ArrowLeft")).toBe(false);
        expect(list.isFocused).toBe(true);
    });

    it("Tab moves focus between the buttons and the readme text", () => {
        const element = createPage({ buttons: [INSTALL] });
        mount(element);
        element.focus();
        const install = buttonElement(element, "install");
        const list = element.querySelector("#extensionPageLines") as ListViewElement;

        // The page takes Tab itself: the global indent must not get into it.
        expect(press(install, "Tab")).toBe(true);
        expect(list.isFocused).toBe(true);

        expect(press(list, "Tab")).toBe(true);
        expect(install.isFocused).toBe(true);
    });

    it("letters do not scroll the page: lines are created without a label", () => {
        const element = createPage();
        renderElement(element, 60, 20, { themeVars: true });
        const list = element.querySelector("#extensionPageLines") as ListViewElement;
        list.setCursorTo("extensionPageLine-0");

        // List quick search works only on row labels; the page has
        // none, so a letter does not move the cursor.
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "a" }));
        expect(list.getCursorElement()?.id).toBe("extensionPageLine-0");
    });
});
