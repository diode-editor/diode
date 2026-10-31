import { describe, expect, it, vi } from "vitest";

import { ApiTrace, type IApiTraceRecord, tracedNamespace } from "./apiTrace.ts";

function makeTrace(write: (text: string) => void = () => undefined): {
    trace: ApiTrace;
    rows: () => IApiTraceRecord[];
    runScheduled: () => void;
    scheduledCount: () => number;
    onError: ReturnType<typeof vi.fn>;
} {
    const written: string[] = [];
    const scheduled: (() => void)[] = [];
    const onError = vi.fn();
    const trace = new ApiTrace({
        write: (text) => {
            write(text);
            written.push(text);
        },
        schedule: (flush) => scheduled.push(flush),
        onError,
    });
    return {
        trace,
        onError,
        rows: () =>
            written
                .join("")
                .split("\n")
                .filter((line) => line !== "")
                .map((line) => JSON.parse(line) as IApiTraceRecord),
        runScheduled: () => {
            for (const flush of scheduled.splice(0)) flush();
        },
        scheduledCount: () => scheduled.length,
    };
}

describe("ApiTrace", () => {
    it("writes a new fact at once and sums repeats into a later delta", () => {
        const { trace, rows, runScheduled } = makeTrace();
        trace.record("pub.a", "window.showTextDocument", "call");
        expect(rows()).toEqual([{ extension: "pub.a", member: "window.showTextDocument", kind: "call", count: 1 }]);

        trace.record("pub.a", "window.showTextDocument", "call");
        trace.record("pub.a", "window.showTextDocument", "call");
        expect(rows()).toHaveLength(1);

        runScheduled();
        expect(rows()[1]).toEqual({ extension: "pub.a", member: "window.showTextDocument", kind: "call", count: 2 });
    });

    it("keeps extensions, kinds and methods apart", () => {
        const { trace, rows } = makeTrace();
        trace.record("pub.a", "m", "call");
        trace.record("pub.b", "m", "call");
        trace.record("pub.a", "m", "read");
        trace.record("pub.a", "m", "invoked", "provideHover");
        trace.record("pub.a", "m", "invoked", "resolveHover");
        expect(rows().map((r) => [r.extension, r.kind, r.method])).toEqual([
            ["pub.a", "call", undefined],
            ["pub.b", "call", undefined],
            ["pub.a", "read", undefined],
            ["pub.a", "invoked", "provideHover"],
            ["pub.a", "invoked", "resolveHover"],
        ]);
    });

    it("a write failure reaches neither the caller nor a second report, and recording stops", () => {
        const write = vi.fn(() => {
            throw new Error("disk full");
        });
        const { trace, onError } = makeTrace(write);
        expect(() => {
            trace.record("pub.a", "m", "call");
            trace.record("pub.a", "n", "call");
        }).not.toThrow();
        trace.flush();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledTimes(1);
    });

    it("repeats share one scheduled flush, and the next repeat after it schedules again", () => {
        const { trace, rows, runScheduled, scheduledCount } = makeTrace();
        trace.record("pub.a", "m", "call");
        expect(scheduledCount()).toBe(0);
        trace.record("pub.a", "m", "call");
        trace.record("pub.a", "m", "call");
        expect(scheduledCount()).toBe(1);

        runScheduled();
        trace.record("pub.a", "m", "call");
        expect(scheduledCount()).toBe(1);
        runScheduled();
        expect(rows().map((r) => r.count)).toEqual([1, 2, 1]);
    });

    it("a flush with nothing pending writes nothing", () => {
        const write = vi.fn();
        const { trace } = makeTrace(write);
        trace.flush();
        expect(write).not.toHaveBeenCalled();
    });

    it("the row of a plain call has no method key", () => {
        const write = vi.fn();
        const { trace } = makeTrace(write);
        trace.record("pub.a", "m", "call");
        expect(write).toHaveBeenCalledWith('{"extension":"pub.a","member":"m","kind":"call","count":1}\n');
    });
});

