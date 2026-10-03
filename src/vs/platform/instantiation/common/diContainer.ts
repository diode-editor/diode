export class Token<T> {
    declare public readonly _: T;
    public readonly id: string;

    public constructor(id: string) {
        this.id = id;
    }
}

export function token<T>(id: string): Token<T> {
    return new Token<T>(id);
}

type Resolve<Deps extends readonly Token<unknown>[]> = {
    [K in keyof Deps]: Deps[K] extends Token<infer T> ? T : never;
};

export interface Injectable<T, Deps extends readonly Token<unknown>[]> {
    readonly dependencies: Deps;
    new (...args: Resolve<Deps>): T;
}

export interface ServiceAccessor {
    get<T>(token: Token<T>): T;
}

interface InjectableClass {
    readonly dependencies: readonly Token<unknown>[];
    new (...args: unknown[]): unknown;
}

/**
 * Module — единица конфигурации контейнера: набор связанных биндингов с
 * опциональным типизированным контекстом (theme, backend и т.п.).
 *
 * Применяется через `Container.use(module, ctx)` — позволяет собирать
 * наборы сервисов в профили (production/test) без копипасты.
 */
export type ContainerModule<Ctx = void> = (container: Container, ctx: Ctx) => void;

export class Container implements ServiceAccessor {
    private factories = new Map<Token<unknown>, () => unknown>();
    private cache = new Map<Token<unknown>, unknown>();
    private resolving = new Set<Token<unknown>>();

    public bind<T, Deps extends readonly Token<unknown>[]>(tok: Token<T>, ctor: Injectable<T, Deps>): this;
    public bind<T>(tok: Token<T>, factory: () => T): this;
    public bind(tok: Token<unknown>, ctorOrFactory: InjectableClass | (() => unknown)): this {
        if ("dependencies" in ctorOrFactory) {
            const ctor = ctorOrFactory;
            this.factories.set(tok, () => new ctor(...ctor.dependencies.map((d) => this.get(d))));
        } else {
            this.factories.set(tok, ctorOrFactory);
        }
        return this;
    }

    /**
     * Применяет модуль конфигурации. Возвращает `this` для чейнинга.
     *
     *     container
     *         .use(coreModule, { app })
     *         .use(commandsModule)
     *         .use(controllersModule);
     */
    public use<Ctx>(module: ContainerModule<Ctx>, ctx: Ctx): this;
    public use(module: ContainerModule): this;
    public use<Ctx>(module: ContainerModule<Ctx>, ctx?: Ctx): this {
        module(this, ctx as Ctx);
        return this;
    }

    public get<T>(tok: Token<T>): T {
        if (this.cache.has(tok)) {
            return this.cache.get(tok) as T;
        }
        if (this.resolving.has(tok)) {
            const chain = [...this.resolving].map((t) => t.id).join(" → ");
            throw new Error(`Circular dependency detected: ${chain} → ${tok.id}`);
        }
        const factory = this.factories.get(tok);
        if (!factory) throw new Error(`No binding for "${tok.id}"`);
        this.resolving.add(tok);
        try {
            const value = factory() as T;
            this.cache.set(tok, value);
            return value;
        } finally {
            this.resolving.delete(tok);
        }
    }
}

/** The container itself as a service locator (analogue of vscode's `IInstantiationService`). */
// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const ServiceAccessorDIToken = token<ServiceAccessor>("ServiceAccessor");
