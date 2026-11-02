import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    type IExtensionHarness,
    provideDocumentSymbols,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { SymbolKind, SymbolTagDeprecated } from "../../../../editor/common/languages/symbolKinds.ts";
import { flattenDocumentSymbols } from "../../../contrib/quickaccess/browser/gotoSymbolQuickAccessProvider.ts";

const LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => {
        if (filePath.endsWith(".ts")) return "typescript";
        return filePath.endsWith(".py") ? "python" : undefined;
    },
    getLanguageDisplayName: () => undefined,
};

function startHarness(name: string): Promise<IExtensionHarness> {
    return createExtensionTestHarness({
        initialFile: { name, content: "line\n".repeat(12) },
        extensions: [extensionFixture("test.providesDocumentSymbols", "providesDocumentSymbols.cjs")],
        languageService: LANGUAGE_SERVICE,
    });
}

describe("ExtensionHost — document symbol provider (subprocess)", () => {
    it("a DocumentSymbol tree arrives whole: names, kinds, tags, ranges and children", async () => {
        const harness = await startHarness("main.ts");
        try {
            const uri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            const symbols = await provideDocumentSymbols(harness, {
                uri,
                languageId: "typescript",
                versionId: documentVersion(harness, uri),
            });
            expect(symbols).toEqual([
                {
                    name: "Foo",
                    detail: "class",
                    kind: SymbolKind.Class,
                    tags: [],
                    range: createRange(0, 0, 9, 1),
                    selectionRange: createRange(0, 6, 0, 9),
                    children: [
                        {
                            name: "paint",
                            detail: "",
                            kind: SymbolKind.Method,
                            tags: [SymbolTagDeprecated],
                            range: createRange(1, 4, 3, 5),
                            selectionRange: createRange(1, 4, 1, 9),
                            children: [],
                        },
                        {
                            name: "layout",
                            detail: "",
                            kind: SymbolKind.Method,
                            tags: [],
                            range: createRange(5, 4, 8, 5),
                            selectionRange: createRange(5, 4, 5, 10),
                            children: [],
                        },
                    ],
                },
            ]);
            expect(flattenDocumentSymbols(symbols).map((symbol) => symbol.name)).toEqual(["Foo", "paint", "layout"]);
        } finally {
            await harness.dispose();
        }
    });

    it("a flat SymbolInformation answer is nested by range containment, both constructors work", async () => {
        const harness = await startHarness("main.py");
        try {
            const uri = Uri.file(`${harness.tmpDir}/main.py`).toString();
            const symbols = await provideDocumentSymbols(harness, {
                uri,
                languageId: "python",
                versionId: documentVersion(harness, uri),
            });
            expect(symbols.map((symbol) => symbol.name)).toEqual(["Klass", "after"]);
            expect(symbols[0].children.map((symbol) => symbol.name)).toEqual(["method"]);
            expect(symbols[0].children[0].containerName).toBe("Klass");
            expect(symbols[0].selectionRange).toEqual(createRange(0, 0, 3, 0));
            expect(symbols[1].containerName).toBe("");
        } finally {
            await harness.dispose();
        }
    });
});
