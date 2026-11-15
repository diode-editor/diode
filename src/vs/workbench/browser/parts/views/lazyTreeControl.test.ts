import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { bindWidgetGlyphs } from "../../../../platform/theme/browser/widgetGlyphs.ts";
import { StaticProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { type ILazyTreeOptions, type ILazyTreeSource, LazyTreeControl, LOADING_LABEL } from "./lazyTreeControl.ts";

interface INode {
    readonly key: string;
    readonly name: string;
    readonly value?: string;
    readonly children?: readonly INode[];
}

const vars = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));

/** A tree whose reads the test resolves by hand, so "Loading..." stays on screen as long as it wants. */
class Source implements ILazyTreeSource<INode> {
    public roots: readonly INode[];
    public readonly reads: string[] = [];
    public renders = 0;
    public manual = false;
    public readonly expandFirst = new Set<string>();
    private readonly pending: (() => void)[] = [];

    public constructor(roots: readonly INode[]) {
        this.roots = roots;
    }

    public getRoots(): readonly INode[] | Promise<readonly INode[]> {
        return this.roots;
    }

    /** Answers with the children as they were when asked: a late answer carries old data. */
    public getChildren(node: INode): readonly INode[] | Promise<readonly INode[]> {
        this.reads.push(node.key);
        const read = this.find(node.key)?.children ?? [];
        if (!this.manual) return read;
        return new Promise((resolve) =>
            this.pending.push(() => {
                resolve(read);
            }),
        );
    }

    public getKey(node: INode): string {
        return node.key;
    }

    public hasChildren(node: INode): boolean {
        return node.children !== undefined;
    }

    public isInitiallyExpanded(node: INode): boolean {
        return this.expandFirst.has(node.key);
    }

    public renderRow(node: INode): { text: string; fg?: string; bg?: string }[] {
        this.renders++;
        if (node.value === undefined) return [{ text: node.name }];
        return [
            { text: node.name, fg: "debugTokenExpression.name" },
            { text: ": " },
            { text: node.value, fg: "debugTokenExpression.number", bg: "debugView.valueChangedHighlight" },
        ];
    }

    public async resolveAll(): Promise<void> {
        for (const resolve of this.pending.splice(0)) resolve();
        await flush();
    }

    private find(key: string, nodes: readonly INode[] = this.roots): INode | undefined {
        for (const node of nodes) {
            if (node.key === key) return node;
            const found = this.find(key, node.children ?? []);
            if (found !== undefined) return found;
        }
        return undefined;
    }
}

async function flush(): Promise<void> {
    await flushMicrotasks(10);
}

function leaves(prefix: string, count: number): INode[] {
    return Array.from({ length: count }, (_, i) => ({ key: `${prefix}${i}`, name: `${prefix}${i}`, value: `${i}` }));
}

function locals(children: readonly INode[]): INode[] {
    return [{ key: "scope", name: "Locals", children }];
}

/** The `Locals` scope with the given children; `expanded` opens it on first sight. */
function scope(children: readonly INode[], expanded = false): Source {
    const source = new Source(locals(children));
    if (expanded) source.expandFirst.add("scope");
    return source;
}

/** Two scopes, `Locals` with `x` and `Globals` with `g`: the second one is not where a cleared cursor lands. */
function twoScopes(): Source {
    return new Source([
        { key: "scope", name: "Locals", children: [{ key: "x", name: "x", value: "1" }] },
        { key: "globals", name: "Globals", children: leaves("g", 2) },
    ]);
}

interface IMounted {
    app: TestApp;
    tree: LazyTreeControl<INode>;
    screen: () => string;
}

function attach(tree: LazyTreeControl<INode>, height: number): IMounted {
    const app = TestApp.createWithContent(tree.element, new Size(30, height));
    // Glyphs without a Nerd Font: the chevrons are plain characters a test can read.
    bindWidgetGlyphs(app.root, new StaticProductIconService(false));
    tree.list.focus();
    app.render();
    return {
        app,
        tree,
        screen: () => {
            app.render();
            return app.backend.screenToString();
        },
    };
}

