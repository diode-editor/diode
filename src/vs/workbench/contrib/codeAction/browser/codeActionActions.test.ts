import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ICodeActionRequest, ICoreCodeAction } from "../../../../editor/common/languages/iCodeActionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    type QuickInputService,
    QuickInputServiceDIToken,
} from "../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

import {
    fixAllAction,
    organizeImportsAction,
    quickFixAction,
    refactorAction,
    sourceActionAction,
} from "./codeActionActions.ts";

interface ISetup {
    accessor: Container;
    requests: ICodeActionRequest[];
    appliedIds: string[];
    notices: string[];
    pickCalls: { title?: string; placeholder?: string; items: readonly QuickPickItem[] }[];
}

interface FakeCodeActions {
    provide(request: ICodeActionRequest): Promise<readonly ICoreCodeAction[]>;
    apply(id: string): Promise<boolean>;
}

function makeSetup(
    source: FakeCodeActions | undefined,
    options: {
        /** Picks in the quick pick by label; a missing field means cancel (undefined). */
        pickLabel?: string;
        selection?: { anchor: { line: number; character: number }; active: { line: number; character: number } };
    } = {},
): ISetup {
    const requests: ICodeActionRequest[] = [];
    const appliedIds: string[] = [];
    const pickCalls: { title?: string; placeholder?: string; items: readonly QuickPickItem[] }[] = [];
    const editor = {
        uri: Uri.file("/proj/a.py"),
        languageId: "python",
        getText: () => "import b\nimport a",
        // The request carries the model version, not the text (the subprocess takes it from the mirror).
        model: { document: { versionId: 7 } },
        viewState: {
            selections: [options.selection ?? { anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }],
        },
    };
    const languageFeatures = new LanguageFeaturesService();
    if (source !== undefined) {
        languageFeatures.codeActionProvider.register("*", {
            providedCodeActionKinds: [],
            provideCodeActions: async (request) => {
                requests.push(request);
                return source.provide(request);
            },
            applyCodeAction: async (id) => {
                appliedIds.push(id);
                return source.apply(id);
            },
        });
    }
    const group = {
        getActiveEditor: () => editor,
    } as unknown as IEditorService;
    const notices: string[] = [];
    const statusBar = {
        addEntry: (entry: { id: string; text: string }) => {
            notices.push(`${entry.id}: ${entry.text}`);
            return { dispose: () => undefined };
        },
    } as unknown as StatusBarService;
    const quickInput = {
        quickPick: (opts: { title?: string; placeholder?: string; items: readonly QuickPickItem[] }) => {
            pickCalls.push({ title: opts.title, placeholder: opts.placeholder, items: opts.items });
            return Promise.resolve(
                options.pickLabel === undefined
                    ? undefined
                    : opts.items.find((item) => item.label === options.pickLabel),
            );
        },
    } as unknown as QuickInputService;
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => group);
    accessor.bind(StatusBarServiceDIToken, () => statusBar);
    accessor.bind(QuickInputServiceDIToken, () => quickInput);
    accessor.bind(LanguageFeaturesServiceDIToken, () => languageFeatures);
    return { accessor, requests, appliedIds, notices, pickCalls };
}

const ACTION = { id: "1.0", title: "Organize" };

