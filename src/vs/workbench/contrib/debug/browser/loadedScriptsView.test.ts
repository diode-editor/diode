// The model of LOADED SCRIPTS (upstream's `BaseTreeItem` family): where a loaded source goes by its path — relative
// to the workspace, tildified outside it, under its host for a URL — how folders of one child fold into one row, the
// order of a session's rows, removal, and the tree over it with the events of the sessions.

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { mockSession } from "../../../../../TestUtils/mockDebug.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IDebugService, IDebugSession, LoadedSourceEvent } from "../common/debug.ts";
import { Source } from "../common/debugSource.ts";

import type { IBreakpointSources } from "./breakpointsView.ts";
import {
    type BaseTreeItem,
    LOADED_SCRIPTS_REFRESH_DELAY_MS,
    LoadedScriptsView,
    RootTreeItem,
    SessionTreeItem,
} from "./loadedScriptsView.ts";

const WORKSPACE: IWorkspaceFolder = { uri: Uri.file("/w"), name: "w", index: 0 };

function session(id: string, name = id): IDebugSession {
    return mockSession({
        getId: () => id,
        getLabel: () => name,
        getSource: (raw?: DebugProtocol.Source) => new Source(raw, id, NULL_LOGGER),
    });
}

function source(path: string, raw: Partial<DebugProtocol.Source> = {}): Source {
    return new Source({ name: path.split("/").at(-1), path, ...raw }, "s", NULL_LOGGER);
}

function rootWith(folders: IWorkspaceFolder[] = [WORKSPACE], userHome = "/home/me"): RootTreeItem {
    return new RootTreeItem({
        workspace: {
            getWorkspaceFolder: (uri) =>
                folders.find((f) => uri.path === f.uri.path || uri.path.startsWith(`${f.uri.path}/`)) ?? null,
            getWorkspace: () => ({ id: null, folders }),
        },
        userHome,
    });
}

/** The rows as the tree shows them, all expanded: the label, indented by depth. */
function rows(item: BaseTreeItem, depth = 0): string[] {
    return item
        .getChildren()
        .flatMap((child) => [`${"  ".repeat(depth)}${child.getLabel()}`, ...rows(child, depth + 1)]);
}