async function mount(
    source: ILazyTreeSource<INode>,
    options: Partial<ILazyTreeOptions> & { height?: number } = {},
): Promise<IMounted> {
    const tree = new LazyTreeControl(source, { idPrefix: "t", ...options });
    const mounted = attach(tree, options.height ?? 10);
    await tree.refresh();
    mounted.app.render();
    return mounted;
}

/** The rows without the scrollbar column: the thumb shrinks as rows come. */
function text(screen: string): string {
    return screen
        .split("\n")
        .map((line) => line.slice(0, -2))
        .join("\n");
}

function lineOf(app: TestApp, text: string): Point {
    const lines = app.backend.screenToString().split("\n");
    const y = lines.findIndex((line) => line.includes(text));
    expect(y, `"${text}" on screen`).toBeGreaterThanOrEqual(0);
    return new Point(lines[y].indexOf(text), y);
}

describe("LazyTreeControl — rows", () => {
    it("paints name and value of a row in their own colors, a column in from the left edge", async () => {
        const { app } = await mount(new Source([{ key: "a", name: "count", value: "42" }]));

        const name = lineOf(app, "count: 42");
        expect(name.x).toBe(1);
        const at = (dx: number): Point => new Point(name.x + dx, name.y);
        expect(app.backend.getFgAt(at(0))).toBe(vars["debugTokenExpression.name"]);
        expect(app.backend.getFgAt(at(4))).toBe(vars["debugTokenExpression.name"]);
        // The separator has no color of its own: neither the name's nor the value's.
        expect(app.backend.getFgAt(at(5))).not.toBe(vars["debugTokenExpression.name"]);
        expect(app.backend.getFgAt(at(5))).not.toBe(vars["debugTokenExpression.number"]);
        for (const dx of [7, 8]) {
            expect(app.backend.getFgAt(at(dx))).toBe(vars["debugTokenExpression.number"]);
            expect(app.backend.getBgAt(at(dx))).toBe(vars["debugView.valueChangedHighlight"]);
        }
    });

    it("keeps a column free at the right edge", async () => {
        const { app } = await mount(new Source([{ key: "a", name: "x".repeat(40) }]));

        const line = app.backend.screenToString().split("\n")[0];
        // 30 columns: a column of padding, 28 of clipped text, a column of padding.
        expect(line).toBe(` ${"x".repeat(28)} `);
    });

    it("activation and typeahead reach the owner's element", async () => {
        const { app, tree } = await mount(new Source([...leaves("a", 2), { key: "b", name: "beta" }]));
        const activated: string[] = [];
        tree.onActivate = (node) => activated.push(node.key);

        app.sendKey("b");
        app.sendKey("Enter");

        expect(activated).toEqual(["b"]);
        expect(tree.focused?.key).toBe("b");
    });

    it("typeahead goes by the source's label when it gives one", async () => {
        const roots = [...leaves("a", 2), { key: "b", name: "beta" }];
        const { app, tree } = await mount({
            getRoots: () => roots,
            getChildren: () => [],
            getKey: (node) => node.key,
            hasChildren: () => false,
            renderRow: (node) => [{ text: node.name }],
            getLabel: (node) => (node.key === "a1" ? "zulu" : node.name),
        });

        app.sendKey("z");

        expect(tree.focused?.key).toBe("a1");
    });

    it("Collapse All before the first refresh has nothing to collapse", () => {
        const tree = new LazyTreeControl(new Source(leaves("a", 1)), { idPrefix: "t" });

        tree.collapseAll();

        expect(tree.list.rowCount).toBe(0);
    });

    it("an empty tree has no focused element, and Enter without a handler is harmless", async () => {
        const { app, tree } = await mount(new Source([]));
        expect(tree.focused).toBeUndefined();

        const filled = await mount(new Source(leaves("a", 1)));
        filled.app.sendKey("Enter");
        app.sendKey("Enter");
        expect(filled.tree.focused?.key).toBe("a0");
    });
});

