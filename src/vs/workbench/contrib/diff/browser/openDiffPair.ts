import { Uri } from "../../../../base/common/uri.ts";
import type { IFileSystemProviderRegistry } from "../../../../platform/files/common/iFileSystemProviderRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { UndoRedoServiceDIToken } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { DiffV2SideSource, IDiffEditorPane2Input } from "../../../browser/parts/editor/diffEditorPane2.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import {
    FileSystemProviderRegistryDIToken,
    LanguageServiceDIToken,
    TokenizationRegistryDIToken,
    TokenStyleResolverDIToken,
} from "../../../common/coreTokens.ts";
import { StateServiceDIToken } from "../../../common/coreTokens.ts";
import { DIFF_VIEW_MODE_STATE } from "../../../common/stateKeys.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";

/** Схема вкладки диффа: не ресурс на диске, а пара «источник ↔ источник». */
const DIFF_SCHEME = "vexx-diff";

/** Сколько держать нотис о том, что сравнение не удалось. */
export const COMPARE_NOTICE_MS = 4000;

/**
 * Сторона сравнения. Вид источника выводится из полей (см. {@link resolveSide}):
 * готовая модель (`ownedModel`) → редактируемая сторона, которой владеет
 * панель; готовый текст (`text`) → снимок; `file:`-uri → **живая общая модель**
 * из реестра (несохранённые правки видны, редактируется прямо в диффе); иные
 * схемы (`git:`) и `preferDisk` → снимок, читаемый провайдером ФС.
 */
