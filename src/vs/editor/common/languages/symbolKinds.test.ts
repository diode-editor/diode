import { describe, expect, it } from "vitest";

import { CODICON_GLYPHS } from "../../../base/common/codicons.generated.ts";
import { CODICON_UNICODE } from "../../../base/common/codiconsUnicode.ts";

import { SymbolKind, symbolKindCodicon, symbolKindGroup } from "./symbolKinds.ts";

describe("symbolKindCodicon", () => {
    it("maps every kind to its own existing codicon, with a Unicode fallback", () => {
        const icons = Object.values(SymbolKind).map(symbolKindCodicon);
        expect(new Set(icons).size).toBe(26);
        for (const icon of icons) {
            expect(CODICON_GLYPHS, icon).toHaveProperty([icon]);
            expect(CODICON_UNICODE[icon], icon).toBeTruthy();
        }
    });

    it("matches upstream on representative kinds, and an unknown kind is a property", () => {
        expect(symbolKindCodicon(SymbolKind.File)).toBe("symbol-file");
        expect(symbolKindCodicon(SymbolKind.Class)).toBe("symbol-class");
        expect(symbolKindCodicon(SymbolKind.Method)).toBe("symbol-method");
        expect(symbolKindCodicon(SymbolKind.EnumMember)).toBe("symbol-enum-member");
        expect(symbolKindCodicon(SymbolKind.TypeParameter)).toBe("symbol-type-parameter");
        expect(symbolKindCodicon(99)).toBe("symbol-property");
    });
});

describe("symbolKindGroup", () => {
    it.each([
        [SymbolKind.Method, "methods"],
        [SymbolKind.Function, "functions"],
        [SymbolKind.Constructor, "constructors"],
        [SymbolKind.Variable, "variables"],
        [SymbolKind.Class, "classes"],
        [SymbolKind.Struct, "structs"],
        [SymbolKind.Event, "events"],
        [SymbolKind.Operator, "operators"],
        [SymbolKind.Interface, "interfaces"],
        [SymbolKind.Namespace, "namespaces"],
        [SymbolKind.Package, "packages"],
        [SymbolKind.TypeParameter, "type parameters"],
        [SymbolKind.Module, "modules"],
        [SymbolKind.Property, "properties"],
        [SymbolKind.Enum, "enumerations"],
        [SymbolKind.EnumMember, "enumeration members"],
        [SymbolKind.String, "strings"],
        [SymbolKind.File, "files"],
        [SymbolKind.Array, "arrays"],
        [SymbolKind.Number, "numbers"],
        [SymbolKind.Boolean, "booleans"],
        [SymbolKind.Object, "objects"],
        [SymbolKind.Key, "keys"],
        [SymbolKind.Field, "fields"],
        [SymbolKind.Constant, "constants"],
    ])("kind %i is %s", (kind, group) => {
        expect(symbolKindGroup(kind)).toBe(group);
    });

    it("Null and unknown kinds fall back to properties, as upstream", () => {
        expect(symbolKindGroup(SymbolKind.Null)).toBe("properties");
        expect(symbolKindGroup(99)).toBe("properties");
    });
});
