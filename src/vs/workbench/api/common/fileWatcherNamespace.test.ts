import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import { type IWatcherTransport, resolveGlobPattern, SubprocessFileSystemWatchers } from "./fileWatcherNamespace.ts";
import { RelativePattern } from "./vscodeTypes.ts";
import type { IWireWatcherCreate } from "./wireTypes.ts";

function makeTransport(): IWatcherTransport & { created: IWireWatcherCreate[]; disposed: number[] } {
    const created: IWireWatcherCreate[] = [];
    const disposed: number[] = [];
    return {
        created,
        disposed,
        create: (request) => created.push(request),
        dispose: (id) => disposed.push(id),
    };
}

describe("resolveGlobPattern", () => {
    it("string pattern binds to the workspace folder", () => {
        expect(resolveGlobPattern("**/*.ts", "/repo")).toEqual({ base: "/repo", pattern: "**/*.ts" });
    });

    it("without a workspace a string pattern has nothing to resolve against", () => {
        expect(resolveGlobPattern("**/*.ts", undefined)).toBeNull();
    });

    it("RelativePattern yields its own base, not the workspace folder", () => {
        const resolved = resolveGlobPattern(
            new RelativePattern(Uri.file("/repo/.git"), "*") as unknown as never,
            "/repo",
        );
        expect(resolved).toEqual({ base: "/repo/.git", pattern: "*" });
    });

    it("RelativePattern based on a workspace folder takes its uri", () => {
        const folder = { uri: Uri.file("/repo"), name: "repo", index: 0 };
        const resolved = resolveGlobPattern(new RelativePattern(folder as never, "**") as unknown as never, undefined);
        expect(resolved).toEqual({ base: "/repo", pattern: "**" });
    });

    it("foreign RelativePattern (duck-typed object) is accepted too", () => {
        const duck = { baseUri: { fsPath: "/other" }, pattern: "*.js" };
        expect(resolveGlobPattern(duck as unknown as never, "/repo")).toEqual({ base: "/other", pattern: "*.js" });
    });

    it("legacy string base is the fallback", () => {
        const duck = { base: "/legacy", pattern: "*.js" };
        expect(resolveGlobPattern(duck as unknown as never, "/repo")).toEqual({ base: "/legacy", pattern: "*.js" });
    });

    it("garbage does not resolve", () => {
        expect(resolveGlobPattern({ pattern: 1 } as unknown as never, "/repo")).toBeNull();
        expect(resolveGlobPattern({ pattern: "*" } as unknown as never, "/repo")).toBeNull();
        expect(resolveGlobPattern(null as unknown as never, "/repo")).toBeNull();
        expect(resolveGlobPattern(42 as unknown as never, "/repo")).toBeNull();
        expect(resolveGlobPattern({ baseUri: 42, pattern: "*" } as unknown as never, "/repo")).toBeNull();
        expect(
            resolveGlobPattern({ baseUri: { fsPath: "" }, base: "", pattern: "*" } as unknown as never, "/repo"),
        ).toBeNull();
    });
});

describe("SubprocessFileSystemWatchers", () => {
    it("creation is sent to the host with the ignore flags", () => {
        const transport = makeTransport();
        const watchers = new SubprocessFileSystemWatchers(transport);

        const watcher = watchers.create({ base: "/repo", pattern: "**" }, false, true, false);

        expect(transport.created).toEqual([
            {
                id: 1,
                base: "/repo",
                pattern: "**",
                ignoreCreateEvents: false,
                ignoreChangeEvents: true,
                ignoreDeleteEvents: false,
            },
        ]);
        expect(watcher.ignoreChangeEvents).toBe(true);
    });

    it("host events are routed to the emitters of their watcher", () => {
        const transport = makeTransport();
        const watchers = new SubprocessFileSystemWatchers(transport);
        const first = watchers.create({ base: "/repo", pattern: "**" }, false, false, false);
        const second = watchers.create({ base: "/other", pattern: "**" }, false, false, false);

        const firstSeen: string[] = [];
        const secondSeen: string[] = [];
        first.onDidCreate((uri) => firstSeen.push(`created ${uri.fsPath}`));
        first.onDidChange((uri) => firstSeen.push(`changed ${uri.fsPath}`));
        first.onDidDelete((uri) => firstSeen.push(`deleted ${uri.fsPath}`));
        second.onDidChange((uri) => secondSeen.push(uri.fsPath));

        watchers.dispatch({
            id: 1,
            events: [
                { type: "created", uri: Uri.file("/repo/a.ts").toString() },
                { type: "changed", uri: Uri.file("/repo/b.ts").toString() },
                { type: "deleted", uri: Uri.file("/repo/c.ts").toString() },
            ],
        });

        expect(firstSeen).toEqual(["created /repo/a.ts", "changed /repo/b.ts", "deleted /repo/c.ts"]);
        expect(secondSeen).toEqual([]);
    });

    it("dispose removes the watcher on the host and silences events", () => {
        const transport = makeTransport();
        const watchers = new SubprocessFileSystemWatchers(transport);
        const watcher = watchers.create({ base: "/repo", pattern: "**" }, false, false, false);
        const seen: string[] = [];
        watcher.onDidChange((uri) => seen.push(uri.fsPath));

        watcher.dispose();
        watcher.dispose(); // a repeated one must not send to the host a second time
        watchers.dispatch({ id: 1, events: [{ type: "changed", uri: Uri.file("/repo/a.ts").toString() }] });

        expect(transport.disposed).toEqual([1]);
        expect(seen).toEqual([]);
    });

    it("a batch for an unknown id (race with dispose) does not break the registry", () => {
        const watchers = new SubprocessFileSystemWatchers(makeTransport());
        expect(() => {
            watchers.dispatch({ id: 42, events: [{ type: "changed", uri: Uri.file("/repo/a.ts").toString() }] });
        }).not.toThrow();
    });

    it("silent watcher is valid: subscriptions and dispose work, no events", () => {
        const transport = makeTransport();
        const watchers = new SubprocessFileSystemWatchers(transport);
        const watcher = watchers.createInert(false, false, false);
        const seen: string[] = [];
        watcher.onDidChange((uri) => seen.push(uri.fsPath));

        watchers.dispatch({ id: 1, events: [{ type: "changed", uri: Uri.file("/repo/a.ts").toString() }] });
        watcher.dispose();

        expect(transport.created).toEqual([]);
        expect(seen).toEqual([]);
    });
});