describe("tracedNamespace", () => {
    it("a call is recorded and passes this, arguments and result", () => {
        const { trace, rows } = makeTrace();
        const source = {
            getConfiguration(this: unknown, section: string): unknown {
                return { self: this, section };
            },
        };
        const ns = tracedNamespace(source, "workspace", "pub.a", trace);
        expect(ns.getConfiguration("files")).toEqual({ self: ns, section: "files" });
        expect(rows()).toEqual([{ extension: "pub.a", member: "workspace.getConfiguration", kind: "call", count: 1 }]);
    });

    it("an exception passes through unchanged", () => {
        const { trace } = makeTrace();
        const boom = new Error("boom");
        const ns = tracedNamespace(
            {
                fail: (): void => {
                    throw boom;
                },
            },
            "window",
            "pub.a",
            trace,
        );
        expect(() => {
            ns.fail();
        }).toThrow(boom);
    });

    it("a getter stays live, a plain value is readable and writable, keys stay", () => {
        const { trace, rows } = makeTrace();
        let active = 1;
        const source = {
            get active(): number {
                return active;
            },
            appName: "Diode",
            run: (): void => undefined,
        };
        const ns = tracedNamespace(source, "window", "pub.a", trace);
        expect(Object.keys(ns)).toEqual(["active", "appName", "run"]);
        expect(rows()).toEqual([]);

        expect(ns.active).toBe(1);
        active = 2;
        expect(ns.active).toBe(2);
        expect(ns.appName).toBe("Diode");
        ns.appName = "Other";
        expect(ns.appName).toBe("Other");
        expect(source.appName).toBe("Diode");
        expect(new Set(rows().map((r) => `${r.member} ${r.kind}`))).toEqual(
            new Set(["window.active read", "window.appName read"]),
        );
    });

    it("a plain value stays configurable, a getter-only member still refuses assignment", () => {
        const { trace } = makeTrace();
        const ns = tracedNamespace(
            {
                appName: "Diode",
                get shell(): string {
                    return "sh";
                },
            },
            "env",
            "pub.a",
            trace,
        );
        expect(Object.getOwnPropertyDescriptor(ns, "appName")?.configurable).toBe(true);
        expect(Object.getOwnPropertyDescriptor(ns, "shell")?.configurable).toBe(true);
        expect(() => {
            (ns as { shell: string }).shell = "bash";
        }).toThrow(TypeError);
        expect(ns.shell).toBe("sh");
    });

    it("a member that only looks like a registration is a plain call", () => {
        const { trace, rows } = makeTrace();
        const ns = tracedNamespace({ registerProviderHelper: () => 1 }, "window", "pub.a", trace);
        ns.registerProviderHelper();
        expect(rows().map((r) => r.kind)).toEqual(["call"]);
    });

    it("a setter of the source still runs", () => {
        const { trace } = makeTrace();
        let stored = 0;
        const ns = tracedNamespace(
            {
                get level(): number {
                    return stored;
                },
                set level(next: number) {
                    stored = next;
                },
            },
            "env",
            "pub.a",
            trace,
        );
        ns.level = 5;
        expect(stored).toBe(5);
    });

    it("a function keeps its name and length, and a class can still be constructed", () => {
        const { trace } = makeTrace();
        class Thing {
            public readonly made = true;
        }
        function named(_a: number, _b: number): void {
            return undefined;
        }
        const ns = tracedNamespace({ Thing, named }, "window", "pub.a", trace);
        expect(ns.named.name).toBe("named");
        expect(ns.named).toHaveLength(2);
        expect(new ns.Thing()).toBeInstanceOf(Thing);
    });
});

interface IRegistered {
    readonly provider: Record<string, (...args: unknown[]) => unknown>;
    readonly selector: unknown;
}

function registerThrough(
    provider: object,
    selector: unknown = { language: "python" },
): {
    registered: IRegistered;
    rows: () => IApiTraceRecord[];
    runScheduled: () => void;
} {
    const { trace, rows, runScheduled } = makeTrace();
    let registered: IRegistered | undefined;
    const ns = tracedNamespace(
        {
            registerCompletionItemProvider: (s: unknown, p: IRegistered["provider"]): string => {
                registered = { provider: p, selector: s };
                return "disposable";
            },
        },
        "languages",
        "pub.a",
        trace,
    );
    expect(ns.registerCompletionItemProvider(selector, provider as IRegistered["provider"])).toBe("disposable");
    return { registered: registered!, rows, runScheduled };
}

const kinds = (rows: readonly IApiTraceRecord[]): unknown[] => rows.map((r) => [r.member, r.kind, r.method]);

