import { packRgb } from "@tuidom/core/common/colorUtils";
import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { RenderContext } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import type { IViewWelcomeBlock, IViewWelcomeTarget } from "./viewWelcomeElement.ts";
import { ViewWelcomeElement } from "./viewWelcomeElement.ts";

const TEXT_FG = packRgb(1, 2, 3);
const LINK_FG = packRgb(4, 5, 6);
const DISABLED_FG = packRgb(7, 8, 9);
const FOCUS_FG = packRgb(10, 11, 12);
const FOCUS_BG = packRgb(13, 14, 15);

const VARS = {
    descriptionForeground: TEXT_FG,
    "textLink.foreground": LINK_FG,
    disabledForeground: DISABLED_FG,
    "button.foreground": FOCUS_FG,
    "button.background": FOCUS_BG,
};

/** Terraform's Providers welcome after a `.tf` without providers is opened. */
const PROVIDERS: readonly IViewWelcomeBlock[] = [
    {
        kind: "paragraph",
        nodes: [
            "There are no installed providers found. ",
            { label: "Learn more about providers", url: "https://example.invalid/providers" },
            ".",
        ],
    },
];

function make(blocks: readonly IViewWelcomeBlock[] = PROVIDERS): {
    readonly welcome: ViewWelcomeElement;
    readonly opened: IViewWelcomeTarget[];
} {
    const opened: IViewWelcomeTarget[] = [];
    const welcome = new ViewWelcomeElement(blocks, (target) => {
        opened.push(target);
    });
    return { welcome, opened };
}

const SCREEN = new Size(30, 6);

function paint(welcome: ViewWelcomeElement, width = SCREEN.width): TerminalScreen {
    const screen = new TerminalScreen(SCREEN);
    welcome.setStyleVars(VARS);
    welcome.layout(BoxConstraints.tight(new Size(width, SCREEN.height)));
    welcome.performStyleResolution(ROOT_STYLE_CONTEXT);
    welcome.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), SCREEN)));
    return screen;
}

function text(screen: TerminalScreen, y: number): string {
    let line = "";
    for (let x = 0; x < SCREEN.width; x++) line += screen.getCell(new Point(x, y)).char;
    return line.trimEnd();
}

/** `_` under an underlined cell, `.` under a link-colored one without underline, a space otherwise. */
function marks(screen: TerminalScreen, y: number): string {
    let line = "";
    for (let x = 0; x < SCREEN.width; x++) {
        const cell = screen.getCell(new Point(x, y));
        line += cell.style & StyleFlags.Underline ? "_" : " ";
    }
    return line.trimEnd();
}

function mouse(app: TestApp, x: number, y: number): void {
    const token = (action: MouseToken["action"]): MouseToken => ({
        kind: "mouse",
        action,
        button: "left",
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    });
    app.backend.simulateMouse(token("press"));
    app.backend.simulateMouse(token("release"));
}

