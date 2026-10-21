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
 * Like `monaco.languages.TokenizationRegistry`. {@link registerLazy} avoids parsing all
 * grammars at startup: until {@link load}, `get()` returns `undefined` (fallback), and
 * loading fires {@link onDidChange}.
 */
export class TokenizationRegistry {
    private supports = new Map<string, ITokenizationSupport>();
    private lazy = new Map<string, ILazyEntry>();
    private readonly onDidChangeEmitter = new Emitter<string>();
    public readonly onDidChange = this.onDidChangeEmitter.event;
    /** `undefined`: not holding. */
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
     * Does NOT fire `onDidChange`: the effective tokenizer is unchanged, and firing would
     * make consumers load every language at once.
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
     * The factory is called once; a failure is cached too. **Never rejects**: callers
     * invoke it fire-and-forget.
     */
    public load(languageId: string): Promise<ITokenizationSupport | undefined> {
        const entry = this.lazy.get(languageId);
        if (entry === undefined) return Promise.resolve(this.supports.get(languageId));
        // The cache lives on the entry, not in `supports`: otherwise an eager registration of
        // the same language would shadow the factory forever. Assigned BEFORE the first await
        // so a re-entrant load() from an onDidChange listener sees the cache.
        entry.loading ??= this.runFactory(languageId, entry);
        return entry.loading;
    }

    /**
     * Tokens from the previous theme hold stale `ColorId` indices, so, like upstream, the
     * event fires for every language and owners retokenize.
     */
    public setColorMap(colorMap: readonly string[]): void {
        this.colorMap = colorMap;
        for (const languageId of this.supports.keys()) this.fireChange(languageId);
    }

    /** `null`: no theme set yet. */
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
     * While held, {@link get} returns `undefined` and `onDidChange` stays silent; release
     * fires for every language. Why: the first frame does not wait for the first
     * tokenization, which compiles the grammar regexes (TypeScript: ~160 ms per viewport).
     * Upstream also tokenizes the viewport after render (`AttachedViewHandler`).
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
            // No retry: the language stays on the fallback. The factory logs, it knows the grammar.
            return undefined;
        }
        if (support === null) return undefined;
        // The entry may have been removed or replaced while the factory was running.
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

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by its reference; the string is only a debug label
export const TokenizationRegistryDIToken = token<TokenizationRegistry>("TokenizationRegistry");
