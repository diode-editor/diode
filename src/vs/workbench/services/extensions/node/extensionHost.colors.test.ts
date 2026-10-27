import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import {
    DEFAULT_COLOR_DECORATORS_OPTIONS,
    type IColorDecoratorsOptions,
} from "../../../../editor/contrib/colorPicker/browser/colorDetector.ts";
import { registerDefaultDocumentColorProvider } from "../../../../editor/contrib/colorPicker/browser/defaultDocumentColorProvider.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

// The whole path of `registerColorProvider`: an extension in the subprocess → the core's color registry →
// the color detector → a square on the frame, side by side with the built-in detector.

const CSS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "css",
    getLanguageDisplayName: () => "CSS",
    getExtensionForLanguage: () => ".css",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const FIXTURE = extensionFixture("test.providesColors", "providesColors.cjs");

interface IColorsHarness {
    readonly harness: IExtensionHarness;
    readonly editor: TextEditorPane;
    readonly stderr: string[];
    frame(): string;
}

async function open(content: string, patch: Partial<IColorDecoratorsOptions> = {}): Promise<IColorsHarness> {
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
        initialFile: { name: "main.css", content },
        languageService: CSS_LANGUAGE_SERVICE,
        extensions: [FIXTURE],
        stderrLogger,
    });
    registerDefaultDocumentColorProvider(harness.languageFeatures);
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    editor.setColorDecorators({ ...DEFAULT_COLOR_DECORATORS_OPTIONS, ...patch });
    const frame = (): string => {
        harness.app.render();
        return harness.app.backend.screenToString();
    };
    return { harness, editor, stderr, frame };
}

/** The column of `needle` on the frame: the square's foreground is checked there. */
function cellOf(app: IExtensionHarness["app"], needle: string): Point {
    const lines = app.backend.screenToString().split("\n");
    const y = lines.findIndex((line) => line.includes(needle));
    return new Point(lines[y].indexOf(needle), y);
}

describe("ExtensionHost — color providers (subprocess)", () => {
    it("a square of the extension's color before its range; in auto the built-in detector stays silent", async () => {
        const { harness, frame } = await open("a { color: red; background: #00ff00; }\n");
        try {
            await waitUntil("the extension's square", () => frame().includes("color: ■ red;"));
            expect(frame()).toContain("background: #00ff00;");
            expect(harness.app.backend.getFgAt(cellOf(harness.app, "■ red"))).toBe(packRgb(255, 0, 0));
        } finally {
            await harness.dispose();
        }
    });

    it("always: the built-in detector draws next to the extension", async () => {
        const { harness, frame } = await open("a { color: blue; background: #00ff00; }\n", {
            defaultEnablement: "always",
        });
        try {
            await waitUntil("both squares", () => frame().includes("color: ■ blue; background: ■ #00ff00;"));
            expect(harness.app.backend.getFgAt(cellOf(harness.app, "■ blue"))).toBe(packRgb(0, 0, 255));
        } finally {
            await harness.dispose();
        }
    });

    it("an empty answer leaves the document to the built-in detector", async () => {
        const { harness, frame } = await open("/* NONE */ a { color: red; background: #00ff00; }\n");
        try {
            await waitUntil("the built-in square", () => frame().includes("background: ■ #00ff00;"));
            expect(frame()).toContain("color: red;");
        } finally {
            await harness.dispose();
        }
    });

    it("a throwing provider is logged with its extension; the built-in detector works, the editor lives on", async () => {
        const { harness, editor, stderr, frame } = await open("/* THROW */ a { color: red; background: #00ff00; }\n");
        try {
            await waitUntil("the built-in square", () => frame().includes("background: ■ #00ff00;"));
            await waitUntil("the failure in the log", () =>
                stderr.some((line) =>
                    line.includes("[test.providesColors] provideDocumentColors failed: Error: colors exploded"),
                ),
            );
            // Fixing the text brings the extension's colors back after the edit's recompute.
            editor.viewState.applyEdits([{ range: createRange(0, 0, 0, 12), text: "" }], "test");
            await waitUntil("the extension's square after the edit", () => frame().includes("color: ■ red;"));
        } finally {
            await harness.dispose();
        }
    });

    it("the extension's squares go away once its registration is disposed", async () => {
        const { harness, frame } = await open("a { color: red; }\n");
        try {
            await waitUntil("the extension's square", () => frame().includes("color: ■ red;"));
            await harness.commandRegistry.execute("providesColors.unregister");
            await waitUntil("the square is gone", () => frame().includes("color: red;"));
        } finally {
            await harness.dispose();
        }
    });
});
