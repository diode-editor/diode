import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { TuiApplicationDIToken } from "../../../../platform/layout/browser/tuiApplicationDIToken.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { bindWidgetGlyphs } from "../../../../platform/theme/browser/widgetGlyphs.ts";
import { StaticProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { lightPlusTheme } from "../../../services/themes/common/themes/lightPlus.ts";
import { listFocusFirstAction, listFocusLastAction } from "../../actions/listActions.ts";

import { type ILazyTreeSource, LazyTreeControl, LOADING_LABEL } from "./lazyTreeControl.ts";

interface INode {
    readonly key: string;
    readonly name: string;
    readonly value?: string;
    readonly children?: readonly INode[];
}

const dark = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));
const light = computeThemeVars(WorkbenchTheme.fromThemeFile(lightPlusTheme));

class Source implements ILazyTreeSource<INode> {
    public readonly reads: string[] = [];
    public manual = false;
    public readonly expandFirst = new Set<string>();
    private readonly pending: (() => void)[] = [];

    public constructor(public roots: readonly INode[]) {}

    public getRoots(): readonly INode[] {
        return this.roots;
    }

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

    public renderRow(node: INode): { text: string; fg?: string }[] {
        if (node.value === undefined) return [{ text: node.name }];
        return [
            { text: node.name, fg: "debugTokenExpression.name" },
            { text: ": " },
            { text: node.value, fg: "debugTokenExpression.number" },
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

async function mount(source: Source, width = 30, height = 10) {
    const tree = new LazyTreeControl(source, { idPrefix: "t" });
    const app = TestApp.createWithContent(tree.element, new Size(width, height));
    bindWidgetGlyphs(app.root, new StaticProductIconService(false));
    tree.list.focus();
    await tree.refresh();
    app.render();
    const screen = (): string => {
        app.render();
        return app.backend.screenToString();
    };
    return { app, tree, screen };
}

function lineOf(app: TestApp, text: string): Point {
    const lines = app.backend.screenToString().split("\n");
    const y = lines.findIndex((line) => line.includes(text));
    expect(y, `"${text}" on screen`).toBeGreaterThanOrEqual(0);
    return new Point(lines[y].indexOf(text), y);
}

function click(app: TestApp, x: number, y: number): void {
    const token = (action: MouseToken["action"]): MouseToken => ({
        kind: "mouse",
        button: "left",
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

const scope = (children: readonly INode[]): INode[] => [{ key: "scope", name: "Locals", children }];

describe("LazyTreeControl — unicode rows", () => {
    it("a value after an astral-plane name keeps its color on its own cells", async () => {
        const { app, screen } = await mount(new Source([{ key: "a", name: "😀ab", value: "42" }]));

        expect(screen()).toContain(": 42");
        const value = lineOf(app, "42");
        expect(app.backend.getFgAt(value)).toBe(dark["debugTokenExpression.number"]);
        expect(app.backend.getFgAt(new Point(value.x + 1, value.y))).toBe(dark["debugTokenExpression.number"]);
    });

    it("a row of wide characters wider than the view still keeps the right padding column free", async () => {
        const { screen } = await mount(new Source([{ key: "a", name: "日本語".repeat(10) }]), 20, 4);

        const first = screen().split("\n")[0];
        expect(first.startsWith(" 日")).toBe(true);
        expect(first.endsWith(" ")).toBe(true);
    });
});

describe("LazyTreeControl — expanding", () => {
    it("a node whose read comes back empty shows no Loading... and no ghost rows", async () => {
        const source = new Source(scope([]));
        const { app, screen, tree } = await mount(source);

        app.sendKey("ArrowRight");
        await flush();

        expect(source.reads).toEqual(["scope"]);
        expect(screen()).not.toContain(LOADING_LABEL);
        app.sendKey("ArrowDown");
        expect(tree.focused?.key).toBe("scope");
    });

    it("an initially expanded node with async children opens with them on the first refresh", async () => {
        const source = new Source(scope([{ key: "x", name: "x", value: "1" }]));
        source.expandFirst.add("scope");
        source.manual = true;
        const tree = new LazyTreeControl(source, { idPrefix: "t" });
        const app = TestApp.createWithContent(tree.element, new Size(30, 6));
        bindWidgetGlyphs(app.root, new StaticProductIconService(false));
        const refreshed = tree.refresh();
        await flush();

        await source.resolveAll();
        await refreshed;
        app.render();

        expect(app.backend.screenToString()).toContain("x: 1");
        expect(app.backend.screenToString()).not.toContain(LOADING_LABEL);
    });

    it("Left on a child goes to its parent; Left again collapses the parent", async () => {
        const source = new Source(scope([{ key: "x", name: "x", value: "1" }]));
        const { app, tree, screen } = await mount(source);
        app.sendKey("ArrowRight");
        await flush();
        app.sendKey("ArrowDown");
        expect(tree.focused?.key).toBe("x");

        app.sendKey("ArrowLeft");
        await flush();
        expect(tree.focused?.key).toBe("scope");
        expect(screen()).toContain("x: 1");

        app.sendKey("ArrowLeft");
        await flush();
        expect(screen()).toContain("▸ Locals");
        expect(screen()).not.toContain("x: 1");
    });

    it("a click on a collapsed node's chevron expands it", async () => {
        const source = new Source(scope([{ key: "x", name: "x", value: "1" }]));
        const { app, screen } = await mount(source);
        const at = lineOf(app, "▸ Locals");

        click(app, at.x, at.y);
        await flush();

        expect(screen()).toContain("▾ Locals");
        expect(screen()).toContain("x: 1");
    });

    it("Right, Left, Right before the reads land leaves one set of children", async () => {
        const source = new Source(scope([{ key: "x", name: "x", value: "1" }]));
        source.manual = true;
        const { app, screen } = await mount(source);

        app.sendKey("ArrowRight");
        await flush();
        app.sendKey("ArrowLeft");
        await flush();
        app.sendKey("ArrowRight");
        await flush();
        await source.resolveAll();

        const frame = screen();
        expect(frame).toContain("▾ Locals");
        expect(frame.split("x: 1").length - 1).toBe(1);
        expect(frame).not.toContain(LOADING_LABEL);
    });

    it("Collapse All with the cursor on a deep child puts the cursor on its root", async () => {
        const source = new Source(
            scope([{ key: "obj", name: "obj", children: [{ key: "f", name: "f", value: "1" }] }]),
        );
        source.expandFirst.add("scope");
        source.expandFirst.add("obj");
        const { app, tree, screen } = await mount(source);
        await flush();
        app.sendKey("End");
        expect(tree.focused?.key).toBe("f");

        tree.collapseAll();
        await flush();

        expect(screen()).not.toContain("f: 1");
        expect(tree.focused?.key).toBe("scope");
    });

    it("a refresh shows the new children of an expanded node and drops the gone ones", async () => {
        const source = new Source(scope([{ key: "x", name: "x", value: "1" }]));
        source.expandFirst.add("scope");
        const { tree, screen } = await mount(source);
        await flush();
        expect(screen()).toContain("x: 1");

        source.roots = scope([
            { key: "x", name: "x", value: "2" },
            { key: "y", name: "y", value: "3" },
        ]);
        await tree.refresh();
        await flush();

        expect(screen()).toContain("x: 2");
        expect(screen()).toContain("y: 3");
        expect(screen()).not.toContain("x: 1");
    });

    it("2000 children expand and End reaches the last", async () => {
        const kids = Array.from({ length: 2000 }, (_, i) => ({ key: `k${i}`, name: `k${i}`, value: `${i}` }));
        const source = new Source(scope(kids));
        const { app, tree, screen } = await mount(source);

        app.sendKey("ArrowRight");
        await flush();
        app.sendKey("End");

        expect(tree.focused?.key).toBe("k1999");
        expect(screen()).toContain("k1999: 1999");
    });
});

describe("LazyTreeControl — environment", () => {
    it("a 6-column terminal draws without throwing", async () => {
        const source = new Source(scope([{ key: "x", name: "x", value: "1" }]));
        source.expandFirst.add("scope");
        const { screen } = await mount(source, 6, 3);
        await flush();

        expect(screen().split("\n")[0].startsWith(" ")).toBe(true);
    });

    it("span colors follow a theme switch", async () => {
        const { app, screen } = await mount(new Source([{ key: "a", name: "count", value: "42" }]));
        app.root.setStyleVars(light);
        screen();

        const name = lineOf(app, "count");
        expect(app.backend.getFgAt(name)).toBe(light["debugTokenExpression.name"]);
        expect(light["debugTokenExpression.name"]).not.toBe(dark["debugTokenExpression.name"]);
    });
});

describe("LazyTreeControl — list commands", () => {
    it("list.focusLast and list.focusFirst move the cursor of the focused tree", async () => {
        const kids = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, name: `k${i}`, value: `${i}` }));
        const source = new Source(scope(kids));
        source.expandFirst.add("scope");
        const { app, tree, screen } = await mount(source);
        await flush();
        const accessor = new Container();
        accessor.bind(TuiApplicationDIToken, () => app.app);
        const commands = new CommandRegistry();
        for (const action of [listFocusLastAction, listFocusFirstAction]) {
            registerAction(commands, new KeybindingRegistry(), accessor, action);
        }

        commands.execute(listFocusLastAction.id);
        expect(tree.focused?.key).toBe("k29");
        expect(screen()).toContain("k29: 29");

        commands.execute(listFocusFirstAction.id);
        expect(tree.focused?.key).toBe("scope");
    });
});
