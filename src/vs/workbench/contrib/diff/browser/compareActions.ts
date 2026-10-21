import path from "node:path";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import { reviveWireUri } from "../../../api/common/wireTypes.ts";
import { explorerPathArg } from "../../../browser/actions/menuContexts.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { DiffViewMode } from "../../../common/stateKeys.ts";
import { DIFF_VIEW_MODE_STATE } from "../../../common/stateKeys.ts";
import { EditorGroupsServiceDIToken } from "../../../services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { FileSearchServiceDIToken } from "../../../services/search/common/fileSearch.ts";
import { TextFileModelServiceDIToken } from "../../../services/textfile/common/textFileModelService.ts";
import { openDiffWithHead } from "../../scm/browser/compareWithHeadAction.ts";
import { OriginalResourceProviderDIToken } from "../../scm/browser/quickDiffService.ts";
import { ScmRepoStateServiceDIToken } from "../../scm/browser/repoStateService.ts";
import { queryRefs } from "../../scm/browser/syncActions.ts";

import { compareLabelOf, openDiffPair, showCompareNotice } from "./openDiffPair.ts";

function activeTextEditor(accessor: ServiceAccessor): TextEditorPane | null {
    return accessor.get(EditorServiceDIToken).getActiveEditor();
}

async function compareWithSaved(accessor: ServiceAccessor): Promise<void> {
    const editor = activeTextEditor(accessor);
    if (editor === null) return;
    if (editor.absoluteFilePath === null) {
        showCompareNotice(accessor, "Cannot compare: the file has no saved version on disk");
        return;
    }

    const name = compareLabelOf(editor.uri);
    const result = await openDiffPair(accessor, {
        original: {
            uri: editor.uri,
            label: `${name} (on disk)`,
            identity: `saved:${editor.uri.toString()}`,
            preferDisk: true,
        },
        modified: { uri: editor.uri, label: name, identity: editor.uri.toString() },
    });
    if (result === "unreadable") {
        showCompareNotice(accessor, "Cannot compare: the file is not readable from disk");
    }
}

async function compareWithClipboard(accessor: ServiceAccessor): Promise<void> {
    const editor = activeTextEditor(accessor);
    if (editor === null) return;

    // Diode's internal register, not the system clipboard: OSC 52 read is deliberately not used (see OscClipboard),
    // and comparing with an empty side is more honest than a hung request.
    const text = await accessor.get(ClipboardDIToken).readText();
    const name = compareLabelOf(editor.uri);
    await openDiffPair(accessor, {
        original: { text, label: "Clipboard", identity: `clipboard:${editor.uri.toString()}` },
        modified: { uri: editor.uri, label: name, identity: editor.uri.toString() },
    });
}

/** Module state, not a service: one uri per app until restart, as in VS Code. */
let selectedForCompare: Uri | null = null;

export function resetSelectedForCompare(): void {
    selectedForCompare = null;
}

function selectForCompare(accessor: ServiceAccessor, filePath: unknown): void {
    if (typeof filePath !== "string" || filePath === "") return;
    selectedForCompare = Uri.file(path.resolve(filePath));
    accessor.get(ContextKeyServiceDIToken).set("resourceSelectedForCompare", true);
}

async function compareWithSelected(accessor: ServiceAccessor, filePath: unknown): Promise<void> {
    if (selectedForCompare === null) return; // the menu gates it with a when key, so does the command palette
    if (typeof filePath !== "string" || filePath === "") return;
    const right = Uri.file(path.resolve(filePath));

    // The one selected FIRST goes on the left, as in VS Code.
    const result = await openDiffPair(accessor, {
        original: {
            uri: selectedForCompare,
            label: compareLabelOf(selectedForCompare),
            identity: selectedForCompare.toString(),
        },
        modified: { uri: right, label: compareLabelOf(right), identity: right.toString() },
    });
    if (result === "unreadable") showCompareNotice(accessor, "Cannot compare: file is not readable");
}

