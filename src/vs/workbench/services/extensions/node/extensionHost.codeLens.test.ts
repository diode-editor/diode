import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { describe, expect, it, vi } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { DEFAULT_CODE_LENS_OPTIONS } from "../../../../editor/contrib/codelens/browser/codeLensController.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { parseGoToLocationsArguments } from "../../../contrib/gotoDefinition/browser/goToLocationsArguments.ts";

// The whole path of `registerCodeLensProvider`: an extension in the subprocess → the core's registry → the controller
// → a row on the frame → the click → the command back in the subprocess, with the extension's own objects.

const TS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "typescript",
    getLanguageDisplayName: () => "TypeScript",
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => ".ts",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const FIXTURE = extensionFixture("test.providesCodeLens", "providesCodeLens.cjs");

interface ILensHarness {
    readonly harness: IExtensionHarness;
    readonly editor: TextEditorPane;
    readonly stderr: string[];
    frame(): string;
    /** Left click on `title`, in a row above the first line of the file. */
    clickTitle(title: string): void;
}

async function open(content: string): Promise<ILensHarness> {
    const stderr: string[] = [];
    const record = (message: string): void => {
        stderr.push(message);
    };
    const stderrLogger: ILogger = {
        error: record,
        warn: record,
        info: record,
        debug: record,
        trace: record,
        isEnabled: () => true,
    };
    const harness = await createExtensionTestHarness({
        initialFile: { name: "main.ts", content },
        languageService: TS_LANGUAGE_SERVICE,
        extensions: [FIXTURE],
        stderrLogger,
    });
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    // The harness has no configuration service to read `editor.codeLens` from.
    editor.setCodeLens(DEFAULT_CODE_LENS_OPTIONS);
    const frame = (): string => {
        harness.app.render();
        return harness.app.backend.screenToString();
    };
    const clickTitle = (title: string): void => {
        const row = frame()
            .split("\n")
            .find((line) => line.includes(title));
        if (row === undefined) throw new Error(`"${title}" is not on the frame`);
        const x = row.indexOf(title);
        const element = editor.component.view.getChild();
        element.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: x, screenY: 0, localX: x, localY: 0 }),
        );
    };
    return { harness, editor, stderr, frame, clickTitle };
}

const SOURCE = "function alpha() {}\nconst b = 1;\n";
const ROW = "2 references | Run";

