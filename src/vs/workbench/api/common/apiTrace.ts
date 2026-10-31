/**
 * The call journal behind the "confirmed by a real extension" mark: `DIODE_API_TRACE=<file>`, JSON
 * lines, one row per delta, so a reader sums `count` and several host processes may share a file.
 * It records facts only; whether the result was right is for the test and the frame to say.
 */

/**
 * - `call`, `read`: a namespace function was called, a namespace property was read.
 * - `registered`: a `register*Provider` call. Registration is not usage.
 * - `invoked`: the editor called a method of that provider (`method`).
 * - `field`: a field the provider set in its response (`member` is `CompletionItem.sortText`).
 */
export type ApiTraceKind = "call" | "read" | "registered" | "invoked" | "field";

export interface IApiTraceRecord {
    readonly extension: string;
    readonly member: string;
    readonly kind: ApiTraceKind;
    /** Absent from the JSON unless `kind` is `invoked`. */
    readonly method: string | undefined;
    count: number;
}

export interface IApiTraceSink {
    write(text: string): void;
    /** Calls `flush` later; must not keep the process alive. */
    schedule(flush: () => void): void;
    onError(error: unknown): void;
}

export class ApiTrace {
    private readonly seen = new Set<string>();
    private readonly pending = new Map<string, IApiTraceRecord>();
    private scheduled = false;
    private failed = false;

    public constructor(private readonly sink: IApiTraceSink) {}

    /** A new fact is written at once, so a killed host keeps it; a repeat only adds to the counter later. */
    public record(extension: string, member: string, kind: ApiTraceKind, method?: string): void {
        if (this.failed) return;
        const key = JSON.stringify([extension, member, kind, method]);
        const row = this.pending.get(key);
        if (row === undefined) {
            this.pending.set(key, { extension, member, kind, method, count: 1 });
        } else {
            row.count++;
        }
        if (!this.seen.has(key)) {
            this.seen.add(key);
            this.flush();
        } else if (!this.scheduled) {
            this.scheduled = true;
            this.sink.schedule(() => {
                this.scheduled = false;
                this.flush();
            });
        }
    }

    /** A journal failure must not reach the extension: it reports once and stops recording. */
    public flush(): void {
        if (this.pending.size === 0) return;
        const text = [...this.pending.values()].map((row) => `${JSON.stringify(row)}\n`).join("");
        this.pending.clear();
        try {
            this.sink.write(text);
        } catch (error) {
            this.failed = true;
            this.sink.onError(error);
        }
    }
}

function hasMethod(value: object | null): boolean {
    for (
        let o: object | null = value;
        o !== null && o !== Object.prototype;
        o = Object.getPrototypeOf(o) as object | null
    ) {
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(o))) {
            if (key !== "constructor" && typeof descriptor.value === "function") return true;
        }
    }
    return false;
}

/** The provider is the first argument with methods: a selector and a view id have none. */
function isProvider(arg: unknown): arg is object {
    return typeof arg === "object" && !Array.isArray(arg) && hasMethod(arg);
}

