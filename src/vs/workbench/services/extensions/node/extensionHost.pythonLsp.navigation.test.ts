import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    type IInstalledBasedpyright,
    installBasedpyright,
    until,
} from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    documentVersion,
    provideDeclarations,
    provideDefinitions,
    provideImplementations,
    provideTypeDefinitions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IPythonSession, withPythonFiles } from "../../../../../TestUtils/pythonSession.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";

const SHAPES_PY = `from typing import overload


class Shape:
    def area(self) -> float:
        raise NotImplementedError


class Circle(Shape):
    def area(self) -> float:
        return 3.14


class Square(Shape):
    def area(self) -> float:
        return 1.0


@overload
def scale(value: int) -> int: ...
@overload
def scale(value: str) -> str: ...
def scale(value):
    return value
`;

const MAIN_PY = `from shapes import Circle, Shape, scale
from stubbed import Thing

shape = Circle()
print(shape)
shape = Circle()
scale(1)
Thing()


def measure(figure: Shape):
    return figure.area()
`;

const STUBBED_PY = "class Thing:\n    pass\n";
const STUBBED_PYI = "# stub\nclass Thing: ...\n";

const FILES = { "shapes.py": SHAPES_PY, "main.py": MAIN_PY, "stubbed.py": STUBBED_PY, "stubbed.pyi": STUBBED_PYI };

interface ITarget {
    readonly file: string;
    readonly line: number;
    readonly character: number;
}

let installed: IInstalledBasedpyright;

function targets(locations: readonly { uri: string; range: { start: { line: number; character: number } } }[]) {
    return locations.map(
        ({ uri, range }): ITarget => ({
            file: uri.slice(uri.lastIndexOf("/") + 1),
            line: range.start.line,
            character: range.start.character,
        }),
    );
}

function fileIn({ harness }: IPythonSession, name: string): string {
    return `${harness.tmpDir}/${name}`;
}

/** The request at a position of an open file. */
function at(session: IPythonSession, name: string, line: number, character: number) {
    const uri = Uri.file(fileIn(session, name)).toString();
    return { uri, languageId: "python", versionId: documentVersion(session.harness, uri), line, character };
}

/** The server may still be indexing: an early answer lacks what it finds later. */
async function expectTargets(
    ask: () => Promise<readonly { uri: string; range: { start: { line: number; character: number } } }[]>,
    expected: readonly ITarget[],
): Promise<void> {
    await expect.poll(async () => targets(await ask()), { timeout: 120_000, interval: 500 }).toEqual(expected);
}

