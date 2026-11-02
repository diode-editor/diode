import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    type IInstalledBasedpyright,
    installBasedpyright,
    until,
} from "../../../../../TestUtils/basedpyrightFixture.ts";
import { documentVersion, provideDocumentSymbols } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { withPythonFiles } from "../../../../../TestUtils/pythonSession.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";

const MAIN_PY = `class Shape:
    def area(self):
        return 1


def measure(figure):
    return figure.area()
`;

let installed: IInstalledBasedpyright;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — symbols from the stock basedpyright", () => {
    beforeAll(async () => {
        installed = await installBasedpyright();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("document symbols form a tree of classes, methods and functions", { timeout: 240_000 }, async () => {
        await withPythonFiles(installed, { "main.py": MAIN_PY }, async ({ harness }) => {
            const uri = Uri.file(`${harness.tmpDir}/main.py`).toString();
            const symbols = await until("the document symbols", async () => {
                const found = await provideDocumentSymbols(harness, {
                    uri,
                    languageId: "python",
                    versionId: documentVersion(harness, uri),
                });
                return found.length > 0 ? found : null;
            });
            // `vscode.SymbolKind`, 0-based: Class 4, Method 5, Function 11, Variable 12.
            expect(symbols.map(({ name, kind }) => [name, kind])).toEqual([
                ["Shape", 4],
                ["measure", 11],
            ]);
            expect(symbols[0].children.map(({ name, kind }) => [name, kind])).toEqual([["area", 5]]);
            expect(symbols[1].selectionRange.start).toEqual({ line: 5, character: 4 });
        });
    });

    it("workspace symbols find a class in a file that is not open", { timeout: 240_000 }, async () => {
        const files = { "main.py": "print(1)\n", "other.py": "class Elsewhere:\n    pass\n" };
        await withPythonFiles(installed, files, async ({ harness }) => {
            const symbol = await until("the workspace symbol", async () => {
                for (const provider of harness.languageFeatures.workspaceSymbolProvider.all()) {
                    const found = await provider.provideWorkspaceSymbols("Elsewhere", CancellationTokenNone);
                    const match = found.find(({ name }) => name === "Elsewhere");
                    if (match !== undefined) return match;
                }
                return null;
            });
            expect(symbol.location.uri).toBe(Uri.file(`${harness.tmpDir}/other.py`).toString());
            expect(symbol.location.range?.start).toEqual({ line: 0, character: 6 });
        });
    });
});
