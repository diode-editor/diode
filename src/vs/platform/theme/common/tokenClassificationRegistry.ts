import { Emitter } from "../../../base/common/event.ts";

// Port of upstream tokenClassificationRegistry.ts without the JSON schema.

const TOKEN_TYPE_WILDCARD = "*";
const CHAR_LANGUAGE = ":".charCodeAt(0);
const CHAR_MODIFIER = ".".charCodeAt(0);

const ID_PATTERN = "\\w+[-_\\w+]*";
export const TYPE_AND_MODIFIER_ID_PATTERN = new RegExp(`^${ID_PATTERN}$`);

/** Rule selector: `match` returns the match weight or `-1`. */
export interface ITokenSelector {
    match(type: string, modifiers: readonly string[], language: string): number;
    readonly id: string;
}

export interface ITokenTypeOrModifierContribution {
    readonly id: string;
    readonly superType?: string;
    readonly description: string;
    readonly deprecationMessage?: string;
}

/** TextMate scope path to probe the theme with (upstream `ProbeScope`). */
export type ProbeScope = readonly string[];

/**
 * Rule default. Only `scopesToProbe` is ported from upstream `TokenStyleDefaults`: neither the
 * built-in rules nor the extension point set literal per-theme-type defaults.
 */
export interface ITokenStyleDefaults {
    readonly scopesToProbe: readonly ProbeScope[];
}

export interface ISemanticTokenDefaultRule {
    readonly selector: ITokenSelector;
    readonly defaults: ITokenStyleDefaults;
}

/**
 * Parses a classifier right to left: after `:` is the language, after `.` a modifier, the rest is
 * the type (upstream `parseClassifierString`).
 */
export function parseClassifierString(
    s: string,
    defaultLanguage?: string,
): { type: string; modifiers: string[]; language: string | undefined } {
    let k = s.length;
    let language = defaultLanguage;
    const modifiers: string[] = [];
    // Stryker disable next-line ArithmeticOperator: starting past the end yields NaN chars, neither ":" nor "."
    for (let i = k - 1; i >= 0; i--) {
        const ch = s.charCodeAt(i);
        if (ch === CHAR_LANGUAGE || ch === CHAR_MODIFIER) {
            const segment = s.substring(i + 1, k);
            k = i;
            if (ch === CHAR_LANGUAGE) {
                language = segment;
            } else {
                modifiers.push(segment);
            }
        }
    }
    return { type: s.substring(0, k), modifiers, language };
}

export class TokenClassificationRegistry {
    private readonly tokenTypeById = new Map<string, ITokenTypeOrModifierContribution>();
    private readonly tokenModifierById = new Map<string, ITokenTypeOrModifierContribution>();
    private tokenStylingDefaultRules: ISemanticTokenDefaultRule[] = [];
    private typeHierarchy = new Map<string, string[]>();

    private readonly onDidChangeEmitter = new Emitter<void>();
    /** Any registration or removal: style caches built on the registry are stale. */
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public registerTokenType(id: string, description: string, superType?: string, deprecationMessage?: string): void {
        if (!TYPE_AND_MODIFIER_ID_PATTERN.test(id)) {
            throw new Error("Invalid token type id.");
        }
        // Stryker disable next-line ConditionalExpression: the pattern accepts undefined anyway (as the string "undefined")
        if (superType !== undefined && superType !== "" && !TYPE_AND_MODIFIER_ID_PATTERN.test(superType)) {
            throw new Error("Invalid token super type id.");
        }
        this.tokenTypeById.set(id, { id, superType, description, deprecationMessage });
        this.typeHierarchy = new Map();
        this.onDidChangeEmitter.fire();
    }

    public registerTokenModifier(id: string, description: string, deprecationMessage?: string): void {
        if (!TYPE_AND_MODIFIER_ID_PATTERN.test(id)) {
            throw new Error("Invalid token modifier id.");
        }
        this.tokenModifierById.set(id, { id, description, deprecationMessage });
        this.onDidChangeEmitter.fire();
    }

