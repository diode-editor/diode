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

    it("the end of a row is pinned to the right edge in its own color; the label is clipped before it", async () => {
        const roots = [
            { key: "a", name: "short" },
            { key: "b", name: "y".repeat(40) },
            { key: "c", name: "plain" },
        ];
        const { app, tree } = await mount({
            getRoots: () => roots,
            getChildren: () => [],
            getKey: (node) => node.key,
            hasChildren: () => false,
            renderRow: (node) => [{ text: node.name }],
            renderRowEnd: (node) =>
                node.key === "c" ? [] : [{ text: "main.cpp:7", fg: "debugConsole.sourceForeground" }],
        });

        const [first, second, third] = app.backend.screenToString().split("\n");
        // 30 columns: padding, the label, a column, the end, padding.
        expect(first).toBe(` short${" ".repeat(12)} main.cpp:7 `);
        expect(second).toBe(` ${"y".repeat(17)} main.cpp:7 `);
        expect(third.trimEnd()).toBe(" plain");
        const end = lineOf(app, "main.cpp:7");
        expect(app.backend.getFgAt(end)).toBe(vars["debugConsole.sourceForeground"]);
        // Typeahead goes by the label.
        app.sendKey("p");
        expect(tree.focused?.key).toBe("c");
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

describe("LazyTreeControl — row parts", () => {
    /** Leaves rendered by the test: a checkbox span that counts clicks, and a badge on the right. */
    function partsSource(
        clicks: string[],
        options: { checkbox: boolean; badge: string } = { checkbox: true, badge: "" },
    ) {
        return {
            getRoots: () => leaves("a", 2),
            getChildren: () => [],
            getKey: (node: INode) => node.key,
            hasChildren: () => false,
            renderRow: (node: INode) => [
                ...(options.checkbox ? [{ text: "[x] ", onClick: () => clicks.push(node.key) }] : []),
                { text: node.name, fg: "debugTokenExpression.name" },
            ],
            renderRowEnd: (node: INode) =>
                options.badge === ""
                    ? []
                    : [{ text: `${options.badge}${node.value ?? ""}`, fg: "descriptionForeground" }],
        };
    }

    function clickAt(app: TestApp, point: Point, type: "press" | "double" = "press"): void {
        const times = type === "double" ? 2 : 1;
        for (let i = 0; i < times; i++) {
            for (const action of ["press", "release"] as const) {
                app.backend.simulateMouse({
                    kind: "mouse",
                    button: "left",
                    action,
                    x: point.x + 1,
                    y: point.y + 1,
                    shiftKey: false,
                    altKey: false,
                    ctrlKey: false,
                    raw: "",
                });
            }
        }
    }

    it("a right part sits at the right edge; when the row is short of room the text is cut, not it", async () => {
        const wide = await mount(partsSource([], { checkbox: false, badge: "line " }));
        // 30 columns: padding, the text, the gap, the badge, padding.
        expect(wide.app.backend.screenToString().split("\n")[0]).toBe(` a0${" ".repeat(20)}line 0 `);
        expect(wide.app.backend.getFgAt(lineOf(wide.app, "line 0"))).toBe(vars.descriptionForeground);

        // 28 columns inside the padding: the 26 of the right part and the column before it stay, the name keeps one.
        const narrow = await mount(partsSource([], { checkbox: false, badge: "x".repeat(25) }));
        expect(narrow.app.backend.screenToString().split("\n")[0]).toBe(` a ${"x".repeat(25)}0 `);
    });

    it("a row with a control and no right part gives the text every column up to the edge", async () => {
        const source = partsSource([]);
        const { app } = await mount({
            ...source,
            renderRow: () => [{ text: "[x] ", onClick: () => undefined }, { text: "n".repeat(40) }],
        });
        // 28 columns inside the padding: the control's 4 and 24 of the name.
        expect(app.backend.screenToString().split("\n")[0]).toBe(` [x] ${"n".repeat(24)} `);
    });

    it("a click on a clickable span runs it and leaves the row alone; elsewhere the row is picked", async () => {
        const clicks: string[] = [];
        const { app, tree } = await mount(partsSource(clicks));
        const activated: string[] = [];
        tree.onActivate = (node) => activated.push(node.key);
        const box = lineOf(app, "[x] a1");

        clickAt(app, box);

        expect(clicks).toEqual(["a1"]);
        expect(tree.focused?.key).toBe("a0");
        // Nor does a double click open it.
        clickAt(app, box, "double");
        expect(activated).toEqual([]);
        expect(clicks).toEqual(["a1", "a1", "a1"]);

        clickAt(app, new Point(box.x + 5, box.y));
        expect(tree.focused?.key).toBe("a1");
        expect(clicks).toHaveLength(3);
        // The text keeps its own colors next to the control.
        expect(app.backend.getFgAt(new Point(box.x + 4, box.y))).toBe(vars["debugTokenExpression.name"]);
    });

    it("onSelect hears the user's moves of the cursor, not a rebuild's nor reveal's", async () => {
        const { app, tree } = await mount(new Source(leaves("a", 3)));
        const selected: string[] = [];
        tree.onSelect = (node) => selected.push(node.key);

        app.sendKey("ArrowDown");
        expect(selected).toEqual(["a1"]);

        await tree.refresh();
        tree.reveal({ key: "a2", name: "a2" });
        expect(tree.focused?.key).toBe("a2");
        // A node the tree does not show moves nothing.
        tree.reveal({ key: "zz", name: "zz" });
        expect(tree.focused?.key).toBe("a2");
        expect(selected).toEqual(["a1"]);

        app.sendKey("ArrowUp");
        expect(selected).toEqual(["a1", "a1"]);
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

    it("the Loading... row is neither selected nor activated", async () => {
        const source = localsSource();
        source.manual = true;
        const { app, tree } = await mount(source);
        const activated: string[] = [];
        const selected: unknown[] = [];
        tree.onActivate = (node) => activated.push(node.key);
        tree.onSelect = (node) => selected.push(node);
        app.sendKey("ArrowRight");
        await flush();

        app.sendKey("ArrowDown");
        app.sendKey("Enter");

        expect(tree.focused).toBeUndefined();
        expect(activated).toEqual([]);
        expect(selected).toEqual([]);
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

    it("expand opens a node whose children came later and reads them, even if it was read open before", async () => {
        const getter: { key: string; name: string; value: string; children?: INode[] } = {
            key: "getter",
            name: "getter",
            value: "(...)",
        };
        const source = scope([getter], true);
        const { tree, screen } = await mount(source);
        expect(screen()).toContain("getter: (...)");
        expect(source.reads).toEqual(["scope"]);

        // A lazy variable once evaluated: its value and its children are there now.
        getter.value = "{...}";
        getter.children = [{ key: "a", name: "a", value: "1" }];
        tree.expand(getter);
        await flush();

        expect(source.reads).toEqual(["scope", "getter"]);
        expect(text(screen())).toContain("▾ getter: {...}");
        expect(screen()).toContain("a: 1");

        getter.children = [{ key: "b", name: "b", value: "2" }];
        tree.expand(getter);
        await flush();
        expect(screen()).toContain("b: 2");
        expect(screen()).not.toContain("a: 1");
    });

    it("expand of a node the tree does not show changes nothing; rerender paints anew without reading", async () => {
        const source = scope([{ key: "x", name: "x", value: "1" }], true);
        const { tree, screen } = await mount(source);
        const renders = source.renders;

        tree.expand({ key: "elsewhere", name: "elsewhere", children: [] });
        await flush();
        expect(source.renders).toBe(renders);
        expect(source.reads).toEqual(["scope"]);

        tree.rerender();
        await flush();
        // Both rows are painted again from what was read: no read.
        expect(source.renders).toBe(renders + 2);
        expect(source.reads).toEqual(["scope"]);
        expect(screen()).toContain("x: 1");
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

    it("revealTail scrolls a list away from its end to the last row, even when a later refresh overtakes it", async () => {
        const source = new Source(leaves("l", 20));
        const { tree, screen } = await mount(source, { height: 5 });
        expect(screen()).not.toContain("l19: 19");

        const revealing = tree.refresh({ revealTail: true });
        await tree.refresh();
        await revealing;
        expect(screen()).toContain("l19: 19");

        // Once: the next refresh keeps where the list is.
        tree.list.scrollTop = 0;
        screen();
        await tree.refresh();
        expect(screen()).not.toContain("l19: 19");
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

describe("LazyTreeControl — wrapped rows and links", () => {
    it("a wrapped node expands with the keyboard and shows its children", async () => {
        const source = new Source([
            { key: "long", name: "x".repeat(40), children: [{ key: "kid", name: "kid", value: "1" }] },
        ]);
        const { app, screen } = await mount(source, { wrap: () => true });
        expect(text(screen())).toContain("xxxx");
        app.sendKey("End");
        app.sendKey("ArrowRight");
        await flush();
        expect(screen()).toContain("kid: 1");
    });

    it("a long row takes the lines it wraps to, keeps its end on its first line; without wrapping it is cut", async () => {
        const nodes = [
            { key: "a", name: `${"a".repeat(30)} tail` },
            { key: "b", name: "b" },
        ];
        const source: ILazyTreeSource<INode> = {
            getRoots: () => nodes,
            getChildren: () => [],
            getKey: (node) => node.key,
            hasChildren: () => false,
            renderRow: (node) => [{ text: node.name }],
            renderRowEnd: (node) => (node.key === "a" ? [{ text: "END" }] : []),
        };
        let wrap = true;
        const { tree, screen } = await mount(source, { wrap: () => wrap });
        const rows = screen().split("\n");
        expect(rows[0]).toContain("END");
        expect(rows.slice(0, 3).join("")).toContain("tail");
        expect(rows.findIndex((row) => row.includes(" b"))).toBeGreaterThan(1);

        wrap = false;
        tree.rerender();
        const cut = screen().split("\n");
        expect(cut[0]).toContain("END");
        expect(cut[1]).toContain("b");
        expect(screen()).not.toContain("tail");
    });

    it("a click on a link's cells runs it, on a wrapped line too; a click beside it picks the row", async () => {
        const clicks: string[] = [];
        const nodes = [
            { key: "a", name: "row" },
            { key: "b", name: "other" },
        ];
        const source: ILazyTreeSource<INode> = {
            getRoots: () => nodes,
            getChildren: () => [],
            getKey: (node) => node.key,
            hasChildren: () => false,
            renderRow: (node) =>
                node.key === "a"
                    ? [
                          // The rows are 28 columns: the link is on the second line.
                          { text: `${"x".repeat(28)} ` },
                          { text: "LINK", link: () => clicks.push("link") },
                          { text: " after" },
                      ]
                    : [{ text: node.name }],
        };
        const { app, tree, screen } = await mount(source, { wrap: () => true });
        tree.onSelect = (node) => clicks.push(`select ${node.key}`);
        screen();
        const link = lineOf(app, "LINK");
        expect(link.y).toBe(1);
        clickAt(app, link);
        expect(clicks).toEqual(["link"]);
        clickAt(app, lineOf(app, "after"));
        clickAt(app, lineOf(app, "other"));
        clickAt(app, lineOf(app, "LINK"));
        expect(clicks).toEqual(["link", "select a", "select b", "link"]);
    });

    it("a double click on a link runs it and opens no row; beside it, or past the text's end, it opens the row", async () => {
        const clicks: string[] = [];
        const source: ILazyTreeSource<INode> = {
            getRoots: () => [
                { key: "a", name: "row" },
                { key: "b", name: "only a link" },
            ],
            getChildren: () => [],
            getKey: (node) => node.key,
            hasChildren: () => false,
            renderRow: (node) =>
                node.key === "a"
                    ? [{ text: "see " }, { text: "LINK", link: () => clicks.push("link") }, { text: " x" }]
                    : [{ text: "ONLY", link: () => clicks.push("only") }],
        };
        const { app, tree, screen } = await mount(source, { wrap: () => true });
        tree.onActivate = (node) => clicks.push(`open ${node.key}`);
        screen();
        const link = lineOf(app, "LINK");
        clickAt(app, link, 2);
        expect(clicks).toEqual(["link", "link"]);
        clicks.length = 0;
        // Its last cell is the link's; the next one is not.
        clickAt(app, { x: link.x + 3, y: link.y });
        expect(clicks).toEqual(["link"]);
        clicks.length = 0;
        clickAt(app, { x: link.x + 4, y: link.y }, 2);
        expect(clicks).toEqual(["open a"]);
        clicks.length = 0;
        clickAt(app, lineOf(app, "see"), 2);
        expect(clicks).toEqual(["open a"]);
        clicks.length = 0;
        // The label fills the row: the cells after its text are its own, with no character under them.
        clickAt(app, { x: link.x + 10, y: link.y }, 2);
        expect(clicks).toEqual(["open a"]);
        clicks.length = 0;
        // A row that is all link.
        clickAt(app, lineOf(app, "ONLY"));
        expect(clicks).toEqual(["only"]);
    });
});

function clickAt(app: TestApp, { x, y }: Point, times = 1): void {
    for (let i = 0; i < times; i++) {
        for (const action of ["press", "release"] as const) {
            app.backend.simulateMouse({
                kind: "mouse",
                button: "left",
                x: x + 1,
                y: y + 1,
                action,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            });
        }
    }
}
