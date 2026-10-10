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
 * `TokenStyle.fromSettings` эталона: `fontStyle` (даже пустой) сбрасывает все
 * четыре флага и выставляет перечисленные, перекрывая отдельные булевы.
 */
function styleFromSettings(settings: ISemanticTokenColorSettings): SemanticTokenStyle {
    const style: IMutableStyle = {};
    if (settings.foreground !== undefined) style.fg = parseHexColor(settings.foreground);
    let { bold, italic, underline, strikethrough } = settings;
    if (settings.fontStyle !== undefined) {
        const fontStyle = settings.fontStyle;
        bold = fontStyle.includes("bold");
        italic = fontStyle.includes("italic");
        underline = fontStyle.includes("underline");
        strikethrough = fontStyle.includes("strikethrough");
    }
    if (bold !== undefined) style.bold = bold;
    if (italic !== undefined) style.italic = italic;
    if (underline !== undefined) style.underline = underline;
    if (strikethrough !== undefined) style.strikethrough = strikethrough;
    return style;
}

/**
 * `nameMatcher` эталона: каждый идентификатор пути правила найден в пробе
 * (ищется с конца); вес — по позиции последнего из них и длине идентификатора.
 */
function nameMatcher(identifiers: readonly string[], scopes: ProbeScope): number {
    if (scopes.length < identifiers.length) {
        return -1;
    }
    let score = -1;
    for (const identifier of identifiers) {
        let found = -1;
        for (let i = scopes.length - 1; i >= 0; i--) {
            if (scopesAreMatching(scopes[i], identifier)) {
                found = (i + 1) * 0x10000 + identifier.length;
                break;
            }
        }
        if (found < 0) return -1;
        score = found;
    }
    return score;
}

/** Скоуп `thisScopeName` — это `scopeName` или его потомок по точке. */
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
    // Без единого матчера (пустой или битый селектор) — max пустого = -Infinity: не совпадает.
    return (scope) => Math.max(...matchers.map((matcher) => matcher(scope)));
}

/**
 * Стиль семантического токена в активной теме — перенос `getTokenStyle` и
 * `resolveScopes` из `colorThemeData.ts` эталона:
 *
 * 1. правила `semanticTokenColors` темы: каждый атрибут (fg, bold, italic,
 *    underline, strikethrough) берётся у совпавшего правила с наибольшим весом
 *    селектора, при равенстве — у позднего;
 * 2. атрибуты, заданные на шаге 1, закрыты; для остальных — дефолтные
 *    правила реестра классификации (встроенные, затем `semanticTokenScopes`
 *    расширений): их TextMate-пробы ищутся в `tokenColors` темы, и первая
 *    проба, давшая цвет или `fontStyle`, участвует с весом селектора правила.
 *
 * Отступление от эталона — момент разрешения: эталон запекает стиль в
 * метаданные токена при приёме ответа и на смене темы перезапрашивает
 * сервер; здесь стиль берётся при отрисовке через этот кэш, а смена темы лишь
 * сбрасывает его. `editor.semanticTokenColorCustomizations` не поддержан (нет
 * и `editor.tokenColorCustomizations`).
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

    /** Правила темы под текущий реестр; кэши стилей и TM-матчеров сброшены. */
    private compile(): ISemanticRule[] {
        this.scopeMatchers = undefined;
        this.cache.clear();
        // Селекторы правил темы парсит реестр: вес `superType` зависит от
        // иерархии типов, а её дополняют расширения.
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

        // Заданное правилом темы дефолтом не перекрывается. Эталон пропускает
        // проход по дефолтам, если правила темы задали всё; здесь стиль и так
        // кэшируется на (тип, модификаторы, язык), и оптимизация не нужна.
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
     * Первая проба, для которой в `tokenColors` темы нашёлся цвет или
     * `fontStyle` (лучший по весу матча правила, при равенстве — поздний).
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
