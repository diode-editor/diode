import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../base/common/event.ts";
import type { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import {
    FILES_EXCLUDE_SETTING,
    SEARCH_USE_IGNORE_FILES_SETTING,
} from "../../../common/configuration/excludeSettings.ts";
import type {
    IFileIndexRequest,
    IFileIndexResult,
    IFileQueryRequest,
    IFileQueryResult,
    IFileSearchProvider,
} from "../common/fileSearch.ts";

import { FileSearchService } from "./fileSearchService.ts";

const FOLDER = path.resolve("/work/project");

interface IWalk {
    readonly request: IFileIndexRequest;
    readonly files: string[];
    complete: boolean;
    finish(limitHit?: boolean): void;
    fail(): void;
}

/** Walks are finished by the test; queries answer from what the test put in. */
class FakeProvider implements IFileSearchProvider {
    public readonly walks = new Map<string, IWalk>();
    public readonly cleared: string[] = [];
    public readonly queries: IFileQueryRequest[] = [];
    public queryFails = false;
    private readonly onDidChangeIndexEmitter = new Emitter<string>();
    public readonly onDidChangeIndex = this.onDidChangeIndexEmitter.event;

    public index(request: IFileIndexRequest): Promise<IFileIndexResult> {
        return new Promise((resolve, reject) => {
            const walk: IWalk = {
                request,
                files: [],
                complete: false,
                finish: (limitHit = false) => {
                    walk.complete = true;
                    resolve({ limitHit });
                },
                fail: () => {
                    reject(new Error("host died"));
                },
            };
            this.walks.set(request.cacheKey, walk);
        });
    }

    public query(request: IFileQueryRequest): Promise<IFileQueryResult> {
        this.queries.push(request);
        if (this.queryFails) return Promise.reject(new Error("host died"));
        const walk = this.walks.get(request.cacheKey);
        if (walk === undefined || this.cleared.includes(request.cacheKey)) {
            return Promise.resolve({ matches: [], complete: false, limitHit: false });
        }
        return Promise.resolve({
            matches: walk.files
                .filter((f) => f.includes(request.query))
                .slice(0, request.maxResults)
                .map((relativePath) => ({ relativePath, score: 1, matchedIndices: [0] })),
            complete: walk.complete,
            limitHit: false,
        });
    }

    public clearCache(cacheKey: string): void {
        this.cleared.push(cacheKey);
    }

    public fire(cacheKey: string): void {
        this.onDidChangeIndexEmitter.fire(cacheKey);
    }

    public walk(index: number): IWalk {
        const walk = [...this.walks.values()].at(index);
        if (walk === undefined) throw new Error(`no walk #${String(index)}`);
        return walk;
    }
}

describe("FileSearchService", () => {
    let config: InMemoryConfigurationService;
    let workspace: WorkspaceContextService;
    let provider: FakeProvider;
    let service: FileSearchService;

    beforeEach(() => {
        config = createTestConfigurationService();
        workspace = new WorkspaceContextService();
        workspace.setWorkspaceFolder(FOLDER);
        provider = new FakeProvider();
        service = new FileSearchService(config, workspace);
        service.registerProvider(provider);
    });

    afterEach(() => {
        service.dispose();
    });

    async function names(session: ReturnType<FileSearchService["createSession"]>, query = ""): Promise<string[]> {
        return (await session.search(query, 50)).results.map((r) => r.relativePath);
    }

    describe("a session", () => {
        it("asks the provider to walk the workspace folder with the exclude and ignore-file settings", async () => {
            await config.updateValue(FILES_EXCLUDE_SETTING, { "**/out": true });
            await config.updateValue(SEARCH_USE_IGNORE_FILES_SETTING, false);
            service.createSession();

            const { request } = provider.walk(0);
            expect(request.folder).toBe(FOLDER);
            expect(request.excludes).toContain("**/out");
            expect(request.useIgnoreFiles).toEqual({ local: false, parent: false, global: false });
        });

        it("every session gets its own cache key", () => {
            service.createSession();
            service.createSession();
            const [a, b] = [...provider.walks.keys()];
            expect(a).not.toBe(b);
        });

        it("results carry the absolute path in the folder and the posix basename", async () => {
            const session = service.createSession();
            provider.walk(0).files.push("src/deep/main.ts");
            const { results } = await session.search("main", 50);
            expect(results).toEqual([
                {
                    relativePath: "src/deep/main.ts",
                    absolutePath: path.join(FOLDER, "src/deep/main.ts"),
                    basename: "main.ts",
                    score: 1,
                    matchedIndices: [0],
                },
            ]);
        });

        it("answers from the growing index before the walk completes", async () => {
            const session = service.createSession();
            provider.walk(0).files.push("a.ts");
            expect(await names(session)).toEqual(["a.ts"]);
        });

        it("says whether more results may come: incomplete while its walk runs, complete after", async () => {
            const session = service.createSession();
            expect((await session.search("", 50)).complete).toBe(false);
            provider.walk(0).finish();
            await session.ready;
            expect((await session.search("", 50)).complete).toBe(true);
        });

        it("forwards maxResults to the provider", async () => {
            const session = service.createSession();
            await session.search("x", 7);
            expect(provider.queries.at(-1)).toMatchObject({ query: "x", maxResults: 7 });
        });

        it("passes limitHit through", async () => {
            const limited: IFileSearchProvider = {
                index: () => Promise.resolve({ limitHit: true, complete: true }),
                query: () => Promise.resolve({ matches: [], complete: true, limitHit: true }),
                clearCache: () => undefined,
                onDidChangeIndex: new Emitter<string>().event,
            };
            service.registerProvider(limited);
            const session = service.createSession();
            await session.ready;
            expect((await session.search("", 50)).limitHit).toBe(true);
        });

        it("`ready` settles when the walk ends and fires onDidChange", async () => {
            const session = service.createSession();
            let changes = 0;
            session.onDidChange(() => changes++);
            let ready = false;
            void session.ready.then(() => (ready = true));
            await flushMicrotasks();
            expect(ready).toBe(false);

            provider.walk(0).finish();
            await session.ready;
            expect(changes).toBe(1);
        });

        it("a failed walk still settles `ready`, and a failed query gives no results", async () => {
            const session = service.createSession();
            provider.walk(0).fail();
            await session.ready;
            provider.queryFails = true;
            expect(await session.search("", 50)).toEqual({ results: [], limitHit: false, complete: true });
        });

        it("fires onDidChange when its own index grows, not on another key", () => {
            const session = service.createSession();
            let changes = 0;
            session.onDidChange(() => changes++);
            provider.fire("someone-else");
            expect(changes).toBe(0);
            provider.fire(provider.walk(0).request.cacheKey);
            expect(changes).toBe(1);
        });
    });

    describe("the previous index stands in while the new walk runs", () => {
        async function completedSession(files: string[]): Promise<string> {
            const session = service.createSession();
            const walk = [...provider.walks.values()].at(-1)!;
            walk.files.push(...files);
            walk.finish();
            await session.ready;
            session.dispose();
            return walk.request.cacheKey;
        }

        it("a new session answers from the last completed index until its own walk ends", async () => {
            await completedSession(["old.ts"]);
            const session = service.createSession();
            const fresh = provider.walk(1);
            fresh.files.push("new.ts");

            expect(await names(session)).toEqual(["old.ts"]);
            fresh.finish();
            await session.ready;
            expect(await names(session)).toEqual(["new.ts"]);
        });

        it("growth of the own index is not news while the stand-in answers", async () => {
            await completedSession(["old.ts"]);
            const session = service.createSession();
            let changes = 0;
            session.onDidChange(() => changes++);
            provider.fire(provider.walk(1).request.cacheKey);
            expect(changes).toBe(0);
        });

        it("once the new walk completes, the previous index is freed", async () => {
            const oldKey = await completedSession(["old.ts"]);
            const session = service.createSession();
            provider.walk(1).finish();
            await session.ready;
            expect(provider.cleared).toEqual([oldKey]);
        });

        it("other settings make another index: no stand-in", async () => {
            await completedSession(["old.ts"]);
            await config.updateValue(FILES_EXCLUDE_SETTING, { "**/old.ts": true });
            const session = service.createSession();
            provider.walk(1).files.push("new.ts");
            expect(await names(session)).toEqual(["new.ts"]);
        });

        it("another folder makes another index: no stand-in", async () => {
            await completedSession(["old.ts"]);
            workspace.setWorkspaceFolder(path.resolve("/work/other"));
            const session = service.createSession();
            provider.walk(1).files.push("new.ts");
            expect(await names(session)).toEqual(["new.ts"]);
        });

        it("a stand-in the provider lost (host restart): the own walk answers", async () => {
            const oldKey = await completedSession(["old.ts"]);
            provider.cleared.push(oldKey);
            const session = service.createSession();
            const own = provider.walk(1).request.cacheKey;
            provider.walk(1).files.push("new.ts");

            expect(await names(session)).toEqual(["new.ts"]);
            expect(provider.queries.map((q) => q.cacheKey)).toEqual([oldKey, own]);
        });

        it("a completed stand-in answers once: no second query to the own walk", async () => {
            const oldKey = await completedSession(["old.ts"]);
            const session = service.createSession();
            provider.queries.length = 0;
            await session.search("", 50);
            expect(provider.queries.map((q) => q.cacheKey)).toEqual([oldKey]);
        });

        it("a walk of an unregistered provider ending late is not adopted", async () => {
            const session = service.createSession();
            const fresh = new FakeProvider();
            service.registerProvider(fresh);
            provider.walk(0).finish();
            await session.ready;

            const next = service.createSession();
            fresh.walk(0).files.push("new.ts");
            expect(await names(next)).toEqual(["new.ts"]);
            expect(fresh.queries.map((q) => q.cacheKey)).toEqual([fresh.walk(0).request.cacheKey]);
        });

        it("a walk that ends late does not replace a newer completed index", async () => {
            const slow = service.createSession();
            const fast = service.createSession();
            provider.walk(1).files.push("fast.ts");
            provider.walk(1).finish();
            await fast.ready;
            provider.walk(0).finish();
            await slow.ready;

            fast.dispose();
            const next = service.createSession();
            expect(await names(next)).toEqual(["fast.ts"]);
            expect(provider.cleared).not.toContain(provider.walk(1).request.cacheKey);
        });
    });

    describe("dispose", () => {
        it("an unfinished walk is dropped when its session goes", () => {
            const session = service.createSession();
            session.dispose();
            session.dispose();
            expect(provider.cleared).toEqual([provider.walk(0).request.cacheKey]);
        });

        it("a completed index is kept as the stand-in; a session ending afterwards changes nothing", async () => {
            const session = service.createSession();
            provider.walk(0).finish();
            await session.ready;
            session.dispose();
            expect(provider.cleared).toEqual([]);
        });

        it("a walk completing after its session went is not adopted", async () => {
            const session = service.createSession();
            session.dispose();
            provider.walk(0).files.push("late.ts");
            provider.walk(0).finish();
            await session.ready;

            const next = service.createSession();
            await next.search("", 50);
            // The next session asks its own walk, not the dropped one.
            expect(provider.queries.map((q) => q.cacheKey)).toEqual([provider.walk(1).request.cacheKey]);
        });

        it("the service frees the last completed index", async () => {
            const session = service.createSession();
            provider.walk(0).finish();
            await session.ready;
            service.dispose();
            expect(provider.cleared).toEqual([provider.walk(0).request.cacheKey]);
        });

        it("a disposed session hears nothing more", () => {
            const session = service.createSession();
            let changes = 0;
            session.onDidChange(() => changes++);
            session.dispose();
            provider.fire(provider.walk(0).request.cacheKey);
            expect(changes).toBe(0);
        });

        it("a disposed service forwards nothing more", () => {
            const session = service.createSession();
            let changes = 0;
            session.onDidChange(() => changes++);
            service.dispose();
            provider.fire(provider.walk(0).request.cacheKey);
            expect(changes).toBe(0);
        });

        it("an unregistered provider's growth reaches nobody", () => {
            const registration = service.registerProvider(provider);
            const session = service.createSession();
            let changes = 0;
            session.onDidChange(() => changes++);
            registration.dispose();
            provider.fire(provider.walk(0).request.cacheKey);
            expect(changes).toBe(0);
        });

        it("a replaced provider's growth reaches nobody", () => {
            const session = service.createSession();
            let changes = 0;
            session.onDidChange(() => changes++);
            service.registerProvider(new FakeProvider());
            provider.fire(provider.walk(0).request.cacheKey);
            expect(changes).toBe(0);
        });
    });

    describe("without a provider or a folder", () => {
        it("no folder: an empty session that asks nobody", async () => {
            const empty = new FileSearchService(config, new WorkspaceContextService());
            empty.registerProvider(provider);
            const session = empty.createSession();
            await session.ready;
            expect(await session.search("a", 50)).toEqual({ results: [], limitHit: false, complete: true });
            session.onDidChange(() => undefined).dispose();
            session.dispose();
            expect(provider.walks.size).toBe(0);
            empty.dispose();
        });

        it("no provider registered: empty results", async () => {
            const bare = new FileSearchService(config, workspace);
            expect(await bare.createSession().search("a", 50)).toEqual({
                results: [],
                limitHit: false,
                complete: true,
            });
            bare.dispose();
        });

        it("an unregistered provider is no longer asked", async () => {
            const registration = service.registerProvider(provider);
            registration.dispose();
            await service.createSession().ready;
            expect(provider.walks.size).toBe(0);
        });

        it("disposing a stale registration keeps the newer provider", () => {
            const first = service.registerProvider(new FakeProvider());
            service.registerProvider(provider);
            first.dispose();
            service.createSession();
            expect(provider.walks.size).toBe(1);
        });

        it("a new provider drops the stand-in of the old one", async () => {
            const session = service.createSession();
            provider.walk(0).files.push("old.ts");
            provider.walk(0).finish();
            await session.ready;

            const fresh = new FakeProvider();
            service.registerProvider(fresh);
            const next = service.createSession();
            fresh.walk(0).files.push("new.ts");
            expect(await names(next)).toEqual(["new.ts"]);
        });
    });
});
