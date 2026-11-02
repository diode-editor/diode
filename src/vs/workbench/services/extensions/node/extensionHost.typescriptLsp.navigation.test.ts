import { Point } from "@tuidom/core/common/geometryPromitives";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    documentVersion,
    type IExtensionHarness,
    provideDefinitions,
    provideImplementations,
    provideTypeDefinitions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { buildTypescriptLspExtension, openInTypescriptLsp } from "../../../../../TestUtils/typescriptLspFixture.ts";
import { assertReturnsDefined } from "../../../../base/common/assert.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import type { ICoreDefinitionLocation } from "../../../../editor/common/languages/iDefinitionSource.ts";
import { FeatureDebounce } from "../../../../editor/common/services/languageFeatureDebounce.ts";
import { LinkedEditingController } from "../../../../editor/contrib/linkedEditing/browser/linkedEditingController.ts";

const HIGHLIGHT_TS = "let x = 1; x = 2; console.log(x); const obj = { x: 3 }; console.log(obj.x);\n";
const TAG_TSX = "export const tag = <div></div>;\n";

const SOURCES: Record<string, string> = {
    "shapes.ts": `export interface Shape {
    area(): number;
}
export class Circle implements Shape {
    area(): number { return 3; }
}
export class Square implements Shape {
    area(): number { return 4; }
}
export interface Solo {
    only(): void;
}
export class TheOne implements Solo {
    only(): void {}
}
export const shape: Shape = new Circle();
`,
    "overloads.ts": `export function f(a: string): void;
export function f(a: number): void;
export function f(a: unknown) {}
`,
    "consumer.ts": 'import { f } from "./overloads";\nf("x");\n',
    "highlight.ts": HIGHLIGHT_TS,
    "calls.ts": `function greet() {
    helper();
}
function helper() {}
function first() {
    greet();
}
function second() {
    greet();
}
`,
    "tag.tsx": TAG_TSX,
};

const startLines = (locations: readonly ICoreDefinitionLocation[]): number[] =>
    locations.map((location) => location.range.start.line).sort((a, b) => a - b);
const nonEmpty = (locations: readonly ICoreDefinitionLocation[]): readonly ICoreDefinitionLocation[] | null =>
    locations.length > 0 ? locations : null;

