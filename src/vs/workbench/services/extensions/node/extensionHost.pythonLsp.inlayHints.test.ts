import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    CLIENT_CRASH_PATTERNS,
    type IInstalledBasedpyright,
    installBasedpyright,
    PY_LANGUAGE_SERVICE,
    until,
} from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";

// The server infers a return type only from annotated parameters: this sample has all three kinds of hints.
const ANNOTATED_PY = "def f(a: int, b: int):\n    return a + b\n\nr = f(1, 2)\n";
const DEF_WITH_HINT = "def f(a: int, b: int) -> int:";
const CALL_WITH_HINTS = "r: int = f(a=1, b=2)";
const CALL_WITHOUT_ARGUMENT_NAMES = "r: int = f(1, 2)";
const DEF_PLAIN = "def f(a: int, b: int):";
const CALL_PLAIN = "r = f(1, 2)";

// The sample of the issue: without annotations the server has no `int` to report.
const UNANNOTATED_PY = "def f(a, b):\n    return a + b\n\nr = f(1, 2)\n";

const WHOLE_SAMPLE = createRange(0, 0, 4, 0);

let installed: IInstalledBasedpyright;

function serverStarts(output: readonly string[]): number {
    return output.filter((line) => line.includes("language server") && line.includes("starting")).length;
}

interface IOpened {
    readonly harness: IExtensionHarness;
    readonly configuration: InMemoryConfigurationService;
    readonly output: readonly string[];
    frame(): string;
    frameHas(...texts: readonly string[]): Promise<void>;
}

