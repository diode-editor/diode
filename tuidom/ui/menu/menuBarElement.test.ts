import { describe, expect, it, vi } from "vitest";

import { expectScreen, screen } from "../../../src/TestUtils/expectScreen.ts";
import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TuiApplication } from "../../dom/tuiApplication.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import type { MouseToken } from "../../input/rawTerminalToken.ts";
import { BodyElement } from "../body/bodyElement.ts";
import { VStackElement } from "../layout/vStackElement.ts";

import type { MenuBarItem } from "./menuBarElement.ts";
import { MenuBarElement } from "./menuBarElement.ts";

class FocusableChild extends TUIElement {
    public constructor() {
        super();
        this.focusable = true;
    }

    public render(): void {
        // noop
    }
}

function renderMenuBar(
    items: MenuBarItem[],
    width = 30,
    height = 10,
): { backend: MockTerminalBackend; menuBar: MenuBarElement } {
    const menuBar = new MenuBarElement(items);
    const backend = renderElement(menuBar, width, height);
    return { backend, menuBar };
}

function setupWithBody(
    items: MenuBarItem[],
    childCount = 2,
    width = 30,
    height = 15,
): {
    backend: MockTerminalBackend;
    app: TuiApplication;
    menuBar: MenuBarElement;
    children: FocusableChild[];
    body: BodyElement;
} {
    const backend = new MockTerminalBackend(new Size(width, height));
    const app = new TuiApplication(backend);

    const body = new BodyElement();
    const menuBar = new MenuBarElement(items);
    const stack = new VStackElement();

    const children: FocusableChild[] = [];
    for (let i = 0; i < childCount; i++) {
        const child = new FocusableChild();
        stack.addChild(child, { width: "fill", height: 3 });
        children.push(child);
    }

    body.setMenuBar(menuBar);
    body.setContent(stack);
    app.root = body;
    app.run();

    return { backend, app, menuBar, children, body };
}

function simpleItems(): MenuBarItem[] {
    return [
        { label: "File", entries: [{ label: "New" }, { label: "Open" }, { label: "Save" }] },
        { label: "Edit", entries: [{ label: "Undo" }, { label: "Redo" }] },
        { label: "View", entries: [{ label: "Zoom In" }, { label: "Zoom Out" }] },
    ];
}

