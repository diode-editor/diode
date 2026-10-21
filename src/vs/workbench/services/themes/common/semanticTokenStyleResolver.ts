import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type {
    ISemanticTokenStyleResolver,
    SemanticTokenStyle,
} from "../../../../editor/common/languages/iSemanticTokenStyleResolver.ts";
import { parseHexColor } from "../../../../platform/theme/common/colorUtils.ts";
import type { IEditorTokenTheme } from "../../../../platform/theme/common/iEditorTokenTheme.ts";
import type { ISemanticTokenColorSettings, ITokenColorRule } from "../../../../platform/theme/common/iThemeFile.ts";
import type {
    ITokenSelector,
    ProbeScope,
    TokenClassificationRegistry,
} from "../../../../platform/theme/common/tokenClassificationRegistry.ts";

import { createMatchers, type Matcher } from "./textMateScopeMatcher.ts";

interface IMutableStyle {
    fg?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
}

interface ISemanticRule {
    readonly selector: ITokenSelector;
    readonly style: SemanticTokenStyle;
}

const FLAGS = ["bold", "italic", "underline", "strikethrough"] as const;

/**
 * Upstream `TokenStyle.fromSettings`: `fontStyle` (even empty) resets all
 * four flags and sets the listed ones, overriding the individual booleans.
 */
function styleFromSettings(settings: ISemanticTokenColorSettings): SemanticTokenStyle {
    let { bold, italic, underline, strikethrough } = settings;
    if (settings.fontStyle !== undefined) {
        const fontStyle = settings.fontStyle;
        bold = fontStyle.includes("bold");
        italic = fontStyle.includes("italic");
        underline = fontStyle.includes("underline");
        strikethrough = fontStyle.includes("strikethrough");
    }
    // An unset flag stays a key with value undefined: the consumer
    // (`processStyle`) takes only the set attributes.
    const style: IMutableStyle = { bold, italic, underline, strikethrough };
    if (settings.foreground !== undefined) style.fg = parseHexColor(settings.foreground);
    return style;
}

/**
 * Upstream `nameMatcher`: every identifier of the rule path is found in the probe
 * (searched from the end); the weight comes from the position of the last one and the identifier length.
 */
function nameMatcher(identifiers: readonly string[], scopes: ProbeScope): number {
    if (scopes.length < identifiers.length) {
        return -1;
    }
    // There is at least one identifier (the parser's do-while), so the initial value is always overwritten.
    let score = 0;
    for (const identifier of identifiers) {
        let found = -1;
        for (let i = scopes.length - 1; i >= 0; i--) {
            if (scopesAreMatching(scopes[i], identifier)) {
                found = (i + 1) * 0x10000 + identifier.length;
                break;
            }
        }
        if (found === -1) return -1;
        score = found;
    }
    return score;
}

/** Scope `thisScopeName` is `scopeName` or its dot-descendant. */
function scopesAreMatching(thisScopeName: string, scopeName: string): boolean {
    return (
        thisScopeName === scopeName || (thisScopeName.startsWith(scopeName) && thisScopeName[scopeName.length] === ".")
    );
}

function getScopeMatcher(rule: ITokenColorRule): Matcher<ProbeScope> | null {
    const ruleScope = rule.scope;
    if (ruleScope === undefined) {
        return null;
    }
    const matchers: Matcher<ProbeScope>[] = [];
    for (const scope of Array.isArray(ruleScope) ? ruleScope : [ruleScope]) {
        createMatchers(scope, nameMatcher, matchers);
    }
    // No matchers at all (empty or broken selector): max of empty is -Infinity, i.e. no match.
    return (scope) => Math.max(...matchers.map((matcher) => matcher(scope)));
}

/**
 * Port of `getTokenStyle` and `resolveScopes` from upstream `colorThemeData.ts`:
 * 1. the theme's `semanticTokenColors` rules: each attribute comes from the matching rule with the highest
 *    selector weight, the later one on a tie;
 * 2. for attributes unset in step 1, the classification registry's default rules: their TextMate probes
 *    are looked up in `tokenColors`, the first one yielding a color or `fontStyle` gets the rule's selector weight.
 *
 * Deviation: upstream bakes the style into token metadata and re-requests the server on theme change;
 * here the style is taken at render time through this cache, and a theme change resets it.
 * `editor.semanticTokenColorCustomizations` is not supported.
 */
export class SemanticTokenStyleResolver implements ISemanticTokenStyleResolver, IDisposable {
    private theme: IEditorTokenTheme;
    private semanticRules: ISemanticRule[];
    private scopeMatchers: (readonly [Matcher<ProbeScope>, ITokenColorRule])[] | undefined;
    private readonly cache = new Map<string, SemanticTokenStyle | null>();
    private readonly onDidChangeEmitter = new Emitter<void>();
    public readonly onDidChange = this.onDidChangeEmitter.event;
    private readonly registrySubscription: IDisposable;

