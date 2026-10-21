import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type {
    ICoreRenameLocation,
    ICoreRenameResult,
    IRenameRequest,
    RenameProvider,
} from "../../../../editor/common/languages/iRenameSource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { InputBoxOptions, QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";

import { RenameService } from "./renameService.ts";

// Only the name input box and the status bar are faked — otherwise there's no way to "type" a name or read an error.

describe("RenameService — Rename Symbol", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let features: ILanguageFeaturesService;
    /** What the input box returns on the next show (undefined = Escape). */
    let typed: (string | undefined)[];
    let opened: InputBoxOptions[];
    let notices: string[];

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-rename-",
            files: { "main.ts": "const value = 1;\nconsole.log(value);\n" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
        features = new LanguageFeaturesService();
        typed = [];
        opened = [];
        notices = [];
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const group = (): IEditorService => h.container.get(EditorServiceDIToken);

    /** `"*"` selector: the harness has no LanguageService, every file is `plaintext`. */
    function provider(impl: Partial<RenameProvider>): RenameProvider {
        const full: RenameProvider = {
            prepareRename: impl.prepareRename ?? ((): Promise<null> => Promise.resolve(null)),
            provideRenameEdits:
                impl.provideRenameEdits ?? ((): Promise<ICoreRenameResult> => Promise.resolve({ applied: false })),
        };
        features.renameProvider.register("*", full);
        return full;
    }

    const name = (value: string): Promise<ICoreRenameLocation> => Promise.resolve({ kind: "name", name: value });

    function service(): RenameService {
        const quickInput = {
            input: (opts: InputBoxOptions = {}) => {
                opened.push(opts);
                return Promise.resolve(typed.shift());
            },
        } as unknown as QuickInputService;
        const statusBar = {
            addEntry: (entry: { id: string; text: string }) => {
                notices.push(`${entry.id}: ${entry.text}`);
                return { dispose: () => undefined };
            },
        } as unknown as StatusBarService;
        return new RenameService(group(), quickInput, statusBar, features);
    }

    /** Puts the cursor inside the word `value` in the declaration (line 0, column 8). */
    function caretOnValue(): void {
        group().getActiveEditor()?.goToPosition(0, 8);
    }

    it("the name from prepare fills the input, the new name goes to the provider", async () => {
        const seen: { request?: IRenameRequest; newName?: string } = {};
        provider({
            prepareRename: () => name("value"),
            provideRenameEdits: (request, newName) => {
                seen.request = request;
                seen.newName = newName;
                return Promise.resolve({ applied: true });
            },
        });
        caretOnValue();
        typed = ["renamed"];

        await service().rename();

        expect(opened).toHaveLength(1);
        expect(opened[0]).toEqual({
            title: "Rename Symbol",
            prompt: "Enter the new name; Escape to cancel",
            value: "value",
        });
        expect(seen.newName).toBe("renamed");
        expect(seen.request).toMatchObject({
            uri: Uri.file(ws.path("main.ts")).toString(),
            line: 0,
            character: 8,
        });
        expect(seen.request?.versionId).toBe(group().getActiveEditor()?.model.document.versionId);
        expect(notices).toEqual([]);
    });

    it("prepare returned null — the input is filled with the word at the cursor (upstream fallback)", async () => {
        provider({ provideRenameEdits: () => Promise.resolve({ applied: true }) });
        caretOnValue();
        typed = ["renamed"];

        await service().rename();

        expect(opened[0]).toMatchObject({ value: "value" });
    });

    it("prepare refused — the reason goes to the user, no input box", async () => {
        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        provider({
            prepareRename: () => Promise.resolve({ kind: "reject", reason: "You cannot rename this element." }),
            provideRenameEdits,
        });
        caretOnValue();
        typed = ["renamed"];

        await service().rename();

        expect(opened).toEqual([]);
        expect(provideRenameEdits).not.toHaveBeenCalled();
        expect(notices).toEqual(["rename.notice: Rename failed: You cannot rename this element."]);
    });

    it("prepare returned null AND the cursor is not on a word — no input box at all", async () => {
        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        provider({ provideRenameEdits });
        // Column 13 is the space after `=`: there's no word at the cursor or
        // before it (a cursor right AFTER a word still counts as on the word,
        // so column 5 won't do).
        group().getActiveEditor()?.goToPosition(0, 13);

        await service().rename();

        expect(opened).toEqual([]);
        expect(provideRenameEdits).not.toHaveBeenCalled();
    });

    it("cursor past the last line — a silent no-op, not a crash", async () => {
        // The whole group is fake: a real editor clamps the position, but the
        // fallback must survive a line that went stale for a frame (see
        // `referencesService.test.ts`, the "cursor past the end of the text" case).
        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        provider({ provideRenameEdits });
        const fakeGroup = {
            getActiveEditor: () => ({
                uri: Uri.file(ws.path("main.ts")),
                languageId: "typescript",
                getText: () => "const value = 1;\n",
                model: { document: { versionId: 1 } },
                viewState: { selections: [{ active: { line: 99, character: 0 } }] },
            }),
        } as unknown as IEditorService;

        await new RenameService(
            fakeGroup,
            { input: () => Promise.resolve("renamed") } as unknown as QuickInputService,
            { addEntry: () => ({ dispose: () => undefined }) } as unknown as StatusBarService,
            features,
        ).rename();

        expect(provideRenameEdits).not.toHaveBeenCalled();
    });

    it("Escape (undefined) and the same name — the provider is not called", async () => {
        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        provider({ prepareRename: () => name("value"), provideRenameEdits });
        caretOnValue();
        typed = [undefined, "value"];

        await service().rename();
        await service().rename();

        expect(opened).toHaveLength(2);
        expect(provideRenameEdits).not.toHaveBeenCalled();
        expect(notices).toEqual([]);
    });

    it("empty name — a message, the provider is not called", async () => {
        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        provider({ prepareRename: () => name("value"), provideRenameEdits });
        caretOnValue();
        typed = [""];

        await service().rename();

        expect(provideRenameEdits).not.toHaveBeenCalled();
        expect(notices).toEqual(["rename.notice: Rename failed: the new name is empty"]);
    });

    it("provider refusal with a message is shown to the user", async () => {
        provider({
            prepareRename: () => name("value"),
            provideRenameEdits: () => Promise.resolve({ applied: false, error: "'class' is not a valid identifier" }),
        });
        caretOnValue();
        typed = ["class"];

        await service().rename();

        expect(notices).toEqual(["rename.notice: Rename failed: 'class' is not a valid identifier"]);
    });

    it("refusal WITHOUT a message is silent: there was nothing to rename", async () => {
        provider({ prepareRename: () => name("value"), provideRenameEdits: () => Promise.resolve({ applied: false }) });
        caretOnValue();
        typed = ["renamed"];

        await service().rename();

        expect(notices).toEqual([]);
    });

    it("the version is recomputed at apply time: the provider sees the live document", async () => {
        const seen: { prepared?: number; applied?: number } = {};
        provider({
            prepareRename: (request) => {
                seen.prepared = request.versionId;
                return name("value");
            },
            provideRenameEdits: (request) => {
                seen.applied = request.versionId;
                return Promise.resolve({ applied: true });
            },
        });
        caretOnValue();
        const editor = group().getActiveEditor();
        const quickInput = {
            input: () => {
                // While the name is being "typed", the document moves on — as from an auto-import.
                editor?.pushUndo(editor.viewState.insertText("// touched\n"));
                return Promise.resolve("renamed");
            },
        } as unknown as QuickInputService;
        const statusBar = { addEntry: () => ({ dispose: () => undefined }) } as unknown as StatusBarService;

        await new RenameService(group(), quickInput, statusBar, features).rename();

        expect(seen.applied).toBe(editor?.model.document.versionId);
        expect(seen.applied).not.toBe(seen.prepared);
    });

    it("the editor closed while the name was being typed — the provider gets the request snapshot", async () => {
        const seen: { prepared?: number; applied?: number } = {};
        provider({
            prepareRename: (request) => {
                seen.prepared = request.versionId;
                return name("value");
            },
            provideRenameEdits: (request) => {
                seen.applied = request.versionId;
                return Promise.resolve({ applied: true });
            },
        });
        caretOnValue();
        const real = group();
        const editor = real.getActiveEditor();
        // The group returns the editor before the input is shown and `null` after — that's how
        // a closed group (or one that lost its active editor) behaves.
        let closed = false;
        const closingGroup = {
            getActiveEditor: () => (closed ? null : editor),
        } as unknown as IEditorService;
        const quickInput = {
            input: () => {
                // The document also moved on, but the group has no live editor anymore.
                editor?.pushUndo(editor.viewState.insertText("// touched\n"));
                closed = true;
                return Promise.resolve("renamed");
            },
        } as unknown as QuickInputService;
        const statusBar = { addEntry: () => ({ dispose: () => undefined }) } as unknown as StatusBarService;

        await new RenameService(closingGroup, quickInput, statusBar, features).rename();

        // The snapshot is the one taken BEFORE the input was shown: the live document is gone.
        expect(seen.applied).toBeDefined();
        expect(seen.applied).toBe(seen.prepared);
        expect(seen.applied).not.toBe(editor?.model.document.versionId);
    });

    it("no providers for the document and no active editor — no-op", async () => {
        caretOnValue();
        typed = ["renamed"];
        await service().rename();
        expect(opened).toEqual([]);

        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        provider({ prepareRename: () => name("value"), provideRenameEdits });
        const emptyGroup = { getActiveEditor: () => null } as unknown as IEditorService;
        await new RenameService(
            emptyGroup,
            { input: () => Promise.resolve("renamed") } as unknown as QuickInputService,
            { addEntry: () => ({ dispose: () => undefined }) } as unknown as StatusBarService,
            features,
        ).rename();
        expect(opened).toEqual([]);
        expect(provideRenameEdits).not.toHaveBeenCalled();
    });

    it("a provider of another language does not touch the document", async () => {
        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        features.renameProvider.register(
            { language: "python" },
            { prepareRename: () => name("value"), provideRenameEdits },
        );
        caretOnValue();
        typed = ["renamed"];

        await service().rename();

        expect(opened).toEqual([]);
        expect(provideRenameEdits).not.toHaveBeenCalled();
    });
});
