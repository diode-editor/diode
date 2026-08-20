import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import { resolveGlobPattern, SubprocessFileSystemWatchers, type IWatcherTransport } from "./fileWatcherNamespace.ts";
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
    it("строковый шаблон привязывается к папке воркспейса", () => {
        expect(resolveGlobPattern("**/*.ts", "/repo")).toEqual({ base: "/repo", pattern: "**/*.ts" });
    });

    it("без воркспейса строковый шаблон резолвить не к чему", () => {
        expect(resolveGlobPattern("**/*.ts", undefined)).toBeNull();
    });

    it("RelativePattern отдаёт свою базу, а не папку воркспейса", () => {
        const resolved = resolveGlobPattern(
            new RelativePattern(Uri.file("/repo/.git"), "*") as unknown as never,
            "/repo",
        );
        expect(resolved).toEqual({ base: "/repo/.git", pattern: "*" });
    });

    it("RelativePattern от папки воркспейса берёт её uri", () => {
        const folder = { uri: Uri.file("/repo"), name: "repo", index: 0 };
        const resolved = resolveGlobPattern(new RelativePattern(folder as never, "**") as unknown as never, undefined);
        expect(resolved).toEqual({ base: "/repo", pattern: "**" });
    });

    it("чужой RelativePattern (утиный объект) тоже принимается", () => {
        const duck = { baseUri: { fsPath: "/other" }, pattern: "*.js" };
        expect(resolveGlobPattern(duck as unknown as never, "/repo")).toEqual({ base: "/other", pattern: "*.js" });
    });

    it("устаревшее строковое base — запасной путь", () => {
        const duck = { base: "/legacy", pattern: "*.js" };
        expect(resolveGlobPattern(duck as unknown as never, "/repo")).toEqual({ base: "/legacy", pattern: "*.js" });
    });

    it("мусор не резолвится", () => {
        expect(resolveGlobPattern({ pattern: 1 } as unknown as never, "/repo")).toBeNull();
        expect(resolveGlobPattern({ pattern: "*" } as unknown as never, "/repo")).toBeNull();
        expect(resolveGlobPattern(null as unknown as never, "/repo")).toBeNull();
        expect(resolveGlobPattern(42 as unknown as never, "/repo")).toBeNull();
        expect(resolveGlobPattern({ baseUri: 42, pattern: "*" } as unknown as never, "/repo")).toBeNull();
        expect(resolveGlobPattern({ baseUri: { fsPath: "" }, base: "", pattern: "*" } as unknown as never, "/repo")).toBeNull();
    });
});

describe("SubprocessFileSystemWatchers", () => {
    it("создание уезжает на хост вместе с ignore-флагами", () => {
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

    it("события хоста разводятся по эмиттерам своего watcher'а", () => {
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

    it("dispose снимает watcher на хосте и глушит события", () => {
        const transport = makeTransport();
        const watchers = new SubprocessFileSystemWatchers(transport);
        const watcher = watchers.create({ base: "/repo", pattern: "**" }, false, false, false);
        const seen: string[] = [];
        watcher.onDidChange((uri) => seen.push(uri.fsPath));

        watcher.dispose();
        watcher.dispose(); // повторный — не должен слать хосту второй раз
        watchers.dispatch({ id: 1, events: [{ type: "changed", uri: Uri.file("/repo/a.ts").toString() }] });

        expect(transport.disposed).toEqual([1]);
        expect(seen).toEqual([]);
    });

    it("пачка на неизвестный id (гонка с dispose) не роняет реестр", () => {
        const watchers = new SubprocessFileSystemWatchers(makeTransport());
        expect(() => {
            watchers.dispatch({ id: 42, events: [{ type: "changed", uri: Uri.file("/repo/a.ts").toString() }] });
        }).not.toThrow();
    });

    it("немой watcher валиден: подписки и dispose работают, событий нет", () => {
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
