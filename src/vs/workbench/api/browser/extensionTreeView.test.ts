import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import type { TreeIndentGuides } from "@tuidom/elements/tree/treeViewElement";
import { describe, expect, it } from "vitest";

import { createSwitchableIcons } from "../../../../TestUtils/switchableIcons.ts";
import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../../TestUtils/timing.ts";
import { CODICON_GLYPHS } from "../../../base/common/codicons.generated.ts";
import { CODICON_UNICODE } from "../../../base/common/codiconsUnicode.ts";
import { Emitter, Event } from "../../../base/common/event.ts";
import { getFileIcon } from "../../../base/common/fileIcons.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import { computeThemeVars } from "../../../platform/theme/browser/themeStyleVars.ts";
import { NERD_FONT_ICONS } from "../../../platform/theme/common/productIconService.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import type { IExtensionTreeDataSource } from "../common/iExtensionTreeViewsSink.ts";
import type { IWireTreeItem } from "../common/treeViewWireTypes.ts";

import { ExtensionTreeView, type IExtensionTreeViewHost } from "./extensionTreeView.ts";

function item(handle: string, label: string, extra: Partial<IWireTreeItem> = {}): IWireTreeItem {
    return { handle, label, collapsibleState: 0, ...extra };
}

interface IFakeSource extends IExtensionTreeDataSource {
    /** `""` — the root. */
    children: Record<string, readonly IWireTreeItem[]>;
    readonly requests: (string | undefined)[];
    readonly executed: string[];
    readonly visibility: boolean[];
    readonly expansions: [string, boolean][];
    readonly selections: [readonly string[], string | undefined][];
    fail: Error | null;
    commandError: Error | null;
}

function fakeSource(children: Record<string, readonly IWireTreeItem[]>): IFakeSource {
    const source: IFakeSource = {
        children,
        requests: [],
        executed: [],
        visibility: [],
        expansions: [],
        selections: [],
        fail: null,
        commandError: null,
        getChildren: (parentHandle) => {
            source.requests.push(parentHandle);
            if (source.fail !== null) return Promise.reject(source.fail);
            return Promise.resolve(source.children[parentHandle ?? ""] ?? []);
        },
        executeCommand: (handle) => {
            source.executed.push(handle);
            return source.commandError === null ? Promise.resolve() : Promise.reject(source.commandError);
        },
        setVisible: (visible) => {
            source.visibility.push(visible);
        },
        setExpanded: (handle, expanded) => {
            source.expansions.push([handle, expanded]);
        },
        setSelection: (handles, focused) => {
            source.selections.push([handles, focused]);
        },
    };
    return source;
}

interface IFixture {
    readonly tree: ExtensionTreeView;
    readonly app: TestApp;
    readonly errors: string[];
    readonly logged: string[];
    lines(): string[];
    settle(): Promise<void>;
}

function mount(
    source: IExtensionTreeDataSource,
    options: { canSelectMany?: boolean; width?: number; host?: Partial<IExtensionTreeViewHost> } = {},
): IFixture {
    const errors: string[] = [];
    const logged: string[] = [];
    const logger = { error: (message: string) => logged.push(message) } as unknown as ILogger;
    const tree = new ExtensionTreeView(
        "test.view",
        source,
        { canSelectMany: options.canSelectMany ?? false },
        {
            openOnSingleClick: () => true,
            expandOnRowClick: () => true,
            renderIndentGuides: () => "none",
            onDidChangeRenderIndentGuides: Event.None,
            notifyError: (message) => errors.push(message),
            hasColor: (token) => typeof vars[token] === "number",
            relativeDirectory: (uri) => `dir-of(${uri})`,
            icons: NERD_FONT_ICONS,
            itemMenu: () => [],
            onDidChangeItemMenu: Event.None,
            showContextMenu: () => undefined,
            executeCommand: () => undefined,
            logger,
            ...options.host,
        },
    );
    const app = TestApp.createWithContent(tree.view, new Size(options.width ?? 40, 8));
    return {
        tree,
        app,
        errors,
        logged,
        lines: () => {
            app.render();
            return app.backend
                .screenToString()
                .split("\n")
                .map((line) => line.trimEnd())
                .filter((line) => line !== "");
        },
        settle: async () => {
            await flushMicrotasks(10);
        },
    };
}

const vars = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));