/** The pick is mapped by the label+description pair: same basenames differ only by description. */
async function compareActiveFileWith(accessor: ServiceAccessor): Promise<void> {
    const editors = accessor.get(EditorServiceDIToken);
    const active = editors.getActiveEditor();
    if (active === null) return;

    // Tabs of ALL groups: the picker is about open buffers, not the active group.
    const openTabs = accessor
        .get(EditorGroupsServiceDIToken)
        .groups.flatMap((group) => [...group.getPanes()])
        .filter((p) => p.uri.toString() !== active.uri.toString() && p.uri.scheme !== "diode-diff");
    // The index is built in the background; a static picker needs a ready snapshot, so wait and nudge it.
    const search = accessor.get(FileSearchServiceDIToken);
    search.refreshIfStale();
    await search.ready;
    const files = search.search("", 50);
    const items = [
        ...openTabs.map((p) => ({ label: editors.displayName(p), description: p.uri.toString(), badge: "open" })),
        ...files
            .filter((f) => Uri.file(f.entry.absolutePath).toString() !== active.uri.toString())
            .map((f) => ({ label: f.entry.basename, description: Uri.file(f.entry.absolutePath).toString() })),
    ];
    const seen = new Set<string>();
    const unique = items.filter((item) => {
        if (seen.has(item.description)) return false;
        seen.add(item.description);
        return true;
    });

    const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
        title: "Compare Active File With...",
        placeholder: "Select a file to compare with",
        items: unique,
    });
    if (picked?.description === undefined) return;

    const right = Uri.parse(picked.description);
    const activeName = editors.displayName(active);
    const result = await openDiffPair(accessor, {
        // The active file is original (left), as in VS Code.
        original: { uri: active.uri, label: activeName, identity: active.uri.toString() },
        modified: { uri: right, label: compareLabelOf(right), identity: right.toString() },
    });
    if (result === "unreadable") showCompareNotice(accessor, "Cannot compare: file is not readable");
}

/** `null` means cancel; an empty ref list shows the notice itself. */
async function pickRevisionRef(accessor: ServiceAccessor, title: string): Promise<string | null> {
    const refs = await queryRefs(accessor);
    if (refs.length === 0) {
        showCompareNotice(accessor, "No refs to pick from: the repository has no branches or tags");
        return null;
    }
    const currentBranch = accessor.get(ScmRepoStateServiceDIToken).state.branch;
    const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
        title,
        placeholder: "Pick a branch or tag",
        items: refs.map((r) => ({
            label: r.name,
            description: `${r.sha.slice(0, 7)} ${r.subject}`,
            ...(r.name === currentBranch ? { badge: "current" } : {}),
        })),
    });
    return picked?.label ?? null;
}

async function compareWithRevision(accessor: ServiceAccessor): Promise<void> {
    const editors = accessor.get(EditorServiceDIToken);
    const active = editors.getActiveEditor();
    if (active === null) return;

    const ref = await pickRevisionRef(accessor, "Compare Active File with Revision");
    if (ref === null) return;

    const result = await openDiffWithHead(accessor, active.uri, ref);
    if (result === "no-original") {
        showCompareNotice(accessor, "Cannot compare: the file has no version in git");
    }
}

/** Read-only snapshot tab `a.ts (ref)`: read by the `git:` provider, bypasses the disk and session persistence. */
async function openFileAtRevision(accessor: ServiceAccessor): Promise<void> {
    const editors = accessor.get(EditorServiceDIToken);
    const active = editors.getActiveEditor();
    if (active === null) return;

    const ref = await pickRevisionRef(accessor, "Open File at Revision");
    if (ref === null) return;

    let revisionUri: Uri | null;
    try {
        revisionUri = await accessor.get(OriginalResourceProviderDIToken).provideOriginalResource(active.uri, ref);
    } catch {
        revisionUri = null;
    }
    const providers = accessor.get(IFileServiceDIToken);
    if (revisionUri === null || !providers.hasProvider(revisionUri)) {
        showCompareNotice(accessor, "Cannot open: the file has no version in git");
        return;
    }

    let text: string;
    try {
        text = new TextDecoder().decode((await providers.readFile(revisionUri)).value);
    } catch {
        showCompareNotice(accessor, `Cannot open: the file does not exist on ${ref}`);
        return;
    }

    editors.openTextSnapshot(revisionUri, {
        text,
        languageId: active.languageId,
        label: `${compareLabelOf(active.uri)} (${ref})`,
    });
}

