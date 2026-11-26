import { Point } from "@tuidom/core/common/geometryPromitives";
import { expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { provideImplementations, provideTypeDefinitions } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { describeStockGo } from "../../../../../TestUtils/goLspSession.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { createCursorSelection, createSelection } from "../../../../editor/common/core/iSelection.ts";

// Go to Implementations, Type Definition and occurrences on the stock extension against the real gopls.

const TIMEOUT = { timeout: 300_000 };

describeStockGo("ExtensionHost — navigation of stock golang.go", (withGoFile) => {
    it("Implementations: the interface method lists both methods, the interface lists both types", TIMEOUT, () =>
        withGoFile(async ({ harness, at, clientCrashes }) => {
            const lineOf = (needle: string): number => at(needle).line;
            const request = at("Greet() string");

            const methods = await provideImplementations(harness, request);
            expect(methods.map((target) => [target.uri, target.range.start.line]).sort()).toEqual(
                [
                    [request.uri, lineOf("func (e English) Greet")],
                    [request.uri, lineOf("func (p Polite) Greet")],
                ].sort(),
            );

            const types = await provideImplementations(harness, at("Greeter interface"));
            expect(types.map((target) => target.range.start.line).sort()).toEqual(
                [lineOf("type English struct"), lineOf("type Polite struct")].sort(),
            );
            expect(clientCrashes()).toEqual([]);
        }),
    );

    it(
        "Type Definition: a variable goes to its struct; a selection reaches gopls through the middleware's range",
        TIMEOUT,
        () =>
            withGoFile(async ({ harness, editor, at, clientCrashes }) => {
                const pairAt = at("pair.Second");

                const plain = await provideTypeDefinitions(harness, pairAt);
                expect(plain.map((target) => target.range.start.line)).toEqual([at("type Pair struct").line]);

                // At the same position, `pair` alone is a Pair: only the selected expression can answer Polite.
                editor.viewState.selections = [
                    createSelection(
                        pairAt.line,
                        pairAt.character,
                        pairAt.line,
                        pairAt.character + "pair.Second".length,
                    ),
                ];
                const politeLine = at("type Polite struct").line;
                const selected = await until("the type of the selected expression", async () => {
                    const targets = await provideTypeDefinitions(harness, pairAt);
                    return targets[0]?.range.start.line === politeLine ? targets : null;
                });
                expect(selected).toHaveLength(1);
                expect(clientCrashes()).toEqual([]);
            }),
    );

    it("occurrences: writes and reads of x in their own colors on the frame", TIMEOUT, () =>
        withGoFile(async ({ harness, editor, at, frame, clientCrashes }) => {
            const declaration = at("x := 1");
            editor.viewState.scrollTop = declaration.line - 1;
            const bgOf = (needle: string, offset: number): number | undefined => {
                const rows = frame().split("\n");
                const y = rows.findIndex((row) => row.includes(needle));
                return harness.app.backend.getBgAt(new Point(rows[y].indexOf(needle) + offset, y));
            };
            const plain = bgOf("x := 1", 3);

            editor.viewState.selections = [createCursorSelection(declaration.line, declaration.character)];
            await waitUntil("the highlights of x", () => {
                frame();
                return editor.viewState.wordHighlights.read.length > 0;
            });

            const { read, write } = editor.viewState.wordHighlights;
            expect(write.map((range) => range.start.line)).toEqual([declaration.line, at("x = 2").line]);
            expect(read.map((range) => range.start.line)).toEqual([at("g.Greet(), x").line, at("return x").line]);
            const writeColor = bgOf("x = 2", 0);
            const readColor = bgOf("return x", "return ".length);
            expect(writeColor).not.toBe(plain);
            expect(readColor).not.toBe(plain);
            expect(writeColor).not.toBe(readColor);
            expect(clientCrashes()).toEqual([]);
        }),
    );
});
