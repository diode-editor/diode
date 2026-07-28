import { describe, expect, it } from "vitest";

import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { MouseEventDispatcher } from "../../dom/events/mouseEventDispatcher.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import type { MouseToken } from "../../input/rawTerminalToken.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";

import { PanelContainerElement } from "./panelContainerElement.ts";

const BG = packRgb(7, 8, 9);
const TITLE_FG = packRgb(44, 55, 66);
const BORDER = packRgb(70, 80, 90);

// Layout: row 0 = top strip (`─` across), row 1 = tabs (indent 1, pad 1 → glyphs at x 2),
// rows 2.. = content indented by 2. "PROBLEMS" (8) → tab segment [1, 11), glyphs x 2..9;
// "OUTPUT" (6) → segment [11, 19), glyphs x 12..17.

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

/** A content element that paints one char at its top-left so we can spot it. */
class MarkerContent extends TUIElement {
    private readonly marker: string;
    public constructor(marker: string) {
        super();
        this.marker = marker;
    }
    public override render(context: RenderContext): void {
        context.setCell(0, 0, { char: this.marker });
    }
}

function makeToken(overrides: Partial<MouseToken> & { action: MouseToken["action"] }): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        x: 1,
        y: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
        ...overrides,
    };
}

function themed(): PanelContainerElement {
    const panel = new PanelContainerElement();
    panel.setStyles({ background: BG, titleForeground: TITLE_FG, borderColor: BORDER });
    return panel;
}

function renderPanel(panel: PanelContainerElement, size: Size): MockTerminalBackend {
    const backend = new MockTerminalBackend(size);
    const screen = new TerminalScreen(size);
    panel.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), size)));
    screen.flush(backend);
    return backend;
}

function layoutPanel(panel: PanelContainerElement, size: Size): void {
    panel.localPosition = new Offset(0, 0);
    panel.layout(BoxConstraints.tight(size));
}

