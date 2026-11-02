import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { documentVersion, provideDocumentSymbols } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    buildTypescriptLspExtension,
    type ITypescriptLspFixture,
    openInTypescriptLsp,
} from "../../../../../TestUtils/typescriptLspFixture.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";

const SHAPES_TS = `export class Circle {
    radius = 1;
    area(): number { return 3; }
}
export function greet(): void {}
`;

describe("ExtensionHost — symbols from the stock typescript-language-server", () => {
    let fixture: ITypescriptLspFixture;

    beforeAll(async () => {
        await buildTypescriptLspExtension();
        fixture = await openInTypescriptLsp("shapes.ts", SHAPES_TS);
        fixture.harness.writeFile("other.ts", "export function farewell(): void {}\n");
    }, 180_000);

    it("#: a symbol from a file that is not open", { timeout: 120_000 }, async () => {
        const providers = fixture.harness.languageFeatures.workspaceSymbolProvider;
        const found = await until("the workspace symbol", async () => {
            // Comes up after the first probes.
            const provider = providers.all().at(0);
            if (provider === undefined) return null;
            const symbols = await provider.provideWorkspaceSymbols("farewell", CancellationTokenNone);
            return symbols.length > 0 ? symbols : null;
        });

        expect(found.map((symbol) => symbol.name)).toEqual(["farewell"]);
        expect(found[0].location.uri.endsWith("/other.ts")).toBe(true);
    });

    afterAll(async () => {
        await fixture.harness.dispose();
    });

    it("@: a class holds its members, a function stands beside it", { timeout: 120_000 }, async () => {
        const { harness, editor } = fixture;
        const uri = editor.uri.toString();
        const symbols = await until("the document symbols", async () => {
            const found = await provideDocumentSymbols(harness, {
                uri,
                languageId: editor.languageId,
                versionId: documentVersion(harness, uri),
            });
            return found.length > 0 ? found : null;
        });

        expect(symbols.map((symbol) => symbol.name)).toEqual(["Circle", "greet"]);
        expect(symbols[0].children.map((member) => member.name).sort()).toEqual(["area", "radius"]);
    });
});
