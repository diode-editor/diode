import path from "node:path";

import type { IDisposable } from "@tuidom/core/common/disposable";
import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { reviveWireUri } from "../../../api/common/wireTypes.ts";
import { explorerPathArg } from "../../../browser/actions/menuContexts.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import {
    ClipboardDIToken,
    FileSystemProviderRegistryDIToken,
    StateServiceDIToken,
} from "../../../common/coreTokens.ts";
import type { DiffViewMode } from "../../../common/stateKeys.ts";
import { DIFF_VIEW_MODE_STATE } from "../../../common/stateKeys.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { FileSearchServiceDIToken } from "../../../services/search/node/fileSearchService.ts";
import { openDiffWithHead } from "../../scm/browser/compareWithHeadAction.ts";
import { OriginalResourceProviderDIToken } from "../../scm/browser/quickDiffService.ts";
import { ScmRepoStateServiceDIToken } from "../../scm/browser/repoStateService.ts";
import { queryRefs } from "../../scm/browser/syncActions.ts";

import { compareLabelOf, openDiffPair, showCompareNotice } from "./openDiffPair.ts";

/**
 * Семейство команд сравнения файлов (спека — docs/TODO/DiffViewer.md, «Спека
 * команд сравнения»). Каждая команда — тонкая обёртка над {@link openDiffPair}:
 * она лишь решает, чем заполнить две стороны. Все команды дают снимок; живой
 * пересчёт — фаза 5.
 */

/** Активный текстовый редактор, иначе — `null`; команды сравнения гейтятся им. */
function activeTextEditor(accessor: ServiceAccessor): TextEditorPane | null {
    return accessor.get(EditorServiceDIToken).getActiveEditor();
}

/** US-6: версия с диска ↔ живой буфер активного файла. */
async function compareWithSaved(accessor: ServiceAccessor): Promise<void> {
    const editor = activeTextEditor(accessor);
    if (editor === null) return;
    if (editor.absoluteFilePath === null) {
        // Untitled: на диске нечего сравнивать — это не сбой, а границы команды.
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

/** US-5: содержимое буфера обмена ↔ активный файл. */
async function compareWithClipboard(accessor: ServiceAccessor): Promise<void> {
    const editor = activeTextEditor(accessor);
    if (editor === null) return;

    // Внутренний регистр Vexx, не системный буфер: OSC 52 read намеренно не
    // используется (см. OscClipboard) — текст из другого приложения сюда не
    // попадёт, и сравнение с пустым в этом случае честнее зависшего запроса.
    const text = await accessor.get(ClipboardDIToken).readText();
    const name = compareLabelOf(editor.uri);
    await openDiffPair(accessor, {
        original: { text, label: "Clipboard", identity: `clipboard:${editor.uri.toString()}` },
        modified: { uri: editor.uri, label: name, identity: editor.uri.toString() },
    });
}

// ─── Select for Compare / Compare with Selected (US-4) ───────────────────────

/**
 * Отложенный «Select for Compare». Модульное состояние, а не сервис: это один
 * uri на всё приложение, живущий до рестарта (как в VS Code); двери к нему —
 * только две команды ниже, а when-ключ `resourceSelectedForCompare` даёт
 * меню знать о выборе без чтения самого uri.
 */
let selectedForCompare: Uri | null = null;

/** Сброс между тестами: состояние модульное, тесты его делят. */
export function resetSelectedForCompare(): void {
    selectedForCompare = null;
}

function selectForCompare(accessor: ServiceAccessor, filePath: unknown): void {
    if (typeof filePath !== "string" || filePath === "") return;
    selectedForCompare = Uri.file(path.resolve(filePath));
    accessor.get(ContextKeyServiceDIToken).set("resourceSelectedForCompare", true);
}

async function compareWithSelected(accessor: ServiceAccessor, filePath: unknown): Promise<void> {
    if (selectedForCompare === null) return; // меню гейтит when-ключом, палитра — тоже
    if (typeof filePath !== "string" || filePath === "") return;
    const right = Uri.file(path.resolve(filePath));

    // Выбранный ПЕРВЫМ — слева, как в VS Code.
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

// ─── Compare Active File With... (US-3, US-9) ──────────────────────────────────

/**
 * Пикер второй стороны: открытые вкладки (сверху — они «под рукой», и среди
 * них untitled), затем файлы workspace. Различитель одинаковых basename —
 * `description` (полный/относительный путь); выбор маппится по паре
 * label+description, а не по одному label.
 */
async function compareActiveFileWith(accessor: ServiceAccessor): Promise<void> {
    const editors = accessor.get(EditorServiceDIToken);
    const active = editors.getActiveEditor();
    if (active === null) return;

    // Вкладки ВСЕХ групп: пикер — про открытые буферы, а не про активную группу.
    const openTabs = editors.groups
        .flatMap((group) => [...group.getPanes()])
        .filter((p) => p.uri.toString() !== active.uri.toString() && p.uri.scheme !== "diode-diff");
    // Индекс строится в фоне (Quick Open живёт с этим через рост списка по мере
    // ввода); статичному пикеру нужен готовый снимок — ждём и подстёгиваем.
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
    // Один файл может быть и вкладкой, и результатом поиска — вкладка выше, дубль долой.
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
        // Активный файл — original (слева), как в VS Code.
        original: { uri: active.uri, label: activeName, identity: active.uri.toString() },
        modified: { uri: right, label: compareLabelOf(right), identity: right.toString() },
    });
    if (result === "unreadable") showCompareNotice(accessor, "Cannot compare: file is not readable");
}

// ─── Compare Active File with Revision… (US-7) ───────────────────────────────

/**
 * Пикер ревизии: ветки и теги репозитория, текущая ветка помечена. `null` —
 * отмена; пустой список ref'ов показывает нотис сам.
 */
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

// ─── Open File at Revision… (DiffEditable PR-1) ──────────────────────────────

/**
 * Открывает файл на выбранной ревизии обычной **read-only текстовой вкладкой**
 * (`a.ts (ref)` с замком): контент читается `git:`-провайдером, вкладка-снимок
 * живёт мимо диска и персиста сессии. Первая видимая ступень editable-диффа
 * (docs/TODO/DiffEditable.md, PR-1) и давний хвост задачи из Uri.md.
 */
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
    const providers = accessor.get(FileSystemProviderRegistryDIToken);
    if (revisionUri === null || !providers.hasProvider(revisionUri.scheme)) {
        showCompareNotice(accessor, "Cannot open: the file has no version in git");
        return;
    }

    let text: string;
    try {
        text = new TextDecoder().decode(await providers.readFile(revisionUri));
    } catch {
        // Файла на этой ревизии нет — честный нотис, а не пустая вкладка.
        showCompareNotice(accessor, `Cannot open: the file does not exist on ${ref}`);
        return;
    }

    editors.openTextSnapshot(revisionUri, {
        text,
        languageId: active.languageId,
        label: `${compareLabelOf(active.uri)} (${ref})`,
    });
}

