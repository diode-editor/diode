import { Uri } from "../../../../base/common/uri.ts";
import { LanguageServiceDIToken } from "../../../../editor/common/languages/iLanguageService.ts";
import { TokenStyleResolverDIToken } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistryDIToken } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IFileService } from "../../../../platform/files/common/files.ts";
import { FileSystemProviderCapabilities, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import { UndoRedoServiceDIToken } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { DiffV2SideSource, IDiffEditorPane2Input } from "../../../browser/parts/editor/diffEditorPane2.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import { DIFF_VIEW_MODE_STATE } from "../../../common/stateKeys.ts";
import type { EditorGroup } from "../../../services/editor/browser/editorGroupModel.ts";
import { EditorGroupsServiceDIToken } from "../../../services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { showTransientNotice, TRANSIENT_NOTICE_MS } from "../../../services/statusbar/common/transientNotice.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";
import { TextFileModelServiceDIToken } from "../../../services/textfile/common/textFileModelService.ts";

const DIFF_SCHEME = "diode-diff";

export const COMPARE_NOTICE_MS = TRANSIENT_NOTICE_MS;

/**
 * Вид стороны выводится из полей ({@link resolveSide}): `ownedModel` — редактируемая, ею владеет
 * панель; `text` — снимок; `file:` — живая общая модель реестра; иные схемы и `preferDisk` — снимок.
 */
export interface IDiffSideSpec {
    readonly uri?: Uri;
    /** Готовый текст стороны (Clipboard); задан — `uri` для чтения не используется. */
    readonly text?: string;
    /** Владение переходит панели диффа вместе с открытием вкладки. */
    readonly ownedModel?: TextFileModel;
    readonly label: string;
    /** Упорядоченная пара ключей — идентичность вкладки: та же пара → та же вкладка, снимки обновляются на месте. */
    readonly identity: string;
    /** Читать с диска мимо открытого буфера («Compare with Saved»). */
    readonly preferDisk?: boolean;
    /** `"empty"` — файл удалён в рабочем дереве (дифф «HEAD ↔ пусто»), `"error"` — сравнение не удаётся. Дефолт — `"error"`. */
    readonly onMissing?: "empty" | "error";
}

export interface IOpenDiffPairOptions {
    readonly original: IDiffSideSpec;
    readonly modified: IDiffSideSpec;
    /** Метка вкладки; не задана — `<label original> ↔ <label modified>`. */
    readonly title?: string;
}

/** `"unreadable"` — сторона не прочиталась; нотис показывает вызывающий. */
export type OpenDiffPairResult = "opened" | "unreadable";

/** Не задано — вкладка ищется по всем группам, новая открывается в активной. */
export interface IOpenDiffPairTarget {
    readonly group: EditorGroup;
    readonly focus: boolean;
}

/** Стороны-модели пересчитывают дифф сами; снимочные (git, clipboard, диск) освежает повторный вызов — вкладка та же. */
export async function openDiffPair(
    accessor: ServiceAccessor,
    options: IOpenDiffPairOptions,
    target?: IOpenDiffPairTarget,
): Promise<OpenDiffPairResult> {
    const editors = accessor.get(EditorServiceDIToken);
    const groups = accessor.get(EditorGroupsServiceDIToken);
    const uri = pairUri(options);

    // Дедуп по всем группам: повторный вызов — единственный способ освежить снимок. Повтор в заданную
    // группу ищет только в ней: копия в соседней группе — ровно то, что просили.
    for (const group of target !== undefined ? [target.group] : groups.groups) {
        const index = group.findPaneIndex(uri);
        if (index < 0) continue;
        const pane = group.getPane(index);
        /* v8 ignore start -- defensive: diode-diff-uri открывает только это ядро, вид панели известен */
        if (!(pane instanceof DiffEditorPane2)) break;
        /* v8 ignore stop */
        // Свежие спеки сторон: у текстовой (Clipboard) стороны текст мог смениться.
        paneOptions.set(pane, options);
        if (!(await refreshSnapshotSides(accessor.get(IFileServiceDIToken), pane, options))) {
            return "unreadable";
        }
        // Группу активной делает и сам фокус в её вкладке (activateTab ниже —
        // capture-слушатель группы), так что мутанты строки ненаблюдаемы: явный
        // вызов держит порядок событий «группа, потом вкладка».
        // Stryker disable next-line ObjectLiteral,BooleanLiteral,ConditionalExpression,EqualityOperator,CallExpression: эквивалентны — см. выше
        if (target === undefined) groups.focusGroup(group.id, { focus: false });
        group.activateTab(index, { focus: target === undefined || target.focus });
        return "opened";
    }

    const input = await buildDiffInput(accessor, options);
    if (input === null) return "unreadable";

    const pane = new DiffEditorPane2(
        accessor.get(LanguageServiceDIToken),
        accessor.get(UndoRedoServiceDIToken),
        accessor.get(IFileServiceDIToken),
        accessor.get(TokenizationRegistryDIToken),
        accessor.get(TokenStyleResolverDIToken),
        { ...input, modeOverride: accessor.get(StateServiceDIToken).get(DIFF_VIEW_MODE_STATE) },
    );
    for (const side of pane.sidePanes()) editors.editorConfiguration.apply(side);
    // Для автоосвежения снимков по onDidChangeFile (US-31).
    paneOptions.set(pane, options);
    editors.openPane(pane, target);
    return "opened";
}

/** `undefined` — вкладка открыта мимо этого ядра либо сторона-модель (`ownedModel`) во вторую панель не переезжает. */
export function diffPaneRecipe(pane: DiffEditorPane2): IOpenDiffPairOptions | undefined {
    const options = paneOptions.get(pane);
    if (options === undefined) return undefined;
    return options.original.ownedModel === undefined && options.modified.ownedModel === undefined ? options : undefined;
}

const paneOptions = new WeakMap<DiffEditorPane2, IOpenDiffPairOptions>();

/** Ошибка чтения стороны молча пропускается: вкладка показывает прежний снимок, нотиса без действий пользователя нет. */
export async function refreshDiffSnapshots(providers: IFileService, pane: DiffEditorPane2): Promise<void> {
    const options = paneOptions.get(pane);
    if (options === undefined) return;
    await refreshSnapshotSides(providers, pane, options);
}

/** `null` — сторона не читается по её политике; ссылки уже взятых сторон освобождаются. */
export async function buildDiffInput(
    accessor: ServiceAccessor,
    options: IOpenDiffPairOptions,
): Promise<IDiffEditorPane2Input | null> {
    const original = await resolveSide(accessor, options.original);
    if (original === null) return null;
    const modified = await resolveSide(accessor, options.modified);
    if (modified === null) {
        if (original.kind === "shared") original.ref.dispose();
        return null;
    }

    return {
        uri: pairUri(options),
        label: options.title ?? `${options.original.label} ↔ ${options.modified.label}`,
        originalLabel: options.original.label,
        modifiedLabel: options.modified.label,
        original,
        modified,
        languageId: resolveLanguageId(accessor, options),
        // Для TabInputTextDiff в API расширений.
        ...(options.original.uri !== undefined ? { originalUri: options.original.uri } : {}),
        ...(options.modified.uri !== undefined ? { modifiedUri: options.modified.uri } : {}),
    };
}

// Путь — правой стороны (вкладка группируется со своим файлом); в query — упорядоченная пара
// ключей: `(лево, право)` ≠ `(право, лево)`.
function pairUri(options: IOpenDiffPairOptions): Uri {
    const path = options.modified.uri?.path ?? options.original.uri?.path ?? "/compare";
    const query = `left=${encodeURIComponent(options.original.identity)}&right=${encodeURIComponent(options.modified.identity)}`;
    return Uri.from({ scheme: DIFF_SCHEME, path, query });
}

async function resolveSide(accessor: ServiceAccessor, side: IDiffSideSpec): Promise<DiffV2SideSource | null> {
    if (side.ownedModel !== undefined) return { kind: "owned", model: side.ownedModel };
    if (side.text !== undefined) return { kind: "snapshot", text: side.text };
    if (side.uri === undefined) return { kind: "snapshot", text: "" };
    if (side.preferDisk !== true && isWritableProvided(accessor.get(IFileServiceDIToken), side.uri)) {
        // Пишущая схема расширения (предложенная правка Claude Code) — правится и сохраняется в провайдера, как в эталоне.
        try {
            return { kind: "shared", ref: await accessor.get(TextFileModelServiceDIToken).acquireProvided(side.uri) };
        } catch {
            // Не читается — дальше, снимком: там политика `onMissing`.
        }
    }
    if (side.preferDisk === true || side.uri.scheme !== "file") {
        const text = await readSideText(accessor.get(IFileServiceDIToken), side);
        return text === null ? null : { kind: "snapshot", text };
    }

    const models = accessor.get(TextFileModelServiceDIToken);
    if (models.get(side.uri) === null) {
        // Фабрика реестра открыла бы отсутствующий файл пустым буфером, а `onMissing` требует
        // знать, существует ли он, — пробуем чтение провайдером.
        try {
            await accessor.get(IFileServiceDIToken).readFile(side.uri);
        } catch {
            return side.onMissing === "empty" ? { kind: "snapshot", text: "" } : null;
        }
    }
    return { kind: "shared", ref: models.acquire(side.uri) };
}

function isWritableProvided(files: IFileService, uri: Uri): boolean {
    return (
        // Stryker disable next-line ConditionalExpression,StringLiteral: эквивалентный по результату — `file:` дошёл бы до `acquireProvided`, `openProvided` его отверг бы, и сторона ушла бы общим путём; гард экономит лишнее чтение файла
        uri.scheme !== "file" &&
        files.hasProvider(uri) &&
        !files.hasCapability(uri, FileSystemProviderCapabilities.Readonly)
    );
}

async function readSideText(providers: IFileService, side: IDiffSideSpec): Promise<string | null> {
    if (side.text !== undefined) return side.text;
    if (side.uri === undefined) return "";
    try {
        // Схема без провайдера — тоже отказ readFile (Unavailable), ловится ниже.
        return new TextDecoder().decode((await providers.readFile(side.uri)).value);
    } catch {
        return side.onMissing === "empty" ? "" : null;
    }
}

async function refreshSnapshotSides(
    providers: IFileService,
    pane: DiffEditorPane2,
    options: IOpenDiffPairOptions,
): Promise<boolean> {
    for (const side of pane.snapshotSides()) {
        const text = await readSideText(providers, side === "original" ? options.original : options.modified);
        if (text === null) return false;
        pane.replaceSnapshotContent(side, text);
    }
    return true;
}

function resolveLanguageId(accessor: ServiceAccessor, options: IOpenDiffPairOptions): string {
    const languages = accessor.get(LanguageServiceDIToken);
    const models = accessor.get(TextFileModelServiceDIToken);
    for (const side of [options.modified, options.original]) {
        if (side.uri === undefined) continue;
        const model = models.get(side.uri);
        if (model !== null) return model.languageId;
        const byResource = languages.getLanguageIdForResource(side.uri.path);
        if (byResource !== undefined) return byResource;
    }
    return "plaintext";
}

export function showCompareNotice(accessor: ServiceAccessor, text: string): void {
    showTransientNotice(accessor.get(StatusBarServiceDIToken), "diff.compare.notice", text);
}

export function compareLabelOf(uri: Uri): string {
    return uri.path.slice(uri.path.lastIndexOf("/") + 1);
}
