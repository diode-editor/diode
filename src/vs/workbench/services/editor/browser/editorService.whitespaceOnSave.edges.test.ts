import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

// Edge cases of the whitespace save participants (#855), observed on disk and in the buffer.

const ALL_ON = {
    "files.trimTrailingWhitespace": true,
    "files.insertFinalNewline": true,
    "files.trimFinalNewlines": true,
};

let ws: ITempWorkspace;
const services: EditorService[] = [];

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-ws-onsave-edges-" });
});

afterEach(() => {
    for (const service of services.splice(0)) service.dispose();
    ws.dispose();
});

function createEditorService(settings: Record<string, unknown>) {
    const service = new EditorService(
        new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        {
            ...NULL_LANGUAGE_SERVICE,
            getLanguageIdForResource: (file) =>
                file.endsWith(".md") ? "markdown" : file.endsWith(".ts") ? "typescript" : undefined,
        },
        createTestConfigurationService(settings),
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
        undefined,
        undefined,
        [],
        new LanguageFeaturesService(),
        diskFileService(),
    );
    services.push(service);
    return service;
}

function open(settings: Record<string, unknown>, name: string, content: string) {
    const service = createEditorService(settings);
    const fp = path.join(ws.dir, name);
    fs.writeFileSync(fp, content, "utf-8");
    service.openFile(fp);
    return { pane: service.getActiveEditor()!, fp };
}

async function save(settings: Record<string, unknown>, name: string, content: string) {
    const { pane, fp } = open(settings, name, content);
    await pane.save();
    return { pane, disk: fs.readFileSync(fp, "utf-8") };
}

describe("whitespace save participants: edges", () => {
    it.each([
        ["mixed tail", "a \t \t\nb", "a\nb"],
        ["NBSP tail is kept", "a \nb", "a \nb"],
        ["ideographic space tail is kept", "a　\nb", "a　\nb"],
        ["spaces before NBSP are kept, after it trimmed", "a   \nb", "a  \nb"],
        ["emoji before the tail", "😀😀  \nb", "😀😀\nb"],
        ["CJK before the tail", "日本語\t\t\nb", "日本語\nb"],
        ["whole file of whitespace", "   \n\t\n ", "\n\n"],
        ["leading whitespace is kept", "  a  \n\tb\t", "  a\n\tb"],
        ["a 10k-space tail", `x${" ".repeat(10_000)}`, "x"],
    ])("trimTrailingWhitespace: %s", async (_name, content, expected) => {
        const { disk } = await save({ "files.trimTrailingWhitespace": true }, "a.txt", content);
        expect(disk).toBe(expected);
    });

    it.each([
        ["a\r\n\r\n\r\n", "a\r\n"],
        ["a  \r\nb\t\r\n\r\n", "a\r\nb\r\n"],
        ["\r\n\r\n", ""],
    ])("CRLF with all three on: %j → %j", async (content, expected) => {
        const { disk } = await save(ALL_ON, "a.txt", content);
        expect(disk).toBe(expected);
    });

    it.each([
        ["\n", ""],
        ["a\n\n", "a\n"],
        ["a\nb\n\n\n\n\n", "a\nb\n"],
    ])("trimFinalNewlines alone: %j → %j", async (content, expected) => {
        const { disk } = await save({ "files.trimFinalNewlines": true }, "a.txt", content);
        expect(disk).toBe(expected);
    });

    it("the cursor on a removed trailing blank line ends up inside the document", async () => {
        const { pane, fp } = open(ALL_ON, "a.txt", "a  \n\n\n\n");
        pane.viewState.selections = [createCursorSelection(4, 0)];

        await pane.save();

        expect(fs.readFileSync(fp, "utf-8")).toBe("a\n");
        const lineCount = pane.getText().split("\n").length;
        for (const sel of pane.viewState.selections) {
            expect(sel.active.line).toBeLessThan(lineCount);
            const lineText = pane.getText().split("\n")[sel.active.line];
            expect(sel.active.character).toBeLessThanOrEqual(lineText.length);
        }
    });

    it("several cursors inside trimmed tails stay inside their lines", async () => {
        const { pane, fp } = open({ "files.trimTrailingWhitespace": true }, "a.txt", "ab   \ncd   \nef");
        pane.viewState.selections = [createCursorSelection(0, 5), createCursorSelection(1, 4)];

        await pane.save();

        expect(fs.readFileSync(fp, "utf-8")).toBe("ab\ncd\nef");
        expect(pane.viewState.selections.map((s) => [s.active.line, s.active.character])).toEqual([
            [0, 2],
            [1, 2],
        ]);
    });

    it("language override turns insertFinalNewline / trimFinalNewlines off for markdown", async () => {
        const settings = {
            ...ALL_ON,
            "[markdown]": { "files.insertFinalNewline": false, "files.trimFinalNewlines": false },
        };
        expect((await save(settings, "a.md", "a\n\n\n")).disk).toBe("a\n\n\n");
        expect((await save(settings, "b.md", "a")).disk).toBe("a");
        expect((await save(settings, "a.ts", "a\n\n\n")).disk).toBe("a\n");
    });

    it("language override turns the whole pipeline on only for one language", async () => {
        const settings = { "[markdown]": { "files.trimTrailingWhitespace": true } };
        expect((await save(settings, "a.md", "a  \n")).disk).toBe("a\n");
        expect((await save(settings, "a.ts", "a  \n")).disk).toBe("a  \n");
    });

    it("100k lines without trailing whitespace: no edit, the tab stays clean", async () => {
        const content = "const x = 1;\n".repeat(100_000);
        const { pane, fp } = open(ALL_ON, "big.ts", content);
        const version = pane.model.document.versionId;

        await pane.save();

        expect(pane.model.document.versionId).toBe(version);
        expect(fs.readFileSync(fp, "utf-8")).toBe(content);
    });

    it("10k lines all with trailing whitespace: trimmed in one save, one undo brings all of it back", async () => {
        const content = "const x = 1;  \n".repeat(10_000);
        const { pane, fp } = open({ "files.trimTrailingWhitespace": true }, "big.ts", content);

        await pane.save();

        expect(fs.readFileSync(fp, "utf-8")).toBe("const x = 1;\n".repeat(10_000));
        pane.undo();
        expect(pane.getText()).toBe(content);
    });

    it("saving twice in a row: the second save is a no-op and the file is unchanged", async () => {
        const { pane, fp } = open(ALL_ON, "a.txt", "a  \nb\n\n");
        await pane.save();
        const version = pane.model.document.versionId;
        await pane.save();
        expect(pane.model.document.versionId).toBe(version);
        expect(fs.readFileSync(fp, "utf-8")).toBe("a\nb\n");
        expect(pane.isModified).toBe(false);
    });

    it("two saves fired at once write the trimmed text and leave the tab clean", async () => {
        const { pane, fp } = open(ALL_ON, "a.txt", "a  \nb\n\n");
        await Promise.all([pane.save(), pane.save()]);
        expect(fs.readFileSync(fp, "utf-8")).toBe("a\nb\n");
        expect(pane.getText()).toBe("a\nb\n");
        expect(pane.isModified).toBe(false);
    });

    it("an edit typed after Ctrl+S while the participants run is not lost", async () => {
        const { pane, fp } = open(ALL_ON, "a.txt", "a  \n");
        const saving = pane.save();
        pane.viewState.type("z");
        await saving;
        expect(pane.getText()).toContain("z");
        await pane.save();
        expect(fs.readFileSync(fp, "utf-8")).toContain("z");
    });
});