describe("LOADED SCRIPTS model", () => {
    it("a workspace file is relative to the folder, others tildified or absolute, a URL under its host", () => {
        const root = rootWith();
        const node = root.add(session("s"));
        for (const path of [
            "/w/src/a.ts",
            "/w/src/b.ts",
            "/w/c.ts",
            "/home/me/lib/d.ts",
            "/usr/lib/e.ts",
            "https://example.com/js/f.js",
            "file:///w/g.ts",
            "<node_internals>/h.js",
        ]) {
            node.addPath(source(path));
        }

        // By the first folder's own name (`localeCompare`), `<…>` last.
        expect(rows(root)).toEqual([
            "/usr/lib/e.ts",
            "~/lib/d.ts",
            "c.ts",
            "g.ts",
            "https://example.com/js/f.js",
            "src",
            "  a.ts",
            "  b.ts",
            "<node_internals>/h.js",
        ]);
    });

    it("a URL's path is decoded; a relative path stays as it is; without a home nothing is tildified", () => {
        const root = rootWith([WORKSPACE], "");
        const node = root.add(session("s"));
        node.addPath(source("https://example.com/my%20dir/f.js"));
        node.addPath(source("w/x.ts"));
        node.addPath(source("/usr/lib/e.ts"));

        expect(rows(root)).toEqual(["/usr/lib/e.ts", "https://example.com/my dir/f.js", "w/x.ts"]);
    });

    it("only a whole `<…>` name goes last", () => {
        const root = rootWith();
        const node = root.add(session("s"));
        for (const path of ["<node internals>/a.js", "x<y>/b.js", "<c>d/e.js", "z/f.js"]) {
            node.addPath(source(path));
        }

        expect(rows(root)).toEqual(["<c>d/e.js", "x<y>/b.js", "z/f.js", "<node internals>/a.js"]);
    });

    it("a folded row is the leaf's: its source, and no children for a file", () => {
        const root = rootWith();
        const node = root.add(session("s"));
        node.addPath(source("/w/src/a.ts"));
        node.addPath(source("/w/lib/deep/b.ts"));
        node.addPath(source("/w/lib/deep/c.ts"));

        const [lib, src] = root.getChildren();
        expect([lib.getLabel(), src.getLabel()]).toEqual(["lib/deep", "src/a.ts"]);
        expect(src.hasChildren()).toBe(false);
        expect(src.getSource()?.raw.path).toBe("/w/src/a.ts");
        expect(lib.hasChildren()).toBe(true);
        expect(lib.getSource()).toBeUndefined();
    });

    it("a changed source with sources has the new ones only", () => {
        const root = rootWith();
        const node = root.add(session("s"));
        node.addPath(source("/w/bundle.js", { sources: [{ name: "a.ts", path: "/w/a.ts" }] }));
        node.addPath(source("/w/bundle.js", { sources: [{ name: "b.ts", path: "/w/b.ts" }] }));

        expect(rows(root)).toEqual(["bundle.js", "  b.ts"]);
    });

    it("an empty root asked for its rows still skips the one session that comes later", () => {
        const root = rootWith();
        expect(root.getChildren()).toEqual([]);

        root.add(session("s1", "first")).addPath(source("/w/a.ts"));

        expect(rows(root)).toEqual(["a.ts"]);
    });

    it("removing the only source of a session named as its id leaves the root empty", () => {
        const root = rootWith();
        const node = root.add(session("s"));
        node.addPath(source("/w/a.ts"));

        expect(node.removePath(source("/w/a.ts"))).toBe(true);

        expect(root.getChildren()).toEqual([]);
    });

    it("with several workspace folders, a workspace file is under its folder, the folders first in their order", () => {
        const second: IWorkspaceFolder = { uri: Uri.file("/x"), name: "x", index: 1 };
        const root = rootWith([WORKSPACE, second]);
        const node = root.add(session("s"));
        node.addPath(source("/x/b.ts"));
        node.addPath(source("/w/a.ts"));
        node.addPath(source("/w/c.ts"));
        node.addPath(source("/a/z.ts"));

        expect(rows(root)).toEqual(["w", "  a.ts", "  c.ts", "x/b.ts", "/a/z.ts"]);
    });

    it("a source without a path is left out; one with sources has them as children", () => {
        const s = session("s");
        const root = rootWith();
        const node = root.add(s);
        node.addPath(new Source({ name: "eval", sourceReference: 3 }, "s", NULL_LOGGER));
        node.addPath(
            source("/w/bundle.js", {
                sources: [
                    { name: "a.ts", path: "/w/a.ts" },
                    { name: "nameless", path: undefined },
                ],
            }),
        );
        node.addPath(source("/w/other.js"));

        expect(rows(root)).toEqual(["bundle.js", "  a.ts", "other.js"]);
        expect(root.getChildren()[0].getChildren()[0].getSource()?.raw.path).toBe("/w/a.ts");
    });

    it("removing the last source of a folder removes the folder", () => {
        const root = rootWith();
        const node = root.add(session("s"));
        node.addPath(source("/w/src/a.ts"));
        node.addPath(source("/w/lib/b.ts"));

        expect(node.removePath(source("/w/src/a.ts"))).toBe(true);
        expect(node.removePath(source("/w/src/a.ts"))).toBe(false);
        expect(node.removePath(source("/w/never.ts"))).toBe(false);
        expect(node.removePath(new Source({ name: "eval", sourceReference: 3 }, "s", NULL_LOGGER))).toBe(false);

        expect(rows(root)).toEqual(["lib/b.ts"]);
    });

    it("a folder that once had two children keeps its own row", () => {
        const root = rootWith();
        const node = root.add(session("s"));
        node.addPath(source("/w/src/a.ts"));
        node.addPath(source("/w/src/b.ts"));
        node.addPath(source("/w/other.ts"));
        // Drawn with both: the folder is a row of its own from then on.
        expect(rows(root)).toEqual(["other.ts", "src", "  a.ts", "  b.ts"]);
        node.removePath(source("/w/src/b.ts"));

        expect(rows(root)).toEqual(["other.ts", "src", "  a.ts"]);
    });

    it("one session has no row; with two each is a row, renamed with its session", () => {
        const root = rootWith();
        root.add(session("s1", "first")).addPath(source("/w/a.ts"));
        expect(rows(root)).toEqual(["a.ts"]);

        const second = root.add(session("s2", "second"));
        second.addPath(source("/w/b.ts"));
        expect(rows(root)).toEqual(["first", "  a.ts", "second", "  b.ts"]);
        expect(root.getChildren()[0]).toBeInstanceOf(SessionTreeItem);
        expect(root.find(session("s2"))).toBe(second);

        second.updateLabel("renamed");
        expect(rows(root)).toContain("renamed");
    });
});

