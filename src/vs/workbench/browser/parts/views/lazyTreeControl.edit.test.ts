import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { VFlexElement, vflexFixed } from "@tuidom/elements/layout/vFlexElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { bindWidgetGlyphs } from "../../../../platform/theme/browser/widgetGlyphs.ts";
import { StaticProductIconService } from "../../../../platform/theme/common/productIconService.ts";

import { type ILazyTreeSource, LazyTreeControl } from "./lazyTreeControl.ts";

interface INode {
    readonly key: string;
    value: string;
}

class Source implements ILazyTreeSource<INode> {
    public constructor(public readonly roots: INode[]) {}
    public getRoots(): readonly INode[] {
        return this.roots;
    }
    public getChildren(): readonly INode[] {
        return [];
    }
    public getKey(node: INode): string {
        return node.key;
    }
    public hasChildren(): boolean {
        return false;
    }
    public renderRow(node: INode): { text: string }[] {
        return [{ text: `${node.key}: ${node.value}` }];
    }
}

async function mount(): Promise<{ app: TestApp; tree: LazyTreeControl<INode>; source: Source; screen: () => string }> {
    const source = new Source([
        { key: "a", value: "1" },
        { key: "b", value: "2" },
    ]);
    const tree = new LazyTreeControl(source, { idPrefix: "t" });
    const app = TestApp.createWithContent(tree.element, new Size(30, 5));
    bindWidgetGlyphs(app.root, new StaticProductIconService(false));
    tree.list.focus();
    await tree.refresh();
    app.render();
    return {
        app,
        tree,
        source,
        screen: () => {
            app.render();
            return app.backend.screenToString();
        },
    };
}

function type(app: TestApp, text: string): void {
    for (const char of text) app.sendKey(char);
}

