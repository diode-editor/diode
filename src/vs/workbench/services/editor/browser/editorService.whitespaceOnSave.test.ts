import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { IFormattingRequest } from "../../../../editor/common/languages/iFormattingSource.ts";
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

// files.trimTrailingWhitespace / insertFinalNewline / trimFinalNewlines through the real save pipeline:
// buffer, disk bytes, dirty state and undo.

const ALL_ON = {
    "files.trimTrailingWhitespace": true,
    "files.insertFinalNewline": true,
    "files.trimFinalNewlines": true,
};

let ws: ITempWorkspace;
const services: EditorService[] = [];

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-ws-onsave-" });
});

afterEach(() => {
    for (const service of services.splice(0)) service.dispose();
    ws.dispose();
});

function createEditorService(settings: Record<string, unknown>) {
    const languageFeatures = new LanguageFeaturesService();
    const configuration = createTestConfigurationService(settings);
    const service = new EditorService(
        new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        {
            ...NULL_LANGUAGE_SERVICE,
            getLanguageIdForResource: (file) =>
                file.endsWith(".md") ? "markdown" : file.endsWith(".ts") ? "typescript" : undefined,
        },
        configuration,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
        undefined,
        undefined,
        [],
        languageFeatures,
        diskFileService(),
    );
    services.push(service);
    return { service, languageFeatures, configuration };
}

function writeFile(name: string, content: string): string {
    const fp = path.join(ws.dir, name);
    fs.writeFileSync(fp, content, "utf-8");
    return fp;
}

async function saveOpened(configuration: Record<string, unknown>, name: string, content: string) {
    const { service } = createEditorService(configuration);
    const fp = writeFile(name, content);
    service.openFile(fp);
    const pane = service.getActiveEditor()!;
    await pane.save();
    return { pane, disk: fs.readFileSync(fp, "utf-8"), fp };
}

