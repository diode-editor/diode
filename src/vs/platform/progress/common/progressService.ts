import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";

import { token } from "../../instantiation/common/diContainer.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и разрешение зависимостей идёт по ссылке на него — строка внутри остаётся отладочной меткой
export const ProgressServiceDIToken = token<ProgressService>("ProgressService");

/**
 * Кадры спиннера — единственное определение в проекте. Брайль, как у ora и всей
 * npm-экосистемы: десять кадров вращаются заметно плавнее четырёх полукругов, а
 * ширина глифа по измерению движка та же, так что раскладка не меняется.
 *
 * Терминал берёт брайль через fallback шрифта — Hack блок U+2800 не покрывает.
 * Растеризатору скриншотов fallback'а взять неоткуда (на CI системных шрифтов
 * нет вовсе), поэтому рядом с Hack завендорен DejaVu Sans; без него оба разных
 * кадра рисуются одинаковым пустым `.notdef`-квадратом. Гейт — `e2e/helpers/
 * renderScreenshot.test.ts`: строковые ассерты тофу не видят.
 */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

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

/** Запись одной живой операции (класс — как у моста прогресса расширений). */
class ProgressEntry {
    public visible = false;
    public delayTimer: ReturnType<typeof setTimeout> | undefined;
    public minVisibleTimer: ReturnType<typeof setTimeout> | undefined;
    /** Операция закончилась, но запись досиживает `minVisibleMs`. */
    public endRequested = false;

    /** `scope === null` — локация `window`, иначе id секции. */
    public constructor(
        public readonly scope: string | null,
        public readonly title: string,
    ) {}
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
        // Stryker disable next-line CallExpression: своих зарегистрированных disposable у сервиса нет, вызов держим ради контракта базового класса
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
        // Событие на самом старте: занятость видна дизейблу сразу, до показа.
        this.fire();
        return entry;
    }

    private end(entry: ProgressEntry): void {
        // Stryker disable next-line ConditionalExpression: без записи в наборе тело end() ничего не меняет — сюда приходят только промисы, пережившие dispose(), а тот уже снял и таймеры, и слушателей
        if (!this.entries.has(entry)) return;
        entry.endRequested = true;
        // Досиживает минимум показа только тот, кого успели показать.
        if (entry.minVisibleTimer === undefined) this.forget(entry);
        this.stopTickerIfIdle();
        this.fire();
    }

    /** Снимает запись и её таймеры. Идемпотентна: `clearTimeout(undefined)` — no-op. */
    private forget(entry: ProgressEntry): void {
        clearTimeout(entry.delayTimer);
        // Stryker disable next-line CallExpression: сюда с живым minVisible-таймером приходят только из dispose(), а он следом снимает слушателей — разбудить утёкшим таймером некого
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

    /** Тикер живёт ровно пока есть что крутить — иначе приложение не бездействует зря. */
    private stopTickerIfIdle(): void {
        // Stryker disable next-line ConditionalExpression: при остановленном тикере тело — clearInterval(null) и сброс кадра, который в этом состоянии уже нулевой
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
