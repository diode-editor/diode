import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";

import type { IDecorationData, IDecorationsProvider, IResourceDecorationChangeEvent } from "./decorations.ts";
import { DECORATION_CHANGE_DEBOUNCE_MS, DecorationsService } from "./decorationsService.ts";

/** A provider answering from a table, counting what it is asked; `"throw"` rejects. */
function tableProvider(label: string, table: Record<string, IDecorationData | "throw" | undefined> = {}) {
    const onDidChange = new Emitter<readonly Uri[] | undefined>();
    const asked: string[] = [];
    const tokens: ICancellationToken[] = [];
    const provider: IDecorationsProvider = {
        label,
        onDidChange: onDidChange.event,
        provideDecorations: (uri, token) => {
            asked.push(uri.toString());
            tokens.push(token);
            const answer = table[uri.toString()];
            return answer === "throw" ? Promise.reject(new Error("boom")) : Promise.resolve(answer);
        },
    };
    return {
        provider,
        table,
        asked,
        tokens,
        fire: (uris?: readonly Uri[]) => {
            onDidChange.fire(uris);
        },
    };
}

const file = (path: string): Uri => Uri.file(path);
const key = (path: string): string => file(path).toString();

describe("DecorationsService", () => {
    let service: DecorationsService;
    let events: IResourceDecorationChangeEvent[];

    beforeEach(() => {
        vi.useFakeTimers();
        service = new DecorationsService();
        events = [];
        service.onDidChangeDecorations((e) => events.push(e));
    });

    afterEach(() => {
        service.dispose();
        vi.useRealTimers();
    });

    /** Lets the answers in flight land and the debounced event go. */
    async function settle(): Promise<void> {
        await vi.advanceTimersByTimeAsync(DECORATION_CHANGE_DEBOUNCE_MS);
    }

    it("registration announces that everything may have changed, at once", () => {
        service.registerDecorationsProvider(tableProvider("a").provider);
        expect(events).toHaveLength(1);
        expect(events[0].affectsResource(file("/anything"))).toBe(true);
    });

    it("the first ask draws nothing and fetches; the answer comes as a debounced event and is cached", async () => {
        const p = tableProvider("a", { [key("/w/a.pull")]: { letter: "P", color: "charts.red" } });
        service.registerDecorationsProvider(p.provider);
        events.length = 0;

        expect(service.getDecoration(file("/w/a.pull"), false)).toBeUndefined();
        expect(p.asked).toEqual([key("/w/a.pull")]);
        await vi.advanceTimersByTimeAsync(DECORATION_CHANGE_DEBOUNCE_MS - 1);
        expect(events).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(events).toHaveLength(1);
        expect(events[0].affectsResource(file("/w/a.pull"))).toBe(true);
        expect(events[0].affectsResource(file("/w"))).toBe(true);
        expect(events[0].affectsResource(file("/other"))).toBe(false);

        expect(service.getDecoration(file("/w/a.pull"), false)).toEqual({
            color: "charts.red",
            badge: "P",
            tooltip: "",
        });
        // Cached: asking again calls no provider.
        service.getDecoration(file("/w/a.pull"), false);
        expect(p.asked).toHaveLength(1);
    });

    it("an empty answer is cached as nothing: no decoration, no new ask", async () => {
        const p = tableProvider("a");
        service.registerDecorationsProvider(p.provider);
        service.getDecoration(file("/w/plain.txt"), false);
        await settle();
        expect(service.getDecoration(file("/w/plain.txt"), false)).toBeUndefined();
        expect(p.asked).toHaveLength(1);
    });

    it("answers of one tick merge into one event", async () => {
        const p = tableProvider("a", { [key("/w/1")]: { letter: "1" }, [key("/w/2")]: { letter: "2" } });
        service.registerDecorationsProvider(p.provider);
        events.length = 0;
        service.getDecoration(file("/w/1"), false);
        service.getDecoration(file("/w/2"), false);
        await settle();
        expect(events).toHaveLength(1);
        expect(events[0].affectsResource(file("/w/1"))).toBe(true);
        expect(events[0].affectsResource(file("/w/2"))).toBe(true);
    });

    it("a failed ask leaves no cache and no event: the next draw asks again", async () => {
        const p = tableProvider("a", { [key("/w/x")]: "throw" });
        service.registerDecorationsProvider(p.provider);
        events.length = 0;
        service.getDecoration(file("/w/x"), false);
        await settle();
        expect(events).toHaveLength(0);
        service.getDecoration(file("/w/x"), false);
        expect(p.asked).toHaveLength(2);
    });

    it("two providers on one resource: letters joined, the newer provider's color first, tooltips joined", async () => {
        const older = tableProvider("older", { [key("/w/f")]: { letter: "B", color: "older.color", tooltip: "b" } });
        const newer = tableProvider("newer", { [key("/w/f")]: { letter: "A", color: "newer.color", tooltip: "a" } });
        service.registerDecorationsProvider(older.provider);
        service.registerDecorationsProvider(newer.provider);
        service.getDecoration(file("/w/f"), false);
        await settle();
        expect(service.getDecoration(file("/w/f"), false)).toEqual({
            color: "newer.color",
            badge: "A, B",
            tooltip: "a • b",
        });
    });

    it("the color comes from the first provider that has one; equal tooltips show once, blank ones not at all", async () => {
        const older = tableProvider("older", { [key("/w/f")]: { color: "older.color", tooltip: "same" } });
        const newer = tableProvider("newer", { [key("/w/f")]: { letter: "A", tooltip: "same" } });
        const blank = tableProvider("blank", { [key("/w/f")]: { letter: "", tooltip: "  " } });
        service.registerDecorationsProvider(older.provider);
        service.registerDecorationsProvider(newer.provider);
        service.registerDecorationsProvider(blank.provider);
        service.getDecoration(file("/w/f"), false);
        await settle();
        expect(service.getDecoration(file("/w/f"), false)).toEqual({
            color: "older.color",
            badge: "A",
            tooltip: "same",
        });
    });

    it("a resource with only a color has no badge", async () => {
        const p = tableProvider("a", { [key("/w/f")]: { color: "c" } });
        service.registerDecorationsProvider(p.provider);
        service.getDecoration(file("/w/f"), false);
        await settle();
        expect(service.getDecoration(file("/w/f"), false)).toEqual({ color: "c", badge: undefined, tooltip: "" });
    });

    describe("folders (includeChildren)", () => {
        it("a folder takes the bubbling descendants' color and '●'; without includeChildren it does not", async () => {
            const p = tableProvider("a", {
                [key("/w/src/lib/util.ts")]: { letter: "M", color: "modified", bubble: true },
            });
            service.registerDecorationsProvider(p.provider);
            service.getDecoration(file("/w/src/lib/util.ts"), false);
            await settle();
            expect(service.getDecoration(file("/w/src"), true)).toEqual({
                color: "modified",
                badge: "●",
                tooltip: "Contains emphasized items",
            });
            expect(service.getDecoration(file("/w/src/lib"), true)?.badge).toBe("●");
            expect(service.getDecoration(file("/w/src"), false)).toBeUndefined();
            expect(service.getDecoration(file("/w/other"), true)).toBeUndefined();
        });

        it("a decoration that does not bubble stays on its resource", async () => {
            const p = tableProvider("a", { [key("/w/old/gone.ts")]: { letter: "D", color: "deleted", bubble: false } });
            service.registerDecorationsProvider(p.provider);
            service.getDecoration(file("/w/old/gone.ts"), false);
            await settle();
            expect(service.getDecoration(file("/w/old"), true)).toBeUndefined();
        });

        it("the folder's own color wins; else the first bubbling descendant in tree order", async () => {
            const p = tableProvider("a", {
                [key("/w/src/main.ts")]: { letter: "U", color: "untracked", bubble: true },
                [key("/w/src/lib/util.ts")]: { letter: "M", color: "modified", bubble: true },
                [key("/w/pkg")]: { letter: "X", color: "own" },
                [key("/w/pkg/a.ts")]: { letter: "M", color: "modified", bubble: true },
            });
            service.registerDecorationsProvider(p.provider);
            // Asked in an order other than the tree's: the order of the cache must not decide.
            service.getDecoration(file("/w/src/main.ts"), false);
            service.getDecoration(file("/w/src/lib/util.ts"), false);
            service.getDecoration(file("/w/pkg/a.ts"), false);
            service.getDecoration(file("/w/pkg"), true);
            await settle();
            // "lib" precedes "main.ts".
            expect(service.getDecoration(file("/w/src"), true)?.color).toBe("modified");
            expect(service.getDecoration(file("/w/pkg"), true)).toEqual({
                color: "own",
                badge: "●",
                tooltip: "Contains emphasized items",
            });
        });

        it("a deeper path sorts after its parent's sibling with a smaller name", async () => {
            const p = tableProvider("a", {
                [key("/w/a/b/c.ts")]: { color: "deep", bubble: true },
                [key("/w/a/b")]: { color: "shallow", bubble: true },
            });
            service.registerDecorationsProvider(p.provider);
            service.getDecoration(file("/w/a/b/c.ts"), false);
            service.getDecoration(file("/w/a/b"), false);
            await settle();
            expect(service.getDecoration(file("/w/a"), true)?.color).toBe("shallow");
        });
    });

    describe("provider events", () => {
        it("a list of resources is asked again at once, shown or not", async () => {
            const p = tableProvider("a");
            service.registerDecorationsProvider(p.provider);
            p.table[key("/w/deep/hidden.ts")] = { letter: "M", color: "modified", bubble: true };
            p.fire([file("/w/deep/hidden.ts")]);
            expect(p.asked).toEqual([key("/w/deep/hidden.ts")]);
            await settle();
            expect(service.getDecoration(file("/w/deep"), true)?.badge).toBe("●");
        });

        it("a newer ask cancels the one in flight, whose late answer is dropped", async () => {
            const answers: ((data: IDecorationData | undefined) => void)[] = [];
            const tokens: ICancellationToken[] = [];
            const onDidChange = new Emitter<readonly Uri[] | undefined>();
            service.registerDecorationsProvider({
                label: "slow",
                onDidChange: onDidChange.event,
                provideDecorations: (_uri, token) => {
                    tokens.push(token);
                    return new Promise((resolve) => answers.push(resolve));
                },
            });
            service.getDecoration(file("/w/f"), false);
            onDidChange.fire([file("/w/f")]);
            expect(tokens[0].isCancellationRequested).toBe(true);
            expect(tokens[1].isCancellationRequested).toBe(false);
            answers[1]({ letter: "new" });
            answers[0]({ letter: "old" });
            await settle();
            expect(service.getDecoration(file("/w/f"), false)?.badge).toBe("new");
        });

        it("an answer that became empty clears what the resource showed", async () => {
            const p = tableProvider("a", { [key("/w/f")]: { letter: "M" } });
            service.registerDecorationsProvider(p.provider);
            service.getDecoration(file("/w/f"), false);
            await settle();
            events.length = 0;
            p.table[key("/w/f")] = undefined;
            p.fire([file("/w/f")]);
            await settle();
            expect(events).toHaveLength(1);
            expect(service.getDecoration(file("/w/f"), false)).toBeUndefined();
        });

        it("undefined drops the provider's cache: the shown resources are announced and asked again on draw", async () => {
            const p = tableProvider("a", { [key("/w/f")]: { letter: "1" } });
            service.registerDecorationsProvider(p.provider);
            service.getDecoration(file("/w/f"), false);
            await settle();
            events.length = 0;

            p.table[key("/w/f")] = { letter: "2" };
            p.fire(undefined);
            expect(p.asked).toHaveLength(1);
            await settle();
            expect(events).toHaveLength(1);
            expect(events[0].affectsResource(file("/w/f"))).toBe(true);

            expect(service.getDecoration(file("/w/f"), false)).toBeUndefined();
            await settle();
            expect(service.getDecoration(file("/w/f"), false)?.badge).toBe("2");
        });

        it("undefined with nothing cached announces nothing", async () => {
            const p = tableProvider("a");
            service.registerDecorationsProvider(p.provider);
            events.length = 0;
            p.fire(undefined);
            await settle();
            expect(events).toHaveLength(0);
        });
    });

    it("dispose removes the provider and its decorations, announcing them; the other provider stays", async () => {
        const gone = tableProvider("gone", { [key("/w/f")]: { letter: "G" } });
        const stays = tableProvider("stays", { [key("/w/f")]: { letter: "S" } });
        service.registerDecorationsProvider(stays.provider);
        const registration = service.registerDecorationsProvider(gone.provider);
        service.getDecoration(file("/w/f"), false);
        await settle();
        expect(service.getDecoration(file("/w/f"), false)?.badge).toBe("G, S");
        events.length = 0;

        registration.dispose();
        await settle();
        expect(events).toHaveLength(1);
        expect(events[0].affectsResource(file("/w/f"))).toBe(true);
        expect(service.getDecoration(file("/w/f"), false)?.badge).toBe("S");
        // Its events no longer reach the service.
        gone.fire([file("/w/f")]);
        expect(gone.asked).toHaveLength(1);
    });

    it("the key is the whole uri: a query is another resource, under the same path", async () => {
        const withQuery = file("/w/dep.jar").with({ query: "hasConflict" });
        const p = tableProvider("a", { [withQuery.toString()]: { letter: "C", bubble: true } });
        service.registerDecorationsProvider(p.provider);
        service.getDecoration(withQuery, false);
        service.getDecoration(file("/w/dep.jar"), false);
        await settle();
        expect(service.getDecoration(withQuery, false)?.badge).toBe("C");
        expect(service.getDecoration(file("/w/dep.jar"), false)).toBeUndefined();
        // As upstream's search tree: the query lies below the path.
        expect(service.getDecoration(file("/w/dep.jar"), true)?.badge).toBe("●");
    });

    it("unicode and spaces in a path: the same key from a parsed string and from a path", async () => {
        const path = "/w/a dir/ünï.pull";
        const p = tableProvider("a", { [key(path)]: { letter: "P" } });
        service.registerDecorationsProvider(p.provider);
        service.getDecoration(Uri.parse(file(path).toString()), false);
        await settle();
        expect(service.getDecoration(file(path), false)?.badge).toBe("P");
    });

    it("a non-file resource is kept as is", async () => {
        const remote = Uri.parse("git://host/repo/a.ts?ref=HEAD");
        const p = tableProvider("a", { [remote.toString()]: { letter: "R" } });
        service.registerDecorationsProvider(p.provider);
        service.getDecoration(remote, false);
        await settle();
        expect(service.getDecoration(remote, false)?.badge).toBe("R");
    });

    it("a change pending when the service is disposed is not announced", async () => {
        const p = tableProvider("a", { [key("/w/f")]: { letter: "1" } });
        service.registerDecorationsProvider(p.provider);
        events.length = 0;
        service.getDecoration(file("/w/f"), false);
        await vi.advanceTimersByTimeAsync(0);
        service.dispose();
        await settle();
        expect(events).toHaveLength(0);
    });
});