describe("editor.action.organizeImports / fixAll", () => {
    it("request: full document range + its own only; the first action is applied", async () => {
        const setup = makeSetup({
            provide: () => Promise.resolve([ACTION, { id: "1.1", title: "Second" }]),
            apply: () => Promise.resolve(true),
        });
        await organizeImportsAction.run(setup.accessor);
        expect(setup.requests).toStrictEqual([
            {
                uri: Uri.file("/proj/a.py").toString(),
                languageId: "python",
                versionId: 7,
                range: createRange(0, 0, 1, 8),
                only: "source.organizeImports",
            },
        ]);
        expect(setup.appliedIds).toEqual(["1.0"]);
        expect(setup.notices).toEqual([]);

        const fixAll = makeSetup({ provide: () => Promise.resolve([ACTION]), apply: () => Promise.resolve(true) });
        await fixAllAction.run(fixAll.accessor);
        expect(fixAll.requests[0].only).toBe("source.fixAll");
    });

    it("the preferred action wins over the first", async () => {
        const setup = makeSetup({
            provide: () =>
                Promise.resolve([
                    { id: "1.0", title: "Plain" },
                    { id: "1.1", title: "Preferred", isPreferred: true },
                ]),
            apply: () => Promise.resolve(true),
        });
        await organizeImportsAction.run(setup.accessor);
        expect(setup.appliedIds).toEqual(["1.1"]);
    });

    it("no provider for the document or no actions ([]): a notice, apply is not called", async () => {
        const noSource = makeSetup(undefined);
        await organizeImportsAction.run(noSource.accessor);
        expect(noSource.notices).toEqual(["codeAction.notice: No organize imports action for 'python'"]);

        const emptyAnswer = makeSetup({ provide: () => Promise.resolve([]), apply: () => Promise.resolve(true) });
        await fixAllAction.run(emptyAnswer.accessor);
        expect(emptyAnswer.notices).toEqual(["codeAction.notice: No fix all action for 'python'"]);
    });

    it("apply refusal gives a notice with the action title; success is silent", async () => {
        const failing = makeSetup({ provide: () => Promise.resolve([ACTION]), apply: () => Promise.resolve(false) });
        await organizeImportsAction.run(failing.accessor);
        expect(failing.notices).toEqual(["codeAction.notice: Code action failed: Organize"]);
    });

    it("without an active editor: a silent exit", async () => {
        const provide = vi.fn();
        const setup = makeSetup({ provide, apply: () => Promise.resolve(true) } as unknown as FakeCodeActions);
        (setup.accessor.get(EditorServiceDIToken) as { getActiveEditor: () => unknown }).getActiveEditor = () => null;
        await organizeImportsAction.run(setup.accessor);
        expect(provide).not.toHaveBeenCalled();
        expect(setup.notices).toEqual([]);
    });

    it("quickFix: request on the cursor line WITHOUT only, a menu with kind/badge, the picked one is applied", async () => {
        const setup = makeSetup(
            {
                provide: () =>
                    Promise.resolve([
                        { id: "1.0", title: "Remove unused", kind: "quickfix", isPreferred: true },
                        { id: "1.1", title: "Extract method", kind: "refactor.extract" },
                        // A bare command — no kind or badge: no extra keys are
                        // invented in the menu item (strict below).
                        { id: "1.2", title: "Bare command" },
                    ]),
                apply: () => Promise.resolve(true),
            },
            {
                pickLabel: "Extract method",
                selection: { anchor: { line: 1, character: 3 }, active: { line: 1, character: 3 } },
            },
        );
        await quickFixAction.run(setup.accessor);

        // Empty selection → the cursor line (line 1 is "import a", 8 chars), only is absent.
        expect(setup.requests).toStrictEqual([
            {
                uri: Uri.file("/proj/a.py").toString(),
                languageId: "python",
                versionId: 7,
                range: createRange(1, 0, 1, 8),
            },
        ]);
        expect(setup.pickCalls).toStrictEqual([
            {
                title: "Code Actions",
                placeholder: "Select Code Action",
                items: [
                    { label: "Remove unused", description: "quickfix", badge: "preferred" },
                    { label: "Extract method", description: "refactor.extract" },
                    { label: "Bare command" },
                ],
            },
        ]);
        expect(setup.appliedIds).toEqual(["1.1"]);
        expect(setup.notices).toEqual([]);
    });

    it("quickFix: menu sorting puts quickfix above refactor/source, preferred first in its group, apply by its own id", async () => {
        // Provider order (verbose tsserver first) must not
        // push linter fixes past the popup edge — caught on a live run of the
        // tsserver+eslint pair: 16 refactorings buried 9 quickfixes.
        // Kinds are deliberately shuffled and cover both forms of each rank (exact
        // kind and subkind), an unknown kind and a bare command — the list tail.
        const setup = makeSetup(
            {
                provide: () =>
                    Promise.resolve([
                        // preferred first, a regular one right after it: V8's insertion sort
                        // calls compare(new, existing), and inserting the
                        // second element is guaranteed to take the "a regular,
                        // b preferred" branch (`: 1` — it stayed uncovered on CI,
                        // main went red on the branch ratchet).
                        { id: "1.0", title: "Fix preferred", kind: "quickfix", isPreferred: true },
                        { id: "1.1", title: "Fix plain", kind: "quickfix" },
                        { id: "1.2", title: "Src organize", kind: "source.organizeImports" },
                        { id: "1.3", title: "Refactor extract", kind: "refactor.extract" },
                        { id: "1.4", title: "Weird kind", kind: "weird.kind" },
                        { id: "1.5", title: "Fix sub", kind: "quickfix.special" },
                        { id: "1.6", title: "Bare command" },
                        { id: "1.7", title: "Refactor preferred", kind: "refactor", isPreferred: true },
                        { id: "1.8", title: "Src exact", kind: "source" },
                    ]),
                apply: () => Promise.resolve(true),
            },
            { pickLabel: "Fix preferred" },
        );
        await quickFixAction.run(setup.accessor);

        expect(setup.pickCalls[0]?.items.map((i) => i.label)).toEqual([
            "Fix preferred",
            "Fix plain",
            "Fix sub",
            "Refactor preferred",
            "Refactor extract",
            "Src organize",
            "Src exact",
            "Weird kind",
            "Bare command",
        ]);
        // The pick maps to the id of the ORIGINAL action, not to the position before sorting.
        expect(setup.appliedIds).toEqual(["1.0"]);
    });

    it("quickFix: menu cancel is silent; apply refusal gives a notice; empty/no source gives a notice without a menu", async () => {
        const cancelled = makeSetup({
            provide: () => Promise.resolve([{ id: "1.0", title: "Fix" }]),
            apply: () => Promise.resolve(true),
        });
        await quickFixAction.run(cancelled.accessor);
        expect(cancelled.appliedIds).toEqual([]);
        expect(cancelled.notices).toEqual([]);

        const failing = makeSetup(
            { provide: () => Promise.resolve([{ id: "1.0", title: "Fix" }]), apply: () => Promise.resolve(false) },
            { pickLabel: "Fix" },
        );
        await quickFixAction.run(failing.accessor);
        expect(failing.notices).toEqual(["codeAction.notice: Code action failed: Fix"]);

        const empty = makeSetup({ provide: () => Promise.resolve([]), apply: () => Promise.resolve(true) });
        await quickFixAction.run(empty.accessor);
        expect(empty.notices).toEqual(["codeAction.notice: No code actions available"]);
        expect(empty.pickCalls).toEqual([]);

        const noSource = makeSetup(undefined);
        await quickFixAction.run(noSource.accessor);
        expect(noSource.notices).toEqual(["codeAction.notice: No code actions available"]);
    });

    it("quickFix: without an active editor, a silent exit", async () => {
        const provide = vi.fn();
        const setup = makeSetup({ provide, apply: () => Promise.resolve(true) } as unknown as FakeCodeActions);
        (setup.accessor.get(EditorServiceDIToken) as { getActiveEditor: () => unknown }).getActiveEditor = () => null;
        await quickFixAction.run(setup.accessor);
        expect(provide).not.toHaveBeenCalled();
    });

    it("Refactor…: request with only=refactor, its own menu title and its own 'empty' text", async () => {
        const setup = makeSetup(
            {
                provide: () => Promise.resolve([{ id: "2.0", title: "Extract method", kind: "refactor.extract" }]),
                apply: () => Promise.resolve(true),
            },
            {
                pickLabel: "Extract method",
                selection: { anchor: { line: 1, character: 3 }, active: { line: 1, character: 3 } },
            },
        );

        await refactorAction.run(setup.accessor);

        expect(setup.requests).toStrictEqual([
            {
                uri: Uri.file("/proj/a.py").toString(),
                languageId: "python",
                versionId: 7,
                range: createRange(1, 0, 1, 8),
                only: "refactor",
            },
        ]);
        expect(setup.pickCalls[0].title).toBe("Refactor");
        expect(setup.appliedIds).toEqual(["2.0"]);

        const empty = makeSetup({ provide: () => Promise.resolve([]), apply: () => Promise.resolve(true) });
        await refactorAction.run(empty.accessor);
        expect(empty.notices).toEqual(["codeAction.notice: No refactorings available"]);
    });

    it("Source Action…: request with only=source, its own menu title and its own 'empty' text", async () => {
        const setup = makeSetup(
            {
                provide: () =>
                    Promise.resolve([{ id: "3.0", title: "Organize Imports", kind: "source.organizeImports" }]),
                apply: () => Promise.resolve(true),
            },
            { pickLabel: "Organize Imports" },
        );

        await sourceActionAction.run(setup.accessor);

        expect(setup.requests[0]).toMatchObject({ only: "source" });
        expect(setup.pickCalls[0].title).toBe("Source Action");
        expect(setup.appliedIds).toEqual(["3.0"]);

        const empty = makeSetup({ provide: () => Promise.resolve([]), apply: () => Promise.resolve(true) });
        await sourceActionAction.run(empty.accessor);
        expect(empty.notices).toEqual(["codeAction.notice: No source actions available"]);
    });

    it("disabled: organize imports applies the enabled one, and without enabled ones shows the disabled reason", async () => {
        const mixed = makeSetup({
            provide: () =>
                Promise.resolve([
                    { id: "1.0", title: "Disabled preferred", isPreferred: true, disabled: "Nothing to organize" },
                    { id: "1.1", title: "Plain" },
                ]),
            apply: () => Promise.resolve(true),
        });
        await organizeImportsAction.run(mixed.accessor);
        expect(mixed.appliedIds).toEqual(["1.1"]);
        expect(mixed.notices).toEqual([]);

        const onlyDisabled = makeSetup({
            provide: () => Promise.resolve([{ id: "1.0", title: "Organize", disabled: "Nothing to organize" }]),
            apply: () => Promise.resolve(true),
        });
        await organizeImportsAction.run(onlyDisabled.accessor);
        expect(onlyDisabled.appliedIds).toEqual([]);
        expect(onlyDisabled.notices).toEqual(["codeAction.notice: Nothing to organize"]);
    });

    it("disabled: Quick Fix does not show them; without enabled ones, 'no actions' and no menu", async () => {
        const mixed = makeSetup(
            {
                provide: () =>
                    Promise.resolve([
                        { id: "1.0", title: "Fix", kind: "quickfix" },
                        { id: "1.1", title: "Extract", kind: "refactor.extract", disabled: "Select an expression" },
                    ]),
                apply: () => Promise.resolve(true),
            },
            { pickLabel: "Fix" },
        );
        await quickFixAction.run(mixed.accessor);
        expect(mixed.pickCalls[0]?.items).toStrictEqual([{ label: "Fix", description: "quickfix" }]);
        expect(mixed.appliedIds).toEqual(["1.0"]);

        const onlyDisabled = makeSetup({
            provide: () => Promise.resolve([{ id: "1.0", title: "Extract", disabled: "Select an expression" }]),
            apply: () => Promise.resolve(true),
        });
        await quickFixAction.run(onlyDisabled.accessor);
        expect(onlyDisabled.pickCalls).toEqual([]);
        expect(onlyDisabled.notices).toEqual(["codeAction.notice: No code actions available"]);
    });

    it("disabled: Refactor… hides them next to enabled ones, and without enabled ones shows the reason and applies nothing", async () => {
        const mixed = makeSetup({
            provide: () =>
                Promise.resolve([
                    { id: "1.0", title: "Extract", kind: "refactor.extract" },
                    { id: "1.1", title: "Inline", kind: "refactor.inline", disabled: "Not a variable" },
                ]),
            apply: () => Promise.resolve(true),
        });
        await refactorAction.run(mixed.accessor);
        expect(mixed.pickCalls[0]?.items.map((item) => item.label)).toEqual(["Extract"]);

        const onlyDisabled = makeSetup(
            {
                provide: () =>
                    Promise.resolve([
                        { id: "1.0", title: "Inline", kind: "refactor.inline", disabled: "Not a variable" },
                    ]),
                apply: () => Promise.resolve(true),
            },
            { pickLabel: "Inline" },
        );
        await refactorAction.run(onlyDisabled.accessor);
        // The title and next to it the disabled reason (upstream shows it in the item's hover).
        expect(onlyDisabled.pickCalls[0]?.items).toStrictEqual([
            { label: "Inline", description: "refactor.inline", hint: "Not a variable" },
        ]);
        expect(onlyDisabled.appliedIds).toEqual([]);
        expect(onlyDisabled.notices).toEqual(["codeAction.notice: Not a variable"]);
    });

    it("metadata is pinned: id/title/keybindings/when are a user contract", () => {
        expect(organizeImportsAction.id).toBe("editor.action.organizeImports");
        expect(organizeImportsAction.title).toBe("Organize Imports");
        // Primary is a chord reachable on any terminal; the canonical Shift+Alt+O
        // is behind the tier gate (shift under Alt doesn't reach the legacy stream).
        expect(organizeImportsAction.keybinding).toEqual(parseChord("ctrl+k alt+o"));
        expect(organizeImportsAction.keybindings).toEqual([
            { keys: parseKeybinding("shift+alt+o"), when: "tier != 'legacy'" },
        ]);
        expect(organizeImportsAction.when).toBe("textInputFocus && !editorReadonly");

        expect(refactorAction.id).toBe("editor.action.refactor");
        expect(refactorAction.title).toBe("Refactor...");
        expect(refactorAction.keybinding).toEqual(parseChord("ctrl+k alt+r"));
        expect(refactorAction.keybindings).toEqual([
            { keys: parseKeybinding("mod+shift+r"), when: "tier != 'legacy'" },
        ]);
        expect(refactorAction.when).toBe("textInputFocus && !editorReadonly");

        expect(sourceActionAction.id).toBe("editor.action.sourceAction");
        expect(sourceActionAction.title).toBe("Source Action...");
        expect(sourceActionAction.keybinding).toBeUndefined();
        expect(sourceActionAction.when).toBe("textInputFocus && !editorReadonly");

        expect(fixAllAction.id).toBe("editor.action.fixAll");
        expect(fixAllAction.title).toBe("Fix All");
        expect(fixAllAction.keybinding).toBeUndefined();
        expect(fixAllAction.when).toBe("textInputFocus && !editorReadonly");

        expect(quickFixAction.id).toBe("editor.action.quickFix");
        expect(quickFixAction.title).toBe("Quick Fix");
        expect(quickFixAction.keybinding).toEqual(parseKeybinding("mod+."));
        // The second binding is the only one reachable on the legacy tier.
        expect(quickFixAction.keybindings).toEqual([parseChord("ctrl+k ctrl+q")]);
        expect(quickFixAction.when).toBe("textInputFocus && !editorReadonly");
    });
});
