import { describe, expect, it } from "vitest";

import { TUIElement } from "./tuiElement.ts";

// ─── Helpers ───

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

class EditorElement extends TUIElement {}

class MenuBarElement extends TUIElement {}

// ─── Tests ───

describe("TUIElement.querySelector", () => {
    it("returns null on element with no children", () => {
        const root = new ContainerElement();
        expect(root.querySelector("#anything")).toBeNull();
    });

    it("finds child by #id", () => {
        const root = new ContainerElement();
        const child = new TUIElement();
        child.id = "editor";
        root.addChild(child);

        expect(root.querySelector("#editor")).toBe(child);
    });

    it("finds child by @role", () => {
        const root = new ContainerElement();
        const child = new TUIElement();
        child.role = "menubar";
        root.addChild(child);

        expect(root.querySelector("@menubar")).toBe(child);
    });

    it("finds child by constructor name (tag)", () => {
        const root = new ContainerElement();
        const editor = new EditorElement();
        root.addChild(editor);

        expect(root.querySelector("EditorElement")).toBe(editor);
    });

    it("finds deeply nested child by #id", () => {
        const root = new ContainerElement();
        const middle = new ContainerElement();
        root.addChild(middle);
        const deep = new TUIElement();
        deep.id = "deep-target";
        middle.addChild(deep);

        expect(root.querySelector("#deep-target")).toBe(deep);
    });

    it("finds deeply nested child by @role", () => {
        const root = new ContainerElement();
        const middle = new ContainerElement();
        root.addChild(middle);
        const deep = new TUIElement();
        deep.role = "statusbar";
        middle.addChild(deep);

        expect(root.querySelector("@statusbar")).toBe(deep);
    });

    it("returns first match in depth-first order", () => {
        const root = new ContainerElement();
        const first = new TUIElement();
        first.role = "item";
        const second = new TUIElement();
        second.role = "item";
        root.addChild(first);
        root.addChild(second);

        expect(root.querySelector("@item")).toBe(first);
    });

    it("combines tag and #id", () => {
        const root = new ContainerElement();
        const editor = new EditorElement();
        editor.id = "main";
        root.addChild(editor);
        const other = new TUIElement();
        other.id = "main";
        root.addChild(other);

        expect(root.querySelector("EditorElement#main")).toBe(editor);
    });

    it("combines tag and @role", () => {
        const root = new ContainerElement();
        const menubar = new MenuBarElement();
        menubar.role = "navigation";
        root.addChild(menubar);
        const other = new TUIElement();
        other.role = "navigation";
        root.addChild(other);

        expect(root.querySelector("MenuBarElement@navigation")).toBe(menubar);
    });

    it("combines @role and #id", () => {
        const root = new ContainerElement();
        const a = new TUIElement();
        a.role = "panel";
        a.id = "left";
        root.addChild(a);
        const b = new TUIElement();
        b.role = "panel";
        b.id = "right";
        root.addChild(b);

        expect(root.querySelector("@panel#right")).toBe(b);
    });

    it("combines tag, @role and #id", () => {
        const root = new ContainerElement();
        const target = new EditorElement();
        target.role = "editor";
        target.id = "primary";
        root.addChild(target);

        expect(root.querySelector("EditorElement@editor#primary")).toBe(target);
    });

    it("returns null when no match found", () => {
        const root = new ContainerElement();
        const child = new TUIElement();
        child.id = "something";
        root.addChild(child);

        expect(root.querySelector("#nonexistent")).toBeNull();
    });

    it("does not match the element itself, only descendants", () => {
        const root = new ContainerElement();
        root.id = "root";
        expect(root.querySelector("#root")).toBeNull();
    });
});

describe("TUIElement.querySelectorAll", () => {
    it("returns empty array on element with no children", () => {
        const root = new ContainerElement();
        expect(root.querySelectorAll("@anything")).toEqual([]);
    });

    it("returns all matching elements by @role", () => {
        const root = new ContainerElement();
        const a = new TUIElement();
        a.role = "tab";
        const b = new TUIElement();
        b.role = "tab";
        const c = new TUIElement();
        c.role = "panel";
        root.addChild(a);
        root.addChild(b);
        root.addChild(c);

        expect(root.querySelectorAll("@tab")).toEqual([a, b]);
    });

    it("returns all matching elements by #id across tree", () => {
        const root = new ContainerElement();
        const container = new ContainerElement();
        root.addChild(container);
        const a = new TUIElement();
        a.id = "item";
        root.addChild(a);
        const b = new TUIElement();
        b.id = "item";
        container.addChild(b);

        const results = root.querySelectorAll("#item");
        expect(results).toHaveLength(2);
        expect(results).toContain(a);
        expect(results).toContain(b);
    });

    it("returns all matching elements by constructor name", () => {
        const root = new ContainerElement();
        const e1 = new EditorElement();
        const e2 = new EditorElement();
        const m1 = new MenuBarElement();
        root.addChild(e1);
        root.addChild(m1);
        root.addChild(e2);

        expect(root.querySelectorAll("EditorElement")).toEqual([e1, e2]);
    });

    it("returns results in depth-first order", () => {
        const root = new ContainerElement();
        const container = new ContainerElement();
        container.role = "group";
        root.addChild(container);
        const deep = new TUIElement();
        deep.role = "item";
        container.addChild(deep);
        const shallow = new TUIElement();
        shallow.role = "item";
        root.addChild(shallow);

        expect(root.querySelectorAll("@item")).toEqual([deep, shallow]);
    });
});

describe("TUIElement.querySelector descendant combinator", () => {
    it("finds element matching multi-part selector", () => {
        const root = new ContainerElement();
        const panel = new ContainerElement();
        panel.role = "panel";
        root.addChild(panel);
        const button = new TUIElement();
        button.role = "button";
        panel.addChild(button);

        expect(root.querySelector("@panel @button")).toBe(button);
    });

    it("skips elements that match first part but lack matching descendants", () => {
        const root = new ContainerElement();
        const panelA = new ContainerElement();
        panelA.role = "panel";
        root.addChild(panelA);

        const panelB = new ContainerElement();
        panelB.role = "panel";
        root.addChild(panelB);
        const button = new TUIElement();
        button.role = "button";
        panelB.addChild(button);

        expect(root.querySelector("@panel @button")).toBe(button);
    });

    it("handles deep nesting with descendant combinator", () => {
        const root = new ContainerElement();
        const sidebar = new ContainerElement();
        sidebar.role = "sidebar";
        root.addChild(sidebar);
        const list = new ContainerElement();
        list.role = "list";
        sidebar.addChild(list);
        const item = new TUIElement();
        item.role = "item";
        list.addChild(item);

        expect(root.querySelector("@sidebar @item")).toBe(item);
    });

    it("querySelectorAll with descendant combinator returns all matches", () => {
        const root = new ContainerElement();
        const panel = new ContainerElement();
        panel.role = "panel";
        root.addChild(panel);
        const btn1 = new TUIElement();
        btn1.role = "button";
        panel.addChild(btn1);
        const btn2 = new TUIElement();
        btn2.role = "button";
        panel.addChild(btn2);

        expect(root.querySelectorAll("@panel @button")).toEqual([btn1, btn2]);
    });
});