describe("MenuBarElement", () => {
    describe("rendering", () => {
        it("renders menu bar with item labels", () => {
            const { backend } = renderMenuBar(simpleItems());
            const firstLine = backend.getTextAt(new Point(0, 0), 30);
            expect(firstLine).toContain("File");
            expect(firstLine).toContain("Edit");
            expect(firstLine).toContain("View");
        });

        it("renders items as ' Label ' with padding", () => {
            const { backend } = renderMenuBar(simpleItems());
            const firstLine = backend.getTextAt(new Point(0, 0), 30);
            expect(firstLine).toContain(" File ");
            expect(firstLine).toContain(" Edit ");
            expect(firstLine).toContain(" View ");
        });

        it("fills full width with spaces on the bar row", () => {
            const { backend } = renderMenuBar(simpleItems(), 40, 5);
            const firstLine = backend.getTextAt(new Point(0, 0), 40);
            expect(firstLine.length).toBe(40);
            for (const ch of firstLine) {
                expect(ch).not.toBe("\0");
            }
        });

        it("renders items at correct horizontal positions", () => {
            const { backend } = renderMenuBar(
                [
                    { label: "AB", entries: [] },
                    { label: "CD", entries: [] },
                ],
                20,
                3,
            );
            const firstLine = backend.getTextAt(new Point(0, 0), 20);
            expect(firstLine.slice(2, 6)).toBe(" AB ");
            expect(firstLine.slice(6, 10)).toBe(" CD ");
        });

        it("first menu item starts at x=2, not x=0", () => {
            const { backend } = renderMenuBar(simpleItems(), 30, 3);
            const firstLine = backend.getTextAt(new Point(0, 0), 30);
            expect(firstLine.slice(2, 8)).toBe(" File ");
            expect(firstLine.slice(0, 2)).toBe("  ");
        });
    });

    describe("focus management", () => {
        it("menuBar is focusable (focusable = true)", () => {
            const { menuBar } = setupWithBody(simpleItems());
            expect(menuBar.focusable).toBe(true);
        });

        it("Tab focuses menuBar first (before content children)", () => {
            const { backend, menuBar, children } = setupWithBody(simpleItems());

            backend.sendKey("Tab");
            expect(menuBar.isFocused).toBe(true);
            expect(children[0].isFocused).toBe(false);
        });

        it("focus sets activeIndex to 0 when no item was selected", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Tab");
            expect(menuBar.isFocused).toBe(true);
            expect(menuBar.activeIndex).toBe(0);
        });

        it("focus does not open popup", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Tab");
            expect(menuBar.isFocused).toBe(true);
            expect(menuBar.activeIndex).toBe(0);
            // No popup children
            expect(menuBar.isMenuOpen).toBe(false);
        });

        it("Tab past menuBar focuses first content child", () => {
            const { backend, menuBar, children } = setupWithBody(simpleItems());

            backend.sendKey("Tab"); // menuBar
            expect(menuBar.isFocused).toBe(true);

            backend.sendKey("Tab"); // child[0]
            expect(menuBar.isFocused).toBe(false);
            expect(children[0].isFocused).toBe(true);
        });

        it("blur deactivates menuBar", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Tab"); // menuBar focused
            expect(menuBar.activeIndex).toBe(0);

            backend.sendKey("Tab"); // focus moves away
            expect(menuBar.isFocused).toBe(false);
            expect(menuBar.activeIndex).toBe(-1);
        });

        it("remembers previous focused element on focus", () => {
            const { backend, menuBar, children } = setupWithBody(simpleItems());

            backend.sendKey("Tab"); // menuBar
            backend.sendKey("Tab"); // child[0]
            expect(children[0].isFocused).toBe(true);

            backend.sendKey("Tab"); // child[1]

            // Now focus menuBar via Shift+Tab cycling
            backend.sendKey("Shift+Tab"); // child[0]
            backend.sendKey("Shift+Tab"); // menuBar
            expect(menuBar.isFocused).toBe(true);
        });
    });

    describe("mnemonic interception", () => {
        it("Alt+letter on focused child opens menu on menuBar", () => {
            const { backend, menuBar, children } = setupWithBody(simpleItems());

            backend.sendKey("Tab"); // menuBar
            backend.sendKey("Tab"); // child[0]
            expect(children[0].isFocused).toBe(true);

            backend.sendKey("Alt+f");
            expect(menuBar.isFocused).toBe(true);
            expect(menuBar.activeIndex).toBe(0);
            expect(menuBar.isMenuOpen).toBe(true); // popup open
        });

        it("mnemonic opens correct menu item", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Tab"); // menuBar
            backend.sendKey("Tab"); // child[0]

            backend.sendKey("Alt+e");
            expect(menuBar.activeIndex).toBe(1);
        });

        it("mnemonic uses explicit mnemonic property", () => {
            const items: MenuBarItem[] = [
                { label: "File", mnemonic: "f", entries: [] },
                { label: "Edit", mnemonic: "x", entries: [] },
            ];
            const { backend, menuBar } = setupWithBody(items);

            backend.sendKey("Tab");
            backend.sendKey("Tab");

            backend.sendKey("Alt+x");
            expect(menuBar.activeIndex).toBe(1);
        });

        it("mnemonic match is case-insensitive", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Alt+F");
            expect(menuBar.activeIndex).toBe(0);
        });

        it("does not match mnemonic without Alt", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("f");
            expect(menuBar.activeIndex).toBe(-1);
        });

        it("does not match mnemonic with Ctrl+Alt", () => {
            const { menuBar, children } = setupWithBody(simpleItems());

            children[0].focus();
            children[0].dispatchEvent(new TUIKeyboardEvent("keydown", { key: "f", altKey: true, ctrlKey: true }));
            expect(menuBar.activeIndex).toBe(-1);
        });

        it("switching menu with mnemonic while another is open", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Alt+f");
            expect(menuBar.activeIndex).toBe(0);

            backend.sendKey("Alt+e");
            expect(menuBar.activeIndex).toBe(1);
        });
    });

    describe("keyboard navigation", () => {
        it("ArrowRight moves highlight to next item (no popup)", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Tab"); // menuBar focused, activeIndex=0
            expect(menuBar.activeIndex).toBe(0);

            backend.sendKey("ArrowRight");
            expect(menuBar.activeIndex).toBe(1);
            expect(menuBar.isMenuOpen).toBe(false); // no popup
        });

        it("ArrowLeft moves highlight to previous item (no popup)", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Tab");
            backend.sendKey("ArrowRight"); // activeIndex=1

            backend.sendKey("ArrowLeft");
            expect(menuBar.activeIndex).toBe(0);
            expect(menuBar.isMenuOpen).toBe(false);
        });

        it("ArrowRight wraps from last to first", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Tab"); // activeIndex=0
            backend.sendKey("ArrowRight"); // 1
            backend.sendKey("ArrowRight"); // 2

            backend.sendKey("ArrowRight"); // wraps to 0
            expect(menuBar.activeIndex).toBe(0);
        });

        it("ArrowLeft wraps from first to last", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Tab"); // activeIndex=0

            backend.sendKey("ArrowLeft"); // wraps to 2
            expect(menuBar.activeIndex).toBe(2);
        });

        it("ArrowDown opens popup for current item", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Tab"); // activeIndex=0
            expect(menuBar.isMenuOpen).toBe(false);

            backend.sendKey("ArrowDown");
            expect(menuBar.activeIndex).toBe(0);
            expect(menuBar.isMenuOpen).toBe(true); // popup open
        });

        it("Enter opens popup for current item", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Tab");
            backend.sendKey("Enter");
            expect(menuBar.isMenuOpen).toBe(true);
        });

        it("ArrowRight with popup open switches to next menu popup", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Alt+f"); // open File popup
            expect(menuBar.activeIndex).toBe(0);
            expect(menuBar.isMenuOpen).toBe(true);

            backend.sendKey("ArrowRight");
            expect(menuBar.activeIndex).toBe(1);
            expect(menuBar.isMenuOpen).toBe(true); // popup still open (different menu)
        });

        it("ArrowLeft with popup open switches to previous menu popup", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Alt+e"); // open Edit popup
            expect(menuBar.activeIndex).toBe(1);

            backend.sendKey("ArrowLeft");
            expect(menuBar.activeIndex).toBe(0);
            expect(menuBar.isMenuOpen).toBe(true);
        });

        it("ignores ArrowLeft/Right when no focus", () => {
            const { menuBar } = setupWithBody(simpleItems());

            menuBar.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowRight" }));
            expect(menuBar.activeIndex).toBe(-1);

            menuBar.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowLeft" }));
            expect(menuBar.activeIndex).toBe(-1);
        });
    });

    describe("escape behavior", () => {
        it("Escape from popup closes popup but keeps highlight", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Alt+f"); // open File popup
            expect(menuBar.isMenuOpen).toBe(true);

            backend.sendKey("Escape");
            expect(menuBar.isMenuOpen).toBe(false); // popup closed
            expect(menuBar.activeIndex).toBe(0); // highlight remains
            expect(menuBar.isFocused).toBe(true); // still focused
        });

        it("second Escape returns focus to previous element", () => {
            const { backend, menuBar, children } = setupWithBody(simpleItems());

            backend.sendKey("Tab"); // menuBar
            backend.sendKey("Tab"); // child[0]
            expect(children[0].isFocused).toBe(true);

            backend.sendKey("Alt+f"); // mnemonic → menuBar focused, popup open
            expect(menuBar.isFocused).toBe(true);

            backend.sendKey("Escape"); // close popup, keep highlight
            expect(menuBar.isFocused).toBe(true);
            expect(menuBar.activeIndex).toBe(0);

            backend.sendKey("Escape"); // return focus to child[0]
            expect(menuBar.isFocused).toBe(false);
            expect(menuBar.activeIndex).toBe(-1);
            expect(children[0].isFocused).toBe(true);
        });

        it("Escape without previous element just blurs", () => {
            const { backend, menuBar } = setupWithBody(simpleItems());

            backend.sendKey("Tab"); // menuBar (no previous)
            expect(menuBar.isFocused).toBe(true);

            backend.sendKey("Escape"); // no popup, no previous → blur
            expect(menuBar.isFocused).toBe(false);
            expect(menuBar.activeIndex).toBe(-1);
        });
    });

    describe("dropdown interaction", () => {
        it("renders dropdown menu when active", () => {
            const items: MenuBarItem[] = [{ label: "File", entries: [{ label: "New" }, { label: "Open" }] }];
            const { backend } = setupWithBody(items, 0, 20, 8);

            backend.sendKey("Alt+f");

            // Menu bar: 2-char spacer then " File " item (spacer aligns with Explorer heading)
            expect(backend.getTextAt(new Point(0, 0), 9)).toBe("   File  ");
            // Popup is positioned below the active item which is shifted right by the 2-char spacer
            expect(backend.getTextAt(new Point(2, 1), 8)).toBe("╭──────╮");
            expect(backend.getTextAt(new Point(2, 2), 8)).toBe("│ New  │");
            expect(backend.getTextAt(new Point(2, 3), 8)).toBe("│ Open │");
            expect(backend.getTextAt(new Point(2, 4), 8)).toBe("╰──────╯");
        });

        it("navigates dropdown with ArrowDown", () => {
            const items: MenuBarItem[] = [
                { label: "File", entries: [{ label: "New" }, { label: "Open" }, { label: "Save" }] },
            ];
            const { backend, menuBar } = setupWithBody(items, 0, 20, 10);

            backend.sendKey("Alt+f");
            backend.sendKey("ArrowDown");
            expect(menuBar.activeIndex).toBe(0); // menu bar stays on File
        });

        it("calls onSelect and fully deactivates on Enter", () => {
            const onNew = vi.fn();
            const items: MenuBarItem[] = [
                { label: "File", entries: [{ label: "New", onSelect: onNew }, { label: "Open" }] },
            ];
            const { backend, menuBar } = setupWithBody(items, 0, 20, 10);

            backend.sendKey("Alt+f");
            expect(menuBar.activeIndex).toBe(0);

            backend.sendKey("Enter");

            expect(onNew).toHaveBeenCalledOnce();
            expect(menuBar.activeIndex).toBe(-1);
            expect(menuBar.isFocused).toBe(false);
        });

        it("Escape in popup closes popup but keeps bar focused", () => {
            const items: MenuBarItem[] = [{ label: "File", entries: [{ label: "New" }] }];
            const { backend, menuBar } = setupWithBody(items, 0, 20, 10);

            backend.sendKey("Alt+f");
            expect(menuBar.activeIndex).toBe(0);
            expect(menuBar.isMenuOpen).toBe(true);

            backend.sendKey("Escape");
            expect(menuBar.activeIndex).toBe(0); // highlight stays
            expect(menuBar.isMenuOpen).toBe(false); // popup closed
            expect(menuBar.isFocused).toBe(true);
        });
    });

    describe("mouse interaction", () => {
        // Helpers: Items layout for simpleItems() = " File " (0..5), " Edit " (6..11), " View " (12..17)
        // MouseToken uses 1-based coords, so screen x=2 → token x=3

        function mouseClick(backend: MockTerminalBackend, screenX: number, screenY: number): void {
            const press: MouseToken = {
                kind: "mouse",
                button: "left",
                action: "press",
                x: screenX + 1,
                y: screenY + 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            };
            const release: MouseToken = {
                kind: "mouse",
                button: "left",
                action: "release",
                x: screenX + 1,
                y: screenY + 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            };
            backend.simulateMouse(press);
            backend.simulateMouse(release);
        }

        it("click on first item opens its popup", () => {
            const { backend, menuBar } = setupWithBody(simpleItems(), 0, 30, 10);

            mouseClick(backend, 2, 0); // inside " File "
            expect(menuBar.isFocused).toBe(true);
            expect(menuBar.activeIndex).toBe(0);
            expect(menuBar.isMenuOpen).toBe(true);
        });

        it("click on second item opens its popup", () => {
            const { backend, menuBar } = setupWithBody(simpleItems(), 0, 30, 10);

            mouseClick(backend, 8, 0); // inside " Edit "
            expect(menuBar.isFocused).toBe(true);
            expect(menuBar.activeIndex).toBe(1);
            expect(menuBar.isMenuOpen).toBe(true);
        });

        it("clicking same item again closes popup", () => {
            const { backend, menuBar } = setupWithBody(simpleItems(), 0, 30, 10);

            mouseClick(backend, 2, 0); // open File
            expect(menuBar.isMenuOpen).toBe(true);

            mouseClick(backend, 2, 0); // close File
            expect(menuBar.isMenuOpen).toBe(false);
        });

        it("clicking different item switches popup", () => {
            const { backend, menuBar } = setupWithBody(simpleItems(), 0, 30, 10);

            mouseClick(backend, 2, 0); // open File
            expect(menuBar.activeIndex).toBe(0);
            expect(menuBar.isMenuOpen).toBe(true);

            mouseClick(backend, 8, 0); // switch to Edit
            expect(menuBar.activeIndex).toBe(1);
            expect(menuBar.isMenuOpen).toBe(true);
        });

        it("click outside menu items does not open popup", () => {
            const { backend, menuBar } = setupWithBody(simpleItems(), 0, 30, 10);

            mouseClick(backend, 25, 0); // past all items
            expect(menuBar.activeIndex).toBe(-1);
            expect(menuBar.isMenuOpen).toBe(false);
        });
    });
});
