import type { IDisposable } from "@tuidom/all/common/disposable";

import type { ITokenizationSupport } from "./iTokenizationSupport.ts";

/** Ленивая регистрация: фабрика + кеш её запуска и итоговой регистрации. */
interface ILazyEntry {
    readonly factory: () => Promise<ITokenizationSupport | null>;
    loading?: Promise<ITokenizationSupport | undefined>;
    registration?: IDisposable;
}

/**
 * Registry that maps a `languageId` to its {@link ITokenizationSupport}.
 *
 * Mirrors `monaco.languages.TokenizationRegistry`. Language detection (which
 * languageId belongs to which file) is intentionally out of scope — that
 * concern lives in higher layers (controllers / language services).
 *
 * Поддерживает два режима регистрации:
 *   - {@link register} — support готов, кладём сразу;
 *   - {@link registerLazy} — support создаётся фабрикой при первом {@link load}.
 *     Нужен, чтобы не парсить все грамматики на старте: `get()` до загрузки
 *     отдаёт `undefined` (вызывающий берёт fallback), а когда `load()` доедет —
 *     фаерится {@link onDidChange} и потребитель пересаживается на настоящий
 *     токенайзер.
 */
export class TokenizationRegistry {
    private supports = new Map<string, ITokenizationSupport>();
    private lazy = new Map<string, ILazyEntry>();
    private listeners: ((languageId: string) => void)[] = [];

    public register(languageId: string, support: ITokenizationSupport): IDisposable {
        this.supports.set(languageId, support);
        this.fireChange(languageId);
        return {
            dispose: () => {
                if (this.supports.get(languageId) === support) {
                    this.supports.delete(languageId);
                    this.fireChange(languageId);
                }
            },
        };
    }

    /**
     * Регистрирует фабрику support'а без его создания. Фабрика запускается
     * ровно один раз — при первом {@link load} этого языка.
     *
     * `onDidChange` здесь НЕ фаерится: эффективный токенайзер не изменился
     * (`get()` по-прежнему отдаёт `undefined`), а фаер спровоцировал бы
     * потребителей загрузить все языки разом — ровно то, от чего уходим.
     *
     * Как и {@link register}, повторная регистрация того же языка побеждает:
     * disposable перекрытой записи становится no-op.
     */
    public registerLazy(languageId: string, factory: () => Promise<ITokenizationSupport | null>): IDisposable {
        const entry: ILazyEntry = { factory };
        this.lazy.set(languageId, entry);
        return {
            dispose: () => {
                if (this.lazy.get(languageId) !== entry) return;
                this.lazy.delete(languageId);
                entry.registration?.dispose();
            },
        };
    }

    /**
     * Догружает support языка, если он был зарегистрирован лениво. Идемпотентен:
     * фабрика вызывается один раз, результат (в том числе неудача) кешируется.
     *
     * **Никогда не реджектится** — вызывающие дёргают его fire-and-forget
     * (`void load(...)`), а отклонённый промис дал бы unhandled rejection.
     */
    public load(languageId: string): Promise<ITokenizationSupport | undefined> {
        const entry = this.lazy.get(languageId);
        // Не ленивый (или вовсе неизвестный) язык — отдаём что есть.
        if (entry === undefined) return Promise.resolve(this.supports.get(languageId));
        // Кеш живёт на entry, а не в `supports`: иначе eager-регистрация того же
        // языка навсегда перекрыла бы фабрику. Присваиваем ДО первого await —
        // тогда ре-ентрантный load() из onDidChange-слушателя увидит кеш.
        entry.loading ??= this.runFactory(languageId, entry);
        return entry.loading;
    }

    /** Языки с ленивой регистрацией — для фонового прогрева. */
    public lazyLanguageIds(): string[] {
        return [...this.lazy.keys()];
    }

    public get(languageId: string): ITokenizationSupport | undefined {
        return this.supports.get(languageId);
    }

    public onDidChange(listener: (languageId: string) => void): IDisposable {
        this.listeners.push(listener);
        return {
            dispose: () => {
                const i = this.listeners.indexOf(listener);
                if (i >= 0) this.listeners.splice(i, 1);
            },
        };
    }

    private async runFactory(languageId: string, entry: ILazyEntry): Promise<ITokenizationSupport | undefined> {
        let support: ITokenizationSupport | null;
        try {
            support = await entry.factory();
        } catch {
            // Ошибку кешируем, а не ретраим: одна попытка на язык, дальше он
            // остаётся на fallback-токенайзере. Логирование — забота фабрики,
            // она знает про грамматику и scope.
            return undefined;
        }
        if (support === null) return undefined;
        // Запись могли снять (dispose) или перекрыть, пока фабрика работала —
        // тогда регистрировать support уже некуда.
        if (this.lazy.get(languageId) !== entry) return undefined;
        entry.registration = this.register(languageId, support);
        return support;
    }

    private fireChange(languageId: string): void {
        // Копия: fireChange теперь случается и по резолву промиса (возможно,
        // после закрытия вкладки), а отписка во время фаера сдвинула бы массив
        // и пропустила соседа.
        for (const listener of [...this.listeners]) listener(languageId);
    }
}
