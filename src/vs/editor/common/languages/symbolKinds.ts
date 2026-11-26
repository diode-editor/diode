/** upstream `languages.SymbolKind`; the numbers are the ones `vscode.SymbolKind` has. */
export const SymbolKind = {
    File: 0,
    Module: 1,
    Namespace: 2,
    Package: 3,
    Class: 4,
    Method: 5,
    Property: 6,
    Field: 7,
    Constructor: 8,
    Enum: 9,
    Interface: 10,
    Function: 11,
    Variable: 12,
    Constant: 13,
    String: 14,
    Number: 15,
    Boolean: 16,
    Array: 17,
    Object: 18,
    Key: 19,
    Null: 20,
    EnumMember: 21,
    Struct: 22,
    Event: 23,
    Operator: 24,
    TypeParameter: 25,
} as const;

export const SymbolTagDeprecated = 1;

/** upstream `SymbolKinds.toIcon`, indexed by kind. */
const SYMBOL_KIND_CODICONS: readonly string[] = [
    "symbol-file",
    "symbol-module",
    "symbol-namespace",
    "symbol-package",
    "symbol-class",
    "symbol-method",
    "symbol-property",
    "symbol-field",
    "symbol-constructor",
    "symbol-enum",
    "symbol-interface",
    "symbol-function",
    "symbol-variable",
    "symbol-constant",
    "symbol-string",
    "symbol-number",
    "symbol-boolean",
    "symbol-array",
    "symbol-object",
    "symbol-key",
    "symbol-null",
    "symbol-enum-member",
    "symbol-struct",
    "symbol-event",
    "symbol-operator",
    "symbol-type-parameter",
];

export function symbolKindCodicon(kind: number): string {
    return SYMBOL_KIND_CODICONS[kind] ?? "symbol-property";
}

/** upstream `FALLBACK_NLS_SYMBOL_KIND`: `Null` and unknown kinds count as properties. */
const FALLBACK_GROUP = "properties";

const SYMBOL_KIND_GROUPS: Readonly<Record<number, string>> = {
    [SymbolKind.Method]: "methods",
    [SymbolKind.Function]: "functions",
    [SymbolKind.Constructor]: "constructors",
    [SymbolKind.Variable]: "variables",
    [SymbolKind.Class]: "classes",
    [SymbolKind.Struct]: "structs",
    [SymbolKind.Event]: "events",
    [SymbolKind.Operator]: "operators",
    [SymbolKind.Interface]: "interfaces",
    [SymbolKind.Namespace]: "namespaces",
    [SymbolKind.Package]: "packages",
    [SymbolKind.TypeParameter]: "type parameters",
    [SymbolKind.Module]: "modules",
    [SymbolKind.Property]: "properties",
    [SymbolKind.Enum]: "enumerations",
    [SymbolKind.EnumMember]: "enumeration members",
    [SymbolKind.String]: "strings",
    [SymbolKind.File]: "files",
    [SymbolKind.Array]: "arrays",
    [SymbolKind.Number]: "numbers",
    [SymbolKind.Boolean]: "booleans",
    [SymbolKind.Object]: "objects",
    [SymbolKind.Key]: "keys",
    [SymbolKind.Field]: "fields",
    [SymbolKind.Constant]: "constants",
};

/** The separator name of the `@:` grouping, without the count. */
export function symbolKindGroup(kind: number): string {
    return SYMBOL_KIND_GROUPS[kind] ?? FALLBACK_GROUP;
}
