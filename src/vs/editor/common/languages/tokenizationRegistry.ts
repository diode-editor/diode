import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { token } from "../../../platform/instantiation/common/diContainer.ts";
import type { ITokenizationSupport } from "../languages.ts";

interface ILazyEntry {
    readonly factory: () => Promise<ITokenizationSupport | null>;
    loading?: Promise<ITokenizationSupport | undefined>;
    registration?: IDisposable;
}

/**
 * Как `monaco.languages.TokenizationRegistry`. {@link registerLazy} — чтобы не
 * парсить все грамматики на старте: до {@link load} `get()` отдаёт `undefined`
 * (fallback), по загрузке фаерится {@link onDidChange}.
 */
export class TokenizationRegistry {
    private supports = new Map<string, ITokenizationSupport>();
    private lazy = new Map<string, ILazyEntry>();
    private readonly onDidChangeEmitter = new Emitter<string>();
    public readonly onDidChange = this.onDidChangeEmitter.event;
    /** `undefined` — не держим. */
    private heldChanges: Set<string> | undefined;
    private colorMap: readonly string[] | null = null;

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
     * `onDidChange` здесь НЕ фаерится: эффективный токенайзер не изменился, а
     * фаер спровоцировал бы потребителей загрузить все языки разом.
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
     * Фабрика зовётся один раз, неудача тоже кешируется. **Никогда не
     * реджектится** — вызывающие дёргают его fire-and-forget.
     */
    public load(languageId: string): Promise<ITokenizationSupport | undefined> {
        const entry = this.lazy.get(languageId);
        if (entry === undefined) return Promise.resolve(this.supports.get(languageId));
        // Кеш живёт на entry, а не в `supports`: иначе eager-регистрация того же
        // языка навсегда перекрыла бы фабрику. Присваиваем ДО первого await —
        // тогда ре-ентрантный load() из onDidChange-слушателя увидит кеш.
        entry.loading ??= this.runFactory(languageId, entry);
        return entry.loading;
    }

    /**
     * Токены прежней темы держат прежние индексы `ColorId`, поэтому, как у
     * эталона, событие уходит по каждому языку — владельцы перетокенизируют.
     */
    public setColorMap(colorMap: readonly string[]): void {
        this.colorMap = colorMap;
        for (const languageId of this.supports.keys()) this.fireChange(languageId);
    }

    /** `null` — тему ещё не ставили. */
    public getColorMap(): readonly string[] | null {
        return this.colorMap;
    }

    public lazyLanguageIds(): string[] {
        return [...this.lazy.keys()];
    }

    public get(languageId: string): ITokenizationSupport | undefined {
        if (this.heldChanges !== undefined) return undefined;
        return this.supports.get(languageId);
    }

    /**
     * Пока держим, {@link get} отдаёт `undefined`, а `onDidChange` молчит; отпуск
     * фаерит по всем языкам. Зачем: стартовый кадр не ждёт первой токенизации —
     * она компилирует regex'ы грамматики (TypeScript — ~160 мс на вьюпорт).
     * Эталон тоже токенизирует вьюпорт после рендера (`AttachedViewHandler`).
     */
    public hold(): IDisposable {
        if (this.heldChanges !== undefined) throw new Error("TokenizationRegistry: already held");
        const changes = new Set<string>();
        this.heldChanges = changes;
        return {
            dispose: () => {
                if (this.heldChanges !== changes) return;
                this.heldChanges = undefined;
                for (const languageId of new Set([...this.supports.keys(), ...changes])) this.fireChange(languageId);
            },
        };
    }

    private async runFactory(languageId: string, entry: ILazyEntry): Promise<ITokenizationSupport | undefined> {
        let support: ITokenizationSupport | null;
        try {
            support = await entry.factory();
        } catch {
            // Не ретраим: язык остаётся на fallback. Логирует фабрика — она знает грамматику.
            return undefined;
        }
        if (support === null) return undefined;
        // Запись могли снять или перекрыть, пока фабрика работала.
        if (this.lazy.get(languageId) !== entry) return undefined;
        entry.registration = this.register(languageId, support);
        return support;
    }

    private fireChange(languageId: string): void {
        if (this.heldChanges !== undefined) {
            this.heldChanges.add(languageId);
            return;
        }
        this.onDidChangeEmitter.fire(languageId);
    }
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const TokenizationRegistryDIToken = token<TokenizationRegistry>("TokenizationRegistry");