/** One server for the suite: tsserver loads the project once, and each test asks about its own file. */
describe("ExtensionHost — navigation from the stock typescript-language-server", () => {
    let harness: IExtensionHarness;
    const paths = new Map<string, string>();

    const open = (name: string) => {
        harness.group.openFile(assertReturnsDefined(paths.get(name)));
        return assertReturnsDefined(harness.group.getActiveEditor());
    };
    const at = (editor: ReturnType<typeof open>, line: number, character: number) => {
        const uri = editor.uri.toString();
        return { uri, languageId: editor.languageId, versionId: documentVersion(harness, uri), line, character };
    };

    beforeAll(async () => {
        await buildTypescriptLspExtension();
        ({ harness } = await openInTypescriptLsp("shapes.ts", SOURCES["shapes.ts"]));
        for (const [name, content] of Object.entries(SOURCES)) paths.set(name, harness.writeFile(name, content));
    }, 180_000);

    afterAll(async () => {
        await harness.dispose();
    });

    it(
        "implementations: both classes of one interface, the single class of another",
        { timeout: 120_000 },
        async () => {
            const editor = open("shapes.ts");
            const two = await until("two implementations", async () =>
                nonEmpty(await provideImplementations(harness, at(editor, 1, 4))),
            );
            expect(startLines(two)).toEqual([4, 7]);

            expect(startLines(await provideImplementations(harness, at(editor, 10, 4)))).toEqual([13]);
        },
    );

    it("type definition of a variable lands on its interface", { timeout: 120_000 }, async () => {
        const editor = open("shapes.ts");
        const found = await until("the type definition", async () =>
            nonEmpty(await provideTypeDefinitions(harness, at(editor, 15, 13))),
        );
        expect(startLines(found)).toEqual([0]);
    });

    it("definition of an overloaded function has three targets", { timeout: 120_000 }, async () => {
        const editor = open("consumer.ts");
        // On the import: at a call site tsserver answers with the one resolved overload.
        const found = await until("the overloads", async () =>
            nonEmpty(await provideDefinitions(harness, at(editor, 0, 9))),
        );
        expect(startLines(found)).toEqual([0, 1, 2]);
    });

    it(
        "occurrences: writes and reads in two colors, the field of the same name is plain",
        { timeout: 120_000 },
        async () => {
            const editor = open("highlight.ts");
            const bgAt = (character: number): number | undefined => {
                harness.app.render();
                const screen = harness.app.backend.screenToString().split("\n");
                const y = screen.findIndex((line) => line.includes("let x"));
                return harness.app.backend.getBgAt(new Point(screen[y].indexOf("let x") + character, y));
            };
            const plain = bgAt(2);
            await waitUntil(
                "the provider",
                () => harness.languageFeatures.documentHighlightProvider.has(editor),
                60_000,
            );
            editor.viewState.selections = [createCursorSelection(0, 4)];
            // Only the server tells a write from a read: the textual fallback has no writes at all.
            await waitUntil(
                "the server's highlights",
                () => {
                    harness.app.render();
                    return editor.viewState.wordHighlights.write.length === 2;
                },
                60_000,
            );

            const write = bgAt(HIGHLIGHT_TS.indexOf("x = 1"));
            const read = bgAt(HIGHLIGHT_TS.indexOf("log(x)") + 4);
            expect(write).not.toBe(plain);
            expect(read).not.toBe(plain);
            expect(read).not.toBe(write);
            expect(bgAt(HIGHLIGHT_TS.indexOf("x = 2"))).toBe(write);
            expect(bgAt(HIGHLIGHT_TS.indexOf("x: 3"))).toBe(plain);
            expect(bgAt(HIGHLIGHT_TS.indexOf("obj.x") + 4)).toBe(plain);
        },
    );

    it(
        "linked editing: the capability reaches the server, a JSX tag rewrites its pair",
        { timeout: 120_000 },
        async () => {
            const editor = open("tag.tsx");
            const controller = new LinkedEditingController(editor, {
                providers: harness.languageFeatures.linkedEditingRangeProvider,
                isSettingEnabled: () => true,
                languageWordPattern: () => undefined,
                debounce: new FeatureDebounce(50, 200),
            });
            try {
                await waitUntil(
                    "the provider",
                    () => harness.languageFeatures.linkedEditingRangeProvider.has(editor),
                    60_000,
                );
                editor.viewState.selections = [createCursorSelection(0, TAG_TSX.indexOf("div") + 1)];
                await waitUntil(
                    "the linked ranges",
                    () => {
                        controller.reinitialize(false);
                        return editor.viewState.linkedEditingRanges.length === 2;
                    },
                    60_000,
                );
                editor.pushUndo(editor.viewState.type("x"));
                await waitUntil("the mirror", () =>
                    editor.viewState.document.getLineContent(0).includes("<dxiv></dxiv>"),
                );
            } finally {
                controller.dispose();
            }
        },
    );

    it("call hierarchy: two callers of a function and what it calls", { timeout: 120_000 }, async () => {
        const editor = open("calls.ts");
        await waitUntil("the provider", () => harness.languageFeatures.callHierarchyProvider.has(editor), 60_000);
        const [provider] = harness.languageFeatures.callHierarchyProvider.ordered(editor);
        const session = await until("the root item", () =>
            provider.prepareCallHierarchy(at(editor, 0, 9), CancellationTokenNone),
        );
        expect(session.items.map((item) => item.name)).toEqual(["greet"]);
        const root = session.items[0].itemId;

        const callers = await provider.provideIncomingCalls(session.sessionId, root, CancellationTokenNone);
        expect(callers.map((call) => call.from.name).sort()).toEqual(["first", "second"]);
        const callees = await provider.provideOutgoingCalls(session.sessionId, root, CancellationTokenNone);
        expect(callees.map((call) => call.to.name)).toEqual(["helper"]);
    });

    it("what the server does not offer stays unregistered", { timeout: 120_000 }, async () => {
        const editor = open("shapes.ts");
        // Comes from the same capabilities answer as the rest.
        await waitUntil("the capabilities", () => harness.languageFeatures.implementationProvider.has(editor), 60_000);
        expect(harness.languageFeatures.declarationProvider.has(editor)).toBe(false);
        expect(harness.languageFeatures.typeHierarchyProvider.has(editor)).toBe(false);
        expect(harness.languageFeatures.onTypeFormattingEditProvider.has(editor)).toBe(false);
        expect(harness.languageFeatures.documentLinkProvider.has(editor)).toBe(false);
    });
});