describe("LazyTreeControl — lazy children", () => {
    const localsSource = (): Source => scope([{ key: "x", name: "x", value: "1" }]);

    it("a collapsed node has a chevron and reads nothing until expanded", async () => {
        const source = localsSource();
        const { screen } = await mount(source);

        expect(screen()).toContain("▸ Locals");
        expect(screen()).not.toContain("x: 1");
        expect(source.reads).toEqual([]);
    });

    it("a source without isInitiallyExpanded starts collapsed", async () => {
        const source = localsSource();
        const { screen } = await mount({
            getRoots: () => source.roots,
            getChildren: (node) => source.getChildren(node),
            getKey: (node) => node.key,
            hasChildren: (node) => source.hasChildren(node),
            renderRow: (node) => [{ text: node.name }],
        });

        expect(screen()).toContain("▸ Locals");
        expect(source.reads).toEqual([]);
    });

    it("expanding shows a muted Loading... row until the read lands, then the children", async () => {
        const source = localsSource();
        source.manual = true;
        const { app, screen } = await mount(source);

        app.sendKey("ArrowRight");
        await flush();

        expect(screen()).toContain("▾ Locals");
        expect(screen()).toContain(LOADING_LABEL);
        expect(app.backend.getFgAt(lineOf(app, LOADING_LABEL))).toBe(vars.descriptionForeground);
        expect(source.reads).toEqual(["scope"]);

        await source.resolveAll();

        expect(screen()).not.toContain(LOADING_LABEL);
        expect(screen()).toContain("x: 1");
    });

    it("Enter on the Loading... row activates nothing", async () => {
        const source = localsSource();
        source.manual = true;
        const { app, tree } = await mount(source);
        const activated: string[] = [];
        tree.onActivate = (node) => activated.push(node.key);
        app.sendKey("ArrowRight");
        await flush();

        app.sendKey("ArrowDown");
        app.sendKey("Enter");

        expect(tree.focused).toBeUndefined();
        expect(activated).toEqual([]);
    });

    it("reopening a node after Collapse All reads its children anew", async () => {
        const source = localsSource();
        const { app, tree, screen } = await mount(source);
        app.sendKey("ArrowRight");
        await flush();
        expect(screen()).toContain("x: 1");

        tree.collapseAll();
        await flush();
        expect(screen()).toContain("▸ Locals");
        expect(screen()).not.toContain("x: 1");
        expect(source.reads).toEqual(["scope"]);

        source.roots = locals([{ key: "y", name: "y", value: "2" }]);
        app.sendKey("ArrowRight");
        await flush();

        expect(source.reads).toEqual(["scope", "scope"]);
        expect(screen()).toContain("y: 2");
        expect(screen()).not.toContain("x: 1");
    });

    it("collapsing by hand drops the children: reopening reads them anew", async () => {
        const source = localsSource();
        const { app, screen } = await mount(source);
        app.sendKey("ArrowRight");
        await flush();
        app.sendKey("ArrowLeft");
        await flush();

        expect(screen()).not.toContain("x: 1");
        app.sendKey("ArrowRight");
        await flush();
        expect(source.reads).toEqual(["scope", "scope"]);
        expect(screen()).toContain("x: 1");
    });

    it("a read still in flight when the node is reopened does not land: the new read does", async () => {
        const source = localsSource();
        source.manual = true;
        const { app, screen } = await mount(source);
        app.sendKey("ArrowRight");
        await flush();
        app.sendKey("ArrowLeft");
        await flush();

        source.roots = locals([{ key: "y", name: "y", value: "2" }]);
        app.sendKey("ArrowRight");
        await flush();
        await source.resolveAll();

        expect(source.reads).toEqual(["scope", "scope"]);
        expect(screen()).toContain("y: 2");
        expect(screen()).not.toContain("x: 1");
    });

    it("a node whose read is pending is not read again by the next rebuild", async () => {
        const source = twoScopes();
        source.manual = true;
        const { app, screen } = await mount(source);
        app.sendKey("ArrowRight");
        await flush();
        app.sendKey("End");
        app.sendKey("ArrowRight");
        await flush();

        expect(source.reads).toEqual(["scope", "globals"]);
        await source.resolveAll();
        expect(screen()).toContain("x: 1");
        expect(screen()).toContain("g1: 1");
    });

    it("reads that land together cost one rebuild", async () => {
        const source = twoScopes();
        source.expandFirst.add("scope");
        source.expandFirst.add("globals");
        const { tree, screen } = await mount(source);
        expect(screen()).toContain("g1: 1");

        source.manual = true;
        tree.collapseAll();
        source.renders = 0;
        // Reopen both by hand in one task: two reads, landing together.
        tree.list.setCollapsed("t:scope", false);
        tree.list.setCollapsed("t:globals", false);
        await flush();
        const afterToggles = source.renders;
        await source.resolveAll();

        expect(source.reads.slice(-2)).toEqual(["scope", "globals"]);
        // The toggles: one rebuild of the two scope rows; the reads: one rebuild of all five.
        expect([afterToggles, source.renders - afterToggles]).toEqual([2, 5]);
        expect(screen()).toContain("x: 1");
    });

    it("Collapse All leaves alone the nodes no longer on screen", async () => {
        const source = localsSource();
        source.expandFirst.add("scope");
        const roots = source.roots;
        const { tree, screen } = await mount(source);
        source.roots = [];
        await tree.refresh();

        tree.collapseAll();
        source.roots = roots;
        await tree.refresh();

        expect(screen()).toContain("x: 1");
    });

    it("a node expanded on first sight stays collapsed once the user collapsed it", async () => {
        const source = localsSource();
        source.expandFirst.add("scope");
        const { app, tree, screen } = await mount(source);
        expect(screen()).toContain("x: 1");

        app.sendKey("ArrowLeft");
        await flush();
        await tree.refresh();

        expect(screen()).not.toContain("x: 1");
    });

    it("a read that fails leaves the node empty and reports the error", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((error) => errors.push(error));
        const source = localsSource();
        source.getChildren = () => Promise.reject(new Error("gone"));
        const { app, tree, screen } = await mount(source);

        app.sendKey("ArrowRight");
        await flush();

        expect(screen()).not.toContain(LOADING_LABEL);
        expect(tree.list.rowCount).toBe(1);
        expect(errors).toEqual([new Error("gone")]);
    });

    it("a row that fails to render is reported, not thrown out of the microtask", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((error) => errors.push(error));
        const source = localsSource();
        const { app } = await mount(source);
        source.renderRow = () => {
            throw new Error("bad row");
        };

        app.sendKey("ArrowRight");
        await flush();

        expect(errors).toEqual([new Error("bad row")]);
    });

    it("a read overtaken by a refresh does not land over the fresher children", async () => {
        const source = localsSource();
        source.manual = true;
        const { app, tree, screen } = await mount(source);
        app.sendKey("ArrowRight");
        await flush();

        source.manual = false;
        source.roots = locals([{ key: "y", name: "y", value: "2" }]);
        await tree.refresh();
        await source.resolveAll();

        expect(screen()).toContain("y: 2");
        expect(screen()).not.toContain("x: 1");
    });
});