    /**
     * Selector from a `(*|type)(.modifier)*(:language)?` string. Weight: a matching language gives
     * `+10` (a mismatch gives `-1`); a non-`*` type gives `100 - level`, where `level` is the position
     * of the selector type in the token's `superType` hierarchy (`-1` if absent); every selector
     * modifier must be on the token, and each gives `+100`. An empty type is the `$invalid`
     * selector, which matches nothing.
     */
    public parseTokenSelector(selectorString: string, language?: string): ITokenSelector {
        const selector = parseClassifierString(selectorString, language);
        if (selector.type === "") {
            return { match: () => -1, id: "$invalid" };
        }
        return {
            match: (type, modifiers, tokenLanguage) => {
                let score = 0;
                if (selector.language !== undefined) {
                    if (selector.language !== tokenLanguage) return -1;
                    score += 10;
                }
                if (selector.type !== TOKEN_TYPE_WILDCARD) {
                    const level = this.getTypeHierarchy(type).indexOf(selector.type);
                    if (level === -1) return -1;
                    score += 100 - level;
                }
                for (const selectorModifier of selector.modifiers) {
                    if (!modifiers.includes(selectorModifier)) return -1;
                }
                return score + selector.modifiers.length * 100;
            },
            id: `${[selector.type, ...selector.modifiers.sort()].join(".")}${selector.language !== undefined ? `:${selector.language}` : ""}`,
        };
    }

    public registerTokenStyleDefault(selector: ITokenSelector, defaults: ITokenStyleDefaults): void {
        this.tokenStylingDefaultRules.push({ selector, defaults });
        this.onDidChangeEmitter.fire();
    }

    public deregisterTokenStyleDefault(selector: ITokenSelector): void {
        this.tokenStylingDefaultRules = this.tokenStylingDefaultRules.filter((r) => r.selector.id !== selector.id);
        this.onDidChangeEmitter.fire();
    }

    public deregisterTokenType(id: string): void {
        this.tokenTypeById.delete(id);
        this.typeHierarchy = new Map();
        this.onDidChangeEmitter.fire();
    }

    public deregisterTokenModifier(id: string): void {
        this.tokenModifierById.delete(id);
        this.onDidChangeEmitter.fire();
    }

    public getTokenTypes(): ITokenTypeOrModifierContribution[] {
        return [...this.tokenTypeById.values()];
    }

    public getTokenModifiers(): ITokenTypeOrModifierContribution[] {
        return [...this.tokenModifierById.values()];
    }

    /** Built-in rules first, then extension ones. */
    public getTokenStylingDefaultRules(): readonly ISemanticTokenDefaultRule[] {
        return this.tokenStylingDefaultRules;
    }

    private getTypeHierarchy(typeId: string): string[] {
        let hierarchy = this.typeHierarchy.get(typeId);
        // Stryker disable next-line ConditionalExpression: cache; recomputing yields the same hierarchy
        if (hierarchy === undefined) {
            hierarchy = [typeId];
            // Stryker disable next-line CallExpression: cache; without the write the hierarchy is recomputed
            this.typeHierarchy.set(typeId, hierarchy);
            let type = this.tokenTypeById.get(typeId);
            // Upstream doesn't catch a superType cycle (an extension declared a→b, b→a) and hangs;
            // here the hierarchy stops at the first repeat. An empty superType in the hierarchy is
            // harmless: no selector has an empty type.
            while (type?.superType !== undefined && !hierarchy.includes(type.superType)) {
                hierarchy.push(type.superType);
                type = this.tokenTypeById.get(type.superType);
            }
        }
        return hierarchy;
    }
}