describe("LoadedScriptsView", () => {
    let loaded: Emitter<LoadedSourceEvent>;
    let renamed: Emitter<string>;
    let newSession: Emitter<IDebugSession>;
    let endSession: Emitter<{ session: IDebugSession; restart: boolean }>;
    let sessions: IDebugSession[];
    let openSource: Mock<IBreakpointSources["openSource"]>;
    let label: string;

    beforeEach(() => {
        vi.useFakeTimers();
        loaded = new Emitter();
        renamed = new Emitter();
        newSession = new Emitter();
        endSession = new Emitter();
        openSource = vi.fn<IBreakpointSources["openSource"]>().mockResolvedValue(undefined);
        label = "first";
        sessions = [
            mockSession({
                getId: () => "s1",
                getLabel: () => label,
                capabilities: { supportsLoadedSourcesRequest: true },
                getLoadedSources: () => Promise.resolve([source("/w/a.ts")]),
                getSource: (raw?: DebugProtocol.Source) => new Source(raw, "s1", NULL_LOGGER),
                onDidLoadedSource: loaded.event,
                onDidChangeName: renamed.event,
            }),
        ];
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function create(): LoadedScriptsView {
        const debugService = {
            getModel: () => ({ getSessions: () => sessions }),
            onDidNewSession: newSession.event,
            onDidEndSession: endSession.event,
        } as unknown as IDebugService;
        return new LoadedScriptsView(
            debugService,
            {
                workspace: {
                    getWorkspaceFolder: () => WORKSPACE,
                    getWorkspace: () => ({ id: null, folders: [WORKSPACE] }),
                },
                userHome: "/home/me",
            },
            { openSource },
        );
    }

    async function settle(): Promise<void> {
        await vi.advanceTimersByTimeAsync(LOADED_SCRIPTS_REFRESH_DELAY_MS);
    }

    function shown(view: LoadedScriptsView): string[] {
        return view.tree.shownItems.map((item) => item.getLabel());
    }

    it("reads the sessions' sources, then follows their events: new, changed, removed; the session's end", async () => {
        const view = create();
        await settle();
        expect(shown(view)).toEqual(["a.ts"]);

        loaded.fire({ reason: "new", source: source("/w/b.ts") });
        loaded.fire({ reason: "changed", source: source("/w/a.ts") });
        // A change of a source not seen yet adds it.
        loaded.fire({ reason: "changed", source: source("/w/c.ts") });
        await settle();
        expect(shown(view)).toEqual(["a.ts", "b.ts", "c.ts"]);

        loaded.fire({ reason: "removed", source: source("/w/a.ts") });
        loaded.fire({ reason: "removed", source: source("/w/never.ts") });
        await settle();
        expect(shown(view)).toEqual(["b.ts", "c.ts"]);

        endSession.fire({ session: sessions[0], restart: false });
        loaded.fire({ reason: "new", source: source("/w/late.ts") });
        await settle();
        expect(shown(view)).toEqual([]);
        view.dispose();
    });

    it("a new session's events are followed; a rename shows with two sessions", async () => {
        const view = create();
        await settle();
        const otherLoaded = new Emitter<LoadedSourceEvent>();
        const other = mockSession({
            getId: () => "s2",
            getLabel: () => "second",
            getSource: (raw?: DebugProtocol.Source) => new Source(raw, "s2", NULL_LOGGER),
            onDidLoadedSource: otherLoaded.event,
            onDidChangeName: new Emitter<string>().event,
        });
        newSession.fire(other);
        otherLoaded.fire({ reason: "new", source: source("/w/c.ts") });
        await settle();
        // The sessions start expanded.
        expect(shown(view)).toEqual(["first", "a.ts", "second", "c.ts"]);

        label = "renamed";
        renamed.fire(label);
        await settle();
        expect(shown(view)).toEqual(["renamed", "a.ts", "second", "c.ts"]);
        view.dispose();
    });

    it("a session whose adapter has no loadedSources is read only by its events", async () => {
        sessions[0] = Object.assign(sessions[0], { capabilities: {} });
        const view = create();
        await settle();
        const refresh = vi.spyOn(view.tree, "refresh");

        // Not in the tree yet: a rename and a removal change nothing.
        renamed.fire("renamed");
        loaded.fire({ reason: "removed", source: source("/w/a.ts") });
        await settle();

        expect(shown(view)).toEqual([]);
        expect(refresh).not.toHaveBeenCalled();
        view.dispose();
    });

    it("a rename of a session in the tree redraws it", async () => {
        const view = create();
        await settle();
        const refresh = vi.spyOn(view.tree, "refresh");

        renamed.fire("renamed");
        await settle();

        expect(refresh).toHaveBeenCalledOnce();
        view.dispose();
    });

    it("each folder keeps its own expansion", async () => {
        sessions[0] = Object.assign(sessions[0], {
            getLoadedSources: () =>
                Promise.resolve(["/w/lib/a.ts", "/w/lib/b.ts", "/w/src/c.ts", "/w/src/d.ts"].map((p) => source(p))),
        });
        const view = create();
        await settle();
        expect(shown(view)).toEqual(["lib", "src"]);

        view.tree.expand(view.tree.shownItems[1]);
        await settle();

        expect(shown(view)).toEqual(["lib", "src", "c.ts", "d.ts"]);
        view.dispose();
    });

    it("Enter opens an available source and nothing for an unavailable one", async () => {
        const view = create();
        loaded.fire({ reason: "new", source: Object.assign(source("/w/gone.ts"), { available: false }) });
        await settle();
        const [a, gone] = view.tree.shownItems;

        view.tree.onActivate(gone);
        view.tree.onActivate(a);
        loaded.fire({ reason: "new", source: source("/w/dir/x.ts") });
        loaded.fire({ reason: "new", source: source("/w/dir/y.ts") });
        await settle();
        // A folder has no source.
        view.tree.onActivate(view.tree.shownItems.find((item) => item.getLabel() === "dir")!);

        expect(openSource).toHaveBeenCalledOnce();
        expect(openSource.mock.calls[0][0].toString()).toBe("file:///w/a.ts");
        view.dispose();
    });
});