function noteCompletionFields(result: unknown, note: (field: string) => void): void {
    const list = result as { readonly items?: unknown } | null | undefined;
    const items: unknown = Array.isArray(result) ? result : list?.items;
    for (const item of Array.isArray(items) ? (items as unknown[]) : [result]) {
        if (typeof item !== "object" || item === null) continue;
        // Descriptors: reading a value could run the extension's getter.
        for (const [field, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
            if (descriptor.get !== undefined || descriptor.value !== undefined) note(field);
        }
    }
}

/**
 * Response fields are traced for completion only: walking every provider's response needs a table
 * of result types, and `CompletionItem` is where a field decides what the user sees. A native
 * promise only: calling `then` on a foreign thenable may run it twice.
 */
function observeResponse(method: string, result: unknown, note: (field: string) => void): void {
    if (method !== "provideCompletionItems" && method !== "resolveCompletionItem") return;
    if (result instanceof Promise) {
        void result.then(
            (value: unknown) => {
                noteCompletionFields(value, note);
            },
            () => undefined,
        );
    } else if (typeof (result as { readonly then?: unknown } | null | undefined)?.then !== "function") {
        noteCompletionFields(result, note);
    }
}

function tracedProvider(provider: object, member: string, extension: string, trace: ApiTrace): object {
    const proxy: object = new Proxy(provider, {
        get(target, key): unknown {
            // The target as the receiver: private fields do not work through a proxy.
            const value: unknown = Reflect.get(target, key, target);
            // `onDid*` is an event the host subscribes to, not the editor asking the provider for something.
            if (typeof key !== "string" || typeof value !== "function" || key.startsWith("onDid")) return value;
            // A proxy must return the original of a frozen property, or `get` throws.
            const own = Object.getOwnPropertyDescriptor(target, key);
            if (own?.configurable === false && own.writable === false) return value;
            return function (this: unknown, ...args: unknown[]): unknown {
                trace.record(extension, member, "invoked", key);
                const result: unknown = Reflect.apply(value, this === proxy ? target : this, args);
                observeResponse(key, result, (field) => {
                    trace.record(extension, `CompletionItem.${field}`, "field");
                });
                return result;
            };
        },
    });
    return proxy;
}

function tracedFunction(
    fn: (...args: unknown[]) => unknown,
    member: string,
    extension: string,
    trace: ApiTrace,
): (...args: unknown[]) => unknown {
    const registers = /\.register\w*Provider$/.test(member);
    // A proxy keeps `name`, `length`, own properties and `new`; `this` and exceptions pass through.
    return new Proxy(fn, {
        apply(target, thisArg: unknown, args: unknown[]): unknown {
            if (!registers) {
                trace.record(extension, member, "call");
                return Reflect.apply(target, thisArg, args);
            }
            trace.record(extension, member, "registered");
            const at = args.findIndex(isProvider);
            const passed = args.map((arg, i) =>
                i === at ? tracedProvider(arg as object, member, extension, trace) : arg,
            );
            return Reflect.apply(target, thisArg, passed);
        },
    });
}

/** `PropertyDescriptor` with `unknown` instead of `any`, and accessors callable with any `this`. */
interface INamespaceDescriptor {
    readonly enumerable?: boolean;
    readonly value?: unknown;
    readonly get?: (this: unknown) => unknown;
    readonly set?: (this: unknown, next: unknown) => void;
}

/** A copy of the descriptors, so `Object.keys` and getter liveness stay as they are. */
export function tracedNamespace<T extends object>(source: T, name: string, extension: string, trace: ApiTrace): T {
    const descriptors = Object.getOwnPropertyDescriptors(source) as Record<string, INamespaceDescriptor>;
    const traced = Object.create(source, descriptors as PropertyDescriptorMap) as T;
    for (const [key, descriptor] of Object.entries(descriptors)) {
        const member = `${name}.${key}`;
        const { enumerable, value: initial, get: getter, set: setter } = descriptor;
        if (typeof initial === "function") {
            const fn = initial as (...args: unknown[]) => unknown;
            Object.defineProperty(traced, key, { ...descriptor, value: tracedFunction(fn, member, extension, trace) });
            continue;
        }
        if (getter !== undefined) {
            // The setter as is: assigning to a getter-only member still throws in strict mode.
            Object.defineProperty(traced, key, {
                enumerable,
                configurable: true,
                get(this: unknown): unknown {
                    trace.record(extension, member, "read");
                    return getter.call(this);
                },
                set: setter,
            });
            continue;
        }
        let value: unknown = initial;
        Object.defineProperty(traced, key, {
            enumerable,
            configurable: true,
            get(): unknown {
                trace.record(extension, member, "read");
                return value;
            },
            set(next: unknown): void {
                value = next;
            },
        });
    }
    return traced;
}