describe("ExtensionTreeView — loading", () => {
    it("is a section body with its own id, painted in the sidebar colors", async () => {
        const source = fakeSource({ "": [item("a", "alpha")] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        f.lines();
        expect(f.tree.view.id).toBe("extensionTreeView-test-view");
        expect(f.app.backend.getBgAt(new Point(10, 4))).toBe(vars["sideBar.background"]);
    });

    it("a failed request without a logger still keeps the rows", async () => {
        const source = fakeSource({ "": [item("a", "alpha")] });
        const f = mount(source, { host: { logger: undefined } });
        f.tree.setVisible(true);
        await f.settle();
        source.fail = new Error("boom");
        await f.tree.refresh(undefined);
        await f.settle();
        expect(f.lines()).toEqual(["   alpha"]);
    });

    it("rows refreshed while hidden are not read until the section shows", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 2 })],
            p: [item("p/c", "child", { parentHandle: "p" })],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        f.tree.setVisible(false);
        await f.tree.refresh(undefined);
        const before = source.requests.length;
        await f.tree.refresh([item("p", "pkg", { collapsibleState: 2, description: "new" })]);
        await f.settle();
        expect(source.requests.slice(before)).toEqual([]);
    });

    it("a failed row reread doesn't hold back a later reread of a row under it", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 2 })],
            p: [item("p/c", "child", { parentHandle: "p", collapsibleState: 2 })],
            "p/c": [item("p/c/g", "grand", { parentHandle: "p/c" })],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        const getChildren = source.getChildren;
        source.getChildren = (handle) => (handle === "p" ? Promise.reject(new Error("pkg down")) : getChildren(handle));
        await f.tree.refresh([item("p", "pkg", { collapsibleState: 2 })]);
        source.getChildren = getChildren;
        const before = source.requests.length;
        source.children["p/c"] = [item("p/c/n", "newer", { parentHandle: "p/c" })];
        await f.tree.refresh([item("p/c", "child", { parentHandle: "p", collapsibleState: 2 })]);
        await f.settle();
        expect(source.requests.slice(before)).toEqual(["p/c"]);
        expect(labels(f)).toEqual(["pkg", "child", "newer"]);
    });

    it("a failure deep in the tree keeps every expanded level under it", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 2 })],
            p: [item("p/c", "child", { parentHandle: "p", collapsibleState: 2 })],
            "p/c": [item("p/c/g", "grand", { parentHandle: "p/c", collapsibleState: 2 })],
            "p/c/g": [item("p/c/g/x", "leaf", { parentHandle: "p/c/g" })],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        expect(labels(f)).toEqual(["pkg", "child", "grand", "leaf"]);
        const getChildren = source.getChildren;
        source.getChildren = (handle) => (handle === "p" ? Promise.reject(new Error("pkg down")) : getChildren(handle));
        const before = source.requests.length;
        await f.tree.refresh([item("p", "pkg", { collapsibleState: 2 })]);
        await f.settle();
        expect(labels(f)).toEqual(["pkg", "child", "grand", "leaf"]);
        expect(source.requests.slice(before)).toEqual([]);
    });

    it("in a root reread one failed branch keeps its rows while the other branches are read", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 2 }), item("q", "other", { collapsibleState: 2 })],
            p: [item("p/c", "child", { parentHandle: "p" })],
            q: [item("q/c", "branch", { parentHandle: "q", collapsibleState: 2 })],
            "q/c": [item("q/c/l", "leaf", { parentHandle: "q/c" })],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        const getChildren = source.getChildren;
        source.getChildren = (handle) => {
            if (handle === "p") {
                source.requests.push(handle);
                return Promise.reject(new Error("pkg down"));
            }
            return getChildren(handle);
        };
        const before = source.requests.length;
        await f.tree.refresh(undefined);
        await f.settle();
        expect(labels(f)).toEqual(["pkg", "child", "other", "branch", "leaf"]);
        expect(source.requests.slice(before)).toEqual([undefined, "p", "q", "q/c"]);
    });

    it("asks for the root only once the section is visible, and tells the subprocess", async () => {
        const source = fakeSource({ "": [item("a", "alpha"), item("b", "beta")] });
        const f = mount(source);
        await f.settle();
        expect(source.requests).toEqual([]);

        f.tree.setVisible(true);
        await f.settle();
        expect(source.requests).toEqual([undefined]);
        expect(source.visibility).toEqual([true]);
        expect(f.lines()).toEqual(["   alpha", "   beta"]);
    });

    it("an Expanded row is open on first show; a reread keeps the user's collapse", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 2 })],
            p: [item("p/c", "child")],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        expect(labels(f)).toEqual(["pkg", "child"]);
        expect(source.requests).toEqual([undefined, "p"]);

        f.tree.focus();
        f.app.sendKey("ArrowLeft");
        await f.settle();
        expect(f.lines()).toHaveLength(1);

        await f.tree.refresh(undefined);
        await f.settle();
        expect(f.lines()).toHaveLength(1);
    });

    it("a refresh while hidden waits for the section to show", async () => {
        const source = fakeSource({ "": [item("a", "alpha")] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        f.tree.setVisible(false);
        source.children[""] = [item("a", "alpha"), item("n", "new")];
        await f.tree.refresh(undefined);
        expect(source.requests).toEqual([undefined]);
        expect(source.visibility).toEqual([true, false]);

        f.tree.setVisible(true);
        await f.settle();
        expect(source.requests).toEqual([undefined, undefined]);
        expect(f.lines()).toEqual(["   alpha", "   new"]);
    });

    it("hiding twice or showing twice says it once", () => {
        const source = fakeSource({});
        const f = mount(source);
        f.tree.setVisible(false);
        f.tree.setVisible(true);
        f.tree.setVisible(true);
        expect(source.visibility).toEqual([true]);
    });

    it("a failed request logs a line and keeps the rows that were there", async () => {
        const source = fakeSource({ "": [item("a", "alpha")] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        source.fail = new Error("boom");
        await f.tree.refresh(undefined);
        await f.settle();
        expect(f.logged).toEqual(['tree view "test.view": boom']);
        expect(f.lines()).toEqual(["   alpha"]);
    });

    it("a failed root reread keeps the expanded rows' children without asking for them; the next reread asks again", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 2 }), item("z", "zed")],
            p: [item("p/c", "child", { parentHandle: "p", collapsibleState: 2 })],
            "p/c": [item("p/c/g", "grand", { parentHandle: "p/c" })],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        expect(labels(f)).toEqual(["pkg", "child", "grand", "zed"]);
        const before = source.requests.length;

        source.fail = new Error("root down");
        await f.tree.refresh(undefined);
        await f.settle();
        expect(labels(f)).toEqual(["pkg", "child", "grand", "zed"]);
        expect(source.requests.slice(before)).toEqual([undefined]);

        source.fail = null;
        await f.tree.refresh(undefined);
        await f.settle();
        expect(source.requests.slice(before + 1)).toEqual([undefined, "p", "p/c"]);
    });

    it("a failed row reread keeps its subtree; its siblings are asked as usual", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 2 }), item("q", "other", { collapsibleState: 2 })],
            p: [item("p/c", "child", { parentHandle: "p", collapsibleState: 2 })],
            "p/c": [item("p/c/g", "grand", { parentHandle: "p/c" })],
            q: [item("q/c", "leaf", { parentHandle: "q" })],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        const before = source.requests.length;
        const getChildren = source.getChildren;
        source.getChildren = (handle) => (handle === "p" ? Promise.reject(new Error("pkg down")) : getChildren(handle));
        await f.tree.refresh([item("p", "pkg", { collapsibleState: 2 }), item("q", "other", { collapsibleState: 2 })]);
        await f.settle();
        expect(labels(f)).toEqual(["pkg", "child", "grand", "other", "leaf"]);
        expect(source.requests.slice(before)).toEqual(["q"]);
    });

    it("a failure before any answer leaves the section empty; a non-Error reason is logged as text", async () => {
        const source = fakeSource({});
        source.fail = "down" as unknown as Error;
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        expect(f.logged).toEqual(['tree view "test.view": down']);
        expect(f.lines()).toEqual([]);
    });
});

