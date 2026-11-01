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
import { DEFAULT_INLAY_HINTS_OPTIONS } from "../../../../editor/contrib/inlayHints/browser/inlayHintsController.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

// Code lens and inlay hint requests have no deadline, as in VS Code: a provider that never answers must cost nothing
// but its own row. An edit is what cancels the request and asks again.

const TS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "typescript",
    getLanguageDisplayName: () => "TypeScript",
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => ".ts",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const FIXTURE = extensionFixture("test.hangingLensesAndHints", "hangingLensesAndHints.cjs");

interface IOpened {
    readonly harness: IExtensionHarness;
    readonly editor: TextEditorPane;
    frame(): string;
}

async function open(content: string): Promise<IOpened> {
    const harness = await createExtensionTestHarness({
        initialFile: { name: "main.ts", content },
        languageService: TS_LANGUAGE_SERVICE,
        extensions: [FIXTURE],
    });
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    editor.setCodeLens(DEFAULT_CODE_LENS_OPTIONS);
    editor.setInlayHints(DEFAULT_INLAY_HINTS_OPTIONS);
    const frame = (): string => {
        harness.app.render();
        return harness.app.backend.screenToString();
    };
    return { harness, editor, frame };
}

async function cancelledRequests(harness: IExtensionHarness): Promise<unknown> {
    return harness.commandRegistry.execute("hanging.cancelled");
}

/** An edit made before the requests reach the provider proves nothing: there is nothing yet to cancel. */
async function bothRequestsHang(harness: IExtensionHarness): Promise<void> {
    await vi.waitFor(
        async () => {
            const hung = await harness.commandRegistry.execute("hanging.hung");
            expect(hung).toContain("provideCodeLenses");
            expect(hung).toContain("provideInlayHints");
        },
        { timeout: 10_000 },
    );
}

describe("ExtensionHost — providers that never answer (subprocess)", () => {
    it("the editor keeps taking edits while provideCodeLenses and provideInlayHints hang, an edit brings the answers", async () => {
        const { harness, editor, frame } = await open("// HANG\nconst a = 1;\nfunction alpha() {}\n");
        try {
            await bothRequestsHang(harness);
            expect(frame()).toContain("function alpha");
            editor.viewState.applyEdits([{ range: createRange(1, 0, 1, 0), text: "typed\n" }], "test");
            await waitUntil("the edit on the frame", () => frame().includes("typed"));

            editor.viewState.applyEdits([{ range: createRange(0, 0, 0, 7), text: "const x = 1;" }], "test");
            await waitUntil("the row", () => frame().includes("resolved alpha"));
            await waitUntil("the hint", () => frame().includes("const x: number = 1;"));
        } finally {
            await harness.dispose();
        }
    });

    it("an edit cancels the token of a provideCodeLenses and a provideInlayHints that hang", async () => {
        const { harness, editor } = await open("// HANG\nconst a = 1;\n");
        try {
            await bothRequestsHang(harness);
            editor.viewState.applyEdits([{ range: createRange(1, 0, 1, 0), text: "x" }], "test");
            await vi.waitFor(
                async () => {
                    const cancelled = await cancelledRequests(harness);
                    expect(cancelled).toContain("provideCodeLenses");
                    expect(cancelled).toContain("provideInlayHints");
                },
                { timeout: 10_000 },
            );
        } finally {
            await harness.dispose();
        }
    });

    it("a resolveCodeLens that hangs on one method does not hold back the row of another", async () => {
        const { harness, frame } = await open("function slow() {}\nconst a = 1;\nfunction fast() {}\n");
        try {
            await waitUntil("the other row", () => frame().includes("resolved fast"));
            expect(frame()).not.toContain("resolved slow");
        } finally {
            await harness.dispose();
        }
    });

    it("an edit asks again after a resolveCodeLens that hangs, the row gets its title", async () => {
        const { harness, editor, frame } = await open("function slow() {}\nconst a = 1;\nfunction fast() {}\n");
        try {
            await waitUntil("the other row", () => frame().includes("resolved fast"));
            editor.viewState.applyEdits([{ range: createRange(1, 0, 1, 0), text: "x" }], "test");
            await waitUntil("the row after the edit", () => frame().includes("resolved slow"));
            expect(await cancelledRequests(harness)).toContain("resolveCodeLens");
        } finally {
            await harness.dispose();
        }
    });

    it("the host stops while requests still hang", async () => {
        const { harness } = await open("// HANG\nconst a = 1;\n");
        await bothRequestsHang(harness);
        await harness.dispose();
    });
});
