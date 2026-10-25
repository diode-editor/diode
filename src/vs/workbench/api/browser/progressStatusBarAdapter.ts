import { SPINNER_FRAMES } from "../../../platform/progress/common/progressService.ts";
import { type IProductIconService, NERD_FONT_ICONS } from "../../../platform/theme/common/productIconService.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../services/statusbar/common/statusBarService.ts";
import type { IProgressSink } from "../common/iExtensionWindowSinks.ts";

const SPINNER_INTERVAL_MS = 100;

/** Priority of progress entries: left of the chord hint (50), right of terminal-env (100). */
const PROGRESS_PRIORITY = 60;

class ProgressEntry {
    public message: string | undefined;
    /** Accumulated discrete progress 0–100; undefined means infinite. */
    public percent: number | undefined;
    public frame = 0;
    public bar!: IStatusBarEntryHandle;
    public timer!: ReturnType<typeof setInterval>;

    /** Captions are kept raw: the spinner re-renders the entry anyway, so a glyph set switch shows on the next tick. */
    public constructor(
        public readonly title: string,
        private readonly icons: IProductIconService,
    ) {}

    public render(): string {
        const spinner = SPINNER_FRAMES[this.frame];
        const parts = [this.title, this.message]
            .filter((p): p is string => p !== undefined && p !== "")
            .map((p) => this.icons.renderCodicons(p));
        const percent = this.percent !== undefined ? ` (${String(Math.round(this.percent))}%)` : "";
        return `${spinner} ${parts.join(" · ")}${percent}`;
    }
}

/** Captions expand `$(name)`: upstream this is `ProgressLocation.Window`, which expands icons. */
export class ProgressStatusBarAdapter implements IProgressSink {
    private readonly entries = new Map<number, ProgressEntry>();

    public constructor(
        private readonly statusBar: StatusBarService,
        private readonly spinnerIntervalMs: number = SPINNER_INTERVAL_MS,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {}

    public start(handle: number, title: string): void {
        // A repeated start of the same handle: defensively dismiss the previous entry.
        if (this.entries.has(handle)) this.end(handle);
        const entry = new ProgressEntry(title, this.icons);
        entry.bar = this.statusBar.addEntry({
            id: `status.extensionProgress.${String(handle)}`,
            text: entry.render(),
            alignment: "left",
            priority: PROGRESS_PRIORITY,
        });
        entry.timer = setInterval(() => {
            entry.frame = (entry.frame + 1) % SPINNER_FRAMES.length;
            entry.bar.update({ text: entry.render() });
        }, this.spinnerIntervalMs);
        this.entries.set(handle, entry);
    }

    public report(handle: number, message?: string, increment?: number): void {
        const entry = this.entries.get(handle);
        if (entry === undefined) return;
        if (message !== undefined) entry.message = message;
        if (increment !== undefined) {
            entry.percent = Math.min(100, Math.max(0, (entry.percent ?? 0) + increment));
        }
        entry.bar.update({ text: entry.render() });
    }

    public end(handle: number): void {
        const entry = this.entries.get(handle);
        if (entry === undefined) return;
        this.entries.delete(handle);
        clearInterval(entry.timer);
        entry.bar.dispose();
    }

    public dispose(): void {
        for (const handle of [...this.entries.keys()]) this.end(handle);
    }
}