describe("ExtensionTreeView — rows", () => {
    it("draws the description dimmed after the label; an empty one is not drawn", async () => {
        const source = fakeSource({
            "": [item("b", "gcp", { description: "" }), item("a", "aws", { description: "~> 5.0" })],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        expect(f.lines()).toEqual(["   gcp", "   aws ~> 5.0"]);
        // Off the cursor row: the cursor row draws everything in the selection foreground.
        const label = f.app.backend.getFgAt(new Point(3, 1));
        const description = f.app.backend.getFgAt(new Point(7, 1));
        expect(description).not.toBe(label);
    });

    it("`description: true` is the resource's folder from the host", async () => {
        const source = fakeSource({
            "": [item("a", "a.ts", { description: true, resourceUri: "file:///w/src/a.ts" })],
        });
        const f = mount(source, { width: 60 });
        f.tree.setVisible(true);
        await f.settle();
        expect(f.lines()[0]).toContain("a.ts dir-of(file:///w/src/a.ts)");
    });

    it("`description: true` without a resource is no description", async () => {
        const source = fakeSource({ "": [item("a", "alpha", { description: true })] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        expect(f.lines()).toEqual(["   alpha"]);
    });

    it("a ThemeIcon is its codicon in its theme color; an unknown codicon is no icon", async () => {
        const source = fakeSource({
            "": [
                item("a", "aws", { themeIcon: { id: "package", color: "terminal.ansiRed" } }),
                item("e", "own", { themeIcon: { id: "package", color: "myExtension.color" } }),
                item("b", "plain", { themeIcon: { id: "package" } }),
                item("c", "odd", { themeIcon: { id: "no-such-icon" } }),
                item("d", "proto", { themeIcon: { id: "toString" } }),
            ],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        const [aws, own, plain, odd, proto] = f.lines();
        expect(aws).toBe(`   ${CODICON_GLYPHS.package} aws`);
        expect(own).toBe(`   ${CODICON_GLYPHS.package} own`);
        expect(plain).toBe(`   ${CODICON_GLYPHS.package} plain`);
        expect(odd).toBe("   odd");
        expect(proto).toBe("   proto");
        expect(f.app.backend.getFgAt(new Point(3, 0))).toBe(vars["terminal.ansiRed"]);
        expect(f.app.backend.getFgAt(new Point(3, 1))).toBe(f.app.backend.getFgAt(new Point(5, 1)));
        expect(f.app.backend.getFgAt(new Point(3, 2))).toBe(f.app.backend.getFgAt(new Point(5, 2)));
    });

    it("a resource gets the file icon as in Explorer; a folder has none", async () => {
        const fileIcon = getFileIcon("main.ts");
        const source = fakeSource({
            "": [
                item("f", "main.ts", { resourceUri: "file:///w/main.ts?x#y" }),
                item("d", "src", { resourceUri: "file:///w/src", collapsibleState: 1 }),
                item("t", "main.ts", { resourceUri: "file:///w/main.ts", themeIcon: { id: "file" } }),
                item("u", "lib", { resourceUri: "file:///w/lib.ts", themeIcon: { id: "folder" } }),
                item("g", "generic", { themeIcon: { id: "file" } }),
            ],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        const [file, folder, themedFile, themedFolder, generic] = f.lines();
        expect(file).toBe(`   ${fileIcon.icon} main.ts`);
        expect(f.app.backend.getFgAt(new Point(3, 0))).toBe(fileIcon.color);
        expect(folder).toContain(" src");
        expect(folder).not.toContain(fileIcon.icon);
        expect(folder).not.toContain(getFileIcon("src").icon);
        expect(themedFile).toBe(`   ${fileIcon.icon} main.ts`);
        expect(themedFolder).toBe("   lib");
        expect(generic).toBe(`   ${CODICON_GLYPHS.file} generic`);
    });

    it("a file icon is by the resource's name, not its path; a ThemeIcon beats the resource", async () => {
        const docker = getFileIcon("Dockerfile");
        const source = fakeSource({
            "": [
                item("d", "Dockerfile", { resourceUri: "file:///w/Dockerfile" }),
                item("p", "main.ts", { resourceUri: "file:///w/main.ts", themeIcon: { id: "package" } }),
            ],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        const [dockerfile, themed] = f.lines();
        expect(docker).not.toEqual(getFileIcon("w/Dockerfile"));
        expect(dockerfile).toBe(`   ${docker.icon} Dockerfile`);
        expect(themed).toBe(`   ${CODICON_GLYPHS.package} main.ts`);
    });

    it("without Nerd Font a ThemeIcon is its Unicode codicon, a resource has no file icon", async () => {
        const { icons } = createSwitchableIcons(false);
        const source = fakeSource({
            "": [
                item("a", "aws", { themeIcon: { id: "package" } }),
                item("f", "main.ts", { resourceUri: "file:///w/main.ts" }),
                item("n", "none", { themeIcon: { id: "no-such-icon" } }),
            ],
        });
        const f = mount(source, { host: { icons } });
        f.tree.setVisible(true);
        await f.settle();
        expect(f.lines()).toEqual([`   ${CODICON_UNICODE.package} aws`, "   main.ts", "   none"]);
    });

    it("switching diode.icons.nerdFont redraws the rows without asking the subprocess", async () => {
        const switchable = createSwitchableIcons(true);
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 2, themeIcon: { id: "package" } })],
            p: [item("p/c", "main.ts", { parentHandle: "p", resourceUri: "file:///w/main.ts" })],
        });
        const f = mount(source, { host: { icons: switchable.icons } });
        f.tree.setVisible(true);
        await f.settle();
        expect(labels(f)).toEqual(["pkg", "main.ts"]);
        const asked = source.requests.length;
        await switchable.set(false);
        await f.settle();
        const [pkg, file] = f.lines();
        expect(pkg).toContain(`${CODICON_UNICODE.package} pkg`);
        expect(file).toBe("     main.ts");
        expect(source.requests.length).toBe(asked);
        // After the redraw the subprocess answers again.
        await f.tree.refresh(undefined);
        expect(source.requests.length).toBe(asked + 2);
    });

    it("a switch before the section is read draws nothing until it shows; a disposed tree no longer redraws", async () => {
        const switchable = createSwitchableIcons(true);
        const source = fakeSource({ "": [item("a", "aws", { themeIcon: { id: "package" } })] });
        const f = mount(source, { host: { icons: switchable.icons } });
        await switchable.set(false);
        await f.settle();
        expect(source.requests).toEqual([]);
        f.tree.setVisible(true);
        await f.settle();
        expect(f.lines()).toEqual([`   ${CODICON_UNICODE.package} aws`]);
        f.tree.dispose();
        await switchable.set(true);
        await f.settle();
        expect(f.lines()).toEqual([`   ${CODICON_UNICODE.package} aws`]);
    });

    it("a row the tree already holds is updated in place when reveal names it again", async () => {
        const source = fakeSource({ "": [item("a", "alpha")] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        await f.tree.reveal({
            viewId: "test.view",
            item: item("a", "alpha"),
            parentChain: [],
            select: true,
            focus: false,
            expand: false,
        });
        await f.tree.refresh([item("a", "alpha", { description: "changed" })]);
        expect(f.lines()).toEqual(["   alpha changed"]);
    });

    it("a refreshed row is redrawn in place; a row the tree doesn't know is ignored", async () => {
        const source = fakeSource({ "": [item("a", "alpha"), item("b", "beta")] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        await f.tree.refresh([item("b", "beta", { description: "changed" }), item("zz", "ghost")]);
        expect(f.lines()).toEqual(["   alpha", "   beta changed"]);
        expect(source.requests).toEqual([undefined]);
    });

    it("a row refresh before the first load only updates the cached item", async () => {
        const source = fakeSource({ "": [item("a", "alpha")] });
        const f = mount(source);
        await f.tree.refresh([item("a", "alpha2")]);
        expect(source.requests).toEqual([]);
    });
});

describe("ExtensionTreeView — gestures", () => {
    it("Enter on a row with a command runs it in the subprocess; a failure is a toast", async () => {
        const source = fakeSource({ "": [item("a", "run me", { command: { id: "x.run", title: "Run" } })] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        f.tree.focus();
        f.app.sendKey("Enter");
        await f.settle();
        expect(source.executed).toEqual(["a"]);

        source.commandError = new Error("command failed");
        f.app.sendKey("Enter");
        await f.settle();
        expect(f.errors).toEqual(["command failed"]);

        source.commandError = "plain" as unknown as Error;
        f.app.sendKey("Enter");
        await f.settle();
        expect(f.errors).toEqual(["command failed", "plain"]);
    });

    it("Enter on a row without a command toggles it, like Explorer, and the subprocess hears it", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 1 })],
            p: [item("p/c", "child")],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        f.tree.focus();
        f.app.sendKey("Enter");
        await f.settle();
        expect(source.executed).toEqual([]);
        expect(f.lines()).toHaveLength(2);
        expect(source.expansions).toEqual([["p", true]]);
        f.app.sendKey("Enter");
        await f.settle();
        expect(source.expansions).toEqual([
            ["p", true],
            ["p", false],
        ]);
    });

    it("a collapsible row with a command runs it on Enter and expands only by its chevron", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 1, command: { id: "x.open", title: "Open" } })],
            p: [item("p/c", "child")],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        f.tree.focus();
        f.app.sendKey("Enter");
        await f.settle();
        expect(source.executed).toEqual(["p"]);
        expect(f.lines()).toHaveLength(1);
    });

    it("`workbench.tree.expandMode: doubleClick`: Enter on a row without a command doesn't toggle it", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 1 })],
            p: [item("p/c", "child")],
        });
        const f = mount(source, { host: { expandOnRowClick: () => false } });
        f.tree.setVisible(true);
        await f.settle();
        f.tree.focus();
        f.app.sendKey("Enter");
        await f.settle();
        expect(f.lines()).toHaveLength(1);
    });

    it("`workbench.tree.renderIndentGuides`: read on every frame, a change event repaints the rows", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 2 })],
            p: [item("p/c", "child", { parentHandle: "p" })],
        });
        let mode: TreeIndentGuides = "always";
        const changed = new Emitter<void>();
        const f = mount(source, {
            host: { renderIndentGuides: () => mode, onDidChangeRenderIndentGuides: changed.event },
        });
        f.tree.setVisible(true);
        await f.settle();
        expect(f.lines()[1]).toMatch(/^ \u2502 /);

        mode = "none";
        changed.fire();
        expect(f.lines()[1]).toMatch(/^ {3}/);
    });

    it("a single click opens a leaf with `workbench.list.openMode: singleClick`, not with doubleClick", async () => {
        const make = async (single: boolean): Promise<IFakeSource> => {
            const source = fakeSource({ "": [item("a", "run", { command: { id: "x", title: "X" } })] });
            const f = mount(source, { host: { openOnSingleClick: () => single } });
            f.tree.setVisible(true);
            await f.settle();
            f.lines();
            click(f, 5, 0);
            await f.settle();
            return source;
        };
        expect((await make(true)).executed).toEqual(["a"]);
        expect((await make(false)).executed).toEqual([]);
    });

    it("moving the cursor reports the selection and the focused row", async () => {
        const source = fakeSource({ "": [item("a", "alpha"), item("b", "beta")] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        f.tree.focus();
        f.app.sendKey("ArrowDown");
        f.app.sendKey("ArrowDown");
        expect(source.selections.at(-1)).toEqual([["b"], "b"]);
    });

    it("canSelectMany reports every selected row", async () => {
        const source = fakeSource({ "": [item("a", "alpha"), item("b", "beta")] });
        const f = mount(source, { canSelectMany: true });
        f.tree.setVisible(true);
        await f.settle();
        f.tree.focus();
        f.tree.treeElement.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "ArrowDown", shiftKey: true }));
        expect(source.selections.at(-1)).toEqual([["a", "b"], "b"]);
    });

    it("a row the user collapsed is not reopened by Collapse All", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 1 })],
            p: [item("p/c", "child", { parentHandle: "p" })],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        f.tree.focus();
        f.app.sendKey("Enter");
        await f.settle();
        f.app.sendKey("Enter");
        await f.settle();
        await f.tree.collapseAll();
        await f.settle();
        expect(f.lines()).toHaveLength(1);
        expect(source.expansions).toEqual([
            ["p", true],
            ["p", false],
        ]);
    });

    it("Collapse All closes every expanded row", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 2 }), item("q", "other", { collapsibleState: 2 })],
            p: [item("p/c", "child", { collapsibleState: 2 })],
            "p/c": [item("p/c/g", "grandchild")],
            q: [item("q/c", "leaf")],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        expect(f.lines()).toHaveLength(5);
        await f.tree.collapseAll();
        expect(f.lines()).toHaveLength(2);
        expect(
            source.expansions
                .filter(([, expanded]) => !expanded)
                .map(([handle]) => handle)
                .sort(),
        ).toEqual(["p", "p/c", "q"]);
    });
});