describe("save participants: whitespace settings", () => {
    it("everything off by default: the file is written as is", async () => {
        const { disk, pane } = await saveOpened({}, "a.txt", "foo  \nbar\t\n\n\n");
        expect(disk).toBe("foo  \nbar\t\n\n\n");
        expect(pane.getText()).toBe("foo  \nbar\t\n\n\n");
    });

    it("off: no participant at all, so the write happens in the same tick", () => {
        const { service } = createEditorService({ "files.trimTrailingWhitespaceInRegexAndStrings": false });
        const ref = service.textFileModels.acquire(Uri.file(writeFile("a.txt", "a  ")));
        expect(ref.model.saveParticipant?.participate(ref.model)).toBeNull();
        ref.dispose();
    });

    it.each(Object.keys(ALL_ON))("%s alone turns the pipeline on", (setting) => {
        const { service } = createEditorService({ [setting]: true });
        const ref = service.textFileModels.acquire(Uri.file(writeFile("a.txt", "a")));
        expect(ref.model.saveParticipant?.participate(ref.model)).toBeInstanceOf(Promise);
        ref.dispose();
    });

    it("trimTrailingWhitespace: spaces and tabs at line ends are gone in the buffer and on disk, the tab is clean", async () => {
        const { disk, pane } = await saveOpened(
            { "files.trimTrailingWhitespace": true },
            "a.txt",
            "foo  \nbar\t\n  \nx \n",
        );
        expect(disk).toBe("foo\nbar\n\nx \n");
        expect(pane.getText()).toBe(disk);
        expect(pane.isModified).toBe(false);
    });

    it("trimTrailingWhitespace: the cursor line is trimmed too and the cursor stays inside the line", async () => {
        const { service } = createEditorService({ "files.trimTrailingWhitespace": true });
        const fp = writeFile("a.txt", "ab    \nc");
        service.openFile(fp);
        const pane = service.getActiveEditor()!;
        pane.viewState.selections = [createCursorSelection(0, 6)];

        await pane.save();

        expect(fs.readFileSync(fp, "utf-8")).toBe("ab\nc");
        expect(pane.viewState.selections.map((sel) => [sel.active.line, sel.active.character])).toEqual([[0, 2]]);
    });

    it("Ctrl+Z after save brings the whitespace back and makes the tab dirty; saving again trims again", async () => {
        const { service } = createEditorService(ALL_ON);
        const fp = writeFile("a.txt", "foo  \nbar\t\n\n\n");
        service.openFile(fp);
        const pane = service.getActiveEditor()!;

        await pane.save();
        expect(fs.readFileSync(fp, "utf-8")).toBe("foo\nbar\n");
        expect(pane.isModified).toBe(false);

        // One undo per participant edit: trim whitespace, then trim final newlines.
        pane.undo();
        pane.undo();
        expect(pane.getText()).toBe("foo  \nbar\t\n\n\n");
        expect(pane.isModified).toBe(true);

        await pane.save();
        expect(fs.readFileSync(fp, "utf-8")).toBe("foo\nbar\n");
        expect(pane.isModified).toBe(false);
    });

    it("all three on, file without a final newline: trimmed and terminated", async () => {
        const { disk } = await saveOpened(ALL_ON, "a.txt", "foo  \nbar\t");
        expect(disk).toBe("foo\nbar\n");
    });

    it.each([
        ["a", "a\n"],
        ["", ""],
        ["a\n", "a\n"],
        ["a\n  ", "a\n  "],
        ["a\n\t", "a\n\t"],
    ])("insertFinalNewline: %j → %j", async (content, expected) => {
        const { disk } = await saveOpened({ "files.insertFinalNewline": true }, "a.txt", content);
        expect(disk).toBe(expected);
    });

    it("insertFinalNewline on a CRLF file writes CRLF", async () => {
        const { disk } = await saveOpened({ "files.insertFinalNewline": true }, "a.txt", "a\r\nb");
        expect(disk).toBe("a\r\nb\r\n");
    });

    it.each([
        ["a\n\n\n", "a\n"],
        ["a", "a"],
        ["a\n", "a\n"],
        ["\n\n\n", ""],
        ["a\n  \n\n", "a\n  \n"],
    ])("trimFinalNewlines: %j → %j", async (content, expected) => {
        const { disk } = await saveOpened({ "files.trimFinalNewlines": true }, "a.txt", content);
        expect(disk).toBe(expected);
    });

    it("trimFinalNewlines with trimTrailingWhitespace: a whitespace-only tail line is already empty", async () => {
        const { disk } = await saveOpened(
            { "files.trimFinalNewlines": true, "files.trimTrailingWhitespace": true },
            "a.txt",
            "a\n  \n\n",
        );
        expect(disk).toBe("a\n");
    });

    it.each([
        ["a", "a\n"],
        ["a\n\n", "a\n"],
    ])("insertFinalNewline + trimFinalNewlines: %j → %j", async (content, expected) => {
        const { disk } = await saveOpened(
            { "files.insertFinalNewline": true, "files.trimFinalNewlines": true },
            "a.txt",
            content,
        );
        expect(disk).toBe(expected);
    });

    it("language override: [markdown] off keeps hard line breaks, .ts is still trimmed", async () => {
        const settings = {
            "files.trimTrailingWhitespace": true,
            "[markdown]": { "files.trimTrailingWhitespace": false },
        };
        expect((await saveOpened(settings, "a.md", "line  \nnext\n")).disk).toBe("line  \nnext\n");
        expect((await saveOpened(settings, "a.ts", "line  \nnext\n")).disk).toBe("line\nnext\n");
    });

    it("the setting is read at save time: enabling it after opening applies on the next save", async () => {
        const { service, configuration } = createEditorService({});
        const fp = writeFile("a.txt", "a  \n");
        service.openFile(fp);
        const pane = service.getActiveEditor()!;
        await pane.save();
        expect(fs.readFileSync(fp, "utf-8")).toBe("a  \n");

        await configuration.updateValue("files.trimTrailingWhitespace", true);
        await pane.save();
        expect(fs.readFileSync(fp, "utf-8")).toBe("a\n");
    });

    it.each([
        [true, "xa\nb\n"],
        // An inactive tab was never rendered, so it has no tokens: every line is skipped.
        [false, "xa  \nb\t\n"],
    ])("Save All trims an inactive tab too (InRegexAndStrings %s)", async (inRegexAndStrings, expected) => {
        const { service } = createEditorService({
            "files.trimTrailingWhitespace": true,
            "files.trimTrailingWhitespaceInRegexAndStrings": inRegexAndStrings,
        });
        const fp = writeFile("first.txt", "a  \nb\t\n");
        service.openFile(fp);
        const first = service.getActiveEditor()!;
        first.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "x")], "edit");
        service.openFile(writeFile("second.txt", "s\n"));
        expect(service.getActiveEditor()).not.toBe(first);

        await service.saveAll();

        expect(fs.readFileSync(fp, "utf-8")).toBe(expected);
    });

    it("order: trim runs before format and insert final newline after it", async () => {
        const { service, languageFeatures } = createEditorService({
            ...ALL_ON,
            "editor.formatOnSave": true,
        });
        const fp = writeFile("a.txt", "a  ");
        service.openFile(fp);
        const pane = service.getActiveEditor()!;
        const seen: string[] = [];
        languageFeatures.documentFormattingEditProvider.register("*", {
            provideDocumentFormattingEdits: (_request: IFormattingRequest): Promise<readonly ITextEdit[]> => {
                seen.push(pane.getText());
                // The formatter leaves trailing whitespace: this save does not trim it again (as upstream).
                return Promise.resolve([createTextEdit(createRange(0, 1, 0, 1), "b ")]);
            },
        });

        await pane.save();

        expect(seen).toEqual(["a"]);
        expect(fs.readFileSync(fp, "utf-8")).toBe("ab \n");
    });

    it("the extension will-save participant runs last and sees the trimmed, terminated text", async () => {
        const { service } = createEditorService(ALL_ON);
        const fp = writeFile("a.txt", "a  \n\n");
        service.openFile(fp);
        const seen: string[] = [];
        service.saveParticipant = (snapshot) => {
            seen.push(snapshot.text);
            return Promise.resolve([]);
        };

        await service.getActiveEditor()!.save();

        expect(seen).toEqual(["a\n"]);
    });

    it("a file without trailing whitespace yields no edits: the version does not move", async () => {
        const { service } = createEditorService({ "files.trimTrailingWhitespace": true });
        const fp = writeFile("a.txt", "a\nb\n");
        service.openFile(fp);
        const pane = service.getActiveEditor()!;
        const version = pane.model.document.versionId;

        await pane.save();

        expect(pane.model.document.versionId).toBe(version);
    });

    it("InRegexAndStrings off: lines whose tail is in a string token keep it, code lines are trimmed", async () => {
        const { service } = createEditorService({
            "files.trimTrailingWhitespace": true,
            "files.trimTrailingWhitespaceInRegexAndStrings": false,
        });
        const fp = writeFile("a.ts", "const s = `a   \nb`;  \n");
        service.openFile(fp);
        const pane = service.getActiveEditor()!;
        // The template string spans line 0's tail; real TextMate tokens are covered by the drive check.
        pane.viewState.tokenStore = {
            hasAccurateTokensForLine: () => true,
            getLineTokens: (line: number) => ({
                findTokenIndexAtOffset: () => 0,
                getStandardTokenType: () => (line === 0 ? 2 : 0),
            }),
        } as unknown as NonNullable<typeof pane.viewState.tokenStore>;

        await pane.save();

        expect(fs.readFileSync(fp, "utf-8")).toBe("const s = `a   \nb`;\n");
    });
});
