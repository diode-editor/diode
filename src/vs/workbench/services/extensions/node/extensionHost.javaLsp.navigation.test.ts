import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    provideDeclarations,
    provideDefinitions,
    provideImplementations,
    provideTypeDefinitions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { JDK_MISSING, SHAPES_JAVA } from "../../../../../TestUtils/javaFixture.ts";
import { type IJavaSuite, openJavaSuite, waitForStandardServer } from "../../../../../TestUtils/javaHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import type { ICoreDefinitionLocation } from "../../../../editor/common/languages/iDefinitionSource.ts";

let suite: IJavaSuite;

const fileAndLine = (target: ICoreDefinitionLocation): string =>
    `${path.basename(Uri.parse(target.uri).fsPath)}:${target.range.start.line}`;

/** The server answers empty while it works on the project, fast: that is its answer, not a lost request. */
async function nonEmpty(
    what: string,
    provide: () => Promise<readonly ICoreDefinitionLocation[]>,
): Promise<readonly ICoreDefinitionLocation[]> {
    return until(
        what,
        async () => {
            const found = await provide();
            return found.length > 0 ? found : null;
        },
        60_000,
    );
}

describe.skipIf(MARKETPLACE_OFFLINE || JDK_MISSING)("ExtensionHost — stock redhat.java: navigation", () => {
    beforeAll(async () => {
        suite = await openJavaSuite({
            sources: SHAPES_JAVA,
            open: ["Circle.java", "Shape.java", "Drawing.java"],
        });
        await waitForStandardServer(suite, "Shape.java", 2, 19);
    }, 400_000);

    afterAll(async () => {
        await suite.dispose();
    });

    it("implementations of an interface method are the methods of both classes", { timeout: 120_000 }, async () => {
        // `double area();` in Shape.java.
        const targets = await nonEmpty("the implementations", () =>
            provideImplementations(suite.harness, suite.at("Shape.java", 3, 11)),
        );
        expect(targets.map(fileAndLine).sort()).toEqual(["Circle.java:4", "Square.java:4"]);
    });

    it("the type definition of a field is the file of its type", { timeout: 120_000 }, async () => {
        // `shape` in `return shape.area();` of Drawing.java.
        const targets = await nonEmpty("the type definition", () =>
            provideTypeDefinitions(suite.harness, suite.at("Drawing.java", 9, 16)),
        );
        expect(targets.map(fileAndLine)).toEqual(["Shape.java:2"]);
    });

    it(
        "the declaration of an override is the interface method, its definition is the override",
        { timeout: 120_000 },
        async () => {
            // `area` in `public double area()` of Circle.java. JDT's own distinction.
            const declarations = await nonEmpty("the declaration", () =>
                provideDeclarations(suite.harness, suite.at("Circle.java", 4, 20)),
            );
            expect(declarations.map(fileAndLine)).toEqual(["Shape.java:3"]);
            const definitions = await provideDefinitions(suite.harness, suite.at("Circle.java", 4, 20));
            expect(definitions.map(fileAndLine)).toEqual(["Circle.java:4"]);
        },
    );

    it(
        "occurrences of a field: the writes and the read have their kinds, on the view state",
        { timeout: 120_000 },
        async () => {
            const editor = suite.editorOf("Drawing.java");
            // `count` in `count = 1;`.
            editor.viewState.selections = [createCursorSelection(7, 9)];
            // JDT counts the declaration of a field as a write.
            await waitUntil(
                "the highlights from the server",
                () => {
                    suite.frame();
                    return editor.viewState.wordHighlights.write.length > 0;
                },
                60_000,
            );
            const lines = (ranges: readonly { readonly start: { readonly line: number } }[]): number[] =>
                ranges.map((range) => range.start.line).sort((a, b) => a - b);
            expect(lines(editor.viewState.wordHighlights.write)).toEqual([4, 7]);
            expect(lines(editor.viewState.wordHighlights.read)).toEqual([8]);
        },
    );

    it("the server has neither linked editing nor document links", () => {
        const editor = suite.editorOf("Drawing.java");
        expect(suite.harness.languageFeatures.linkedEditingRangeProvider.has(editor)).toBe(false);
        expect(suite.harness.languageFeatures.documentLinkProvider.has(editor)).toBe(false);
    });
});
