import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { documentVersion, provideDocumentSymbols } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    buildTypescriptLspExtension,
    type ITypescriptLspFixture,
    openInTypescriptLsp,
} from "../../../../../TestUtils/typescriptLspFixture.ts";

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
    }, 180_000);

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