export interface IDiffSideSpec {
    /** Ресурс стороны; не задан — сторона живёт только в `text`/`ownedModel`. */
    readonly uri?: Uri;
    /** Готовый текст стороны (Clipboard); задан — `uri` для чтения не используется. */
    readonly text?: string;
    /**
     * Готовая модель стороны (untitled-стороны «Compare New Untitled Text
     * Files»). Владение переходит панели диффа вместе с открытием вкладки.
     */
    readonly ownedModel?: TextFileModel;
    /** Подпись колонки side-by-side и половина метки вкладки. */
    readonly label: string;
    /**
     * Ключ идентичности вкладки. Пара ключей (упорядоченная) определяет
     * «ту же» вкладку: тот же ключ → та же вкладка (снимочные стороны
     * обновляются на месте), другой → отдельная вкладка.
     */
    readonly identity: string;
    /**
     * Читать `uri` с диска (провайдером), игнорируя открытый буфер, — для
     * «Compare with Saved», где левая сторона обязана быть версией с диска.
     */
    readonly preferDisk?: boolean;
    /**
     * Что значит «не читается»: `"empty"` — легитимно пустая сторона (файл
     * удалён в рабочем дереве — дифф «HEAD ↔ пусто», US-10), `"error"` —
     * сравнение не удаётся (выбранный в пикере файл исчез). Дефолт — `"error"`.
     */
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

/**
 * Ядро сравнения: открывает **живую** дифф-вкладку v2 ({@link DiffEditorPane2})
 * для произвольной пары источников — им пользуются и «Compare with HEAD», и всё
 * семейство команд сравнения (два файла, буфер обмена, сохранённая версия,
 * ревизия, untitled-пара), и программная `vscode.diff`.
 *
 * Стороны-модели живут: правки (в диффе или в обычной вкладке того же файла)
 * пересчитывают дифф сами. Снимочные стороны (git-ревизия, clipboard, диск)
 * обновляются повторным вызовом команды — вкладка та же, содержимое свежее.
 */
export async function openDiffPair(
    accessor: ServiceAccessor,
    options: IOpenDiffPairOptions,
): Promise<OpenDiffPairResult> {
    const editors = accessor.get(EditorServiceDIToken);
    const uri = pairUri(options);

    // Дедуп по идентичности пары — по ВСЕМ группам (вкладка могла остаться в
    // другой группе): живые стороны уже актуальны, снимочные освежаем — иначе
    // повторный вызов (единственный способ «обновить» снимок) показал бы старое.
    for (const group of editors.groups) {
        const index = group.findPaneIndex(uri);
        if (index < 0) continue;
        const pane = group.getPane(index);
        /* v8 ignore start -- defensive: vexx-diff-uri открывает только это ядро, вид панели известен */
        if (!(pane instanceof DiffEditorPane2)) break;
        /* v8 ignore stop */
        // Свежие спеки сторон: у текстовой (Clipboard) стороны текст мог смениться.
        paneOptions.set(pane, options);
        if (!(await refreshSnapshotSides(accessor.get(FileSystemProviderRegistryDIToken), pane, options))) {
            return "unreadable";
        }
        editors.focusGroup(group.id, { focus: false });
        editors.activateTab(index);
        return "opened";
    }

    const input = await buildDiffInput(accessor, options);
    if (input === null) return "unreadable";

    const pane = new DiffEditorPane2(
        accessor.get(LanguageServiceDIToken),
        accessor.get(UndoRedoServiceDIToken),
        accessor.get(TokenizationRegistryDIToken),
        accessor.get(TokenStyleResolverDIToken),
        // Персист тумблера US-22: новая вкладка рождается в выбранном режиме.
        { ...input, modeOverride: accessor.get(StateServiceDIToken).get(DIFF_VIEW_MODE_STATE) },
    );
    // Стороны — редактирующие поверхности: editor.*-конфиг (tabSize, отступы)
    // применяется как к обычным вкладкам.
    for (const side of pane.sidePanes()) editors.applyConfigurationToEditor(side);
    // Спеки сторон — для автоосвежения снимков по onDidChangeFile (US-31):
    // политика чтения (`onMissing`) остаётся в одном месте.
    paneOptions.set(pane, options);
    editors.openPane(pane);
    return "opened";
}

/** Спеки сторон открытых вкладок; живут и умирают вместе с панелью. */
const paneOptions = new WeakMap<DiffEditorPane2, IOpenDiffPairOptions>();

/**
 * Освежает снимочные стороны вкладки по её же спекам (US-31: git-провайдер
 * сообщил об изменении ресурса — HEAD сдвинулся). Неизменившийся текст панель
 * отбрасывает сама; ошибка чтения стороны здесь молча пропускается — вкладка
 * продолжает показывать прежний снимок, нотиса без действий пользователя нет.
 */
export async function refreshDiffSnapshots(
    providers: IFileSystemProviderRegistry,
    pane: DiffEditorPane2,
): Promise<void> {
    const options = paneOptions.get(pane);
    if (options === undefined) return;
    await refreshSnapshotSides(providers, pane, options);
}

/**
 * Резолв обеих сторон в готовый вход панели, без открытия вкладки. `null` —
 * сторона не читается по её политике (ссылки/модели уже взятых сторон
 * освобождаются — вкладки не будет).
 */
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
        // Стороны вкладки — для TabInputTextDiff в API расширений; сторона без
        // uri (Clipboard) остаётся без ресурса.
        ...(options.original.uri !== undefined ? { originalUri: options.original.uri } : {}),
        ...(options.modified.uri !== undefined ? { modifiedUri: options.modified.uri } : {}),
    };
}

/**
 * Идентичность вкладки: путь — правой (изменённой) стороны, чтобы вкладка
 * группировалась с файлом, о котором она; в query — упорядоченная пара ключей
 * сторон. `(лево, право)` ≠ `(право, лево)` by design: это разные сравнения.
 */
function pairUri(options: IOpenDiffPairOptions): Uri {
    const path = options.modified.uri?.path ?? options.original.uri?.path ?? "/compare";
    const query = `left=${encodeURIComponent(options.original.identity)}&right=${encodeURIComponent(options.modified.identity)}`;
    return Uri.from({ scheme: DIFF_SCHEME, path, query });
}

