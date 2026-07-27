import { describe, expect, it } from "vitest";

import { TUIElement } from "./tuiElement.ts";
import { querySelector, querySelectorAll } from "./tuiSelector.ts";

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

// These tests drive the `depth === 0` self-recursion branch (TUISelector.ts:69 / :91)
// for a SINGLE-part selector: the search must keep descending into a non-matching
// child even when there is only one selector part (selectors.length === 1, so the
// `selectors.length > 1` half is false and only `depth === 0` keeps recursion alive).

describe("querySelector — single-part deep descent (line 69)", () => {
    it("finds a deeply nested match by descending through non-matching ancestors", () => {
        // root > wrapperA(no role) > wrapperB(no role) > target(@button)
        const root = new Container();
        const wrapperA = new Container();
        const wrapperB = new Container();
        const target = leaf("button");
        wrapperB.addChild(target);
        wrapperA.addChild(wrapperB);
        root.addChild(wrapperA);

        expect(querySelector(root, "@button")).toBe(target);
    });

    it("returns the first match in document order across sibling subtrees", () => {
        const root = new Container();
        const left = new Container();
        const right = new Container();
        const first = leaf("button");
        const second = leaf("button");
        left.addChild(first);
        right.addChild(second);
        root.addChild(left);
        root.addChild(right);

        expect(querySelector(root, "@button")).toBe(first);
    });

    it("returns null when a single-part selector matches nothing in the tree", () => {
        const root = new Container();
        const wrapper = new Container();
        wrapper.addChild(leaf("label"));
        root.addChild(wrapper);

        expect(querySelector(root, "@button")).toBeNull();
    });

    it("matches by id deep in the tree", () => {
        const root = new Container();
        const wrapper = new Container();
        const target = leaf(undefined, "save");
        wrapper.addChild(target);
        root.addChild(wrapper);

        expect(querySelector(root, "#save")).toBe(target);
    });
});

describe("querySelectorAll — single-part deep descent (line 91)", () => {
    it("collects every match across all depths and subtrees", () => {
        const root = new Container();
        const wrapper = new Container();
        const a = leaf("button");
        const nested = new Container();
        const b = leaf("button");
        nested.addChild(b);
        wrapper.addChild(a);
        wrapper.addChild(nested);
        root.addChild(wrapper);

        expect(querySelectorAll(root, "@button")).toEqual([a, b]);
    });

    it("returns an empty array when nothing matches", () => {
        const root = new Container();
        root.addChild(leaf("label"));

        expect(querySelectorAll(root, "@button")).toEqual([]);
    });
});
