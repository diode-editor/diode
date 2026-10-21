// Трасса инстанцирования (как `Trace` эталона), флаг `DIODE_STARTUP_TRACE_INSTANTIATIONS=1`. Без
// него `Container.get` платит одну проверку на промахе кэша, попадание в кэш не трогается.
// Таблицу печатает `npm run bench:services`.

export interface IInstantiationTraceEntry {
    readonly id: string;
    /** мс от `performance.timeOrigin`. */
    readonly start: number;
    /** С вложенными созданиями, мс. */
    readonly inclusive: number;
    /** Без вложенных созданий, мс. */
    readonly self: number;
    /** Глубина в дереве созданий: 0 — запрошен не из конструктора другого сервиса. */
    readonly depth: number;
    /**
     * Id токена-родителя; на верхнем уровне — `contributions:<фаза>` либо первая функция стека
     * за контейнером (`new WorkbenchComponent`, `runEditor`…).
     */
    readonly requester: string;
    /** Фаза контрибуций, внутри которой шло создание; null — вне реестра. */
    readonly phase: string | null;
    /** true — сам токен зарегистрирован контрибуцией и создан её фазой. */
    readonly contribution: boolean;
}

/** Вызыватель верхнего уровня — пока сырой стек: форматирует его V8 лениво, при выгрузке. */
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

/** Кадров стека хватает дойти от контейнера до вызывателя; меньше кадров — дешевле захват. */
const CALLER_STACK_LIMIT = 8;

export class InstantiationTracer {
    private readonly entries: RawEntry[] = [];
    private readonly stack: Frame[] = [];
    private readonly phases: string[] = [];
    /** Фаза контрибуции, чьё создание идёт следующим на верхнем уровне; null — не контрибуция. */
    private pendingContribution: string | null = null;

    /** Исключение пробрасывает, запись не оставляет. */
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
     * Создание контрибуции фазой `phase` (реестр контрибуций): само создание
     * помечено флагом `contribution`, оно и всё вложенное — фазой. Уже созданная
     * контрибуция (кэш контейнера) записи не даёт.
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

    /** Записи в порядке завершения создания; стеки вызывателей форматируются здесь. */
    public getEntries(): IInstantiationTraceEntry[] {
        return this.entries.map((entry) =>
            typeof entry.requester === "string"
                ? (entry as IInstantiationTraceEntry)
                : { ...entry, requester: callerName(entry.requester) },
        );
    }
}

/**
 * Захват стека без форматирования: строку `.stack` V8 собирает при первом
 * чтении, а оно — в {@link callerName} при выгрузке, вне замеряемого окна.
 */
function captureCaller(): Error {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = CALLER_STACK_LIMIT;
    const error = new Error();
    Error.stackTraceLimit = limit;
    return error;
}

/**
 * Первая функция стека за пределами контейнера и трассы. В бандле имена
 * классов и функций esbuild сохраняет, файл и строку отбрасываем: в SEA это
 * строка `main.cjs`, ни о чём не говорящая.
 */
function callerName(error: Error): string {
    // Stryker disable next-line StringLiteral: `stack` у Error в V8 — всегда строка, фоллбэк — страховка типа
    for (const line of (error.stack ?? "").split("\n")) {
        // `at name (file:line:col)`; безымянная функция — `at file:line:col`, её
        // пропускаем, как и кадры самого node (`processTicksAndRejections` после
        // await). Первая строка стека (`Error`) не совпадает ни с чем.
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

/** Включает трассу инстанцирования (идемпотентно) и возвращает её. */
export function enableInstantiationTrace(): InstantiationTracer {
    activeTracer ??= new InstantiationTracer();
    return activeTracer;
}

/** Активная трасса либо undefined — трасса выключена. */
export function getInstantiationTracer(): InstantiationTracer | undefined {
    return activeTracer;
}

/** Выключает трассу и сбрасывает записи — для тестов. */
export function resetInstantiationTrace(): void {
    activeTracer = undefined;
}