/** Types, modifiers and fallbacks are verbatim from upstream. */
export function createDefaultTokenClassificationRegistry(): TokenClassificationRegistry {
    const registry = new TokenClassificationRegistry();

    function registerTokenStyleDefault(selectorString: string, scopesToProbe: readonly ProbeScope[]): void {
        registry.registerTokenStyleDefault(registry.parseTokenSelector(selectorString), { scopesToProbe });
    }

    function registerTokenType(
        id: string,
        description: string,
        scopesToProbe: readonly ProbeScope[] = [],
        superType?: string,
        deprecationMessage?: string,
    ): void {
        registry.registerTokenType(id, description, superType, deprecationMessage);
        registerTokenStyleDefault(id, scopesToProbe);
    }

    // default token types

    registerTokenType("comment", "Style for comments.", [["comment"]]);
    registerTokenType("string", "Style for strings.", [["string"]]);
    registerTokenType("keyword", "Style for keywords.", [["keyword.control"]]);
    registerTokenType("number", "Style for numbers.", [["constant.numeric"]]);
    registerTokenType("regexp", "Style for expressions.", [["constant.regexp"]]);
    registerTokenType("operator", "Style for operators.", [["keyword.operator"]]);

    registerTokenType("namespace", "Style for namespaces.", [["entity.name.namespace"]]);

    registerTokenType("type", "Style for types.", [["entity.name.type"], ["support.type"]]);
    registerTokenType("struct", "Style for structs.", [["entity.name.type.struct"]]);
    registerTokenType("class", "Style for classes.", [["entity.name.type.class"], ["support.class"]]);
    registerTokenType("interface", "Style for interfaces.", [["entity.name.type.interface"]]);
    registerTokenType("enum", "Style for enums.", [["entity.name.type.enum"]]);
    registerTokenType("typeParameter", "Style for type parameters.", [["entity.name.type.parameter"]]);

    registerTokenType("function", "Style for functions", [["entity.name.function"], ["support.function"]]);
    registerTokenType("member", "Style for member functions", [], "method", "Deprecated use `method` instead");
    registerTokenType("method", "Style for method (member functions)", [
        ["entity.name.function.member"],
        ["support.function"],
    ]);
    registerTokenType("macro", "Style for macros.", [["entity.name.function.preprocessor"]]);

    registerTokenType("variable", "Style for variables.", [["variable.other.readwrite"], ["entity.name.variable"]]);
    registerTokenType("parameter", "Style for parameters.", [["variable.parameter"]]);
    registerTokenType("property", "Style for properties.", [["variable.other.property"]]);
    registerTokenType("enumMember", "Style for enum members.", [["variable.other.enummember"]]);
    registerTokenType("event", "Style for events.", [["variable.other.event"]]);
    registerTokenType("decorator", "Style for decorators & annotations.", [
        ["entity.name.decorator"],
        ["entity.name.function"],
    ]);

    registerTokenType("label", "Style for labels. ", undefined);

    // default token modifiers

    registry.registerTokenModifier("declaration", "Style for all symbol declarations.");
    registry.registerTokenModifier("documentation", "Style to use for references in documentation.");
    registry.registerTokenModifier("static", "Style to use for symbols that are static.");
    registry.registerTokenModifier("abstract", "Style to use for symbols that are abstract.");
    registry.registerTokenModifier("deprecated", "Style to use for symbols that are deprecated.");
    registry.registerTokenModifier("modification", "Style to use for write accesses.");
    registry.registerTokenModifier("async", "Style to use for symbols that are async.");
    registry.registerTokenModifier("readonly", "Style to use for symbols that are read-only.");

    registerTokenStyleDefault("variable.readonly", [["variable.other.constant"]]);
    registerTokenStyleDefault("property.readonly", [["variable.other.constant.property"]]);
    registerTokenStyleDefault("type.defaultLibrary", [["support.type"]]);
    registerTokenStyleDefault("class.defaultLibrary", [["support.class"]]);
    registerTokenStyleDefault("interface.defaultLibrary", [["support.class"]]);
    registerTokenStyleDefault("variable.defaultLibrary", [["support.variable"], ["support.other.variable"]]);
    registerTokenStyleDefault("variable.defaultLibrary.readonly", [["support.constant"]]);
    registerTokenStyleDefault("property.defaultLibrary", [["support.variable.property"]]);
    registerTokenStyleDefault("property.defaultLibrary.readonly", [["support.constant.property"]]);
    registerTokenStyleDefault("function.defaultLibrary", [["support.function"]]);
    registerTokenStyleDefault("member.defaultLibrary", [["support.function"]]);
    return registry;
}