// ─── File: Compare New Untitled Text Files (US-37) ───────────────────────────

/**
 * Дифф двух свежих пустых безымянных буферов — обе стороны **редактируются
 * прямо в дифф-вкладке**, живой пересчёт подхватывает набор/вставку (VS Code
 * `CompareNewUntitledTextFilesAction` — команда, ради которой затевалась вся
 * дуга editable-диффа). Номера буферов — из общего счётчика untitled: метки
 * стабильны и Save As стороны работает штатно.
 */
async function compareNewUntitledTextFiles(accessor: ServiceAccessor): Promise<void> {
    const editors = accessor.get(EditorServiceDIToken);
    const original = editors.createUntitledModel();
    const modified = editors.createUntitledModel();
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

// ─── Diff: Revert Hunk ───────────────────────────────────────────────────────

/**
 * Откат ганка под кареткой активной дифф-вкладки: строки modified заменяются
 * строками original (аналог стрелки на ганке в VS Code, `diffEditor.revert`).
 * Правка undoable; живой пересчёт сам убирает разметку. Вне дифф-вкладки —
 * тихий no-op (без кейбинда контекст-ключ не нужен).
 */
function revertDiffHunk(accessor: ServiceAccessor): void {
    const pane = accessor.get(EditorServiceDIToken).getActiveTabPane();
    if (!(pane instanceof DiffEditorPane2)) return;
    const result = pane.revertHunkAtCaret();
    if (result === "no-hunk") showCompareNotice(accessor, "No change under the cursor to revert");
    if (result === "read-only") showCompareNotice(accessor, "Cannot revert: the modified side is read-only");
}

// ─── Diff: Toggle Inline View (US-22) ────────────────────────────────────────

/**
 * Тумблер режима дифф-вкладок: inline ↔ side-by-side. Выбор персистится
 * (`DIFF_VIEW_MODE_STATE`) и применяется ко ВСЕМ открытым дифф-вкладкам и всем
 * будущим — режим отображения это привычка, а не свойство конкретной пары.
 * Вне активной дифф-вкладки — тихий no-op (следующий переключаемый режим
 * осмыслен только от текущего).
 */
function toggleInlineView(accessor: ServiceAccessor): void {
    const editors = accessor.get(EditorServiceDIToken);
    const active = editors.getActiveTabPane();
    if (!(active instanceof DiffEditorPane2)) return;
    const next: DiffViewMode = active.mode === "inline" ? "side-by-side" : "inline";
    accessor.get(StateServiceDIToken).store(DIFF_VIEW_MODE_STATE, next);
    for (const group of editors.groups) {
        for (const pane of group.getPanes()) {
            if (pane instanceof DiffEditorPane2) pane.setModeOverride(next);
        }
    }
}

// ─── vscode.diff (US-12, AS-20) ──────────────────────────────────────────────

/** `ViewColumn.Beside` из vscode API. `ViewColumn.Active` (-1) — дефолт и так. */
const VIEW_COLUMN_BESIDE = -2;

/**
 * Целевая колонка из 4-го аргумента `vscode.diff` (`ViewColumn` числом либо
 * `TextDocumentShowOptions` с `viewColumn`). Существующая колонка N —
 * активируется; `Beside`/колонка за краем — новая группа справа (нет места —
 * фолбэк в активную, как у Open to the Side); `Active` и мусор — активная.
 */
function applyViewColumn(accessor: ServiceAccessor, raw: unknown): void {
    const editors = accessor.get(EditorServiceDIToken);
    const value = typeof raw === "number" ? raw : (raw as { viewColumn?: unknown } | undefined)?.viewColumn;
    if (typeof value !== "number") return;
    if (value === VIEW_COLUMN_BESIDE || value > editors.groups.length) {
        editors.newGroup("after", { focus: false });
        return;
    }
    // За краем слева (Active, мусор) focusGroup сам делает no-op.
    editors.focusGroup({ index: value - 1 }, { focus: false });
}

async function vscodeDiff(accessor: ServiceAccessor, ...args: unknown[]): Promise<void> {
    // Из субпроцесса аргументы приходят одним массивом (мост
    // `commands.executeCommand` передаёт `args` как есть), из ядра — varargs;
    // uri там сериализованы `Uri.toJSON()` в компоненты (`{$mid, scheme, path}`)
    // либо строками — {@link reviveWireUri} понимает оба вида (и сам Uri).
    const list = args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
    const left = reviveWireUri(list[0]);
    const right = reviveWireUri(list[1]);
    if (left === null || right === null) return;
    const title = typeof list[2] === "string" && list[2] !== "" ? list[2] : undefined;
    applyViewColumn(accessor, list[3]);

    await openDiffPair(accessor, {
        // Недоступный ресурс — легитимно пустая сторона: расширения зовут diff
        // и для ещё не существующих файлов (превью создаваемого файла).
        original: { uri: left, label: compareLabelOf(left), identity: left.toString(), onMissing: "empty" },
        modified: { uri: right, label: compareLabelOf(right), identity: right.toString(), onMissing: "empty" },
        ...(title !== undefined ? { title } : {}),
    });
}

// ─── Регистрации ─────────────────────────────────────────────────────────────

export const compareWithSavedAction: CommandAction = {
    id: "workbench.files.action.compareWithSaved",
    title: "File: Compare Active File with Saved",
    keybinding: parseChord("ctrl+k d"),
    run(accessor) {
        void compareWithSaved(accessor);
    },
};

export const compareWithClipboardAction: CommandAction = {
    id: "workbench.files.action.compareWithClipboard",
    title: "File: Compare Active File with Clipboard",
    keybinding: parseChord("ctrl+k c"),
    run(accessor) {
        void compareWithClipboard(accessor);
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
        void compareWithSelected(accessor, filePath);
    },
};

export const compareFileWithAction: CommandAction = {
    id: "workbench.files.action.compareFileWith",
    title: "File: Compare Active File With...",
    run(accessor) {
        void compareActiveFileWith(accessor);
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
        void compareNewUntitledTextFiles(accessor);
    },
};

export const compareWithRevisionAction: CommandAction = {
    id: "diode.scm.compareWithRevision",
    title: "Git: Compare Active File with Revision...",
    when: "gitHasRepo",
    run(accessor) {
        void compareWithRevision(accessor);
    },
};

export const openFileAtRevisionAction: CommandAction = {
    id: "diode.scm.openFileAtRevision",
    title: "Git: Open File at Revision...",
    when: "gitHasRepo",
    run(accessor) {
        void openFileAtRevision(accessor);
    },
};

/**
 * Программный вход с контрактом VS Code (`vscode.diff(left, right, title?)`):
 * ext-host исполняет команды ядра по id через мост, поэтому стоковым
 * расширениям ничего адаптировать не нужно. Регистрируется без title —
 * низкоуровневым `CommandRegistry.register`, минуя `CommandAction`, — и потому
 * в палитре не показывается (как и в VS Code).
 */
export function registerVscodeDiffCommand(
    commands: { register(id: string, handler: (...args: unknown[]) => unknown): IDisposable },
    accessor: ServiceAccessor,
): IDisposable {
    return commands.register("vscode.diff", (...args) => vscodeDiff(accessor, ...args));
}
