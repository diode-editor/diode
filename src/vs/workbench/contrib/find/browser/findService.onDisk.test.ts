import * as fs from "node:fs";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import type { InputElement } from "@tuidom/elements/inputbox/inputElement";
import type { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The walks over the 6 MiB file wait for the index and for the end of the walk with 20 s waits.
vi.setConfig({ testTimeout: 60_000 });

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { memoryFileOpener } from "../../../../../TestUtils/memoryRandomAccessFile.ts";
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
import type { IRandomAccessFileOpener } from "../../../../platform/files/common/iRandomAccessFile.ts";
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

    function setup(name = "huge.log", opener: IRandomAccessFileOpener = nodeRandomAccessFileOpener) {
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
            opener,
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
        group.openFile(ws.path(name));
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

        // Past the first element the document is read (the line before the list's first line).
        const reads = vi.spyOn(editor.viewState.document, "getLineContent");
        const linesRead = () => new Set(reads.mock.calls.map((call) => call[0]));
        find.prev();
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
        expect(editor.viewState.searchMatches[0].start.line).toBe(cursorLine - 1);
        expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT + 1);
        expect(counterText(widget)).toBe(`1 of ${String(MATCHES_LIMIT)}+`);
        expect(linesRead().has(cursorLine - 1)).toBe(true);

        find.prev();
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
        expect(editor.viewState.searchMatches[0].start.line).toBe(cursorLine - 2);
        // Back through the matches the document search added: the same objects, nothing duplicated.
        find.next();
        find.next();
        expect(editor.viewState.currentSearchMatchIndex).toBe(2);
        expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT + 2);
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
        const reads = vi.spyOn(editor.viewState.document, "getLineContent");
        find.next();
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
        expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT);
        // The document was searched (the empty last line, then the top), not the list stepped.
        expect(reads.mock.calls.some((call) => call[0] === lines)).toBe(true);
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
        // Long enough for a walk that was not stopped to reach the needle and report it.
        await new Promise((resolve) => setTimeout(resolve, 1000));
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

    it("the walk is case-insensitive and matches inside words, as the in-memory find does", () => {
        const { find, widget, editor } = setup();
        find.open();
        typeQuery(widget, "REQ");
        const [first] = editor.viewState.searchMatches;
        expect(first).toBeDefined();
        expect(first.end.character - first.start.character).toBe(3);
    });

    it("disposing the service stops the walk: no late report reaches the editor", async () => {
        const { find, widget, editor } = setup();
        find.open();
        typeQuery(widget, "needle");
        find.dispose();
        await indexed(editor);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(editor.viewState.searchMatches).toEqual([]);
        expect(editor.viewState.currentSearchMatchIndex).toBe(-1);
    });

    it("Prev from the first of a list that starts at the top wraps to the document's last match and appends it", async () => {
        const { find, widget, editor } = setup();
        await indexed(editor);
        find.open();
        typeQuery(widget, "request");
        await searchDone(widget);
        expect(editor.viewState.searchMatches[0].start.line).toBe(0);
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
        find.prev();
        expect(editor.viewState.currentSearchMatchIndex).toBe(MATCHES_LIMIT);
        expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT + 1);
        expect(editor.viewState.searchMatches[MATCHES_LIMIT].start.line).toBe(lines - 1);
    });

    describe("matches found so far only before the cursor on its own line", () => {
        /** Line 0 holds two needles, the rest is filler: the first slice has no match after the cursor and the walk is not over. */
        function writeGap(): void {
            fs.writeFileSync(ws.path("gap.log"), "needle needle tail\n" + "filler line of the log\n".repeat(60_000));
        }

        it("F3 with the widget closed goes to the first of them once the walk wrapped, Shift+F3 to the last", async () => {
            writeGap();
            const first = setup("gap.log");
            first.editor.viewState.selections = [createCursorSelection(0, 18)];
            first.widget.setQuery("needle");
            first.find.next();
            // No match after the cursor: the walk has to see the whole file before it wraps to line 0.
            expect(first.editor.viewState.selections[0].active).toEqual({ line: 0, character: 18 });
            await vi.waitFor(
                () => {
                    expect(first.editor.viewState.selections[0].active).toEqual({ line: 0, character: 6 });
                },
                { timeout: 20_000, interval: 20 },
            );
            expect(first.editor.viewState.searchMatches).toHaveLength(2);
            expect(first.editor.viewState.currentSearchMatchIndex).toBe(0);
            expect(first.editor.viewState.selections[0]).toMatchObject({
                anchor: { line: 0, character: 0 },
                active: { line: 0, character: 6 },
            });

            const last = setup("gap.log");
            last.editor.viewState.selections = [createCursorSelection(0, 18)];
            last.widget.setQuery("needle");
            last.find.prev();
            await vi.waitFor(
                () => {
                    expect(last.editor.viewState.currentSearchMatchIndex).toBe(1);
                },
                { timeout: 20_000, interval: 20 },
            );
            expect(last.editor.viewState.selections[0]).toMatchObject({
                anchor: { line: 0, character: 7 },
                active: { line: 0, character: 13 },
            });
        });
    });

    describe("edges found by QA (OpenPerformance 4.3)", () => {
        it("Prev from the first match after the cursor goes to the line just above it when the cap was hit after the wrap", async () => {
            const { find, widget, editor } = setup();
            await indexed(editor);
            // Every line matches. The lines from the cursor on hold fewer than the limit, so the walk wraps and
            // stops at the limit on the top of the file: the lines between that stop and the cursor are not in.
            const cursorLine = lines - 10_000;
            editor.viewState.selections = [createCursorSelection(cursorLine, 0)];
            find.open();
            typeQuery(widget, "request");
            await searchDone(widget);
            const current = () => editor.viewState.searchMatches[editor.viewState.currentSearchMatchIndex];
            expect(current().start.line).toBe(cursorLine);

            find.prev();
            // The previous match of the document is on the line above the cursor, as upstream's Shift+Enter gives.
            expect(current().start.line).toBe(cursorLine - 1);
            expect(editor.viewState.scrollTop).toBeLessThanOrEqual(cursorLine - 1);
        });

        it("the current match is the first after the cursor even when the index brings it in after the walk wrapped", async () => {
            // A needle on line 1 (above the cursor) and one past the first chunk (below it, indexed later).
            const body: string[] = [];
            for (let i = 0; i < 90_000; i++) {
                body.push(i === 1 || i === NEEDLE_LINE ? `${String(i)} ${LINE} needle` : `${String(i)} ${LINE}`);
            }
            fs.writeFileSync(ws.path("wrap.log"), body.join("\n") + "\n");
            const opener = memoryFileOpener({ size: 32 * 1024 * 1024, gated: true });
            const { find, widget, editor } = setup("wrap.log", opener);
            expect(editor.lineCount).toBeLessThan(NEEDLE_LINE);
            editor.viewState.selections = [createCursorSelection(10, 0)];
            find.open();
            typeQuery(widget, "needle");
            await new Promise((resolve) => setTimeout(resolve, 300));
            opener.opened[0].openGate();
            await indexed(editor);
            await searchDone(widget);

            // Upstream's research picks the nearest match after the cursor: line 70 000, the second of two.
            expect(counterText(widget)).toBe("2 of 2");
            const current = editor.viewState.searchMatches[editor.viewState.currentSearchMatchIndex];
            expect(current.start.line).toBe(NEEDLE_LINE);
        });

        it("F3 with the widget closed selects a match the walk finds past the first slice", async () => {
            const { find, widget, editor } = setup();
            await indexed(editor);
            find.open();
            typeQuery(widget, "needle");
            await searchDone(widget);
            find.close();
            editor.viewState.selections = [createCursorSelection(0, 0)];

            // F3: the needle is far past the first slice, the walk finds it in the background.
            find.next();
            await vi.waitFor(
                () => {
                    expect(editor.viewState.searchMatches).toHaveLength(1);
                },
                { timeout: 20_000, interval: 20 },
            );
            // As upstream's NextMatchFindAction: the match becomes the selection.
            expect(editor.viewState.selections[0]).toMatchObject({
                anchor: { line: NEEDLE_LINE },
                active: { line: NEEDLE_LINE },
            });
        });
    });

    describe("with the index held back (gated reads)", () => {
        function setupGated() {
            const opener = memoryFileOpener({ size: 32 * 1024 * 1024, gated: true });
            const result = setup("huge.log", opener);
            return { ...result, file: opener.opened[0] };
        }

        it("the walk waits at the indexed end for the index and goes on when it grows", async () => {
            const { find, widget, editor, file } = setupGated();
            expect(editor.lineCount).toBeLessThan(NEEDLE_LINE);
            find.open();
            typeQuery(widget, "needle");
            await new Promise((resolve) => setTimeout(resolve, 300));
            // The indexed part is walked; the walk is not over, the index is.
            expect(counterText(widget)).toBe("Searching…");
            expect(editor.viewState.searchMatches).toEqual([]);
            file.openGate();
            await indexed(editor);
            await searchDone(widget);
            expect(counterText(widget)).toBe("1 of 1");
        });

        it("the current match the user stepped to survives the final report, which does not scroll the view either", async () => {
            const { find, widget, editor, file } = setupGated();
            editor.viewState.selections = [createCursorSelection(10, 0)];
            find.open();
            // Lines whose number ends in 1: every tenth line, far below the limit.
            typeQuery(widget, "1 2026");
            // The walk waits for the index below the cursor; the first match after it (line 11) is current.
            await vi.waitFor(
                () => {
                    expect(counterText(widget)).toMatch(/^1 of \d+…$/u);
                },
                { timeout: 20_000, interval: 20 },
            );
            expect(editor.viewState.searchMatches[editor.viewState.currentSearchMatchIndex].start.line).toBe(11);
            find.next();
            const stepped = editor.viewState.searchMatches[editor.viewState.currentSearchMatchIndex];
            expect(stepped.start.line).toBe(21);
            editor.viewState.scrollTop = 5000;

            file.openGate();
            await indexed(editor);
            await searchDone(widget);
            // The wrap put line 1 in front of it: the same match, now third.
            expect(editor.viewState.searchMatches[editor.viewState.currentSearchMatchIndex]).toBe(stepped);
            expect(counterText(widget)).toMatch(/^3 of \d+$/u);
            expect(editor.viewState.scrollTop).toBe(5000);
        });
    });

    describe("the lines a capped walk left out after its wrap", () => {
        it("Next from the last match above the gap goes to the line just below it, not across to the cursor", async () => {
            const { find, widget, editor } = setup();
            await indexed(editor);
            const cursorLine = lines - 10_000;
            editor.viewState.selections = [createCursorSelection(cursorLine, 0)];
            find.open();
            typeQuery(widget, "request");
            await searchDone(widget);
            const current = () => editor.viewState.searchMatches[editor.viewState.currentSearchMatchIndex];
            // Walk back to the first match after the cursor, then one more Prev into the gap and Next out of it.
            find.prev();
            expect(current().start.line).toBe(cursorLine - 1);
            find.prev();
            expect(current().start.line).toBe(cursorLine - 2);
            find.next();
            expect(current().start.line).toBe(cursorLine - 1);
            find.next();
            expect(current().start.line).toBe(cursorLine);

            // The top of the list: the last match collected above the gap, Next goes to the line after it.
            const top = MATCHES_LIMIT - 1 - (lines - cursorLine);
            editor.viewState.selections = [createCursorSelection(0, 0)];
            find.close();
            editor.viewState.selections = [createCursorSelection(cursorLine, 0)];
            find.open();
            await searchDone(widget);
            const lastAbove = editor.viewState.searchMatches.findIndex((m) => m.start.line >= cursorLine) - 1;
            expect(editor.viewState.searchMatches[lastAbove].start.line).toBe(top);
            for (let i = editor.viewState.currentSearchMatchIndex; i > lastAbove; i--) find.prev();
            expect(current().start.line).toBe(cursorLine - 1);
        });

        it("a gap without matches in it: Prev and Next across it find the list's own neighbours, nothing is duplicated", async () => {
            // The top lines match until the limit is exactly full, then a block without the query, then the cursor's lines.
            const below = 10;
            const filler = "a".repeat(60);
            const body = [
                ...Array.from({ length: MATCHES_LIMIT - below }, () => `q ${filler}`),
                ...Array.from({ length: 2_000 }, () => filler),
                ...Array.from({ length: below }, () => `q ${filler}`),
            ];
            fs.writeFileSync(ws.path("holes.log"), body.join("\n") + "\n");
            const { find, widget, editor } = setup("holes.log");
            await indexed(editor);
            const cursorLine = MATCHES_LIMIT - below + 2_000;
            editor.viewState.selections = [createCursorSelection(cursorLine, 0)];
            find.open();
            typeQuery(widget, "q");
            await searchDone(widget);
            expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT);
            const current = () => editor.viewState.searchMatches[editor.viewState.currentSearchMatchIndex];
            expect(current().start.line).toBe(cursorLine);
            find.prev();
            expect(current().start.line).toBe(MATCHES_LIMIT - below - 1);
            expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT);
            find.next();
            expect(current().start.line).toBe(cursorLine);
            expect(editor.viewState.searchMatches).toHaveLength(MATCHES_LIMIT);
        });
    });
});
