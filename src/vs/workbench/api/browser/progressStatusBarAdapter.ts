import type { IProgressSink } from "../../services/extensions/node/extensionHost.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../services/statusbar/common/statusBarService.ts";

/** Кадры спиннера (брайль, как у VS Code/ora). */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Период смены кадра спиннера, мс. */
const SPINNER_INTERVAL_MS = 100;

/** Приоритет записей прогресса: левее chord-хинта (50), правее terminal-env (100). */
const PROGRESS_PRIORITY = 60;

class ProgressEntry {
    public message: string | undefined;
    /** Накопленный дискретный прогресс 0–100; undefined — бесконечный. */
    public percent: number | undefined;
    public frame = 0;
    public bar!: IStatusBarEntryHandle;
    public timer!: ReturnType<typeof setInterval>;

    public constructor(public readonly title: string) {}

    public render(): string {
        const spinner = SPINNER_FRAMES[this.frame];
        const parts = [this.title, this.message].filter((p): p is string => p !== undefined && p !== "");
        const percent = this.percent !== undefined ? ` (${String(Math.round(this.percent))}%)` : "";
        return `${spinner} ${parts.join(" · ")}${percent}`;
    }
}

/**
 * Мост `window.withProgress` расширений в статус-бар (реализация
 * {@link IProgressSink}): на `start` появляется запись с анимированным
 * спиннером, `report` обновляет сообщение/процент, `end` снимает запись.
 * Несколько одновременных прогрессов — независимые записи. Проводка —
 * `extensionHostModule` (сток `ExtensionHost.progressSink`).
 */
export class ProgressStatusBarAdapter implements IProgressSink {
    private readonly entries = new Map<number, ProgressEntry>();

    public constructor(
        private readonly statusBar: StatusBarService,
        private readonly spinnerIntervalMs: number = SPINNER_INTERVAL_MS,
    ) {}

    public start(handle: number, title: string): void {
        // Повторный start того же handle — защитно гасим прежнюю запись.
        if (this.entries.has(handle)) this.end(handle);
        const entry = new ProgressEntry(title);
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

    /** Гасит все живые записи и таймеры (остановка приложения/пере-проводка). */
    public dispose(): void {
        for (const handle of [...this.entries.keys()]) this.end(handle);
    }
}
