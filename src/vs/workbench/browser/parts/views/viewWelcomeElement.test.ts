import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import type { IViewWelcomeBlock } from "./viewWelcomeElement.ts";
import { ViewWelcomeElement } from "./viewWelcomeElement.ts";

/** Explorer's empty state, exactly what is rendered with no folder open. */
const EXPLORER_WELCOME: readonly IViewWelcomeBlock[] = [
    { kind: "text", text: "You have not yet opened a folder." },
    { kind: "text", text: "" },
    { kind: "button", label: "Open Folder", command: "workbench.action.files.openFolder" },
];

function make(blocks: readonly IViewWelcomeBlock[] = EXPLORER_WELCOME): {
    readonly welcome: ViewWelcomeElement;
    readonly ran: { command: string; args: readonly unknown[] }[];
} {
    const ran: { command: string; args: readonly unknown[] }[] = [];
    const welcome = new ViewWelcomeElement(blocks, (target) => {
        ran.push(
            "command" in target
                ? { command: target.command, args: target.args ?? [] }
                : { command: target.url, args: [] },
        );
    });
    return { welcome, ran };
}

function buttons(welcome: ViewWelcomeElement): ButtonElement[] {
    return welcome.getChildren().filter((child): child is ButtonElement => child instanceof ButtonElement);
}

/**
 * Frame lines without leading indent or trailing spaces: the welcome indent is its
 * alignment with the section header, while the test reads the content.
 */
function lines(backend: MockTerminalBackend, count: number): string[] {
    const width = backend.size.width;
    return Array.from({ length: count }, (_, y) => backend.getTextAt(new Point(0, y), width).trimEnd().trimStart());
}

describe("ViewWelcomeElement — rendering", () => {
    it("text word-wraps to the section width, the button is on its own row", () => {
        const { welcome } = make();
        const backend = renderElement(welcome, 29, 6, { themeVars: true });

        // Width 29 splits the upstream sentence into two lines; the gap stays empty.
        expect(lines(backend, 6)).toEqual(["You have not yet opened a", "folder.", "", "[ Open Folder ]", "", ""]);
    });

    it("on a wide section a paragraph fits in one row: wrapping invents nothing", () => {
        const { welcome } = make();
        const backend = renderElement(welcome, 40, 4, { themeVars: true });

        expect(lines(backend, 4)).toEqual(["You have not yet opened a folder.", "", "[ Open Folder ]", ""]);
    });

    it("re-rendering at another width recomputes wrapping", () => {
        const { welcome } = make();
        renderElement(welcome, 40, 4, { themeVars: true });
        const backend = renderElement(welcome, 29, 6, { themeVars: true });

        expect(lines(backend, 6)).toEqual(["You have not yet opened a", "folder.", "", "[ Open Folder ]", "", ""]);
    });

    it("several buttons each get their own row, in block order", () => {
        const { welcome } = make([
            { kind: "text", text: "Nothing here yet." },
            { kind: "button", label: "First", command: "first" },
            { kind: "button", label: "Second", command: "second" },
        ]);
        const backend = renderElement(welcome, 30, 3, { themeVars: true });

        expect(lines(backend, 3)).toEqual(["Nothing here yet.", "[ First ]", "[ Second ]"]);
    });

    it("a word wider than the section is cut, not lost", () => {
        const { welcome } = make([{ kind: "text", text: "unsplittableverylongword" }]);
        const backend = renderElement(welcome, 10, 3, { themeVars: true });

        // Section width is 10 and the indent takes one column, so cut at nine.
        expect(lines(backend, 3)).toEqual(["unsplitta", "bleverylo", "ngword"]);
    });

    it("text uses descriptionForeground, the same token as the plain hint", () => {
        const { welcome } = make();
        const backend = renderElement(welcome, 40, 3, { themeVars: true });

        expect(backend.getFgAt(new Point(1, 0))).toBe(welcome.resolvedStyle.fg);
    });
});

describe("ViewWelcomeElement — buttons", () => {
    it("a button runs its command with the declared arguments", () => {
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

    it("buttons are focusable, so the engine's Tab traversal reaches them", () => {
        const { welcome } = make();
        expect(welcome.getDepthFirstFocusableOrder()).toEqual(buttons(welcome));
    });

    it("focusFirstButton focuses the first button, and Enter on it runs the command", () => {
        const { welcome, ran } = make();
        const app = TestApp.createWithContent(welcome, new Size(30, 4));

        expect(welcome.focusFirstButton()).toBe(true);
        expect(app.focusedElement).toBe(buttons(welcome)[0]);

        app.sendKey("Enter");
        expect(ran).toEqual([{ command: "workbench.action.files.openFolder", args: [] }]);
    });

    it("Tab reaches the button even without focusFirstButton: the engine traversal sees it", () => {
        const { welcome, ran } = make();
        const app = TestApp.createWithContent(welcome, new Size(30, 4));

        app.sendKey("Tab");
        expect(app.focusedElement).toBe(buttons(welcome)[0]);
        app.sendKey(" ");
        expect(ran).toEqual([{ command: "workbench.action.files.openFolder", args: [] }]);
    });

    it("an empty state without buttons: focusFirstButton returns false and leaves focus alone", () => {
        const { welcome } = make([{ kind: "text", text: "No output yet." }]);
        const app = TestApp.createWithContent(welcome, new Size(30, 2));

        expect(welcome.focusFirstButton()).toBe(false);
        expect(app.focusedElement).toBeNull();
    });
});