describe("ExtensionHost — code lens providers (subprocess)", () => {
    it("[api:languages.registerCodeLensProvider] [api:CodeLensProvider.provideCodeLenses] [api:CodeLensProvider.resolveCodeLens] the row is on the frame, the second title comes from the resolve", async () => {
        const { harness, frame } = await open(SOURCE);
        try {
            await waitUntil("the row", () => frame().includes(ROW));
        } finally {
            await harness.dispose();
        }
    });

    it("the click runs the extension's command in the subprocess with its own objects", async () => {
        const { harness, frame, clickTitle } = await open(SOURCE);
        try {
            await waitUntil("the row", () => frame().includes(ROW));
            clickTitle("Run");
            await vi.waitFor(
                async () => {
                    expect(await harness.commandRegistry.execute("providesCodeLens.runs")).toEqual([
                        { uri: "file:///arg.ts", isPosition: true, isMarker: true },
                    ]);
                },
                { timeout: 10_000 },
            );
        } finally {
            await harness.dispose();
        }
    });

    it("the lens of editor.action.showReferences reaches the host command with arguments its parser takes", async () => {
        const { harness, frame, clickTitle, editor } = await open(SOURCE);
        const seen: ReturnType<typeof parseGoToLocationsArguments>[] = [];
        harness.commandRegistry.register(
            "editor.action.showReferences",
            (uri: unknown, position: unknown, locations: unknown) => {
                seen.push(parseGoToLocationsArguments(uri, position, locations));
            },
        );
        try {
            await waitUntil("the row", () => frame().includes(ROW));
            clickTitle("2 references");
            await waitUntil("the command ran", () => seen.length > 0);
            const uri = editor.uri.toString();
            expect(seen[0].uri.toString()).toBe(uri);
            expect(seen[0].position).toEqual({ line: 0, character: 0 });
            expect(seen[0].locations).toEqual([
                { uri, range: createRange(0, 0, 0, 3) },
                { uri, range: createRange(1, 0, 1, 3) },
            ]);
        } finally {
            await harness.dispose();
        }
    });

    it("a command that throws, a command nobody has: the failure reaches the caller of the lens", async () => {
        const { harness, editor, frame } = await open(`${SOURCE}// FAILS\n`);
        try {
            await waitUntil("the row", () => frame().includes(`${ROW} | Boom | Missing`));
            const picks = await editor.getCodeLensPicksAtLine(0);
            const run = (label: string): Promise<void> | undefined =>
                picks.find((pick) => pick.label === label)?.command.run?.();
            await expect(run("Boom")).rejects.toThrow("command exploded");
            await expect(run("Missing")).rejects.toThrow("command 'providesCodeLens.nope' not found");
        } finally {
            await harness.dispose();
        }
    });

    it("[api:CodeLensProvider.onDidChangeCodeLenses] the provider's event brings its new answer to the frame", async () => {
        const { harness, frame } = await open(SOURCE);
        try {
            await waitUntil("the row", () => frame().includes(ROW));
            await harness.commandRegistry.execute("providesCodeLens.refresh");
            await waitUntil("the new row", () => frame().includes("3 references | Run"));
        } finally {
            await harness.dispose();
        }
    });

    it("a new answer releases the old one: its lens has nothing to run any more", async () => {
        const { harness, editor, frame } = await open(SOURCE);
        try {
            await waitUntil("the row", () => frame().includes(ROW));
            const [, oldRun] = await editor.getCodeLensPicksAtLine(0);
            await harness.commandRegistry.execute("providesCodeLens.refresh");
            await waitUntil("the new row", () => frame().includes("3 references | Run"));
            await oldRun.command.run?.();
            expect(await harness.commandRegistry.execute("providesCodeLens.runs")).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("an edit moves the row with the text, the lens of the new answer still runs", async () => {
        const { harness, editor, frame } = await open(SOURCE);
        try {
            await waitUntil("the row", () => frame().includes(ROW));
            editor.viewState.applyEdits([{ range: createRange(0, 0, 0, 0), text: "function zero() {}\n" }], "test");
            await waitUntil("two rows", () => frame().split(ROW).length === 3);
            const [references, run] = await editor.getCodeLensPicksAtLine(1);
            expect(references.label).toBe("2 references");
            await run.command.run?.();
            const runs = await harness.commandRegistry.execute("providesCodeLens.runs");
            expect(runs).toHaveLength(1);
        } finally {
            await harness.dispose();
        }
    });

    it("a throwing provider is logged with its extension, the editor lives on, fixed text brings the row back", async () => {
        const { harness, editor, stderr, frame } = await open(`// THROW\n${SOURCE}`);
        try {
            await waitUntil("the failure in the log", () =>
                stderr.some((line) =>
                    line.includes("[test.providesCodeLens] provideCodeLenses failed: Error: lenses exploded"),
                ),
            );
            expect(frame()).not.toContain("references");
            editor.viewState.applyEdits([{ range: createRange(0, 0, 1, 0), text: "" }], "test");
            await waitUntil("the row after the edit", () => frame().includes(ROW));
        } finally {
            await harness.dispose();
        }
    });

    it("the row goes away once the registration is disposed", async () => {
        const { harness, frame } = await open(SOURCE);
        try {
            await waitUntil("the row", () => frame().includes(ROW));
            await harness.commandRegistry.execute("providesCodeLens.unregister");
            await waitUntil("no row", () => !frame().includes("references"));
        } finally {
            await harness.dispose();
        }
    });
});
