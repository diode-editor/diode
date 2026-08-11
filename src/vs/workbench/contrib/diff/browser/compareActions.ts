import path from "node:path";

import type { IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { reviveWireUri } from "../../../api/common/wireTypes.ts";
import { explorerPathArg } from "../../../browser/actions/menuContexts.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { DiffEditorPane } from "../../../browser/parts/editor/diffEditorPane.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { ClipboardDIToken } from "../../../common/coreTokens.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { FileSearchServiceDIToken } from "../../../services/search/node/fileSearchService.ts";
import { openDiffWithHead } from "../../scm/browser/compareWithHeadAction.ts";
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

    const openTabs = editors
        .getPanes()
        .filter(
            (p) =>
                !(p instanceof DiffEditorPane) &&
                p.uri.toString() !== active.uri.toString() &&
                p.uri.scheme !== "vexx-diff",
        );
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

async function compareWithRevision(accessor: ServiceAccessor): Promise<void> {
    const editors = accessor.get(EditorServiceDIToken);
    const active = editors.getActiveEditor();
    if (active === null) return;

    const refs = await queryRefs(accessor);
    if (refs.length === 0) {
        showCompareNotice(accessor, "No refs to compare with: the repository has no branches or tags");
        return;
    }
    const currentBranch = accessor.get(ScmRepoStateServiceDIToken).state.branch;
    const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
        title: "Compare Active File with Revision",
        placeholder: "Pick a branch or tag",
        items: refs.map((r) => ({
            label: r.name,
            description: `${r.sha.slice(0, 7)} ${r.subject}`,
            ...(r.name === currentBranch ? { badge: "current" } : {}),
        })),
    });
    if (picked === undefined) return;

    const result = await openDiffWithHead(accessor, active.uri, picked.label);
    if (result === "no-original") {
        showCompareNotice(accessor, "Cannot compare: the file has no version in git");
    }
}

// ─── vscode.diff (US-12) ─────────────────────────────────────────────────────

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

export const compareWithRevisionAction: CommandAction = {
    id: "vexx.scm.compareWithRevision",
    title: "Git: Compare Active File with Revision...",
    when: "gitHasRepo",
    run(accessor) {
        void compareWithRevision(accessor);
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
