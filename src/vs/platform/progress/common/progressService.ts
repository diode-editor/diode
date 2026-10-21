import { Emitter } from "../../../base/common/event.ts";
import { Disposable } from "../../../base/common/lifecycle.ts";
import { token } from "../../instantiation/common/diContainer.ts";

// Stryker disable next-line StringLiteral: token() returns a new Token and dependency resolution goes by its reference, so the string inside is only a debug label
export const ProgressServiceDIToken = token<ProgressService>("ProgressService");

/**
 * The terminal gets Braille through font fallback (Hack doesn't cover U+2800), but the screenshot
 * rasterizer has no fallback to use, so DejaVu Sans is vendored next to Hack; without it every frame
 * renders as the same `.notdef`. Gate: `e2e/helpers/renderScreenshot.test.ts`.
 */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

const SPINNER_INTERVAL_MS = 100;

/** Staging a file takes tens of ms; a one-frame spinner reads as noise. */
const SHOW_DELAY_MS = 300;

const MIN_VISIBLE_MS = 500;

/** `view` is a spinner in a section header, `window` is a status bar entry. */
export type IProgressOptions =
    | { readonly location: "view"; readonly viewId: string; readonly title: string }
    | { readonly location: "window"; readonly title: string };

export interface IProgressFrame {
    readonly spinner: string;
    readonly title: string;
}

export interface IProgressServiceOptions {
    readonly delayMs?: number;
    readonly minVisibleMs?: number;
    readonly intervalMs?: number;
}

class ProgressEntry {
    public visible = false;
    public delayTimer: ReturnType<typeof setTimeout> | undefined;
    public minVisibleTimer: ReturnType<typeof setTimeout> | undefined;
    /** The operation finished, but the entry stays until `minVisibleMs` elapses. */
    public endRequested = false;

    /** `scope === null` means the `window` location, otherwise the section id. */
    public constructor(
        public readonly scope: string | null,
        public readonly title: string,
    ) {}
}

/**
 * Progress model and animation clock, without rendering. An operation shorter than {@link SHOW_DELAY_MS}
 * doesn't flash, but {@link isBusy} is true immediately; a shown spinner lives {@link MIN_VISIBLE_MS}.
 * There is one ticker per app, alive only while some entry is visible: spinners run in the same
 * phase, so consumers must not have their own `setInterval`. The service never reads the clock (only
 * timers), so it is deterministic under fake timers.
 */
export class ProgressService extends Disposable {
    public static dependencies = [] as const;

    private readonly entries = new Set<ProgressEntry>();
    private readonly onDidChangeEmitter = new Emitter<void>();
    public readonly onDidChange = this.onDidChangeEmitter.event;
    private readonly delayMs: number;
    private readonly minVisibleMs: number;
    private readonly intervalMs: number;

    private ticker: ReturnType<typeof setInterval> | null = null;
    private frame = 0;

    public constructor(options?: IProgressServiceOptions) {
        super();
        this.delayMs = options?.delayMs ?? SHOW_DELAY_MS;
        this.minVisibleMs = options?.minVisibleMs ?? MIN_VISIBLE_MS;
        this.intervalMs = options?.intervalMs ?? SPINNER_INTERVAL_MS;
    }

    /** A task error also ends the progress and is rethrown untouched. */
    public async withProgress<T>(options: IProgressOptions, task: () => Promise<T>): Promise<T> {
        const entry = this.start(options);
        try {
            return await task();
        } finally {
            this.end(entry);
        }
    }

    /** Includes entries not shown yet: buttons must disable immediately, not after the show delay. */
    public isBusy(viewId?: string): boolean {
        for (const entry of this.entries) {
            if (entry.endRequested) continue;
            if (viewId === undefined || entry.scope === viewId) return true;
        }
        return false;
    }

    /** The section's earliest entry provides the title, so "commit → refresh" doesn't flicker the text. */
    public viewProgress(): ReadonlyMap<string, IProgressFrame> {
        const result = new Map<string, IProgressFrame>();
        for (const entry of this.entries) {
            if (!entry.visible || entry.scope === null) continue;
            if (!result.has(entry.scope)) result.set(entry.scope, this.frameOf(entry));
        }
        return result;
    }

    /** The earliest visible entry. */
    public windowProgress(): IProgressFrame | null {
        for (const entry of this.entries) {
            if (entry.visible && entry.scope === null) return this.frameOf(entry);
        }
        return null;
    }

    public override dispose(): void {
        for (const entry of [...this.entries]) this.forget(entry);
        this.stopTickerIfIdle();
        this.onDidChangeEmitter.dispose();
        // Stryker disable next-line CallExpression: the service registers no disposables of its own; the call is kept for the base class contract
        super.dispose();
    }

    private start(options: IProgressOptions): ProgressEntry {
        const entry = new ProgressEntry(options.location === "view" ? options.viewId : null, options.title);
        entry.delayTimer = setTimeout(() => {
            entry.delayTimer = undefined;
            entry.visible = true;
            entry.minVisibleTimer = setTimeout(() => {
                entry.minVisibleTimer = undefined;
                if (entry.endRequested) this.forget(entry);
                this.stopTickerIfIdle();
                this.fire();
            }, this.minVisibleMs);
            this.startTicker();
            this.fire();
        }, this.delayMs);
        this.entries.add(entry);
        // Fire right at start: busy state is visible to disabling logic immediately, before the show.
        this.fire();
        return entry;
    }

    private end(entry: ProgressEntry): void {
        // Stryker disable next-line ConditionalExpression: without the entry in the set, end() changes nothing; only promises that outlived dispose() get here, and dispose() already removed both timers and listeners
        if (!this.entries.has(entry)) return;
        entry.endRequested = true;
        // Only an entry that was already shown stays for the minimum visible time.
        if (entry.minVisibleTimer === undefined) this.forget(entry);
        this.stopTickerIfIdle();
        this.fire();
    }

    private forget(entry: ProgressEntry): void {
        clearTimeout(entry.delayTimer);
        // Stryker disable next-line CallExpression: only dispose() gets here with a live minVisible timer, and it removes the listeners right after, so a leaked timer has no one to wake
        clearTimeout(entry.minVisibleTimer);
        entry.delayTimer = undefined;
        entry.minVisibleTimer = undefined;
        this.entries.delete(entry);
    }

    private frameOf(entry: ProgressEntry): IProgressFrame {
        return { spinner: SPINNER_FRAMES[this.frame], title: entry.title };
    }

    private startTicker(): void {
        if (this.ticker !== null) return;
        this.ticker = setInterval(() => {
            this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
            this.fire();
        }, this.intervalMs);
    }

    private stopTickerIfIdle(): void {
        // Stryker disable next-line ConditionalExpression: with the ticker stopped, the body is clearInterval(null) and a frame reset, and the frame is already zero in that state
        if (this.ticker === null) return;
        for (const entry of this.entries) {
            if (entry.visible) return;
        }
        clearInterval(this.ticker);
        this.ticker = null;
        // The next operation starts from the first frame, so the spinner always
        // appears the same way rather than mid-cycle.
        this.frame = 0;
    }

    private fire(): void {
        this.onDidChangeEmitter.fire();
    }
}