async function withPython(
    source: string,
    run: (opened: IOpened) => Promise<void>,
    settings: Readonly<Record<string, unknown>> = {},
): Promise<void> {
    const output: string[] = [];
    const configuration = createTestConfigurationService(settings);
    const harness = await createExtensionTestHarness({
        languageService: PY_LANGUAGE_SERVICE,
        activateEvents: [],
        // The core reads `editor.inlayHints.*` from it; the extension has its own service with the manifest's schema.
        configurationService: configuration,
        outputSink: {
            append: (_channel, _label, _level, value) => output.push(value),
            show: () => undefined,
        },
        extensions: [installed.registration],
    });
    try {
        harness.group.openFile(harness.writeFile("main.py", source));
        await harness.host.activateByEvent("onLanguage:python");
        const frame = (): string => {
            harness.app.render();
            return harness.app.backend.screenToString();
        };
        await run({
            harness,
            configuration,
            output,
            frame,
            frameHas: async (...texts) => {
                await until(texts.join(" + "), () =>
                    Promise.resolve(texts.every((text) => frame().includes(text)) ? true : null),
                );
            },
        });
        expect(output.filter((line) => CLIENT_CRASH_PATTERNS.test(line))).toEqual([]);
    } finally {
        await harness.dispose();
    }
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — inlay hints from the stock basedpyright", () => {
    beforeAll(async () => {
        installed = await installBasedpyright();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("a return type, a variable type and argument names reach the frame", { timeout: 240_000 }, async () => {
        await withPython(ANNOTATED_PY, async ({ frameHas }) => {
            await frameHas(DEF_WITH_HINT, CALL_WITH_HINTS);
        });
    });

    it("a python file opened after the server is up shows hints with no edit", { timeout: 240_000 }, async () => {
        await withPython(ANNOTATED_PY, async ({ harness, frameHas }) => {
            await frameHas(DEF_WITH_HINT, CALL_WITH_HINTS);
            harness.group.openFile(
                harness.writeFile("second.py", "def g(x: int, y: int):\n    return x + y\n\nq = g(3, 4)\n"),
            );
            await frameHas("def g(x: int, y: int) -> int:", "q: int = g(x=3, y=4)");
        });
    });

    it(
        "the issue's unannotated sample shows what the server infers: Any and no variable type",
        {
            timeout: 240_000,
        },
        async () => {
            await withPython(UNANNOTATED_PY, async ({ frameHas }) => {
                await frameHas("def f(a, b) -> Any:", "r = f(a=1, b=2)");
            });
        },
    );

    // The server takes the setting at once but never sends `workspace/inlayHint/refresh`, and upstream's controller
    // does not ask again on a foreign setting either: the next request, here after an edit, gets the new answer.
    it(
        "callArgumentNames: false applies without a restart, from the next request after an edit",
        {
            timeout: 240_000,
        },
        async () => {
            await withPython(ANNOTATED_PY, async ({ harness, output, frame, frameHas }) => {
                await frameHas(CALL_WITH_HINTS);
                const editor = harness.group.getActiveEditor();
                if (editor === null) throw new Error("no active editor");
                let lastLine = 4;
                // Repeated: the server reads the setting back asynchronously, an early request gets the old answer.
                // Backing off: an edit cancels the request in flight, so a fixed pace starves a slow server forever.
                const editUntil = async (text: string): Promise<void> => {
                    let nextEditAt = 0;
                    let pause = 1000;
                    await until(text, () => {
                        if (frame().includes(text)) return Promise.resolve(true);
                        if (Date.now() >= nextEditAt) {
                            editor.applyExternalEdits(
                                [createTextEdit(createRange(lastLine, 0, lastLine, 0), "\n")],
                                "nudge",
                            );
                            lastLine++;
                            nextEditAt = Date.now() + pause;
                            pause *= 2;
                        }
                        return Promise.resolve(null);
                    });
                };
                await harness.extensionConfiguration.updateValue(
                    "basedpyright.analysis.inlayHints.callArgumentNames",
                    false,
                );
                await editUntil(CALL_WITHOUT_ARGUMENT_NAMES);
                expect(frame()).toContain(DEF_WITH_HINT);
                await harness.extensionConfiguration.updateValue(
                    "basedpyright.analysis.inlayHints.callArgumentNames",
                    true,
                );
                await editUntil(CALL_WITH_HINTS);
                expect(serverStarts(output)).toBe(1);
            });
        },
    );

    it(
        "editor.inlayHints.enabled: off removes every hint and on brings them back, the server keeps running",
        {
            timeout: 240_000,
        },
        async () => {
            await withPython(ANNOTATED_PY, async ({ configuration, output, frameHas }) => {
                await frameHas(DEF_WITH_HINT, CALL_WITH_HINTS);
                await configuration.updateValue("editor.inlayHints.enabled", "off");
                await frameHas(DEF_PLAIN, CALL_PLAIN);
                await configuration.updateValue("editor.inlayHints.enabled", "on");
                await frameHas(DEF_WITH_HINT, CALL_WITH_HINTS);
                expect(serverStarts(output)).toBe(1);
            });
        },
    );

    it("a [python] override removes every hint, dropping it brings them back", { timeout: 240_000 }, async () => {
        await withPython(ANNOTATED_PY, async ({ configuration, frameHas }) => {
            await frameHas(DEF_WITH_HINT, CALL_WITH_HINTS);
            await configuration.updateValue("[python]", { "editor.inlayHints.enabled": "off" });
            await frameHas(DEF_PLAIN, CALL_PLAIN);
            await configuration.updateValue("[python]", undefined);
            await frameHas(DEF_WITH_HINT, CALL_WITH_HINTS);
        });
    });

    it(
        "a [python] override from the start: no hint ever appears though the provider answers",
        {
            timeout: 240_000,
        },
        async () => {
            await withPython(
                ANNOTATED_PY,
                async ({ harness, frame, configuration, frameHas }) => {
                    const editor = harness.group.getActiveEditor();
                    if (editor === null) throw new Error("no active editor");
                    const model = editor.model;
                    await until("an answer of the provider", async () => {
                        const providers = harness.languageFeatures.inlayHintsProvider.ordered(model);
                        if (providers.length === 0) return null;
                        const list = await providers[0].provideInlayHints(model, WHOLE_SAMPLE, CancellationTokenNone);
                        return (list?.hints.length ?? 0) > 0 ? true : null;
                    });
                    expect(frame()).toContain(DEF_PLAIN);
                    expect(frame()).toContain(CALL_PLAIN);
                    await configuration.updateValue("[python]", undefined);
                    await frameHas(DEF_WITH_HINT, CALL_WITH_HINTS);
                },
                { "[python]": { "editor.inlayHints.enabled": "off" } },
            );
        },
    );

    it("the server registers inlay hints and no code lens", { timeout: 240_000 }, async () => {
        await withPython(ANNOTATED_PY, async ({ harness, frameHas }) => {
            await frameHas(CALL_WITH_HINTS);
            const editor = harness.group.getActiveEditor();
            if (editor === null) throw new Error("no active editor");
            // The client registers both from the same `initialize` answer: the hints on the frame mean it is done.
            expect(harness.languageFeatures.inlayHintsProvider.has(editor.model)).toBe(true);
            expect(harness.languageFeatures.codeLensProvider.has(editor.model)).toBe(false);
        });
    });
});