/** Buffer numbers come from the shared untitled counter: labels are stable, and Save As on a side works normally. */
async function compareNewUntitledTextFiles(accessor: ServiceAccessor): Promise<void> {
    const models = accessor.get(TextFileModelServiceDIToken);
    const original = models.createUntitledModel();
    const modified = models.createUntitledModel();
    await openDiffPair(accessor, {
        original: {
            ownedModel: original,
            uri: original.uri,
            label: original.uri.path,
            identity: original.uri.toString(),
        },
        modified: {
            ownedModel: modified,
            uri: modified.uri,
            label: modified.uri.path,
            identity: modified.uri.toString(),
        },
    });
}

/** Outside a diff tab it is a silent no-op: without a keybinding no context key is needed. */
function revertDiffHunk(accessor: ServiceAccessor): void {
    const pane = accessor.get(EditorServiceDIToken).getActiveTabPane();
    if (!(pane instanceof DiffEditorPane2)) return;
    const result = pane.revertHunkAtCaret();
    if (result === "no-hunk") showCompareNotice(accessor, "No change under the cursor to revert");
    if (result === "read-only") showCompareNotice(accessor, "Cannot revert: the modified side is read-only");
}

/** The mode applies to all open and future diff tabs: it is a habit, not a property of the pair. */
function toggleInlineView(accessor: ServiceAccessor): void {
    const editors = accessor.get(EditorServiceDIToken);
    const active = editors.getActiveTabPane();
    if (!(active instanceof DiffEditorPane2)) return;
    const next: DiffViewMode = active.mode === "inline" ? "side-by-side" : "inline";
    accessor.get(StateServiceDIToken).store(DIFF_VIEW_MODE_STATE, next);
    for (const group of accessor.get(EditorGroupsServiceDIToken).groups) {
        for (const pane of group.getPanes()) {
            if (pane instanceof DiffEditorPane2) pane.setModeOverride(next);
        }
    }
}

/** `ViewColumn.Beside`; `ViewColumn.Active` (-1) is the default anyway. */
const VIEW_COLUMN_BESIDE = -2;

/** An existing column N is activated; `Beside`/a column past the edge opens a new group on the right (no room:
 * the active one, like Open to the Side); `Active` and garbage use the active one. */
function applyViewColumn(accessor: ServiceAccessor, raw: unknown): void {
    const groups = accessor.get(EditorGroupsServiceDIToken);
    const value = typeof raw === "number" ? raw : (raw as { viewColumn?: unknown } | undefined)?.viewColumn;
    if (typeof value !== "number") return;
    if (value === VIEW_COLUMN_BESIDE || value > groups.groups.length) {
        // Stryker disable next-line StringLiteral: position "" behaves like "after", equivalent
        groups.newGroup("after", { focus: false });
        return;
    }
    // Past the left edge (Active, garbage) focusGroup is a no-op itself.
    groups.focusGroup({ index: value - 1 }, { focus: false });
}

async function vscodeDiff(accessor: ServiceAccessor, ...args: unknown[]): Promise<void> {
    // From the subprocess args come as one array, from the core as varargs; uris come as
    // `Uri.toJSON()` components or strings, {@link reviveWireUri} understands both.
    const list = args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
    const left = reviveWireUri(list[0]);
    const right = reviveWireUri(list[1]);
    if (left === null || right === null) return;
    const title = typeof list[2] === "string" && list[2] !== "" ? list[2] : undefined;
    applyViewColumn(accessor, list[3]);

    await openDiffPair(accessor, {
        // An unavailable resource is a legitimately empty side: extensions call diff
        // for not-yet-existing files too (preview of a file being created).
        original: { uri: left, label: compareLabelOf(left), identity: left.toString(), onMissing: "empty" },
        modified: { uri: right, label: compareLabelOf(right), identity: right.toString(), onMissing: "empty" },
        ...(title !== undefined ? { title } : {}),
    });
}

