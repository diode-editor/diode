import { Emitter } from "../../../base/common/event.ts";
import { Disposable } from "../../../base/common/lifecycle.ts";
import { token } from "../../instantiation/common/diContainer.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и разрешение зависимостей идёт по ссылке на него — строка внутри остаётся отладочной меткой
export const ProgressServiceDIToken = token<ProgressService>("ProgressService");

/**
 * Брайль терминал берёт через fallback шрифта (Hack U+2800 не покрывает), а растеризатору
 * скриншотов fallback'а взять неоткуда — рядом с Hack завендорен DejaVu Sans, без него кадры
 * рисуются одинаковым `.notdef`. Гейт — `e2e/helpers/renderScreenshot.test.ts`.
 */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

const SPINNER_INTERVAL_MS = 100;

/** Стейджинг файла укладывается в десятки мс — спиннер на один кадр читается как помеха. */
const SHOW_DELAY_MS = 300;

const MIN_VISIBLE_MS = 500;

/** `view` — спиннер в заголовке секции, `window` — запись в статус-баре. */
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
    /** Операция закончилась, но запись досиживает `minVisibleMs`. */
    public endRequested = false;

    /** `scope === null` — локация `window`, иначе id секции. */
    public constructor(
        public readonly scope: string | null,
        public readonly title: string,
    ) {}
}

/**
 * Модель и такт анимации прогресса, без отрисовки. Операция короче {@link SHOW_DELAY_MS} не
 * мигает, но {@link isBusy} истинен сразу; показанный спиннер живёт {@link MIN_VISIBLE_MS}.
 * Тикер один на приложение и живёт, только пока есть видимая запись: спиннеры идут в одной
 * фазе, своего `setInterval` у потребителей быть не должно. Часы сервис не читает (только
 * таймеры) — под fake timers детерминирован.
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

    /** Ошибка задачи — тоже конец прогресса и пробрасывается нетронутой. */
    public async withProgress<T>(options: IProgressOptions, task: () => Promise<T>): Promise<T> {
        const entry = this.start(options);
        try {
            return await task();
        } finally {
            this.end(entry);
        }
    }

    /** Включая ещё не показанные: кнопки обязаны погаснуть сразу, а не через задержку показа. */
    public isBusy(viewId?: string): boolean {
        for (const entry of this.entries) {
            if (entry.endRequested) continue;
            if (viewId === undefined || entry.scope === viewId) return true;
        }
        return false;
    }

    /** Подпись отдаёт самая ранняя запись секции: «commit → refresh» не мигает сменой текста. */
    public viewProgress(): ReadonlyMap<string, IProgressFrame> {
        const result = new Map<string, IProgressFrame>();
        for (const entry of this.entries) {
            if (!entry.visible || entry.scope === null) continue;
            if (!result.has(entry.scope)) result.set(entry.scope, this.frameOf(entry));
        }
        return result;
    }

    /** Самый ранний из показанных. */
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
        this.onDidChangeEmitter.fire();
    }
}