describe("LazyTreeControl — refresh", () => {
    it("rereads every expanded node and keeps the cursor on its key and the scroll position", async () => {
        const source = scope(leaves("v", 30), true);
        const { app, tree, screen } = await mount(source);
        for (let i = 0; i < 15; i++) app.sendKey("ArrowDown");
        const before = text(screen());
        expect(tree.focused?.key).toBe("v14");

        source.roots = locals(leaves("v", 31));
        await tree.refresh();

        expect(tree.focused?.key).toBe("v14");
        expect(text(screen())).toBe(before);
        expect(source.reads).toEqual(["scope", "scope"]);
    });

    it("swaps all the rows at once: a refresh in flight shows no half tree", async () => {
        const source = scope(leaves("v", 2), true);
        const { tree, screen } = await mount(source);
        source.manual = true;

        const refreshed = tree.refresh();
        await flush();
        expect(screen()).toContain("v1: 1");
        expect(screen()).not.toContain(LOADING_LABEL);

        await source.resolveAll();
        await refreshed;
        expect(screen()).toContain("v1: 1");
    });

    it("the cursor whose row is gone moves to the row's parent", async () => {
        const source = twoScopes();
        source.expandFirst.add("globals");
        const { app, tree } = await mount(source);
        app.sendKey("End");
        expect(tree.focused?.key).toBe("g1");

        source.roots = [source.roots[0], { key: "globals", name: "Globals", children: [] }];
        await tree.refresh();

        expect(tree.focused?.key).toBe("globals");
    });

    it("the cursor on a Loading... row moves to its node when the children land", async () => {
        const source = twoScopes();
        source.manual = true;
        const { app, tree } = await mount(source);
        app.sendKey("End");
        app.sendKey("ArrowRight");
        await flush();
        app.sendKey("ArrowDown");
        expect(tree.focused).toBeUndefined();

        await source.resolveAll();

        expect(tree.focused?.key).toBe("globals");
    });

    it("a refresh overtaken by a later one is dropped", async () => {
        const source = new Source(leaves("a", 1));
        const { tree, screen } = await mount(source);
        let release: () => void = () => undefined;
        source.getRoots = () => {
            source.getRoots = () => leaves("c", 1);
            return new Promise(
                (resolve) =>
                    (release = () => {
                        resolve(leaves("b", 1));
                    }),
            );
        };

        const first = tree.refresh();
        await tree.refresh();
        release();
        await first;

        expect(screen()).toContain("c0: 0");
        expect(screen()).not.toContain("b0: 0");
    });

    it("sticky tail: a list scrolled to its end follows new rows", async () => {
        const source = new Source(leaves("l", 20));
        const { app, tree, screen } = await mount(source, { stickyTail: true, height: 5 });
        app.sendKey("End");
        expect(screen()).toContain("l19: 19");

        source.roots = leaves("l", 25);
        await tree.refresh();

        expect(screen()).toContain("l24: 24");
    });

    it("sticky tail: a console filled before it is first drawn opens at its tail", async () => {
        const source = new Source(leaves("l", 20));
        const tree = new LazyTreeControl(source, { idPrefix: "t", stickyTail: true });
        await tree.refresh();
        // More output while still hidden: the list was never laid out, its size is no evidence.
        source.roots = leaves("l", 40);
        await tree.refresh();

        const { screen } = attach(tree, 5);

        expect(screen()).toContain("l39: 39");
        expect(screen()).not.toContain("l0: 0");
    });

    it("sticky tail: a list scrolled up stays where the user left it", async () => {
        const source = new Source(leaves("l", 20));
        const { app, tree, screen } = await mount(source, { stickyTail: true, height: 5 });
        expect(screen()).toContain("l19: 19");
        app.sendKey("Home");
        const before = text(screen());

        source.roots = leaves("l", 25);
        await tree.refresh();
        // A second rebuild before any frame: the list is not laid out, its size says nothing about the tail.
        source.roots = leaves("l", 26);
        await tree.refresh();

        expect(text(screen())).toBe(before);
    });

    it("sticky tail: a short list scrolled up stays put through two rebuilds before a frame", async () => {
        const source = new Source(leaves("l", 8));
        const { app, tree, screen } = await mount(source, { stickyTail: true, height: 5 });
        app.sendKey("Home");
        const before = text(screen());

        source.roots = leaves("l", 9);
        await tree.refresh();
        // Not laid out since the first rebuild: a size read now would be a lazy one, the whole content high.
        source.roots = leaves("l", 10);
        await tree.refresh();

        expect(text(screen())).toBe(before);
    });

    it("without sticky tail the end of the list does not follow new rows", async () => {
        const source = new Source(leaves("l", 20));
        const { app, tree, screen } = await mount(source, { height: 5 });
        app.sendKey("End");
        const before = text(screen());

        source.roots = leaves("l", 25);
        await tree.refresh();

        expect(text(screen())).toBe(before);
    });
});
