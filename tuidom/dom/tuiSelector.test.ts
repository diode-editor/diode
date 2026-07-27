import { describe, expect, it } from "vitest";

import { TUIElement } from "./tuiElement.ts";
import { parseSelector, querySelector, querySelectorAll } from "./tuiSelector.ts";

// ─── Helpers ───

class Container extends TUIElement {
    public addChild(child: TUIElement): this {
        this.appendChild(child);
        return this;
    }
}

function leaf(role?: string, id?: string): TUIElement {
    const el = new TUIElement();
    if (role) el.role = role;
    if (id) el.id = id;
    return el;
}

describe("parseSelector", () => {
    it("splits a multi-part descendant selector on whitespace", () => {
        const parts = parseSelector("@panel  @button");
        expect(parts).toHaveLength(2);
        expect(parts[0].role).toBe("panel");
        expect(parts[1].role).toBe("button");
    });

    it("parses combined tag/id/role into one part", () => {
        const [part] = parseSelector("Container@panel#main");
        expect(part.tag).toBe("Container");
        expect(part.role).toBe("panel");
        expect(part.id).toBe("main");
    });
});

describe("matchesSingleSelector — tag matching", () => {
    it("does not match a child whose constructor name differs from the tag", () => {
        // The selector "Container" requires constructor name Container; a plain
        // TUIElement leaf must be skipped (tag-mismatch → return false).
        const root = new Container();
        const wrongTag = leaf(); // constructor name "TUIElement"
        root.addChild(wrongTag);

        expect(querySelector(root, "Container")).toBeNull();
    });

    it("matches purely by role when the selector has no tag", () => {
        // A role-only selector leaves `tag` undefined, so the tag check short-circuits.
        const root = new Container();
        const target = leaf("button");
        root.addChild(target);

        expect(querySelector(root, "@button")).toBe(target);
    });
});

describe("querySelector — multi-part same-depth recursion (line 69)", () => {
    it("descends through a non-matching intermediate container to find the deep descendant", () => {
        // root > wrapper(no role) > panel(@panel) > inner(no role) > target(@button)
        // The descendant search for "@button" under @panel must recurse into a
        // child that does NOT match "@button" itself (the wrapper 'inner').
        const root = new Container();
        const panel = new Container();
        panel.role = "panel";
        const inner = new Container();
        const target = leaf("button");
        inner.addChild(target);
        panel.addChild(inner);
        const wrapper = new Container();
        wrapper.addChild(panel);
        root.addChild(wrapper);

        expect(querySelector(root, "@panel @button")).toBe(target);
    });

    it("returns null when the second part has no descendant match anywhere", () => {
        const root = new Container();
        const panel = new Container();
        panel.role = "panel";
        panel.addChild(leaf("label"));
        root.addChild(panel);

        expect(querySelector(root, "@panel @button")).toBeNull();
    });

    it("finds the match in a later sibling subtree after an earlier sibling has no match", () => {
        const root = new Container();
        const panelA = new Container();
        panelA.role = "panel"; // no @button descendant
        panelA.addChild(leaf("label"));
        const panelB = new Container();
        panelB.role = "panel";
        const btn = leaf("button");
        panelB.addChild(btn);
        root.addChild(panelA);
        root.addChild(panelB);

        expect(querySelector(root, "@panel @button")).toBe(btn);
    });
});

describe("querySelectorAll — multi-part same-depth recursion (line 91)", () => {
    it("collects matches across nested non-matching wrappers", () => {
        const root = new Container();
        const panel = new Container();
        panel.role = "panel";
        const wrapper = new Container(); // does not match @button
        const b1 = leaf("button");
        const b2 = leaf("button");
        wrapper.addChild(b1);
        wrapper.addChild(b2);
        panel.addChild(wrapper);
        root.addChild(panel);

        expect(querySelectorAll(root, "@panel @button")).toEqual([b1, b2]);
    });

    it("collects matches from multiple panel subtrees", () => {
        const root = new Container();
        const panelA = new Container();
        panelA.role = "panel";
        const a = leaf("button");
        panelA.addChild(a);
        const panelB = new Container();
        panelB.role = "panel";
        const b = leaf("button");
        panelB.addChild(b);
        root.addChild(panelA);
        root.addChild(panelB);

        expect(querySelectorAll(root, "@panel @button")).toEqual([a, b]);
    });
});
