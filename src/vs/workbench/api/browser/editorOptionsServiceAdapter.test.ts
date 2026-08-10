import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import type { EditorService } from "../../services/editor/browser/editorService.ts";

import { EditorOptionsServiceAdapter } from "./editorOptionsServiceAdapter.ts";

/**
 * Минимальный стаб EditorService — адаптер спрашивает у него **вкладку**
 * (`getActiveTabEditor()`), а не focus-aware активный редактор: фокус в нижней
 * панели не должен подменять расширению `activeTextEditor`. Здесь нам нужен
 * случай «нет активного редактора».
 */
/** Групповой срез фасада: одна группа (id 1, колонка 1) — мета и таргетинг. */
const GROUP_SURFACE = {
    groupOf: () => ({ id: 1 }),
    activeGroup: { id: 1 },
    viewColumnOf: () => 1,
    groups: [] as unknown[],
    getEditors: () => [] as unknown[],
};

function groupWithNoActiveEditor(): EditorService {
    return {
        ...GROUP_SURFACE,
        getActiveTabEditor: () => null,
    } as unknown as EditorService;
}

describe("EditorOptionsServiceAdapter", () => {
    it("getActiveEditorOptions() returns null when there is no active editor (line 20)", () => {
        const adapter = new EditorOptionsServiceAdapter(groupWithNoActiveEditor());
        expect(adapter.getActiveEditorOptions()).toBeNull();
    });

    it("getActiveEditorOptions() reads tabSize/insertSpaces from the active editor", () => {
        const group = {
            getActiveTabEditor: () => ({
                viewState: { tabSize: 4, insertSpaces: true },
            }),
        } as unknown as EditorService;
        const adapter = new EditorOptionsServiceAdapter(group);
        expect(adapter.getActiveEditorOptions()).toEqual({ tabSize: 4, insertSpaces: true });
    });

    it("setActiveEditorOptions() is a no-op when there is no active editor", () => {
        const adapter = new EditorOptionsServiceAdapter(groupWithNoActiveEditor());
        expect(() => {
            adapter.setActiveEditorOptions({ tabSize: 2 });
        }).not.toThrow();
    });

    it("setActiveEditorOptions() forwards the patch to the active editor", () => {
        const setIndentOptions = vi.fn();
        const group = {
            getActiveTabEditor: () => ({ setIndentOptions }),
        } as unknown as EditorService;
        const adapter = new EditorOptionsServiceAdapter(group);
        adapter.setActiveEditorOptions({ tabSize: 8 });
        expect(setIndentOptions).toHaveBeenCalledWith({ tabSize: 8 });
    });

    it("getActiveEditorFilePath() returns null when there is no active editor", () => {
        const adapter = new EditorOptionsServiceAdapter(groupWithNoActiveEditor());
        expect(adapter.getActiveEditorFilePath()).toBeNull();
    });

    it("getActiveEditorFilePath() отдаёт путь для file:-ресурса", () => {
        const group = {
            getActiveTabEditor: () => ({ uri: Uri.file("/a/b.ts"), languageId: "typescript", isModified: false }),
        } as unknown as EditorService;
        expect(new EditorOptionsServiceAdapter(group).getActiveEditorFilePath()).toBe("/a/b.ts");
    });

    it("getActiveEditorFilePath() отдаёт null для безымянного буфера, а не мусорный путь", () => {
        // fsPath у untitled: вернул бы относительный "Untitled-1" — потребителю
        // (editorconfig) такой «путь» скармливать нельзя.
        const group = {
            getActiveTabEditor: () => ({
                uri: Uri.parse("untitled:Untitled-1"),
                languageId: "plaintext",
                isModified: false,
            }),
        } as unknown as EditorService;
        expect(new EditorOptionsServiceAdapter(group).getActiveEditorFilePath()).toBeNull();
    });

    it("getActiveEditorMeta() reports uri/languageId/isDirty (nulls when no editor)", () => {
        const withEditor = {
            ...GROUP_SURFACE,
            getActiveTabEditor: () => ({
                uri: Uri.file("/a/b.ts"),
                languageId: "typescript",
                isModified: true,
                encoding: "windows1251",
                eol: 2,
            }),
        } as unknown as EditorService;
        expect(new EditorOptionsServiceAdapter(withEditor).getActiveEditorMeta()).toEqual({
            uri: Uri.file("/a/b.ts").toString(),
            languageId: "typescript",
            isDirty: true,
            encoding: "windows1251",
            eol: 2,
            selection: null,
            groupId: 1,
            viewColumn: 1,
        });
        expect(new EditorOptionsServiceAdapter(groupWithNoActiveEditor()).getActiveEditorMeta()).toEqual({
            uri: null,
            languageId: null,
            isDirty: false,
            encoding: null,
            eol: null,
            selection: null,
        });
    });

    it("onActiveEditorChanged() forwards active-editor meta, and nulls when there is no editor", () => {
        let registered: ((editor: unknown) => void) | undefined;
        const groupDisposable = { dispose: vi.fn() };
        const group = {
            ...GROUP_SURFACE,
            onActiveEditorChanged: (cb: (editor: unknown) => void) => {
                registered = cb;
                return groupDisposable;
            },
        } as unknown as EditorService;
        const adapter = new EditorOptionsServiceAdapter(group);

        const received: unknown[] = [];
        const subscription = adapter.onActiveEditorChanged((meta) => received.push(meta));

        // The adapter passes the group's disposable straight through.
        expect(subscription).toBe(groupDisposable);
        expect(registered).toBeDefined();

        // Active editor present → its meta is forwarded.
        registered!({
            uri: Uri.file("/a/b.ts"),
            languageId: "typescript",
            isModified: false,
            encoding: "utf8",
            eol: 1,
            viewState: {
                selections: [{ anchor: { line: 0, character: 2 }, active: { line: 1, character: 4 } }],
            },
        });
        // No active editor → nulls are forwarded.
        registered!(null);

        expect(received).toEqual([
            {
                uri: Uri.file("/a/b.ts").toString(),
                languageId: "typescript",
                isDirty: false,
                encoding: "utf8",
                eol: 1,
                selection: { anchorLine: 0, anchorCharacter: 2, activeLine: 1, activeCharacter: 4 },
                groupId: 1,
                viewColumn: 1,
            },
            { uri: null, languageId: null, isDirty: false, encoding: null, eol: null, selection: null },
        ]);
    });

    it("setActiveEditorSelections() — no-op при несовпадении uri", () => {
        const setSelections = vi.fn();
        const group = {
            getActiveTabEditor: () => ({
                uri: Uri.file("/a/b.ts"),
                get viewState() {
                    return {
                        get selections() {
                            return [];
                        },
                        set selections(v: unknown) {
                            setSelections(v);
                        },
                    };
                },
                focusEditor: vi.fn(),
            }),
        } as unknown as EditorService;
        const adapter = new EditorOptionsServiceAdapter(group);
        adapter.setActiveEditorSelections(Uri.file("/other.ts").toString(), [
            { anchorLine: 0, anchorCharacter: 0, activeLine: 0, activeCharacter: 1 },
        ]);
        expect(setSelections).not.toHaveBeenCalled();
    });

    it("applyActiveEditorEdits() — false при несовпадении uri, true при применении", () => {
        const applyExternalEdits = vi.fn();
        const editor = {
            uri: Uri.file("/a/b.ts"),
            model: { document: { lineCount: 3, getLineLength: () => 10 } },
            applyExternalEdits,
        };
        const group = { ...GROUP_SURFACE, getActiveTabEditor: () => editor } as unknown as EditorService;
        const adapter = new EditorOptionsServiceAdapter(group);

        const edit = { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 2 }, text: "hi" };
        expect(adapter.applyActiveEditorEdits(Uri.file("/other.ts").toString(), [edit])).toBe(false);
        expect(applyExternalEdits).not.toHaveBeenCalled();

        expect(adapter.applyActiveEditorEdits(Uri.file("/a/b.ts").toString(), [edit])).toBe(true);
        expect(applyExternalEdits).toHaveBeenCalledOnce();
    });

    it("applyActiveEditorEdits() — false, если нет активного редактора или пустой список", () => {
        const editor = {
            uri: Uri.file("/a/b.ts"),
            model: { document: { lineCount: 3, getLineLength: () => 10 } },
            applyExternalEdits: vi.fn(),
        };
        const group = { ...GROUP_SURFACE, getActiveTabEditor: () => editor } as unknown as EditorService;
        const adapter = new EditorOptionsServiceAdapter(group);
        expect(adapter.applyActiveEditorEdits(Uri.file("/a/b.ts").toString(), [])).toBe(false);
        expect(new EditorOptionsServiceAdapter(groupWithNoActiveEditor()).setActiveEditorSelections("x", [])).toBeUndefined();
    });

    it("клампит выделения и правки к границам документа", () => {
        let setSel: unknown;
        const applyExternalEdits = vi.fn();
        const editor = {
            uri: Uri.file("/a/b.ts"),
            model: { document: { lineCount: 3, getLineLength: () => 10 } },
            get viewState() {
                return {
                    get selections() {
                        return [];
                    },
                    set selections(v: unknown) {
                        setSel = v;
                    },
                };
            },
            focusEditor: vi.fn(),
            applyExternalEdits,
        };
        const group = { ...GROUP_SURFACE, getActiveTabEditor: () => editor } as unknown as EditorService;
        const adapter = new EditorOptionsServiceAdapter(group);
        const uri = Uri.file("/a/b.ts").toString();

        // anchor вне границ снизу/слева, active вне границ сверху/справа.
        adapter.setActiveEditorSelections(uri, [
            { anchorLine: -5, anchorCharacter: -3, activeLine: 99, activeCharacter: 999 },
        ]);
        expect(setSel).toEqual([
            { anchor: { line: 0, character: 0 }, active: { line: 2, character: 10 }, idealColumn: undefined },
        ]);

        adapter.applyActiveEditorEdits(uri, [
            { range: { startLine: -1, startCharacter: -1, endLine: 50, endCharacter: 50 }, text: "z" },
        ]);
        const applied = applyExternalEdits.mock.calls[0][0];
        expect(applied).toEqual([
            { range: { start: { line: 0, character: 0 }, end: { line: 2, character: 10 } }, text: "z" },
        ]);
    });

    // ── onActiveEditorSelectionChanged (#194) ────────────────────────────────
    // Продюсер `editor.selectionChanged`. Тест именно на «кто и когда шлёт»: без
    // него `activeTextEditor.selection` в расширении навсегда залипает на моменте
    // открытия файла, и любая команда, читающая выделение, молча ничего не делает.

    /**
     * Группа с одним редактором, у которого присваивание `viewState.selections`
     * реально фаерит `onDidChangeActiveEditorSelection` — как в живом
     * EditorService. Нужно, чтобы проверить эхо-гард на настоящем пути.
     */
    function groupWithLiveSelections(): { group: EditorService; selections: () => unknown[] } {
        const listeners: (() => void)[] = [];
        let current: unknown[] = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }];
        const editor = {
            uri: Uri.file("/a/b.ts"),
            model: { document: { lineCount: 10, getLineLength: () => 20 } },
            focusEditor: vi.fn(),
            viewState: {
                get selections(): unknown[] {
                    return current;
                },
                set selections(v: unknown[]) {
                    current = v;
                    for (const cb of [...listeners]) cb();
                },
            },
        };
        const group = {
            ...GROUP_SURFACE,
            getActiveTabEditor: () => editor,
            onDidChangeActiveEditorSelection: (cb: (e: unknown) => void) => {
                const wrapped = (): void => {
                    cb(editor);
                };
                listeners.push(wrapped);
                return {
                    dispose: () => {
                        listeners.splice(listeners.indexOf(wrapped), 1);
                    },
                };
            },
        } as unknown as EditorService;
        return { group, selections: () => current };
    }

    it("onActiveEditorSelectionChanged() шлёт выделения активного редактора", async () => {
        const { group } = groupWithLiveSelections();
        const adapter = new EditorOptionsServiceAdapter(group);
        const seen: unknown[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        group.getActiveTabEditor()!.viewState.selections = [
            { anchor: { line: 3, character: 1 }, active: { line: 3, character: 5 } },
        ] as never;
        await Promise.resolve();

        expect(seen).toEqual([
            {
                uri: Uri.file("/a/b.ts").toString(),
                selections: [{ anchorLine: 3, anchorCharacter: 1, activeLine: 3, activeCharacter: 5 }],
                groupId: 1,
            },
        ]);
    });

    it("onActiveEditorSelectionChanged() коалесит несколько смен в одну нотификацию", async () => {
        const { group } = groupWithLiveSelections();
        const adapter = new EditorOptionsServiceAdapter(group);
        const seen: unknown[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        const viewState = group.getActiveTabEditor()!.viewState;
        viewState.selections = [{ anchor: { line: 1, character: 0 }, active: { line: 1, character: 0 } }] as never;
        viewState.selections = [{ anchor: { line: 2, character: 0 }, active: { line: 2, character: 0 } }] as never;
        viewState.selections = [{ anchor: { line: 4, character: 0 }, active: { line: 4, character: 2 } }] as never;
        await Promise.resolve();

        // Одна нотификация — и в ней последнее состояние, а не первое.
        expect(seen).toHaveLength(1);
        expect((seen[0] as { selections: { activeLine: number }[] }).selections[0].activeLine).toBe(4);
    });

    it("не гоняет обратно выделение, которое поставил сам субпроцесс (эхо-гард)", async () => {
        const { group, selections } = groupWithLiveSelections();
        const adapter = new EditorOptionsServiceAdapter(group);
        const seen: unknown[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        adapter.setActiveEditorSelections(Uri.file("/a/b.ts").toString(), [
            { anchorLine: 1, anchorCharacter: 0, activeLine: 1, activeCharacter: 3 },
        ]);
        await Promise.resolve();

        // Выделение применено, но обратной нотификации нет — иначе расширение
        // получало бы эхо на каждое собственное `TextEditor.selection =`.
        expect(selections()).toHaveLength(1);
        expect(seen).toHaveLength(0);
    });

    it("если активный редактор исчез за тик — шлёт выделения того, кто событие поднял", async () => {
        const { group } = groupWithLiveSelections();
        const editor = group.getActiveTabEditor()!;
        const adapter = new EditorOptionsServiceAdapter(group);
        const seen: { uri: string }[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        editor.viewState.selections = [
            { anchor: { line: 2, character: 0 }, active: { line: 2, character: 1 } },
        ] as never;
        // Вкладку закрыли внутри того же тика, пока нотификация ждала flush.
        (group as unknown as { getActiveTabEditor: () => null }).getActiveTabEditor = () => null;
        await Promise.resolve();

        expect(seen).toHaveLength(1);
        expect(seen[0].uri).toBe(Uri.file("/a/b.ts").toString());
    });

    it("onActiveEditorSelectionChanged() снимается по dispose", async () => {
        const { group } = groupWithLiveSelections();
        const adapter = new EditorOptionsServiceAdapter(group);
        const seen: unknown[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s)).dispose();

        group.getActiveTabEditor()!.viewState.selections = [
            { anchor: { line: 3, character: 1 }, active: { line: 3, character: 5 } },
        ] as never;
        await Promise.resolve();

        expect(seen).toHaveLength(0);
    });

    it("вкладка вне полосы (groupOf → null) — groupId падает на активную группу", async () => {
        // Вкладку успели закрыть, пока нотификация ждала microtask-флаш: её
        // группы больше нет, и мета/нотификация несут координату активной.
        const listeners: (() => void)[] = [];
        const editor = {
            uri: Uri.file("/a/b.ts"),
            languageId: "typescript",
            isModified: false,
            encoding: "utf8",
            eol: 1,
            viewState: { selections: [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 1 } }] },
        };
        const group = {
            ...GROUP_SURFACE,
            groupOf: () => null,
            activeGroup: { id: 7 },
            viewColumnOf: () => 2,
            getActiveTabEditor: () => editor,
            onDidChangeActiveEditorSelection: (cb: (e: unknown) => void) => {
                listeners.push(() => {
                    cb(editor);
                });
                return { dispose: () => undefined };
            },
        } as unknown as EditorService;
        const adapter = new EditorOptionsServiceAdapter(group);

        expect(adapter.getActiveEditorMeta()).toMatchObject({ groupId: 7, viewColumn: 2 });

        const seen: { groupId?: number }[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));
        for (const fire of listeners) fire();
        await Promise.resolve();
        expect(seen).toEqual([
            {
                uri: Uri.file("/a/b.ts").toString(),
                selections: [{ anchorLine: 0, anchorCharacter: 0, activeLine: 0, activeCharacter: 1 }],
                groupId: 7,
            },
        ]);
    });

    it("getActiveEditorMeta() — selection null, когда выделений нет", () => {
        const group = {
            ...GROUP_SURFACE,
            getActiveTabEditor: () => ({
                uri: Uri.file("/a/b.ts"),
                languageId: "typescript",
                isModified: false,
                encoding: "utf8",
                eol: 1,
                viewState: { selections: [] },
            }),
        } as unknown as EditorService;
        expect(new EditorOptionsServiceAdapter(group).getActiveEditorMeta().selection).toBeNull();
    });
});
