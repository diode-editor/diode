import * as fs from "node:fs";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import type { InputElement } from "@tuidom/elements/inputbox/inputElement";
import type { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestContextMenuService } from "../../../../../TestUtils/testContextMenuService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { DISK_INDEX_CHUNK_SIZE } from "../../../../editor/common/model/diskTextBuffer.ts";
import { MATCHES_LIMIT } from "../../../../editor/contrib/find/findMatches.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { nodeRandomAccessFileOpener } from "../../../../platform/files/node/nodeRandomAccessFile.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { EditorGroupComponent } from "../../../browser/parts/editor/editorGroupComponent.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { EditorService } from "../../../services/editor/browser/editorService.ts";
import { TextFileModelService } from "../../../services/textfile/common/textFileModelService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { FindComponent, type FindWidget } from "./findComponent.ts";
import { FindService } from "./findService.ts";

const LINE = "2026-01-01T00:00:00.000Z INFO worker request handled path=/api/v1/items";
/** Past the first chunk (4 MiB is about 54 000 of these lines): the needle is indexed by the background pass. */
const NEEDLE_LINE = 70_000;

/** Longer than the first chunk (4 MiB): the index has a background pass the search has to wait for. */
function writeLog(path: string): number {
    const lines: string[] = [];
    let size = 0;
    for (let i = 0; size < DISK_INDEX_CHUNK_SIZE + DISK_INDEX_CHUNK_SIZE / 2; i++) {
        const line = i === NEEDLE_LINE ? `${String(i)} ${LINE} needle\n` : `${String(i)} ${LINE}\n`;
        lines.push(line);
        size += line.length;
    }
    fs.writeFileSync(path, lines.join(""));
    return lines.length;
}

function typeQuery(widget: FindWidget, query: string): void {
    const input = widget.view.querySelector("InputElement") as InputElement;
    input.inputState.value = query;
    input.onChange?.(query);
}

function counterText(widget: FindWidget): string {
    const texts = (widget.view.querySelectorAll("TextLabelElement") as TextLabelElement[]).map((label) =>
        label.getText(),
    );
    return texts.find((text) => /of|results|Searching/u.test(text)) ?? "";
}

/**
 * The find over a document on disk (OpenPerformance 4.3): the walk runs in the background from the cursor on,
 * the matches show up as they are found, Next/Prev work meanwhile, and the collection stops at the upstream
 * limit — seen through the service, the widget and the editor, as the user sees it.
 */
