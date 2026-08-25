import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";

import { token } from "../../instantiation/common/diContainer.ts";

export const ProgressServiceDIToken = token<ProgressService>("ProgressService");

/**
 * Кадры спиннера — единственное определение в проекте. Полукруги, а не брайль
 * (как у ora и прежнего статус-бара): брайльный блок U+2800 не покрыт Hack Nerd
 * Font — эталонным шрифтом наших скриншотов и очень обычным терминальным, — и
 * спиннер выглядел там пустым квадратом. Ширина глифа по измерению движка та же,
 * так что раскладка не меняется.
 */
export const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;

/** Период смены кадра, мс. */
const SPINNER_INTERVAL_MS = 100;

/**
 * Сколько операция должна прожить, прежде чем её станет видно. Стейджинг одного
 * файла укладывается в пару десятков миллисекунд — спиннер на один кадр читается
 * как помеха, а не как прогресс.
 */
const SHOW_DELAY_MS = 300;

/** Минимальная длительность показа: показанный спиннер не должен мигнуть и пропасть. */
const MIN_VISIBLE_MS = 500;

/**
 * Куда показывать прогресс — подмножество `ProgressLocation` VS Code:
 * `view` — спиннер в заголовке секции, `window` — запись в статус-баре.
 */
export type IProgressOptions =
    | { readonly location: "view"; readonly viewId: string; readonly title: string }
    | { readonly location: "window"; readonly title: string };

/** Что видит отрисовка: текущий кадр спиннера и подпись операции. */
export interface IProgressFrame {
    readonly spinner: string;
    readonly title: string;
}

/** Тайминги; инжектятся тестами (fake timers), в приложении — дефолты выше. */
export interface IProgressServiceOptions {
    readonly delayMs?: number;
    readonly minVisibleMs?: number;
    readonly intervalMs?: number;
}

/** Запись одной живой операции. `scope === null` — локация `window`. */
interface ProgressEntry {
    readonly scope: string | null;
    readonly title: string;
    visible: boolean;
    delayTimer: ReturnType<typeof setTimeout> | null;
    minVisibleTimer: ReturnType<typeof setTimeout> | null;
    /** Операция закончилась, но запись досиживает `minVisibleMs`. */
    endRequested: boolean;
}

/**
 * Прогресс длительных операций (аналог `IProgressService` VS Code): модель и
 * такт анимации, без отрисовки. Кадры разбирают потребители — спиннер в
 * заголовке view (`ViewProgressContribution`) и запись статус-бара.
 *
 * Три свойства, ради которых сервис вообще есть:
 * - **задержка показа** — операция короче {@link SHOW_DELAY_MS} не мигает вовсе,
 *   при этом {@link isBusy} истинен сразу, так что кнопки гаснут без задержки;
 * - **минимум показа** — успевший появиться спиннер живёт {@link MIN_VISIBLE_MS};
 * - **один тикер на всё приложение**, живой только пока есть видимая запись:
 *   спиннеры идут в одной фазе, а их кадр — одна пачка `markDirty` на кадр
 *   экрана. Своего `setInterval` у потребителей быть не должно.
 *
 * Времени по часам сервис не читает (только таймеры) — под `vi.useFakeTimers()`
 * поведение детерминировано.
 */
export class ProgressService extends Disposable {
    public static dependencies = [] as const;

    private readonly entries = new Set<ProgressEntry>();
    private readonly listeners = new Set<() => void>();
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

    /**
     * Прогресс живёт от вызова до settle промиса задачи — ошибка тоже конец
     * (и пробрасывается наружу нетронутой).
     */
    public async withProgress<T>(options: IProgressOptions, task: () => Promise<T>): Promise<T> {
        const entry = this.start(options);
        try {
            return await task();
        } finally {
            this.end(entry);
        }
    }

    /**
     * Идёт ли операция прямо сейчас — включая ещё не показанные. Источник для
     * дизейбла кнопок и контекст-ключей: клик обязан перестать работать сразу,
     * а не через задержку показа.
     */
    public isBusy(viewId?: string): boolean {
        for (const entry of this.entries) {
            if (entry.endRequested) continue;
            if (viewId === undefined || entry.scope === viewId) return true;
        }
        return false;
    }

    /**
     * Показываемые прогрессы по viewId. Подпись отдаёт самая ранняя запись
     * секции: «commit → refresh» не должен мигать сменой текста.
     */
    public viewProgress(): ReadonlyMap<string, IProgressFrame> {
        const result = new Map<string, IProgressFrame>();
        for (const entry of this.entries) {
            if (!entry.visible || entry.scope === null) continue;
            if (!result.has(entry.scope)) result.set(entry.scope, this.frameOf(entry));
        }
        return result;
    }

    /** Показываемый прогресс локации `window` (самый ранний), иначе null. */
    public windowProgress(): IProgressFrame | null {
        for (const entry of this.entries) {
            if (entry.visible && entry.scope === null) return this.frameOf(entry);
        }
        return null;
    }

    /** Любое изменение: старт, показ, смена кадра, конец. */
    public onDidChange(listener: () => void): IDisposable {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            },
        };
    }

    public override dispose(): void {
        for (const entry of [...this.entries]) this.forget(entry);
        this.stopTickerIfIdle();
        this.listeners.clear();
        super.dispose();
    }

    private start(options: IProgressOptions): ProgressEntry {
        const entry: ProgressEntry = {
            scope: options.location === "view" ? options.viewId : null,
            title: options.title,
            visible: false,
            delayTimer: null,
            minVisibleTimer: null,
            endRequested: false,
        };
        entry.delayTimer = setTimeout(() => {
            entry.delayTimer = null;
            entry.visible = true;
            entry.minVisibleTimer = setTimeout(() => {
                entry.minVisibleTimer = null;
                if (entry.endRequested) this.forget(entry);
                this.stopTickerIfIdle();
                this.fire();
            }, this.minVisibleMs);
            this.startTicker();
            this.fire();
        }, this.delayMs);
        this.entries.add(entry);
        // Событие на самом старте: занятость видна дизейблу сразу, до показа.
        this.fire();
        return entry;
    }

    private end(entry: ProgressEntry): void {
        if (!this.entries.has(entry)) return;
        entry.endRequested = true;
        // Досиживает минимум показа только тот, кого успели показать.
        if (entry.minVisibleTimer === null) this.forget(entry);
        this.stopTickerIfIdle();
        this.fire();
    }

    /** Снимает запись и её таймеры. Идемпотентна. */
    private forget(entry: ProgressEntry): void {
        if (entry.delayTimer !== null) clearTimeout(entry.delayTimer);
        if (entry.minVisibleTimer !== null) clearTimeout(entry.minVisibleTimer);
        entry.delayTimer = null;
        entry.minVisibleTimer = null;
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

    /** Тикер живёт ровно пока есть что крутить — иначе приложение не бездействует зря. */
    private stopTickerIfIdle(): void {
        if (this.ticker === null) return;
        for (const entry of this.entries) {
            if (entry.visible) return;
        }
        clearInterval(this.ticker);
        this.ticker = null;
        // Следующая операция начнёт с первого кадра — так спиннер всегда
        // появляется одинаково, а не с середины прошлого цикла.
        this.frame = 0;
    }

    private fire(): void {
        for (const listener of [...this.listeners]) listener();
    }
}
