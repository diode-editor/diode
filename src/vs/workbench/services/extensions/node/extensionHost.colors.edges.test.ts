import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle, waitUntil } from "../../../../../TestUtils/timing.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { DEFAULT_COLOR_DECORATORS_OPTIONS } from "../../../../editor/contrib/colorPicker/browser/colorDetector.ts";
import { registerDefaultDocumentColorProvider } from "../../../../editor/contrib/colorPicker/browser/defaultDocumentColorProvider.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

// Edge cases of `registerColorProvider` seen on the frame: answer shapes, broken colors, several providers
// and extensions on one document, selectors, edits, a hung provider and its cancellation.

const CSS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "css",
    getLanguageDisplayName: () => "CSS",
    getExtensionForLanguage: () => ".css",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const PROVIDER_A = extensionFixture("test.edgeColorsA", "edgeColorsA.cjs");
const PROVIDER_B = extensionFixture("test.edgeColorsB", "edgeColorsB.cjs");

interface IColorsHarness {
    readonly harness: IExtensionHarness;
    readonly editor: TextEditorPane;
    readonly stderr: string[];
    frame(): string;
}

async function open(content: string): Promise<IColorsHarness> {
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
        extensions: [PROVIDER_A, PROVIDER_B],
        stderrLogger,
    });
    registerDefaultDocumentColorProvider(harness.languageFeatures);
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    editor.setColorDecorators(DEFAULT_COLOR_DECORATORS_OPTIONS);
    const frame = (): string => {
        harness.app.render();
        return harness.app.backend.screenToString();
    };
    return { harness, editor, stderr, frame };
}

function cellOf(app: IExtensionHarness["app"], needle: string): Point {
    const lines = app.backend.screenToString().split("\n");
    const y = lines.findIndex((line) => line.includes(needle));
    return new Point(lines[y].indexOf(needle), y);
}