function rightClick(app: TestApp, x: number, y: number): void {
    const token = (action: MouseToken["action"]): MouseToken => ({
        kind: "mouse",
        button: "right",
        action,
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

describe("LazyTreeControl — row edit", () => {
    it("puts the value in an input over the row; typing replaces it and Enter hands the text over", async () => {
        const { app, tree, source, screen } = await mount();
        const done: [string, boolean][] = [];
        tree.edit(source.roots[1], { value: "2", onDone: (value, success) => done.push([value, success]) });
        app.render();
        expect(screen().split("\n")[1].trim()).toBe("2");

        type(app, "42");
        expect(screen().split("\n")[1].trim()).toBe("42");
        app.sendKey("Enter");

        expect(done).toEqual([["42", true]]);
        expect(screen().split("\n")[1].trim()).toBe("b: 2");
        // The list has the keys again.
        expect(app.focusedElement).toBe(tree.list);
    });

    it("a key that reaches the input after its edit ended does nothing more", async () => {
        const { app, tree, source } = await mount();
        const done: boolean[] = [];
        tree.edit(source.roots[0], { value: "1", onDone: (_value, success) => done.push(success) });
        const input = app.focusedElement;
        app.sendKey("Enter");
        input?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        expect(done).toEqual([true]);
    });

    it("an element the tree does not show is not edited; one it shows is", async () => {
        const { tree, source, screen } = await mount();
        expect(tree.edit({ key: "z", value: "9" }, { value: "9", onDone: () => undefined })).toBe(false);
        expect(screen().split("\n")[0].trim()).toBe("a: 1");
        expect(tree.edit(source.roots[0], { value: "1", onDone: () => undefined })).toBe(true);
    });

    it("leaving the input for another element ends the edit and leaves the focus there", async () => {
        const source = new Source([{ key: "a", value: "1" }]);
        const tree = new LazyTreeControl(source, { idPrefix: "t" });
        const other = new InputElement();
        const root = new VFlexElement();
        root.addChild(tree.element, { height: vflexFixed(3), width: "fill" });
        root.addChild(other, { height: vflexFixed(1), width: "fill" });
        const app = TestApp.createWithContent(root, new Size(30, 5));
        await tree.refresh();
        app.render();
        const done: boolean[] = [];
        tree.edit(source.roots[0], { value: "1", onDone: (_value, success) => done.push(success) });
        // The focus passes straight to the other element: the list does not take it on the way.
        let listFocused = 0;
        tree.list.addEventListener("focus", () => listFocused++);

        other.focus();

        expect(done).toEqual([true]);
        expect(app.focusedElement).toBe(other);
        expect(listFocused).toBe(0);
    });

    it("Escape ends the edit without success and leaves the row as it was", async () => {
        const { app, tree, source, screen } = await mount();
        const done: [string, boolean][] = [];
        tree.edit(source.roots[0], { value: "1", onDone: (value, success) => done.push([value, success]) });
        type(app, "9");
        app.sendKey("Escape");

        expect(done).toEqual([["9", false]]);
        expect(screen().split("\n")[0].trim()).toBe("a: 1");
    });

    it("leaving the input ends the edit with success, as upstream's blur", async () => {
        const { tree, source } = await mount();
        const done: [string, boolean][] = [];
        tree.edit(source.roots[0], { value: "1", onDone: (value, success) => done.push([value, success]) });
        tree.list.focus();

        expect(done).toEqual([["1", true]]);
    });

    it("a refresh during the edit keeps the input with its text and its focus", async () => {
        const { app, tree, source, screen } = await mount();
        const done: string[] = [];
        tree.edit(source.roots[0], { value: "1", onDone: (value) => done.push(value) });
        type(app, "7");
        await tree.refresh();
        type(app, "8");

        expect(screen().split("\n")[0].trim()).toBe("78");
        expect(done).toEqual([]);
    });

    it("shows the error of the last try after the input; a second edit ends the first one without success", async () => {
        const { tree, source, screen } = await mount();
        const done: [string, boolean][] = [];
        tree.edit(source.roots[0], {
            value: "x",
            error: "bad",
            onDone: (value, success) => done.push([value, success]),
        });
        expect(screen().split("\n")[0]).toContain("x");
        expect(screen().split("\n")[0]).toContain(" bad");

        tree.edit(source.roots[1], { value: "2", onDone: () => undefined });
        expect(done).toEqual([["x", false]]);
    });
});

describe("LazyTreeControl — context menu", () => {
    it("a right click on a row hands its element over, the cursor already on it", async () => {
        const { app, tree } = await mount();
        const opened: string[] = [];
        tree.onContextMenu = (node, x, y) => opened.push(`${node?.key ?? "none"}@${x},${y}`);

        rightClick(app, 3, 1);
        await flushMicrotasks();

        expect(opened).toEqual(["b@3,1"]);
        expect(tree.focused?.key).toBe("b");
    });

    it("the element still reaches the owner when the click's selection has rebuilt the rows", async () => {
        const { app, tree } = await mount();
        const opened: string[] = [];
        // The call stack focuses what the user picks, which repaints the tree at once.
        tree.onSelect = () => {
            tree.rerender();
        };
        tree.onContextMenu = (node) => opened.push(node?.key ?? "none");

        rightClick(app, 3, 1);
        await flushMicrotasks();

        expect(opened).toEqual(["b"]);
    });

    it("a right click below the rows hands over no element, once", async () => {
        const { app, tree } = await mount();
        const opened: string[] = [];
        tree.onContextMenu = (node, x, y) => opened.push(`${node?.key ?? "none"}@${x},${y}`);

        rightClick(app, 3, 3);
        await flushMicrotasks();

        expect(opened).toEqual(["none@3,3"]);
    });

    it("a tree whose owner has no menu takes a right click without harm", async () => {
        const { app, tree } = await mount();
        rightClick(app, 3, 1);
        rightClick(app, 3, 3);
        await flushMicrotasks();
        expect(tree.focused?.key).toBe("b");
    });

    it("Shift+F10 opens it on the row under the cursor", async () => {
        const { app, tree } = await mount();
        const opened: string[] = [];
        tree.onContextMenu = (node) => opened.push(node?.key ?? "none");

        app.sendKey("Shift+F10");

        expect(opened).toEqual(["a"]);
    });
});