describe("provider tracing", () => {
    const MEMBER = "languages.registerCompletionItemProvider";

    it("registration is recorded apart from invocation, and only the editor's call is an invocation", () => {
        const { registered, rows } = registerThrough({ provideHover: () => 1 });
        expect(kinds(rows())).toEqual([[MEMBER, "registered", undefined]]);

        expect(registered.provider.provideHover("doc")).toBe(1);
        expect(kinds(rows())).toEqual([
            [MEMBER, "registered", undefined],
            [MEMBER, "invoked", "provideHover"],
        ]);
    });

    it("the selector is passed as is, the provider's fields and absent methods stay visible", () => {
        const selector = { language: "python" };
        const { registered } = registerThrough({ provideHover: () => 1, triggers: ["."] }, selector);
        expect(registered.selector).toBe(selector);
        expect((registered.provider as unknown as { triggers: string[] }).triggers).toEqual(["."]);
        expect(registered.provider.resolveHover).toBeUndefined();
    });

    it("a provider with private fields and a class prototype works through the wrapper", () => {
        class Provider {
            readonly #secret = 7;
            public provideHover(): number {
                return this.#secret;
            }
        }
        const { registered, rows } = registerThrough(new Provider());
        expect(registered.provider.provideHover()).toBe(7);
        expect(kinds(rows())).toContainEqual([MEMBER, "invoked", "provideHover"]);
    });

    it("an explicit `this` is kept when it is not the wrapper", () => {
        const { registered } = registerThrough({
            provideHover(this: unknown): unknown {
                return this;
            },
        });
        const other = {};
        expect(registered.provider.provideHover.call(other)).toBe(other);
    });

    it("only an object with methods is taken for the provider", () => {
        const { trace } = makeTrace();
        const passed: unknown[][] = [];
        const ns = tracedNamespace(
            {
                registerThingProvider: (...args: unknown[]): void => {
                    passed.push(args);
                },
            },
            "window",
            "pub.a",
            trace,
        );
        class Selector {
            public readonly language = "python";
        }
        const provider = { provide: () => 1 };
        const notProviders: unknown[] = [
            "view.id",
            1,
            null,
            undefined,
            ["python"],
            { language: "python" },
            new Selector(),
            Object.create(null),
        ];
        ns.registerThingProvider(...notProviders, provider);
        const [args] = passed;
        expect(args.slice(0, notProviders.length)).toEqual(notProviders);
        notProviders.forEach((arg, i) => {
            expect(args[i]).toBe(arg);
        });
        expect(args[notProviders.length]).not.toBe(provider);
    });

    it("a provider method on a class prototype counts, a getter is not run to find out", () => {
        const getter = vi.fn(() => "x");
        class Provider {
            public get lazy(): string {
                return getter();
            }
            public provide(): number {
                return 1;
            }
        }
        const { registered, rows } = registerThrough(new Provider());
        expect(getter).not.toHaveBeenCalled();
        expect(registered.provider.provide()).toBe(1);
        expect(kinds(rows())).toContainEqual([MEMBER, "invoked", "provide"]);
    });

    it("a symbol member of a provider is returned untouched", () => {
        const tag = Symbol("tag");
        const method = (): number => 1;
        const { registered } = registerThrough({ provide: () => 1, [tag]: method });
        expect((registered.provider as unknown as Record<symbol, unknown>)[tag]).toBe(method);
    });

    it("a non-configurable but writable method is still traced", () => {
        const provider = Object.defineProperty({}, "provide", { value: () => 1, writable: true, configurable: false });
        const { registered, rows } = registerThrough(provider);
        expect(registered.provider.provide()).toBe(1);
        expect(kinds(rows())).toContainEqual([MEMBER, "invoked", "provide"]);
    });

    it("an empty or junk completion response is survived and records no fields", async () => {
        const { registered, rows } = registerThrough({
            provideCompletionItems: (kind: unknown) => kind,
        });
        for (const response of [null, undefined, "junk", ["junk", null, 1]]) {
            expect(registered.provider.provideCompletionItems(response)).toBe(response);
        }
        await registered.provider.provideCompletionItems(Promise.resolve(null));
        expect(rows().filter((r) => r.kind === "field")).toEqual([]);
    });

    it("a provider's event is not an invocation", () => {
        const { registered, rows } = registerThrough({ provideHover: () => 1, onDidChangeHovers: () => "sub" });
        expect(registered.provider.onDidChangeHovers()).toBe("sub");
        expect(kinds(rows())).toEqual([[MEMBER, "registered", undefined]]);
    });

    it("a frozen provider does not break the proxy", () => {
        const { registered } = registerThrough(Object.freeze({ provideHover: () => 1 }));
        expect(registered.provider.provideHover()).toBe(1);
    });

    it("response fields of a completion list are recorded, undefined ones are not", () => {
        const { registered, rows } = registerThrough({
            provideCompletionItems: () => ({ items: [{ label: "a", sortText: "1", detail: undefined }] }),
        });
        registered.provider.provideCompletionItems();
        const fields = rows()
            .filter((r) => r.kind === "field")
            .map((r) => r.member);
        expect(fields).toEqual(["CompletionItem.label", "CompletionItem.sortText"]);
    });

    it("response fields of a promised array and of a resolved item are recorded", async () => {
        const { registered, rows } = registerThrough({
            provideCompletionItems: () => Promise.resolve([{ filterText: "x" }]),
            resolveCompletionItem: () => ({ documentation: "doc" }),
        });
        await registered.provider.provideCompletionItems();
        registered.provider.resolveCompletionItem();
        const fields = rows()
            .filter((r) => r.kind === "field")
            .map((r) => r.member);
        expect(fields).toEqual(["CompletionItem.filterText", "CompletionItem.documentation"]);
    });

    it("a rejected response stays rejected for the editor, a getter in a response is not run", async () => {
        const getter = vi.fn(() => "x");
        const boom = new Error("boom");
        const { registered, rows } = registerThrough({
            provideCompletionItems: () => Promise.reject(boom),
            resolveCompletionItem: () => ({
                get detail(): string {
                    return getter();
                },
            }),
        });
        await expect(registered.provider.provideCompletionItems()).rejects.toBe(boom);
        registered.provider.resolveCompletionItem();
        expect(getter).not.toHaveBeenCalled();
        expect(kinds(rows())).toContainEqual(["CompletionItem.detail", "field", undefined]);
    });

    it("other providers' responses are not walked", () => {
        const { registered, rows } = registerThrough({ provideHover: () => ({ contents: [] }) });
        registered.provider.provideHover();
        expect(rows().filter((r) => r.kind === "field")).toEqual([]);
    });
});
