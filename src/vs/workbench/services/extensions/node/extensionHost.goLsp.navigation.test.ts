import { Point } from "@tuidom/core/common/geometryPromitives";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { provideImplementations, provideTypeDefinitions } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { ensureGopls, goToolchainMissing, type IInstalledGo, installGo } from "../../../../../TestUtils/goFixture.ts";
import { openGoFile } from "../../../../../TestUtils/goLspSession.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { createCursorSelection, createSelection } from "../../../../editor/common/core/iSelection.ts";

// Go to Implementations, Type Definition and occurrences on the stock extension against the real gopls.

const skipReason = goToolchainMissing();
if (skipReason !== undefined) console.warn(skipReason);

let installed: IInstalledGo;
let gopls: string;

describe.skipIf(MARKETPLACE_OFFLINE || skipReason !== undefined)(
    "ExtensionHost — navigation of stock golang.go",
    () => {
        beforeAll(async () => {
            gopls = ensureGopls();
            installed = await installGo();
        }, 600_000);

        afterAll(() => {
            installed.dispose();
        });

        it(
            "Implementations: the interface method lists both methods, the interface lists both types",
            {
                timeout: 300_000,
            },
            async () => {
                const session = await openGoFile(installed, gopls, "greet/greeter.go");
                try {
                    const { harness, at, clientCrashes, uriOf } = session;
                    const lineOf = (needle: string): number => at(needle).line;

                    const methods = await provideImplementations(harness, at("Greet() string"));
                    expect(methods.map((target) => [target.uri, target.range.start.line]).sort()).toEqual(
                        [
                            [uriOf("greet/greeter.go"), lineOf("func (e English) Greet")],
                            [uriOf("greet/greeter.go"), lineOf("func (p Polite) Greet")],
                        ].sort(),
                    );

                    const types = await provideImplementations(harness, at("Greeter interface"));
                    expect(types.map((target) => target.range.start.line).sort()).toEqual(
                        [lineOf("type English struct"), lineOf("type Polite struct")].sort(),
                    );
                    expect(clientCrashes()).toEqual([]);
                } finally {
                    await session.harness.dispose();
                }
            },
        );

        it(
            "Type Definition: a variable goes to its struct; a selection reaches gopls through the middleware's range",
            {
                timeout: 300_000,
            },
            async () => {
                const session = await openGoFile(installed, gopls, "greet/greeter.go");
                try {
                    const { harness, editor, at, clientCrashes } = session;
                    const lineOf = (needle: string): number => at(needle).line;
                    const pairAt = at("pair.Second");

                    const plain = await provideTypeDefinitions(harness, pairAt);
                    expect(plain.map((target) => target.range.start.line)).toEqual([lineOf("type Pair struct")]);

                    // At the same position, `pair` alone is a Pair: only the selected expression can answer Polite.
                    editor.viewState.selections = [
                        createSelection(
                            pairAt.line,
                            pairAt.character,
                            pairAt.line,
                            pairAt.character + "pair.Second".length,
                        ),
                    ];
                    const selected = await until("the type of the selected expression", async () => {
                        const targets = await provideTypeDefinitions(harness, at("pair.Second"));
                        return targets[0]?.range.start.line === lineOf("type Polite struct") ? targets : null;
                    });
                    expect(selected).toHaveLength(1);
                    expect(clientCrashes()).toEqual([]);
                } finally {
                    await session.harness.dispose();
                }
            },
        );

        it("occurrences: writes and reads of x in their own colors on the frame", { timeout: 300_000 }, async () => {
            const session = await openGoFile(installed, gopls, "greet/greeter.go");
            try {
                const { harness, editor, at, frame, clientCrashes } = session;
                await waitUntil("the provider", () => harness.languageFeatures.documentHighlightProvider.has(editor));
                const declaration = at("x := 1");
                editor.viewState.scrollTop = declaration.line - 1;
                const bgOf = (needle: string, offset: number): number | undefined => {
                    const rows = frame().split("\n");
                    const y = rows.findIndex((row) => row.includes(needle));
                    return harness.app.backend.getBgAt(new Point(rows[y].indexOf(needle) + offset, y));
                };
                const plain = bgOf("x := 1", 3);

                await until("the highlights of x", () => {
                    // gopls is still loading on the first queries: each new cursor position asks again.
                    editor.viewState.selections = [createCursorSelection(declaration.line, declaration.character + 1)];
                    editor.viewState.selections = [createCursorSelection(declaration.line, declaration.character)];
                    frame();
                    return Promise.resolve(editor.viewState.wordHighlights.read.length > 0 ? true : null);
                });

                const { read, write } = editor.viewState.wordHighlights;
                expect(write.map((range) => range.start.line)).toEqual([at("x := 1").line, at("x = 2").line]);
                expect(read.map((range) => range.start.line)).toEqual([at("g.Greet(), x").line, at("return x").line]);
                const writeColor = bgOf("x = 2", 0);
                const readColor = bgOf("return x", "return ".length);
                expect(writeColor).not.toBe(plain);
                expect(readColor).not.toBe(plain);
                expect(writeColor).not.toBe(readColor);
                expect(clientCrashes()).toEqual([]);
            } finally {
                await session.harness.dispose();
            }
        });
    },
);