describe("ExtensionHost — color providers, edge cases (subprocess)", () => {
    it("two extensions on one document: the squares of both", async () => {
        const { harness, frame } = await open("a { color: red; border-color: gold; }\n");
        try {
            await waitUntil("both squares", () => frame().includes("color: ■ red; border-color: ■ gold;"));
            expect(harness.app.backend.getFgAt(cellOf(harness.app, "■ gold"))).toBe(packRgb(255, 214, 0));
        } finally {
            await harness.dispose();
        }
    });

    it("one provider throws, the other's squares are drawn", async () => {
        const { harness, frame } = await open("/* THROW */ a { color: red; border-color: gold; }\n");
        try {
            await waitUntil("the square of B", () => frame().includes("border-color: ■ gold;"));
            expect(frame()).toContain("color: red;");
        } finally {
            await harness.dispose();
        }
    });

    it("a promise of colors is drawn", async () => {
        const { harness, frame } = await open("/* ASYNC */ a { color: blue; }\n");
        try {
            await waitUntil("the square", () => frame().includes("color: ■ blue;"));
        } finally {
            await harness.dispose();
        }
    });

    it("plain objects instead of the classes are drawn, as upstream reads them by fields", async () => {
        const { harness, frame } = await open("/* PLAIN */ a { color: red; }\n");
        try {
            await waitUntil("the square", () => frame().includes("color: ■ red;"));
            expect(harness.app.backend.getFgAt(cellOf(harness.app, "■ red"))).toBe(packRgb(255, 0, 0));
        } finally {
            await harness.dispose();
        }
    });

    it("a promise of undefined and a non-array answer leave the document to the built-in detector", async () => {
        for (const marker of ["UNDEF", "OBJECT"]) {
            const { harness, frame } = await open(`/* ${marker} */ a { color: red; background: #00ff00; }\n`);
            try {
                await waitUntil(`the built-in square (${marker})`, () => frame().includes("background: ■ #00ff00;"));
                expect(frame()).toContain("color: red;");
            } finally {
                await harness.dispose();
            }
        }
    });

    it("channels outside 0..1 are clamped, a NaN color is dropped alone", async () => {
        const { harness, frame } = await open("/* WILD */ a { color: red; border: blue; }\n");
        try {
            await waitUntil("the clamped square", () => frame().includes("color: ■ red;"));
            expect(frame()).toContain("border: blue;");
            const fg = harness.app.backend.getFgAt(cellOf(harness.app, "■ red"));
            expect([packRgb(255, 0, 127), packRgb(255, 0, 128)]).toContain(fg);
        } finally {
            await harness.dispose();
        }
    });

    it("a color past the end of the document is dropped, the rest are drawn", async () => {
        const { harness, frame } = await open("/* FAR */ a { color: red; }\n");
        try {
            await waitUntil("the square", () => frame().includes("color: ■ red;"));
            expect(frame().match(/■/g)).toHaveLength(1);
        } finally {
            await harness.dispose();
        }
    });

    it("wide and surrogate characters before a color: the square stays right before it", async () => {
        const { harness, frame } = await open("/* 日本 😀 */ a { color: red; } /* é */ b { color: blue; }\n");
        try {
            await waitUntil(
                "both squares",
                () => frame().includes("color: ■ red;") && frame().includes("color: ■ blue;"),
            );
        } finally {
            await harness.dispose();
        }
    });

    it("selectors: a pattern matches, a foreign scheme or language does not", async () => {
        const { harness, frame } = await open("a { color: green; border: navy; outline: pink; }\n");
        try {
            await waitUntil("the pattern square", () => frame().includes("color: ■ green;"));
            expect(frame()).toContain("border: navy; outline: pink;");
        } finally {
            await harness.dispose();
        }
    });

    it("an edit recomputes: a new word gets its square, a hex the extension does not claim gets the built-in one", async () => {
        const { harness, editor, frame } = await open("a { color: red; }\n");
        try {
            await waitUntil("the square", () => frame().includes("color: ■ red;"));
            editor.viewState.applyEdits([{ range: createRange(0, 11, 0, 14), text: "blue" }], "test");
            await waitUntil("the square on the new word", () => frame().includes("color: ■ blue;"));
            editor.viewState.applyEdits([{ range: createRange(0, 11, 0, 15), text: "#0000ff" }], "test");
            await waitUntil("the built-in square", () => frame().includes("color: ■ #0000ff;"));
            expect(frame().match(/■/g)).toHaveLength(1);
        } finally {
            await harness.dispose();
        }
    });

    it("a late answer for an old version does not paint over the newer text", async () => {
        const { harness, editor, frame } = await open("/* SLOW */ a { color: red; }\n/* fast */\n");
        try {
            await settle(200);
            // The edit drops SLOW: the new answer is quick, the old one arrives later with `red`'s range.
            editor.viewState.applyEdits([{ range: createRange(0, 3, 0, 7), text: "QUIK" }], "test");
            await waitUntil("the square after the edit", () => frame().includes("color: ■ red;"));
            editor.viewState.applyEdits([{ range: createRange(0, 22, 0, 25), text: "blue" }], "test");
            await waitUntil("the square on blue", () => frame().includes("color: ■ blue;"));
            await settle(1300);
            expect(frame()).toContain("color: ■ blue;");
            expect(frame().match(/■/g)).toHaveLength(1);
            expect(harness.app.backend.getFgAt(cellOf(harness.app, "■ blue"))).toBe(packRgb(0, 0, 255));
        } finally {
            await harness.dispose();
        }
    });

    it("a big document with thousands of colors: squares on the visible ones, the editor lives on", async () => {
        const { harness, editor, frame } = await open("a { color: red; }\n".repeat(3000));
        try {
            await waitUntil("the squares", () => frame().includes("a { color: ■ red; }"));
            editor.viewState.applyEdits([{ range: createRange(0, 11, 0, 14), text: "blue" }], "test");
            await waitUntil("the square after the edit", () => frame().includes("a { color: ■ blue; }"));
        } finally {
            await harness.dispose();
        }
    });

    it("a hung provider: an edit cancels its token and the new answer is drawn", async () => {
        const { harness, editor, frame } = await open("/* HANG */ a { color: red; }\n");
        try {
            await settle(500);
            editor.viewState.applyEdits([{ range: createRange(0, 3, 0, 7), text: "done" }], "test");
            await waitUntil("the square after the edit", () => frame().includes("color: ■ red;"), 4000);
            expect(await harness.commandRegistry.execute("edgeColorsA.cancelled")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("a hung provider is cut by the request timeout: the built-in detector takes the document", async () => {
        const { harness, frame } = await open("/* HANG */ a { color: red; background: #00ff00; }\n");
        try {
            await waitUntil("the built-in square", () => frame().includes("background: ■ #00ff00;"), 9000);
        } finally {
            await harness.dispose();
        }
    }, 20_000);
});
