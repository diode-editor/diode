// Instantiation trace (like upstream `Trace`), enabled by `DIODE_STARTUP_TRACE_INSTANTIATIONS=1`. Without
// it `Container.get` pays one check on a cache miss; cache hits are untouched.
// `npm run bench:services` prints the table.

export interface IInstantiationTraceEntry {
    readonly id: string;
    /** ms since `performance.timeOrigin`. */
    readonly start: number;
    /** Including nested creations, ms. */
    readonly inclusive: number;
    /** Excluding nested creations, ms. */
    readonly self: number;
    /** Depth in the creation tree: 0 means not requested from another service's constructor. */
    readonly depth: number;
    /**
     * Parent token id; at the top level, `contributions:<phase>` or the first stack function
     * past the container (`new WorkbenchComponent`, `runEditor`…).
     */
    readonly requester: string;
    /** Contribution phase the creation ran in; null outside the registry. */
    readonly phase: string | null;
    /** true if the token itself is registered by a contribution and created by its phase. */
    readonly contribution: boolean;
}

/** A top-level caller, kept as a raw stack for now: V8 formats it lazily, on export. */
type Requester = string | Error;

interface Frame {
    readonly id: string;
    readonly start: number;
    readonly depth: number;
    readonly requester: Requester;
    readonly phase: string | null;
    readonly contribution: boolean;
    children: number;
}

type RawEntry = Omit<IInstantiationTraceEntry, "requester"> & { readonly requester: Requester };

/** Enough stack frames to get from the container to the caller; fewer frames make capture cheaper. */
const CALLER_STACK_LIMIT = 8;

export class InstantiationTracer {
    private readonly entries: RawEntry[] = [];
    private readonly stack: Frame[] = [];
    private readonly phases: string[] = [];
    /** Phase of the contribution whose creation comes next at the top level; null if not a contribution. */
    private pendingContribution: string | null = null;

    /** Rethrows exceptions without leaving an entry. */
    public trace<T>(id: string, factory: () => T): T {
        const parent = this.stack.at(-1);
        const phase = this.phases.at(-1) ?? null;
        const contributionPhase = this.pendingContribution;
        this.pendingContribution = null;
        const contribution = contributionPhase !== null;
        const requester =
            parent !== undefined
                ? parent.id
                : contributionPhase !== null
                  ? `contributions:${contributionPhase}`
                  : captureCaller();
        const frame: Frame = {
            id,
            start: performance.now(),
            depth: this.stack.length,
            requester,
            phase,
            contribution,
            children: 0,
        };
        this.stack.push(frame);
        let ok = false;
        try {
            const value = factory();
            ok = true;
            return value;
        } finally {
            this.stack.pop();
            const inclusive = performance.now() - frame.start;
            if (parent !== undefined) parent.children += inclusive;
            if (ok) {
                this.entries.push({
                    id,
                    start: frame.start,
                    inclusive,
                    self: inclusive - frame.children,
                    depth: frame.depth,
                    requester: frame.requester,
                    phase: frame.phase,
                    contribution: frame.contribution,
                });
            }
        }
    }

    /**
     * Creates a contribution in phase `phase` (contribution registry): the creation itself
     * is flagged `contribution`, and it plus everything nested is tagged with the phase. An
     * already created contribution (container cache) produces no entry.
     */
    public contribution<T>(phase: string, run: () => T): T {
        this.phases.push(phase);
        this.pendingContribution = phase;
        try {
            return run();
        } finally {
            this.pendingContribution = null;
            this.phases.pop();
        }
    }

    /** Entries in order of creation completion; caller stacks are formatted here. */
    public getEntries(): IInstantiationTraceEntry[] {
        return this.entries.map((entry) =>
            typeof entry.requester === "string"
                ? (entry as IInstantiationTraceEntry)
                : { ...entry, requester: callerName(entry.requester) },
        );
    }
}

/**
 * Captures the stack without formatting: V8 builds the `.stack` string on first
 * read, which happens in {@link callerName} on export, outside the measured window.
 */
function captureCaller(): Error {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = CALLER_STACK_LIMIT;
    const error = new Error();
    Error.stackTraceLimit = limit;
    return error;
}

/**
 * The first stack function outside the container and the tracer. esbuild keeps class
 * and function names in the bundle; file and line are dropped: in the SEA it's a
 * meaningless `main.cjs` line.
 */
function callerName(error: Error): string {
    // No stack under a `prepareStackTrace` hook that yields none; any string without a frame line gives the same "?".
    // Stryker disable next-line StringLiteral: see above
    for (const line of (error.stack ?? "").split("\n")) {
        // `at name (file:line:col)`; an anonymous function is `at file:line:col` and is
        // skipped, as are node's own frames (`processTicksAndRejections` after
        // await). The first stack line (`Error`) matches nothing.
        const match = /at (?:async )?(.+?) \((.*)\)/.exec(line);
        if (match === null || match[2].startsWith("node:")) continue;
        const name = match[1];
        if (name === "captureCaller" || name.startsWith("InstantiationTracer.") || name.startsWith("Container.")) {
            continue;
        }
        return name;
    }
    return "?";
}

let activeTracer: InstantiationTracer | undefined;

/** Enables the instantiation trace (idempotent) and returns it. */
export function enableInstantiationTrace(): InstantiationTracer {
    activeTracer ??= new InstantiationTracer();
    return activeTracer;
}

/** The active tracer, or undefined if tracing is off. */
export function getInstantiationTracer(): InstantiationTracer | undefined {
    return activeTracer;
}

/** Disables the trace and drops its entries; for tests. */
export function resetInstantiationTrace(): void {
    activeTracer = undefined;
}