export const compareWithSavedAction: CommandAction = {
    id: "workbench.files.action.compareWithSaved",
    title: "File: Compare Active File with Saved",
    keybinding: parseChord("mod+k d"),
    run(accessor) {
        return compareWithSaved(accessor);
    },
};

export const compareWithClipboardAction: CommandAction = {
    id: "workbench.files.action.compareWithClipboard",
    title: "File: Compare Active File with Clipboard",
    keybinding: parseChord("mod+k c"),
    run(accessor) {
        return compareWithClipboard(accessor);
    },
};

export const selectForCompareAction: CommandAction = {
    id: "selectForCompare",
    title: "File: Select for Compare",
    shortTitle: "Select for Compare",
    menus: [{ menuId: MenuId.ExplorerContext, group: "3_compare", order: 10, args: explorerPathArg }],
    run(accessor, filePath: unknown) {
        selectForCompare(accessor, filePath);
    },
};

export const compareFilesAction: CommandAction = {
    id: "compareFiles",
    title: "File: Compare with Selected",
    shortTitle: "Compare with Selected",
    when: "resourceSelectedForCompare",
    menus: [
        {
            menuId: MenuId.ExplorerContext,
            group: "3_compare",
            order: 20,
            args: explorerPathArg,
            when: "resourceSelectedForCompare",
        },
    ],
    run(accessor, filePath: unknown) {
        return compareWithSelected(accessor, filePath);
    },
};

export const compareFileWithAction: CommandAction = {
    id: "workbench.files.action.compareFileWith",
    title: "File: Compare Active File With...",
    run(accessor) {
        return compareActiveFileWith(accessor);
    },
};

export const revertDiffHunkAction: CommandAction = {
    id: "diode.diff.revertHunk",
    title: "Diff: Revert Hunk",
    run(accessor) {
        revertDiffHunk(accessor);
    },
};

export const toggleInlineViewAction: CommandAction = {
    id: "diode.diff.toggleInlineView",
    title: "Diff: Toggle Inline View",
    run(accessor) {
        toggleInlineView(accessor);
    },
};

export const compareNewUntitledTextFilesAction: CommandAction = {
    id: "workbench.files.action.compareNewUntitledTextFiles",
    title: "File: Compare New Untitled Text Files",
    run(accessor) {
        return compareNewUntitledTextFiles(accessor);
    },
};

export const compareWithRevisionAction: CommandAction = {
    id: "diode.scm.compareWithRevision",
    title: "Git: Compare Active File with Revision...",
    when: "gitHasRepo",
    run(accessor) {
        return compareWithRevision(accessor);
    },
};

export const openFileAtRevisionAction: CommandAction = {
    id: "diode.scm.openFileAtRevision",
    title: "Git: Open File at Revision...",
    when: "gitHasRepo",
    run(accessor) {
        return openFileAtRevision(accessor);
    },
};

/** No title, registered via low-level `CommandRegistry.register`, so it is not shown in the command palette (as in VS Code). */
export function registerVscodeDiffCommand(
    commands: { register(id: string, handler: (...args: unknown[]) => unknown): IDisposable },
    accessor: ServiceAccessor,
): IDisposable {
    return commands.register("vscode.diff", (...args) => vscodeDiff(accessor, ...args));
}

export const COMPARE_ACTIONS: readonly CommandAction[] = [
    compareWithSavedAction,
    compareWithClipboardAction,
    compareFileWithAction,
    compareNewUntitledTextFilesAction,
    selectForCompareAction,
    compareFilesAction,
    compareWithRevisionAction,
    openFileAtRevisionAction,
    revertDiffHunkAction,
    toggleInlineViewAction,
];
