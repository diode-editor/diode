import { expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { writeCompileCommands } from "../../../../../TestUtils/clangdFixture.ts";
import { describeStockClangd, targets, WITH_INDEX } from "../../../../../TestUtils/clangdSession.ts";
import {
    provideCompletions,
    provideDefinitions,
    provideHovers,
    provideReferences,
    provideRename,
    provideSignatureHelp,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { CompletionTriggerKind } from "../../../../editor/common/languages/iCompletionSource.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";

// The stock vscode-clangd against the machine's clangd: the language client's features end to end. The visible
// part (squiggle, inlay hints on the frame, Alt+O, the AST tree) is in the marketplace smoke and the `clangd`
// scenario.

const TIMEOUT = { timeout: 240_000 };

const UNDECLARED_SCALE = "Use of undeclared identifier 'SHAPE_SCALE'";

describeStockClangd("ExtensionHost — stock vscode-clangd", (withCppFile) => {
    it("diagnostics, hover, completion and signature help on main.cpp", TIMEOUT, () =>
        withCppFile(async ({ harness, at, diagnostics, clientCrashes }) => {
            await until("the diagnostic for the string literal", () =>
                diagnostics("main.cpp")?.some((message) =>
                    message.includes("Cannot initialize a variable of type 'int'"),
                )
                    ? true
                    : null,
            );

            const hovers = await provideHovers(harness, at("total(square", 1));
            expect(hovers.flatMap((hover) => hover.contents).join("\n")).toContain(
                "double total(const Shape &a, const Shape &b)",
            );

            const completion = await provideCompletions(harness, {
                ...at("square.area", "square.".length),
                triggerKind: CompletionTriggerKind.TriggerCharacter,
                triggerCharacter: ".",
            });
            expect(completion.items.map((item) => item.label.trim())).toEqual(
                expect.arrayContaining([expect.stringContaining("area"), expect.stringContaining("side")]),
            );

            const help = await provideSignatureHelp(harness, {
                ...at("total(square", "total(".length),
                triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
                triggerCharacter: "(",
                isRetrigger: false,
            });
            expect(help?.signatures[0].label).toContain("total(const Shape &a, const Shape &b)");
            expect(help?.activeParameter).toBe(0);
            expect(clientCrashes()).toEqual([]);
        }),
    );

    it("with the background index F12 goes to the definition in shape.cpp, references reach every file", TIMEOUT, () =>
        withCppFile(async ({ harness, at, uriOf, clientCrashes }) => {
            // Only the declaration in shape.h is known until the background index has read shape.cpp.
            const definitions = await until("the definition of total in shape.cpp", async () => {
                const found = await provideDefinitions(harness, at("total(square", 1));
                return found.some((target) => target.uri === uriOf("shape.cpp")) ? found : null;
            });
            expect(targets(definitions)).toEqual([[uriOf("shape.cpp"), 4]]);

            const references = await provideReferences(harness, {
                ...at("total(square", 1),
                includeDeclaration: true,
            });
            expect(references.map((reference) => [reference.uri, reference.range.start.line]).sort()).toEqual(
                [
                    [uriOf("main.cpp"), 6],
                    [uriOf("shape.cpp"), 4],
                    [uriOf("shape.h"), 13],
                ].sort(),
            );
            expect(clientCrashes()).toEqual([]);
        }, WITH_INDEX),
    );

    it("rename of a local edits every use in the file", TIMEOUT, () =>
        withCppFile(async ({ harness, editor, at, clientCrashes }) => {
            const result = await provideRename(harness, at("square(2.0)"), "box");
            await settle();
            expect(result).toEqual({ applied: true });
            expect(editor.getText()).toContain("Square box(2.0);\n    double a = box.area();");
            expect(editor.getText()).toContain("total(box, box)");
            expect(clientCrashes()).toEqual([]);
        }),
    );

    it("clangd.switchheadersource opens the source of the header", TIMEOUT, () =>
        withCppFile(
            async ({ harness, uriOf }) => {
                await harness.commandRegistry.execute("clangd.switchheadersource");
                await until("shape.cpp in the editor", () =>
                    harness.group.getActiveEditor()?.uri.toString() === uriOf("shape.cpp") ? true : null,
                );
            },
            { file: "shape.h" },
        ),
    );

    it("without compile_commands.json clangd uses default flags: SHAPE_SCALE is undeclared", TIMEOUT, () =>
        withCppFile(
            async ({ diagnostics }) => {
                await until("the undeclared SHAPE_SCALE", () =>
                    diagnostics("scale.cpp")?.includes(UNDECLARED_SCALE) ? true : null,
                );
            },
            { file: "scale.cpp" },
        ),
    );

    it("compile_commands.json in the folder is picked up: its -D makes scale.cpp clean", TIMEOUT, () =>
        withCppFile(
            async ({ harness, at, diagnostics }) => {
                await until("diagnostics of scale.cpp", () => (diagnostics("scale.cpp")?.length === 0 ? true : null));
                const hovers = await provideHovers(harness, at("SHAPE_SCALE;", 1));
                expect(hovers.flatMap((hover) => hover.contents).join("\n")).toContain("#define SHAPE_SCALE 3");
            },
            { ...WITH_INDEX, file: "scale.cpp" },
        ),
    );

    it("clangd.arguments reaches the server, and clangd.restart applies a changed value", TIMEOUT, () =>
        withCppFile(
            async ({ harness, diagnostics }) => {
                await until("the undeclared SHAPE_SCALE before the argument", () =>
                    diagnostics("scale.cpp")?.includes(UNDECLARED_SCALE) ? true : null,
                );
                await harness.extensionConfiguration.updateValue("clangd.arguments", [
                    `--compile-commands-dir=${harness.tmpDir}/out/cdb`,
                ]);
                await harness.commandRegistry.execute("clangd.restart");
                await until("scale.cpp clean after the restart", () =>
                    diagnostics("scale.cpp")?.length === 0 ? true : null,
                );
            },
            {
                file: "scale.cpp",
                // Not where clangd looks by itself (the folder and its `build/`): only the argument finds it.
                beforeServer: (dir) => {
                    writeCompileCommands(`${dir}/out/cdb`, dir);
                },
            },
        ),
    );
});