describe("ViewWelcomeElement — links in text", () => {
    it("a link shows its label in the wrapped text, underlined in the link color", () => {
        const screen = paint(make().welcome);

        expect([0, 1, 2].map((y) => text(screen, y))).toEqual([
            " There are no installed",
            " providers found. Learn more",
            " about providers.",
        ]);
        // The space between two words of the label belongs to the link; the one before it does not.
        expect([1, 2].map((y) => marks(screen, y))).toEqual(["                  __________", " _______________"]);
        expect(screen.getCell(new Point(18, 1)).fg).toBe(LINK_FG);
        expect(screen.getCell(new Point(1, 1)).fg).toBe(TEXT_FG);
        expect(screen.getCell(new Point(16, 2)).fg).toBe(TEXT_FG);
    });

    it("several links in a line, each its own run", () => {
        const { welcome } = make([
            {
                kind: "paragraph",
                nodes: ["a ", { label: "one", command: "x" }, " b ", { label: "two", command: "y" }],
            },
        ]);
        const screen = paint(welcome);

        expect(text(screen, 0)).toBe(" a one b two");
        expect(marks(screen, 0)).toBe("   ___   ___");
    });

    it("wide characters keep the columns of the runs after them", () => {
        const { welcome } = make([{ kind: "paragraph", nodes: ["日本 ", { label: "リンク", command: "x" }, " ok"] }]);
        const screen = paint(welcome);

        // `日本` takes four columns, so the link starts at column 6.
        expect(marks(screen, 0)).toBe("      ______");
        expect(screen.getCell(new Point(13, 0)).char).toBe("o");
    });

    it("a click on a link opens its target, a click on plain text does nothing", () => {
        const { welcome, opened } = make();
        const app = TestApp.createWithContent(welcome, SCREEN);
        app.render();

        mouse(app, 3, 0);
        expect(opened).toEqual([]);
        mouse(app, 20, 1);
        expect(opened).toEqual([{ label: "Learn more about providers", url: "https://example.invalid/providers" }]);
    });

    it("a click on the wrapped part of a link opens it too", () => {
        const { welcome, opened } = make();
        const app = TestApp.createWithContent(welcome, SCREEN);
        app.render();

        mouse(app, 8, 2);
        expect(opened).toHaveLength(1);
        // The period after the link is not part of it.
        mouse(app, 16, 2);
        expect(opened).toHaveLength(1);
    });

    it("Tab focuses the link, Enter and Space open it; the focused link looks like a focused button", () => {
        const { welcome, opened } = make([
            { kind: "paragraph", nodes: ["See ", { label: "docs", command: "show.docs", args: [1] }] },
            { kind: "button", label: "Go", command: "go" },
        ]);
        const app = TestApp.createWithContent(welcome, SCREEN);
        app.render();

        app.sendKey("Tab");
        expect(welcome.getChildren()).toContain(app.focusedElement);
        expect(app.focusedElement).not.toBeInstanceOf(ButtonElement);
        app.sendKey("Enter");
        app.sendKey(" ");
        expect(opened).toEqual([
            { label: "docs", command: "show.docs", args: [1] },
            { label: "docs", command: "show.docs", args: [1] },
        ]);
        app.render();
        expect(app.backend.getBgAt(new Point(5, 0))).toBe(welcome.styleVar("button.background"));
        expect(app.backend.getFgAt(new Point(5, 0))).toBe(welcome.styleVar("button.foreground"));

        // Tab goes on to the button: links and buttons are in block order.
        app.sendKey("Tab");
        expect(app.focusedElement).toBeInstanceOf(ButtonElement);
        app.render();
        expect(app.backend.getBgAt(new Point(5, 0))).toBe(app.backend.getBgAt(new Point(1, 0)));
    });

    it("focusFirstButton skips links: they are not buttons", () => {
        const { welcome } = make([{ kind: "paragraph", nodes: [{ label: "docs", command: "x" }] }]);
        TestApp.createWithContent(welcome, SCREEN);

        expect(welcome.focusFirstButton()).toBe(false);
    });

    it("a link whose label is only the spaces wrapping drops is drawn as nothing and opens nothing", () => {
        const { welcome, opened } = make([{ kind: "paragraph", nodes: ["x", { label: "   ", command: "c" }] }]);
        const app = TestApp.createWithContent(welcome, SCREEN);
        app.render();

        expect(app.backend.getTextAt(new Point(0, 0), 4)).toBe(" x  ");
        mouse(app, 2, 0);
        mouse(app, 0, 0);
        expect(opened).toEqual([]);
    });
});

describe("ViewWelcomeElement — enablement", () => {
    const blocks: readonly IViewWelcomeBlock[] = [
        { kind: "paragraph", nodes: ["Run ", { label: "init", command: "tf.init", enablement: "ready" }] },
        { kind: "button", label: "Open Settings", command: "tf.settings", enablement: "ready" },
        { kind: "button", label: "Always", command: "always" },
    ];

    it("while false, the button and the command link are dimmed and do nothing", () => {
        const { welcome, opened } = make(blocks);
        welcome.updateEnablement(() => false);
        const screen = paint(welcome);

        expect(marks(screen, 0)).toBe("");
        expect(screen.getCell(new Point(5, 0)).fg).toBe(DISABLED_FG);
        expect(screen.getCell(new Point(3, 1)).fg).toBe(DISABLED_FG);

        const app = TestApp.createWithContent(welcome, SCREEN);
        app.render();
        mouse(app, 5, 0);
        mouse(app, 3, 1);
        mouse(app, 3, 2);
        expect(opened).toEqual([{ kind: "button", label: "Always", command: "always" }]);
    });

    it("a disabled button and link are out of the Tab order, focusFirstButton takes the next button", () => {
        const { welcome } = make(blocks);
        welcome.updateEnablement(() => false);
        const app = TestApp.createWithContent(welcome, SCREEN);

        expect(welcome.focusFirstButton()).toBe(true);
        expect((app.focusedElement as ButtonElement).getLabel()).toBe("Always");
        expect(welcome.getDepthFirstFocusableOrder()).toEqual([app.focusedElement]);
    });

    it("turning true again restores the look and the action", () => {
        const { welcome, opened } = make(blocks);
        const before = paint(welcome);
        const enabledButtonFg = before.getCell(new Point(3, 1)).fg;
        welcome.updateEnablement(() => false);
        welcome.updateEnablement(() => true);
        const screen = paint(welcome);

        expect(marks(screen, 0)).toBe("     ____");
        expect(screen.getCell(new Point(3, 1)).fg).toBe(enabledButtonFg);
        const app = TestApp.createWithContent(welcome, SCREEN);
        app.render();
        mouse(app, 5, 0);
        mouse(app, 3, 1);
        expect(opened.map((target) => ("command" in target ? target.command : target.url))).toEqual([
            "tf.init",
            "tf.settings",
        ]);
    });

    it("the clause is asked per entry, and entries without one are left alone", () => {
        const { welcome } = make(blocks);
        const asked: string[] = [];
        welcome.updateEnablement((clause) => {
            asked.push(clause);
            return true;
        });

        expect(asked).toEqual(["ready", "ready"]);
    });
});