describe.skipIf(MARKETPLACE_OFFLINE)(
    "ExtensionHost — navigation from the stock basedpyright",
    { timeout: 240_000 },
    () => {
        beforeAll(async () => {
            installed = await installBasedpyright();
        }, 120_000);

        afterAll(() => {
            installed.dispose();
        });

        // The server lists the base method too, on the method itself and on a call through the base type.
        it("implementations of a base method: the method and both overrides", async () => {
            await withPythonFiles(installed, FILES, async (session) => {
                session.harness.group.openFile(fileIn(session, "shapes.py"));
                const expected = [
                    { file: "shapes.py", line: 4, character: 8 },
                    { file: "shapes.py", line: 9, character: 8 },
                    { file: "shapes.py", line: 14, character: 8 },
                ];
                await expectTargets(
                    () => provideImplementations(session.harness, at(session, "shapes.py", 4, 8)),
                    expected,
                );
                await expectTargets(
                    () => provideImplementations(session.harness, at(session, "main.py", 11, 18)),
                    expected,
                );
            });
        });

        it("type definition of a variable is its class", async () => {
            await withPythonFiles(installed, FILES, async (session) => {
                await expectTargets(
                    () => provideTypeDefinitions(session.harness, at(session, "main.py", 3, 0)),
                    [{ file: "shapes.py", line: 8, character: 6 }],
                );
            });
        });

        // Not the `import` line: the server resolves an imported name through it, in both requests. The two differ only
        // when a stub exists: definition prefers the source, declaration the stub.
        it("declaration and definition go past the import, and split on a stub", async () => {
            await withPythonFiles(installed, FILES, async (session) => {
                const onImport = { file: "shapes.py", line: 8, character: 6 };
                await expectTargets(
                    () => provideDeclarations(session.harness, at(session, "main.py", 0, 19)),
                    [onImport],
                );
                await expectTargets(
                    () => provideDefinitions(session.harness, at(session, "main.py", 0, 19)),
                    [onImport],
                );
                await expectTargets(
                    () => provideDeclarations(session.harness, at(session, "main.py", 7, 0)),
                    [{ file: "stubbed.pyi", line: 1, character: 6 }],
                );
                await expectTargets(
                    () => provideDefinitions(session.harness, at(session, "main.py", 7, 0)),
                    [{ file: "stubbed.py", line: 0, character: 6 }],
                );
            });
        });

        // On a call the server picks the implementation alone; every overload comes from the name of a declaration.
        it("definition of an overloaded function: all of them on the declaration, one on a call", async () => {
            await withPythonFiles(installed, FILES, async (session) => {
                session.harness.group.openFile(fileIn(session, "shapes.py"));
                await expectTargets(
                    () => provideDefinitions(session.harness, at(session, "shapes.py", 19, 4)),
                    [
                        { file: "shapes.py", line: 19, character: 4 },
                        { file: "shapes.py", line: 21, character: 4 },
                        { file: "shapes.py", line: 22, character: 4 },
                    ],
                );
                await expectTargets(
                    () => provideDefinitions(session.harness, at(session, "main.py", 6, 0)),
                    [{ file: "shapes.py", line: 22, character: 4 }],
                );
            });
        });

        it("definition of a variable assigned twice has both targets", async () => {
            await withPythonFiles(installed, FILES, async (session) => {
                await expectTargets(
                    () => provideDefinitions(session.harness, at(session, "main.py", 4, 6)),
                    [
                        { file: "main.py", line: 3, character: 0 },
                        { file: "main.py", line: 5, character: 0 },
                    ],
                );
            });
        });

        it("occurrences at the caret split into reads and writes on the editor", async () => {
            await withPythonFiles(installed, FILES, async (session) => {
                const editor = session.activeEditor();
                await until("the highlight provider", () =>
                    session.harness.languageFeatures.documentHighlightProvider.has(editor) ? true : null,
                );
                editor.viewState.selections = [createCursorSelection(4, 6)];
                await until("the occurrences", () => {
                    session.frame();
                    return editor.viewState.wordHighlights.write.length === 2 ? true : null;
                });
                expect(editor.viewState.wordHighlights.read).toEqual([createRange(4, 6, 4, 11)]);
                expect(editor.viewState.wordHighlights.write).toEqual([
                    createRange(3, 0, 3, 5),
                    createRange(5, 0, 5, 5),
                ]);
            });
        });

        it("call hierarchy of a function: the caller, and what the caller calls", async () => {
            await withPythonFiles(installed, FILES, async (session) => {
                const editor = session.activeEditor();
                const provider = await until(
                    "the call hierarchy provider",
                    () => session.harness.languageFeatures.callHierarchyProvider.ordered(editor).at(0) ?? null,
                );
                const prepared = await until("the prepared item", async () => {
                    const answer = await provider.prepareCallHierarchy(
                        at(session, "main.py", 11, 18),
                        CancellationTokenNone,
                    );
                    return answer !== null && answer.items.length > 0 ? answer : null;
                });
                const root = prepared.items[0];
                expect(root.name).toBe("area");
                const incoming = await until("the incoming calls", async () => {
                    const calls = await provider.provideIncomingCalls(
                        prepared.sessionId,
                        root.itemId,
                        CancellationTokenNone,
                    );
                    return calls.length > 0 ? calls : null;
                });
                expect(incoming.map((call) => call.from.name)).toEqual(["measure"]);

                const outgoing = await provider.provideOutgoingCalls(
                    prepared.sessionId,
                    incoming[0].from.itemId,
                    CancellationTokenNone,
                );
                expect(outgoing.map((call) => call.to.name)).toEqual(["area"]);
            });
        });

        it("the server has no linked editing, document links or type hierarchy", async () => {
            await withPythonFiles(installed, FILES, async (session) => {
                const editor = session.activeEditor();
                const features = session.harness.languageFeatures;
                // Registered from the same `initialize` answer as the absent three.
                await until("the registrations", () => features.definitionProvider.has(editor) || null);
                expect(features.linkedEditingRangeProvider.has(editor)).toBe(false);
                expect(features.documentLinkProvider.has(editor)).toBe(false);
                expect(features.typeHierarchyProvider.has(editor)).toBe(false);
            });
        });
    },
);