describe("PanelContainerElement", () => {
    it("activates the first added view and tracks view ids", () => {
        const panel = themed();
        panel.addView({ id: "a", title: "PROBLEMS", content: null });
        panel.addView({ id: "b", title: "OUTPUT", content: null });
        expect(panel.getActiveViewId()).toBe("a");
        expect(panel.getViewIds()).toEqual(["a", "b"]);
    });

    it("switches the active view, ignoring unknown or already-active ids", () => {
        const panel = themed();
        panel.addView({ id: "a", title: "PROBLEMS", content: null });
        panel.addView({ id: "b", title: "OUTPUT", content: null });

        panel.setActiveView("nope");
        expect(panel.getActiveViewId()).toBe("a");
        panel.setActiveView("a"); // already active — no-op
        expect(panel.getActiveViewId()).toBe("a");
        panel.setActiveView("b");
        expect(panel.getActiveViewId()).toBe("b");
    });

    it("draws a flat top border strip in the border colour, with no left border", () => {
        const panel = themed();
        panel.addView({ id: "a", title: "P", content: null });
        layoutPanel(panel, new Size(40, 6));
        const backend = renderPanel(panel, new Size(40, 6));

        // Row 0 is a plain horizontal line across the full width.
        expect(backend.getTextAt(new Point(0, 0), 1)).toBe("─");
        expect(backend.getTextAt(new Point(20, 0), 1)).toBe("─");
        expect(backend.getFgAt(new Point(0, 0))).toBe(BORDER);
        expect(backend.getBgAt(new Point(0, 0))).toBe(BG);
        // No vertical left border on the body rows.
        expect(backend.getTextAt(new Point(0, 1), 1)).toBe(" ");
        expect(backend.getTextAt(new Point(0, 3), 1)).toBe(" ");
    });

    it("draws indented, dim tab titles on the header row", () => {
        const panel = themed();
        panel.addView({ id: "a", title: "PROBLEMS", content: null });
        panel.addView({ id: "b", title: "OUTPUT", content: null });
        layoutPanel(panel, new Size(40, 6));
        const backend = renderPanel(panel, new Size(40, 6));

        // Tabs sit on row 1, indented; both drawn dim.
        expect(backend.getTextAt(new Point(2, 1), 8)).toBe("PROBLEMS");
        expect(backend.getTextAt(new Point(12, 1), 6)).toBe("OUTPUT");
        expect(backend.getFgAt(new Point(2, 1))).toBe(TITLE_FG);
        expect(backend.getFgAt(new Point(12, 1))).toBe(TITLE_FG);
        expect(backend.getBgAt(new Point(2, 1))).toBe(BG);
    });

    it("renders the placeholder empty-state indented under the tab label", () => {
        const panel = themed();
        panel.addView({ id: "a", title: "PROBLEMS", content: null, placeholder: "No problems." });
        layoutPanel(panel, new Size(40, 6));
        const backend = renderPanel(panel, new Size(40, 6));
        // Placeholder starts on the first content row (2), aligned under the tab label (x 2).
        expect(backend.getTextAt(new Point(2, 2), 12)).toBe("No problems.");
    });

    it("does not paint a placeholder when there is no room for a content row", () => {
        const panel = themed();
        panel.addView({ id: "a", title: "P", content: null, placeholder: "hidden" });
        layoutPanel(panel, new Size(40, 2)); // strip row + tab row only
        const backend = renderPanel(panel, new Size(40, 2));
        // The tab header still shows; the placeholder (row 2) is never drawn.
        expect(backend.getTextAt(new Point(2, 1), 1)).toBe("P");
    });

    it("renders and lays out the active view's content element indented below the header", () => {
        const panel = themed();
        const content = new MarkerContent("X");
        panel.addView({ id: "a", title: "P", content });
        layoutPanel(panel, new Size(40, 6));
        expect(content.layoutSize).toEqual(new Size(38, 4));
        expect(content.globalPosition).toEqual(new Point(2, 2));
        expect(panel.getChildren()).toEqual([content]);

        const backend = renderPanel(panel, new Size(40, 6));
        expect(backend.getTextAt(new Point(2, 2), 1)).toBe("X");
    });

    it("has no children and lays out nothing when the active view has no content", () => {
        const panel = themed();
        panel.addView({ id: "a", title: "P", content: null });
        layoutPanel(panel, new Size(40, 6));
        expect(panel.getChildren()).toEqual([]);
    });

    it("swaps a view's content, re-parenting old and new elements", () => {
        const panel = themed();
        const first = new MarkerContent("1");
        panel.addView({ id: "a", title: "P", content: first });
        const second = new MarkerContent("2");
        panel.setViewContent("a", second);
        expect(first.getParent()).toBeNull();
        expect(second.getParent()).toBe(panel);
        panel.setViewContent("a", null); // clearing back to a placeholder-only view
        expect(second.getParent()).toBeNull();
        panel.setViewContent("missing", first); // unknown id — no-op
        expect(panel.getChildren()).toEqual([]);
    });

    it("sets content on a view that started with none", () => {
        const panel = themed();
        panel.addView({ id: "a", title: "P", content: null });
        const content = new MarkerContent("Y");
        panel.setViewContent("a", content); // old content was already null
        expect(content.getParent()).toBe(panel);
        expect(panel.getChildren()).toEqual([content]);
    });

    describe("tab clicks", () => {
        function scene(): { root: ContainerElement; panel: PanelContainerElement; activated: string[] } {
            const root = new ContainerElement();
            root.setAsRoot();
            root.localPosition = new Offset(0, 0);
            root.layout(BoxConstraints.tight(new Size(40, 8)));

            const panel = themed();
            panel.addView({ id: "a", title: "PROBLEMS", content: null });
            panel.addView({ id: "b", title: "OUTPUT", content: null });
            panel.localPosition = new Offset(0, 0);
            panel.layout(BoxConstraints.tight(new Size(40, 8)));
            root.addChild(panel);

            const activated: string[] = [];
            panel.onActivateView = (id) => activated.push(id);
            return { root, panel, activated };
        }

        it("activates the clicked tab and fires the callback", () => {
            const { root, panel, activated } = scene();
            const dispatcher = new MouseEventDispatcher();
            // Click inside the OUTPUT tab: screen x 12 (token 13), header row 1 (token y 2).
            dispatcher.handleMouseToken(makeToken({ action: "press", x: 13, y: 2 }), root);
            expect(panel.getActiveViewId()).toBe("b");
            expect(activated).toEqual(["b"]);
        });

        it("ignores clicks off the header row (top strip or content)", () => {
            const { root, panel, activated } = scene();
            const dispatcher = new MouseEventDispatcher();
            dispatcher.handleMouseToken(makeToken({ action: "press", x: 13, y: 1 }), root); // top strip row 0
            dispatcher.handleMouseToken(makeToken({ action: "press", x: 13, y: 4 }), root); // content area
            expect(panel.getActiveViewId()).toBe("a");
            expect(activated).toEqual([]);
        });

        it("ignores clicks past the last tab", () => {
            const { root, panel, activated } = scene();
            const dispatcher = new MouseEventDispatcher();
            dispatcher.handleMouseToken(makeToken({ action: "press", x: 30, y: 2 }), root); // empty header space
            expect(panel.getActiveViewId()).toBe("a");
            expect(activated).toEqual([]);
        });

        it("ignores non-left clicks", () => {
            const { root, panel, activated } = scene();
            const dispatcher = new MouseEventDispatcher();
            dispatcher.handleMouseToken(makeToken({ action: "press", button: "right", x: 13, y: 2 }), root);
            expect(panel.getActiveViewId()).toBe("a");
            expect(activated).toEqual([]);
        });

        it("does not require an onActivateView callback", () => {
            const { root, panel } = scene();
            panel.onActivateView = undefined;
            const dispatcher = new MouseEventDispatcher();
            expect(() => {
                dispatcher.handleMouseToken(makeToken({ action: "press", x: 13, y: 2 }), root);
            }).not.toThrow();
            expect(panel.getActiveViewId()).toBe("b");
        });
    });

    it("renders with the default palette until the controller applies a theme", () => {
        const panel = new PanelContainerElement();
        panel.addView({ id: "a", title: "P", content: null, placeholder: "x" });
        layoutPanel(panel, new Size(10, 4));
        expect(() => renderPanel(panel, new Size(10, 4))).not.toThrow();
    });
});
