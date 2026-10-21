import type { IGrammar, IRawGrammar, Registry } from "vscode-textmate";
import vsctm from "vscode-textmate";

import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";
import type { ITokenizationSupport } from "../../../../editor/common/languages.ts";
import type { ITextMateTheme } from "../../themes/common/textMateTheme.ts";

import { getOnigLib } from "./onigLib.ts";
import { TextMateTokenizationSupport } from "./textMateTokenizationSupport.ts";

export interface IGrammarRecord {
    readonly scopeName: string;
    readonly path: string;
    readonly injections?: readonly string[];
}

/** Grammars are read lazily, on first request. */
export class TextMateGrammarLoader {
    private readonly assets: IAssetAccess;
    private readonly registry: Registry;
    private readonly recordsByScope = new Map<string, IGrammarRecord>();
    private readonly injectionsByHost = new Map<string, string[]>();
    private readonly grammarCache = new Map<string, Promise<IGrammar | null>>();

    public constructor(assets: IAssetAccess, records: readonly IGrammarRecord[]) {
        this.assets = assets;
        for (const rec of records) {
            this.recordsByScope.set(rec.scopeName, rec);
            if (rec.injections) {
                for (const host of rec.injections) {
                    let list = this.injectionsByHost.get(host);
                    if (list === undefined) {
                        list = [];
                        this.injectionsByHost.set(host, list);
                    }
                    list.push(rec.scopeName);
                }
            }
        }

        this.registry = new vsctm.Registry({
            onigLib: getOnigLib(this.assets),
            loadGrammar: (scopeName) => this.loadRawGrammar(scopeName),
            getInjections: (scopeName) => this.injectionsByHost.get(scopeName),
        });
    }

    public async loadSupport(scopeName: string): Promise<ITokenizationSupport | null> {
        // If the scope is not registered with us, return null without touching the
        // Registry, otherwise vscode-textmate throws "No grammar provided".
        if (!this.recordsByScope.has(scopeName)) return null;
        const grammar = await this.loadGrammar(scopeName);
        /* v8 ignore start -- defensive: for a registered scope the Registry either throws "No grammar provided" or returns the grammar; null is unreachable here */
        if (grammar === null) return null;
        /* v8 ignore stop */
        return new TextMateTokenizationSupport(grammar);
    }

    /**
     * Upstream `TextMateTokenizationFeature._updateTheme`. Loaded grammars pick up the theme
     * themselves; tokens from the old one are retokenized by the owner (`TokenizationRegistry.setColorMap`).
     */
    public setTheme(theme: ITextMateTheme): void {
        this.registry.setTheme(
            { settings: theme.settings.map((rule) => ({ ...rule, scope: copyScope(rule.scope) })) },
            [...theme.colorMap],
        );
    }

    public dispose(): void {
        this.registry.dispose();
    }

    private loadGrammar(scopeName: string): Promise<IGrammar | null> {
        let pending = this.grammarCache.get(scopeName);
        if (pending === undefined) {
            pending = this.registry.loadGrammar(scopeName);
            this.grammarCache.set(scopeName, pending);
        }
        return pending;
    }

    private async loadRawGrammar(scopeName: string): Promise<IRawGrammar | null> {
        const rec = this.recordsByScope.get(scopeName);
        if (rec === undefined) return null;
        const content = await this.assets.readText(rec.path);
        return vsctm.parseRawGrammar(content, rec.path);
    }
}

/** vscode-textmate expects a mutable scope array, so pass a copy. */
function copyScope(scope: string | readonly string[] | undefined): string | string[] | undefined {
    return typeof scope === "object" ? [...scope] : scope;
}