describe("ExtensionTreeView — message, reveal, replacement", () => {
    it("the message is a wrapped line above the tree; empty — the tree starts at the top", async () => {
        const source = fakeSource({ "": [item("a", "alpha")] });
        const f = mount(source, { width: 20 });
        f.tree.setVisible(true);
        await f.settle();
        f.tree.setMessage("No providers found in this workspace");
        expect(f.tree.getMessage()).toBe("No providers found in this workspace");
        expect(f.lines()).toEqual([" No providers found", " in this workspace", "   alpha"]);
        f.tree.setMessage("");
        expect(f.lines()).toEqual(["   alpha"]);
    });

    it("reveal expands the ancestors, puts the cursor on the item and expands it on request", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 1 }), item("z", "zed")],
            p: [item("p/c", "child", { collapsibleState: 1 }), item("p/d", "dee")],
            "p/c": [item("p/c/g", "grand")],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        await f.tree.reveal({
            viewId: "test.view",
            item: item("p/c", "child", { collapsibleState: 1 }),
            parentChain: [item("p", "pkg", { collapsibleState: 1 })],
            select: true,
            focus: true,
            expand: true,
        });
        expect(labels(f)).toEqual(["pkg", "child", "grand", "dee", "zed"]);
        expect(f.tree.treeElement.getSelectedNode()?.handle).toBe("p/c");
        expect(f.app.focusedElement).toBe(f.tree.treeElement);
    });

    it("reveal with a number of levels expands that deep; without focus the tree isn't focused", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 1 })],
            p: [item("p/c", "child", { collapsibleState: 1 })],
            "p/c": [item("p/c/g", "grand")],
        });
        const f = mount(source);
        await f.tree.reveal({
            viewId: "test.view",
            item: item("p", "pkg", { collapsibleState: 1 }),
            parentChain: [],
            select: true,
            focus: false,
            expand: 2,
        });
        expect(labels(f)).toEqual(["pkg", "child", "grand"]);
        expect(f.app.focusedElement).not.toBe(f.tree.treeElement);
    });

    it("reveal without an item only focuses", async () => {
        const source = fakeSource({ "": [item("a", "alpha")] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        await f.tree.reveal({ viewId: "test.view", parentChain: [], select: true, focus: true, expand: false });
        expect(f.app.focusedElement).toBe(f.tree.treeElement);
        expect(source.expansions).toEqual([]);
    });

    it("a new provider that fails keeps the rows the old one gave", async () => {
        const first = fakeSource({ "": [item("a", "alpha")] });
        const f = mount(first);
        f.tree.setVisible(true);
        await f.settle();
        const second = fakeSource({});
        second.fail = new Error("not ready");
        f.tree.setSource(second, { canSelectMany: false });
        await f.settle();
        expect(f.lines()).toEqual(["   alpha"]);
    });

    it("reveal in a loaded tree doesn't reread the root, expands one level for `true` and never asks a leaf", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 1 })],
            p: [
                item("p/c", "child", { parentHandle: "p", collapsibleState: 1 }),
                item("p/l", "leafy", { parentHandle: "p" }),
            ],
            "p/c": [item("p/c/g", "grand", { parentHandle: "p/c" })],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        const before = source.requests.length;
        await f.tree.reveal({
            viewId: "test.view",
            item: item("p", "pkg", { collapsibleState: 1 }),
            parentChain: [],
            select: true,
            focus: false,
            expand: true,
        });
        expect(labels(f)).toEqual(["pkg", "child", "leafy"]);
        expect(source.requests.slice(before)).toEqual(["p"]);
    });

    it("reveal with two levels doesn't ask a leaf on the first level", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 1 })],
            p: [
                item("p/c", "child", { parentHandle: "p", collapsibleState: 1 }),
                item("p/l", "leafy", { parentHandle: "p" }),
            ],
            "p/c": [item("p/c/g", "grand", { parentHandle: "p/c" })],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        const before = source.requests.length;
        await f.tree.reveal({
            viewId: "test.view",
            item: item("p", "pkg", { collapsibleState: 1 }),
            parentChain: [],
            select: true,
            focus: false,
            expand: 2,
        });
        expect(labels(f)).toEqual(["pkg", "child", "grand", "leafy"]);
        expect(source.requests.slice(before)).toEqual(["p", "p/c"]);
    });

    it("reveal with two levels stops at two", async () => {
        const source = fakeSource({
            "": [item("p", "pkg", { collapsibleState: 1 })],
            p: [item("p/c", "child", { parentHandle: "p", collapsibleState: 1 })],
            "p/c": [item("p/c/g", "grand", { parentHandle: "p/c", collapsibleState: 1 })],
            "p/c/g": [item("p/c/g/x", "deepest", { parentHandle: "p/c/g" })],
        });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        await f.tree.reveal({
            viewId: "test.view",
            item: item("p", "pkg", { collapsibleState: 1 }),
            parentChain: [],
            select: true,
            focus: false,
            expand: 2,
        });
        expect(labels(f)).toEqual(["pkg", "child", "grand"]);
    });

    it("a new source answers after setSource; the old one's late answer is dropped", async () => {
        let release: (items: IWireTreeItem[]) => void = () => undefined;
        const slow = fakeSource({});
        slow.getChildren = () =>
            new Promise((resolve) => {
                release = resolve;
            });
        const f = mount(slow);
        f.tree.setVisible(true);
        await f.settle();

        const fresh = fakeSource({ "": [item("n", "new provider")] });
        f.tree.setSource(fresh, { canSelectMany: false });
        await f.settle();
        release([item("o", "old provider")]);
        await f.settle();
        expect(fresh.visibility).toEqual([true]);
        expect(f.lines()).toEqual(["   new provider"]);
    });

    it("setSource on a hidden tree doesn't ask until it shows", async () => {
        const first = fakeSource({ "": [item("a", "alpha")] });
        const f = mount(first);
        const second = fakeSource({ "": [item("b", "beta")] });
        f.tree.setSource(second, { canSelectMany: true });
        await f.settle();
        expect(second.requests).toEqual([]);
        expect(second.visibility).toEqual([]);
        f.tree.setVisible(true);
        await f.settle();
        expect(f.lines()).toEqual(["   beta"]);
    });
});

