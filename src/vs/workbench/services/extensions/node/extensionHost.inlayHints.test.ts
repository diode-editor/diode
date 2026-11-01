import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { DEFAULT_INLAY_HINTS_OPTIONS } from "../../../../editor/contrib/inlayHints/browser/inlayHintsController.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

// The whole path of `registerInlayHintsProvider`: an extension in the subprocess → the core's registry →
// the controller → a pill on the frame.

const TS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "typescript",
    getLanguageDisplayName: () => "TypeScript",
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => ".ts",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const FIXTURE = extensionFixture("test.providesInlayHints", "providesInlayHints.cjs");

interface IHintsHarness {
    readonly harness: IExtensionHarness;
    readonly editor: TextEditorPane;
    readonly stderr: string[];
    frame(): string;
}

async function open(content: string): Promise<IHintsHarness> {
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
    // The harness has no configuration service to read `editor.inlayHints.enabled` from.
    editor.setInlayHints(DEFAULT_INLAY_HINTS_OPTIONS);
    const frame = (): string => {
        harness.app.render();
        return harness.app.backend.screenToString();
    };
    return { harness, editor, stderr, frame };
}

describe("ExtensionHost — inlay hints providers (subprocess)", () => {
    it("[api:languages.registerInlayHintsProvider] [api:InlayHintsProvider.provideInlayHints] pills of two providers are merged on the frame", async () => {
        const { harness, frame } = await open("const a = f(1);\n");
        try {
            await waitUntil("both hints", () => frame().includes("const a : number = f(count: 1);"));
        } finally {
            await harness.dispose();
        }
    });

    it("turning the setting off removes the pills, turning it on brings them back", async () => {
        const { harness, editor, frame } = await open("const a = 1;\n");
        try {
            await waitUntil("the hint", () => frame().includes("const a : number = 1;"));
            editor.setInlayHints({ ...DEFAULT_INLAY_HINTS_OPTIONS, enabled: false });
            await waitUntil("no hint", () => frame().includes("const a = 1;"));
            editor.setInlayHints({ ...DEFAULT_INLAY_HINTS_OPTIONS, enabled: true });
            await waitUntil("the hint again", () => frame().includes("const a : number = 1;"));
        } finally {
            await harness.dispose();
        }
    });

    it("[api:InlayHintsProvider.onDidChangeInlayHints] the provider's event brings its new answer to the frame", async () => {
        const { harness, frame } = await open("const a = 1;\n");
        try {
            await waitUntil("the hint", () => frame().includes("const a : number = 1;"));
            await harness.commandRegistry.execute("providesInlayHints.refresh");
            await waitUntil("the new hint", () => frame().includes("const a : string = 1;"));
        } finally {
            await harness.dispose();
        }
    });

    it("an edit moves the pill with the text, then the provider answers for the new text", async () => {
        const { harness, editor, frame } = await open("const a = 1;\n");
        try {
            await waitUntil("the hint", () => frame().includes("const a : number = 1;"));
            editor.viewState.applyEdits([{ range: createRange(0, 0, 0, 0), text: "const b = 2;\n" }], "test");
            await waitUntil("both hints", () => {
                const text = frame();
                return text.includes("const b : number = 2;") && text.includes("const a : number = 1;");
            });
        } finally {
            await harness.dispose();
        }
    });

    it("a throwing provider is logged with its extension, the other provider's hints stay, the editor lives on", async () => {
        const { harness, editor, stderr, frame } = await open("/* THROW */ const a = f(1);\n");
        try {
            await waitUntil("the other provider's hint", () => frame().includes("const a = f(count: 1);"));
            await waitUntil("the failure in the log", () =>
                stderr.some((line) =>
                    line.includes("[test.providesInlayHints] provideInlayHints failed: Error: hints exploded"),
                ),
            );
            // Fixing the text brings the hints back after the edit's recompute.
            editor.viewState.applyEdits([{ range: createRange(0, 0, 0, 12), text: "" }], "test");
            await waitUntil("the hint after the edit", () => frame().includes("const a : number = f(count: 1);"));
        } finally {
            await harness.dispose();
        }
    });

    it("the pills go away once the registrations are disposed", async () => {
        const { harness, frame } = await open("const a = 1;\n");
        try {
            await waitUntil("the hint", () => frame().includes("const a : number = 1;"));
            await harness.commandRegistry.execute("providesInlayHints.unregister");
            await waitUntil("no hint", () => frame().includes("const a = 1;"));
        } finally {
            await harness.dispose();
        }
    });
});