    public constructor(
        private readonly registry: TokenClassificationRegistry,
        theme: IEditorTokenTheme,
    ) {
        this.theme = theme;
        this.semanticRules = this.compile();
        this.registrySubscription = registry.onDidChange(() => {
            this.semanticRules = this.compile();
            this.onDidChangeEmitter.fire();
        });
    }

    public get semanticHighlighting(): boolean {
        return this.theme.semanticHighlighting === true;
    }

    public setTheme(theme: IEditorTokenTheme): void {
        this.theme = theme;
        this.semanticRules = this.compile();
        this.onDidChangeEmitter.fire();
    }

    public resolve(type: string, modifiers: readonly string[], languageId: string): SemanticTokenStyle | null {
        const key = `${type}.${[...modifiers].sort().join(".")}:${languageId}`;
        let style = this.cache.get(key);
        if (style === undefined) {
            style = this.getTokenStyle(type, modifiers, languageId);
            this.cache.set(key, style);
        }
        return style;
    }

    public dispose(): void {
        this.registrySubscription.dispose();
        this.onDidChangeEmitter.dispose();
    }

    /** Theme rules for the current registry; style and TM matcher caches are reset. */
    private compile(): ISemanticRule[] {
        this.scopeMatchers = undefined;
        this.cache.clear();
        // The registry parses theme rule selectors: the `superType` weight depends on
        // the type hierarchy, which extensions extend.
        return (this.theme.semanticTokenRules ?? []).map((rule) => ({
            selector: this.registry.parseTokenSelector(rule.selector),
            style: styleFromSettings(rule.settings),
        }));
    }

    private getTokenStyle(type: string, modifiers: readonly string[], language: string): SemanticTokenStyle | null {
        const result: IMutableStyle = {};
        const score = { fg: -1, bold: -1, italic: -1, underline: -1, strikethrough: -1 };

        const processStyle = (matchScore: number, style: SemanticTokenStyle): void => {
            if (style.fg !== undefined && score.fg <= matchScore) {
                score.fg = matchScore;
                result.fg = style.fg;
            }
            for (const flag of FLAGS) {
                const value = style[flag];
                if (value !== undefined && score[flag] <= matchScore) {
                    score[flag] = matchScore;
                    result[flag] = value;
                }
            }
        };

        for (const rule of this.semanticRules) {
            const matchScore = rule.selector.match(type, modifiers, language);
            if (matchScore >= 0) processStyle(matchScore, rule.style);
        }

        // Upstream skips the defaults pass if theme rules set everything; here the style is cached
        // per (type, modifiers, language) anyway.
        for (const key of ["fg", ...FLAGS] as const) {
            if (score[key] !== -1) score[key] = Number.MAX_VALUE;
        }
        for (const rule of this.registry.getTokenStylingDefaultRules()) {
            const matchScore = rule.selector.match(type, modifiers, language);
            if (matchScore < 0) continue;
            const style = this.resolveScopes(rule.defaults.scopesToProbe);
            if (style !== undefined) processStyle(matchScore, style);
        }
        return result.fg === undefined && FLAGS.every((flag) => result[flag] === undefined) ? null : result;
    }

    /**
     * The first probe for which the theme's `tokenColors` has a color or
     * `fontStyle` (best by rule match weight, the later one on a tie).
     */
    private resolveScopes(probes: readonly ProbeScope[]): SemanticTokenStyle | undefined {
        this.scopeMatchers ??= this.theme.rules.flatMap((rule) => {
            const matcher = getScopeMatcher(rule);
            return matcher === null ? [] : [[matcher, rule] as const];
        });
        for (const probe of probes) {
            let foreground: string | undefined;
            let fontStyle: string | undefined;
            let foregroundScore = -1;
            let fontStyleScore = -1;
            for (const [matcher, rule] of this.scopeMatchers) {
                const matchScore = matcher(probe);
                if (matchScore < 0) continue;
                if (matchScore >= foregroundScore && rule.settings.foreground !== undefined) {
                    foreground = rule.settings.foreground;
                    foregroundScore = matchScore;
                }
                if (matchScore >= fontStyleScore && rule.settings.fontStyle !== undefined) {
                    fontStyle = rule.settings.fontStyle;
                    fontStyleScore = matchScore;
                }
            }
            if (foreground !== undefined || fontStyle !== undefined) {
                return styleFromSettings({ foreground, fontStyle });
            }
        }
        return undefined;
    }
}