/**
 * Источник стороны по её спеке. Порядок ветвления — от явного к выводимому:
 * готовая модель → готовый текст → без uri пусто → снимок с диска/провайдера
 * (`preferDisk`, не-file схемы) → **живая модель из реестра** для `file:`.
 * Файл, которого нет ни в буферах, ни на диске, — по политике `onMissing`.
 */
async function resolveSide(accessor: ServiceAccessor, side: IDiffSideSpec): Promise<DiffV2SideSource | null> {
    if (side.ownedModel !== undefined) return { kind: "owned", model: side.ownedModel };
    if (side.text !== undefined) return { kind: "snapshot", text: side.text };
    if (side.uri === undefined) return { kind: "snapshot", text: "" };
    if (side.preferDisk === true || side.uri.scheme !== "file") {
        const text = await readSideText(accessor.get(FileSystemProviderRegistryDIToken), side);
        return text === null ? null : { kind: "snapshot", text };
    }

    const editors = accessor.get(EditorServiceDIToken);
    if (editors.openFileModel(side.uri) === null) {
        // Файл не открыт — политика `onMissing` требует знать, существует ли он,
        // а фабрика реестра отсутствующий файл молча открыла бы пустым буфером
        // (семантика «новый файл по пути»). Пробуем чтение провайдером; сам
        // контент возьмёт модель.
        try {
            await accessor.get(FileSystemProviderRegistryDIToken).readFile(side.uri);
        } catch {
            return side.onMissing === "empty" ? { kind: "snapshot", text: "" } : null;
        }
    }
    return { kind: "shared", ref: editors.acquireFileModel(side.uri) };
}

/**
 * Текст снимочной стороны; `null` — не читается (и это ошибка по её политике).
 */
async function readSideText(providers: IFileSystemProviderRegistry, side: IDiffSideSpec): Promise<string | null> {
    if (side.text !== undefined) return side.text;
    if (side.uri === undefined) return "";
    try {
        if (!providers.hasProvider(side.uri.scheme)) throw new Error(`no provider for ${side.uri.scheme}`);
        return new TextDecoder().decode(await providers.readFile(side.uri));
    } catch {
        return side.onMissing === "empty" ? "" : null;
    }
}

/**
 * Освежает снимочные стороны существующей вкладки свежими текстами (HEAD
 * сдвинулся, диск перезаписан). Живые стороны не трогаются — они и так
 * актуальны. Неизменившийся текст панель отбрасывает сама (no-op).
 */
async function refreshSnapshotSides(
    providers: IFileSystemProviderRegistry,
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

/** Язык подсветки снимков: открытая модель стороны с uri, иначе по расширению файла. */
function resolveLanguageId(accessor: ServiceAccessor, options: IOpenDiffPairOptions): string {
    const languages = accessor.get(LanguageServiceDIToken);
    const editors = accessor.get(EditorServiceDIToken);
    for (const side of [options.modified, options.original]) {
        if (side.uri === undefined) continue;
        const model = editors.openFileModel(side.uri);
        if (model !== null) return model.languageId;
        const byResource = languages.getLanguageIdForResource(side.uri.path);
        if (byResource !== undefined) return byResource;
    }
    return "plaintext";
}

/** Транзиентный нотис в статус-баре — единая форма отказов сравнения. */
export function showCompareNotice(accessor: ServiceAccessor, text: string): void {
    const handle = accessor.get(StatusBarServiceDIToken).addEntry({
        id: "diff.compare.notice",
        text,
        alignment: "left",
        priority: 100,
    });
    setTimeout(() => {
        handle.dispose();
    }, COMPARE_NOTICE_MS);
}

/** Имя файла для меток вкладки/колонок: basename пути uri. */
export function compareLabelOf(uri: Uri): string {
    return uri.path.slice(uri.path.lastIndexOf("/") + 1);
}