/** Row text without the indent, chevron and icon glyphs (private-use code points). */
function labels(f: IFixture): string[] {
    return f.lines().map((line) => line.replace(/^[\s\uE000-\uF8FF]+/u, ""));
}

function click(f: IFixture, x: number, y: number): void {
    for (const action of ["press", "release"] as const) {
        const token: MouseToken = {
            kind: "mouse",
            button: "left",
            x: x + 1,
            y: y + 1,
            action,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            raw: "",
        };
        f.app.backend.simulateMouse(token);
    }
}

describe("ExtensionTreeView — a row refreshed under a new handle", () => {
    function expandable(handle: string, label: string): IWireTreeItem {
        return item(handle, label, { collapsibleState: 1 });
    }

    async function expand(f: IFixture, row: IWireTreeItem): Promise<void> {
        await f.tree.reveal({ viewId: "test.view", item: row, parentChain: [], select: true, focus: false, expand: true });
    }

    it("a root row comes from the root", async () => {
        const source = fakeSource({ "": [item("a", "before")] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        source.requests.length = 0;
        source.children[""] = [item("b", "after")];

        await f.tree.refresh([item("b", "after", { previousHandle: "a" })]);

        expect(labels(f)).toEqual(["after"]);
        expect(source.requests).toEqual([undefined]);
    });

    it("a root row comes from the provider even after a failed read of the root", async () => {
        const source = fakeSource({ "": [item("a", "before")] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        source.fail = new Error("boom");
        await f.tree.refresh(undefined);
        source.fail = null;
        source.children[""] = [item("b", "after")];

        await f.tree.refresh([item("b", "after", { previousHandle: "a" })]);

        expect(labels(f)).toEqual(["after"]);
    });

    it("a nested row comes from its parent, and the root is not reread", async () => {
        const parent = expandable("p", "pkg");
        const source = fakeSource({ "": [parent], p: [item("p/a", "before", { parentHandle: "p" })] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        await expand(f, parent);
        source.requests.length = 0;
        source.children.p = [item("p/b", "after", { parentHandle: "p" })];

        await f.tree.refresh([item("p/b", "after", { parentHandle: "p", previousHandle: "p/a" })]);

        expect(labels(f)).toEqual(["pkg", "after"]);
        expect(source.requests).toEqual(["p"]);
    });

    it("a previous handle the tree does not know rereads nothing", async () => {
        const source = fakeSource({ "": [item("a", "alpha")] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        source.requests.length = 0;

        await f.tree.refresh([item("b", "after", { previousHandle: "ghost" })]);

        expect(source.requests).toEqual([]);
    });

    it("an expanded row under a new handle is not collapsed again by Collapse All", async () => {
        const row = expandable("p", "pkg");
        const source = fakeSource({ "": [row], p: [item("p/c", "child", { parentHandle: "p" })] });
        const f = mount(source);
        f.tree.setVisible(true);
        await f.settle();
        await expand(f, row);
        source.children[""] = [expandable("q", "renamed")];
        await f.tree.refresh([item("q", "renamed", { collapsibleState: 1, previousHandle: "p" })]);
        source.expansions.length = 0;

        await f.tree.collapseAll();

        expect(source.expansions).toEqual([]);
    });
});

describe("ExtensionTreeView — welcome state", () => {
    it("empty until the root answers; an expanded row with no children doesn't make the tree empty", async () => {
        const source = fakeSource({ "": [item("p", "pkg", { collapsibleState: 2 })], p: [] });
        const f = mount(source);
        expect(f.tree.shouldShowWelcome()).toBe(true);

        f.tree.setVisible(true);
        await f.settle();
        expect(source.requests).toEqual([undefined, "p"]);
        expect(f.tree.shouldShowWelcome()).toBe(false);
    });

    it("the change event fires only when the answer changes, not on every message or reread", async () => {
        const source = fakeSource({ "": [] });
        const f = mount(source);
        let changes = 0;
        f.tree.onDidChangeWelcomeState(() => {
            changes++;
        });

        f.tree.setMessage("Loading…");
        expect(changes).toBe(1);
        f.tree.setVisible(true);
        await f.settle();
        source.children[""] = [item("a", "alpha")];
        await f.tree.refresh(undefined);
        await f.settle();
        expect(changes).toBe(1);

        f.tree.setMessage("");
        f.tree.setMessage("Still here");
        expect(changes).toBe(1);
        expect(f.tree.shouldShowWelcome()).toBe(false);
    });

    it("a disposed tree notifies nobody", () => {
        const f = mount(fakeSource({ "": [] }));
        let changes = 0;
        f.tree.onDidChangeWelcomeState(() => {
            changes++;
        });
        f.tree.dispose();

        f.tree.setMessage("after dispose");
        expect(changes).toBe(0);
    });
});

describe("ExtensionTreeView — row menus", () => {
    const copy = {
        label: "Copy Name",
        id: "ext.copy",
        enabled: true,
        disabled: false,
    };

    it("a row whose menu is only its inline group opens no context menu", async () => {
        const shown: unknown[] = [];
        const f = mount(fakeSource({ "": [item("a", "alpha")] }), {
            host: {
                itemMenu: () => [{ group: "inline", entries: [copy] }],
                showContextMenu: (_owner, _anchor, entries) => shown.push(entries),
            },
        });
        f.tree.setVisible(true);
        await f.settle();
        f.tree.focus();
        f.app.sendKey("Shift+F10");
        expect(shown).toEqual([]);
    });

    it("a glyph drawn before the menu lost its item runs nothing", async () => {
        const executed: string[] = [];
        let entries = [copy];
        const f = mount(fakeSource({ "": [item("a", "alpha")] }), {
            host: {
                itemMenu: () => [{ group: "inline", entries }],
                executeCommand: (id) => executed.push(id),
            },
        });
        f.tree.setVisible(true);
        await f.settle();
        const node = f.tree.treeElement.getSelectedNode();
        if (node === null) throw new Error("no row");
        entries = [];
        f.tree.treeElement.onInlineAction?.(node, 0);
        expect(executed).toEqual([]);
        entries = [copy];
        f.tree.treeElement.onInlineAction?.(node, 0);
        expect(executed).toEqual(["ext.copy"]);
    });

    it("an inline item whose glyph is missing from the font set shows its title", async () => {
        const f = mount(fakeSource({ "": [item("a", "alpha")] }), {
            host: {
                itemMenu: () => [
                    {
                        group: "inline",
                        entries: [
                            { ...copy, icon: "" },
                            { ...copy, label: "Edit", id: "ext.edit", icon: "✎" },
                        ],
                    },
                ],
            },
        });
        f.tree.setVisible(true);
        await f.settle();
        const row = f.lines().find((line) => line.includes("alpha")) ?? "";
        expect(row).toContain("Copy Name");
        expect(row).toContain("✎");
        expect(row).not.toContain("Edit");
    });
});