describe("FindService over a document on disk", () => {
    let ws: ITempWorkspace;
    let lines = 0;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-find-on-disk-" });
        lines = writeLog(ws.path("huge.log"));
    });

    afterEach(() => {
        ws.dispose();
    });

    function setup() {
        const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
        // Above 1 MiB the file stays on disk (docs/arch/Editor.md).
        const configuration = createTestConfigurationService({ "editor.largeFileSizeThreshold": 1 });
        const undoRedo = new UndoRedoService();
        const files = diskFileService();
        const textFileModels = new TextFileModelService(
            NULL_LANGUAGE_SERVICE,
            undoRedo,
            files,
            NULL_FILE_WATCHER,
            configuration,
            nodeRandomAccessFileOpener,
        );
        const group = new EditorService(
            themeService,
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            NULL_LANGUAGE_SERVICE,
            configuration,
            undoRedo,
            NULL_FILE_WATCHER,
            createTestEditorContextMenuController(),
            NULL_LOG_SERVICE,
            undefined,
            undefined,
            undefined,
            undefined,
            files,
            textFileModels,
        );
        const groupComponent = new EditorGroupComponent(
            group.editorGroups.activeGroup,
            group,
            createTestContextMenuService(),
            group.editorGroups,
        );
        group.openFile(ws.path("huge.log"));
        const body = new BodyElement();
        body.setContent(groupComponent.view);
        const testApp = TestApp.create(body, new Size(100, 24));
        testApp.render();

        const component = new FindComponent({ groupOverlayHost: () => groupComponent.view });
        const find = new FindService(component, group, group.editorGroups);
        const widget = component.widgetFor(group.editorGroups.activeGroup.id)!;
        const editor = group.getActiveEditor()!;
        expect(editor.fileModel?.isOnDisk).toBe(true);
        return { find, widget, editor, group, testApp };
    }

    function indexed(editor: TextEditorPane): Promise<void> {
        const model = editor.fileModel!;
        if (model.diskIndexing?.done !== false) return Promise.resolve();
        return new Promise((resolve) => {
            const subscription = model.onDidChangeDiskIndexing(() => {
                if (model.diskIndexing?.done !== true) return;
                subscription.dispose();
                resolve();
            });
        });
    }

    async function searchDone(widget: FindWidget): Promise<void> {
        await vi.waitFor(
            () => {
                expect(counterText(widget)).not.toMatch(/…/u);
            },
            { timeout: 20_000, interval: 20 },
        );
    }

    it("a dense query: the first matches are in before the first frame, the counter grows, the limit ends the walk", async () => {
        const { find, widget, editor } = setup();
        find.open();
        typeQuery(widget, "request");

        // The first slice ran synchronously.
        expect(editor.viewState.searchMatches.length).toBeGreaterThan(0);
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
        expect(editor.viewState.searchMatches[0].start.line).toBe(0);

        await searchDone(widget);
        expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT);
        expect(counterText(widget)).toBe(`1 of ${String(MATCHES_LIMIT)}+`);
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
    });

    it("a rare query: «Searching…» while the walk runs, then the lone match is current and revealed", async () => {
        const { find, widget, editor } = setup();
        find.open();
        typeQuery(widget, "needle");
        expect(editor.viewState.searchMatches).toEqual([]);
        expect(counterText(widget)).toBe("Searching…");

        await searchDone(widget);
        expect(counterText(widget)).toBe("1 of 1");
        expect(editor.viewState.searchMatches.map((m) => m.start.line)).toEqual([NEEDLE_LINE]);
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
        // Revealed: the match is in the viewport.
        expect(editor.viewState.scrollTop).toBeLessThanOrEqual(NEEDLE_LINE);
        expect(editor.viewState.scrollTop + editor.viewState.viewportHeight).toBeGreaterThan(NEEDLE_LINE);
    });

    it("the walk waits for the index: a match in the part indexed later is found once it is in", async () => {
        const { find, widget, editor } = setup();
        // The needle sits past the first chunk.
        expect(editor.lineCount).toBeLessThan(NEEDLE_LINE);
        find.open();
        typeQuery(widget, "needle");
        await indexed(editor);
        expect(editor.lineCount).toBe(lines + 1);
        await searchDone(widget);
        expect(counterText(widget)).toBe("1 of 1");
    });

    it("a query without matches ends with «No results» only when the whole document was walked", async () => {
        const { find, widget, editor } = setup();
        find.open();
        typeQuery(widget, "zzz");
        expect(counterText(widget)).toBe("Searching…");
        await indexed(editor);
        await searchDone(widget);
        expect(counterText(widget)).toBe("No results");
        expect(editor.viewState.searchMatches).toEqual([]);
    });

    it("Next and Prev work while the walk runs, and the current match survives the progress", async () => {
        const { find, widget, editor } = setup();
        find.open();
        typeQuery(widget, "request");
        expect(counterText(widget)).toMatch(/^1 of \d+…$/u);
        find.next();
        expect(editor.viewState.currentSearchMatchIndex).toBe(1);
        find.next();
        expect(editor.viewState.currentSearchMatchIndex).toBe(2);
        find.prev();
        expect(editor.viewState.currentSearchMatchIndex).toBe(1);
        expect(counterText(widget)).toMatch(/^2 of \d+…$/u);
        const current = editor.viewState.searchMatches[1];

        await searchDone(widget);
        expect(editor.viewState.searchMatches[editor.viewState.currentSearchMatchIndex]).toBe(current);
        expect(counterText(widget)).toBe(`2 of ${String(MATCHES_LIMIT)}+`);
    });

    it("the walk starts at the cursor: the current match is the first after it, and the lines above arrive after the wrap", async () => {
        const { find, widget, editor } = setup();
        await indexed(editor);
        const cursorLine = lines - 100;
        editor.viewState.selections = [createCursorSelection(cursorLine, 0)];
        find.open();
        typeQuery(widget, "request");
        const first = editor.viewState.searchMatches[editor.viewState.currentSearchMatchIndex];
        expect(first.start.line).toBe(cursorLine);
        expect(editor.viewState.searchMatches[0].start.line).toBe(cursorLine);

        await searchDone(widget);
        // The list is in document order and the current match is the same one, now deeper in the list.
        expect(editor.viewState.searchMatches[0].start.line).toBe(0);
        const index = editor.viewState.currentSearchMatchIndex;
        expect(editor.viewState.searchMatches[index]).toBe(first);
        expect(index).toBe(MATCHES_LIMIT - 100);
        expect(counterText(widget)).toBe(`${String(index + 1)} of ${String(MATCHES_LIMIT)}+`);
    });

    it("past the ends of a capped list, Next and Prev search the document from the current match (upstream findNextMatch)", async () => {
        const { find, widget, editor } = setup();
        await indexed(editor);
        const cursorLine = 40_000;
        editor.viewState.selections = [createCursorSelection(cursorLine, 0)];
        find.open();
        typeQuery(widget, "request");
        await searchDone(widget);
        // The limit was reached on the lines after the cursor: the list starts at the cursor's line.
        expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT);
        expect(editor.viewState.searchMatches[0].start.line).toBe(cursorLine);
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);

        find.prev();
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
        expect(editor.viewState.searchMatches[0].start.line).toBe(cursorLine - 1);
        expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT + 1);
        expect(counterText(widget)).toBe(`1 of ${String(MATCHES_LIMIT)}+`);

        find.prev();
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
        expect(editor.viewState.searchMatches[0].start.line).toBe(cursorLine - 2);
        // Inside the list the steps are ordinary.
        find.next();
        find.next();
        expect(editor.viewState.currentSearchMatchIndex).toBe(2);
        expect(editor.viewState.searchMatches[2].start.line).toBe(cursorLine);
        expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT + 2);
    });

    it("past the ends of a capped list, a match the document search wraps to is taken from the list, not duplicated", async () => {
        const { find, widget, editor } = setup();
        await indexed(editor);
        // The cursor on the last matching line: the list is that line plus the top of the file after the wrap.
        const lastMatching = lines - 1;
        editor.viewState.selections = [createCursorSelection(lastMatching, 0)];
        find.open();
        typeQuery(widget, "request");
        await searchDone(widget);
        expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT);
        expect(editor.viewState.searchMatches[0].start.line).toBe(0);
        expect(editor.viewState.searchMatches[MATCHES_LIMIT - 1].start.line).toBe(lastMatching);
        expect(editor.viewState.currentSearchMatchIndex).toBe(MATCHES_LIMIT - 1);

        // Next from the document's last match wraps to its first, which the list holds already.
        find.next();
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
        expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT);
        // And back.
        find.prev();
        expect(editor.viewState.currentSearchMatchIndex).toBe(MATCHES_LIMIT - 1);
        expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT);
    });

    it("closing the widget or retyping the query stops the walk: no late report touches the editor", async () => {
        const { find, widget, editor } = setup();
        find.open();
        typeQuery(widget, "needle");
        expect(counterText(widget)).toBe("Searching…");
        find.close();
        expect(editor.viewState.searchMatches).toEqual([]);
        await indexed(editor);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(editor.viewState.searchMatches).toEqual([]);
        expect(editor.viewState.currentSearchMatchIndex).toBe(-1);

        find.open();
        typeQuery(widget, "needl");
        typeQuery(widget, "needle");
        await searchDone(widget);
        expect(counterText(widget)).toBe("1 of 1");
        expect(editor.viewState.searchMatches).toHaveLength(1);
    });

    it("Next before any match after the cursor is in starts at the top of the list", async () => {
        const { find, widget, editor } = setup();
        await indexed(editor);
        // The cursor on the last (empty) line: the only matches of the first slice are the ones after the wrap.
        editor.viewState.selections = [createCursorSelection(lines, 0)];
        find.open();
        typeQuery(widget, "needle");
        expect(editor.viewState.currentSearchMatchIndex).toBe(-1);
        await searchDone(widget);
        expect(counterText(widget)).toBe("1 of 1");
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
    });
});
