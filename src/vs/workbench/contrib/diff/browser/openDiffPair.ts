import { Uri } from "../../../../base/common/uri.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { DiffEditorPane } from "../../../browser/parts/editor/diffEditorPane.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import {
    FileSystemProviderRegistryDIToken,
    LanguageServiceDIToken,
    TokenizationRegistryDIToken,
    TokenStyleResolverDIToken,
} from "../../../common/coreTokens.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

/** Схема вкладки диффа: не ресурс на диске, а пара «источник ↔ источник». */
const DIFF_SCHEME = "vexx-diff";

/** Сколько держать нотис о том, что сравнение не удалось. */
export const COMPARE_NOTICE_MS = 4000;

/**
 * Сторона сравнения. Текст берётся из `text`, если он задан (Clipboard);
 * иначе — по `uri`: открытый буфер этого ресурса (несохранённые правки видны),
 * а без него — чтение через реестр провайдеров ФС (`file:`, `git:`, …).
 */
export interface IDiffSideSpec {
    /** Ресурс стороны; не задан — сторона живёт только в `text`. */
    readonly uri?: Uri;
    /** Готовый текст стороны; задан — `uri` для чтения не используется. */
    readonly text?: string;
    /** Подпись колонки side-by-side и половина метки вкладки. */
    readonly label: string;
    /**
     * Ключ идентичности вкладки. Пара ключей (упорядоченная) определяет
     * «ту же» вкладку: тот же ключ → обновление снимка на месте, другой →
     * отдельная вкладка. По устройству НЕ зависит от текста: повторное
     * сравнение обновляет вкладку, а не плодит новую.
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
 * Ядро смотрелки изменений: открывает вкладку диффа для произвольной пары
 * источников — им пользуются и «Compare with HEAD», и всё семейство команд
 * сравнения (два файла, буфер обмена, сохранённая версия, ревизия), и
 * программная `vscode.diff`. Дифф считает перенесённый движок, отображение
 * собирает `DiffViewModel`, вкладкой это становится благодаря абстракции
 * панели.
 *
 * Дифф — **снимок** на момент вызова: панель держит тексты у себя. Живой
 * пересчёт по правкам исходного буфера — отдельная задача (docs/TODO/DiffViewer.md).
 */
export async function openDiffPair(accessor: ServiceAccessor, options: IOpenDiffPairOptions): Promise<OpenDiffPairResult> {
    const editors = accessor.get(EditorServiceDIToken);

    const originalText = await resolveSideText(accessor, options.original);
    if (originalText === null) return "unreadable";
    const modifiedText = await resolveSideText(accessor, options.modified);
    if (modifiedText === null) return "unreadable";

    const input = {
        uri: pairUri(options),
        label: options.title ?? `${options.original.label} ↔ ${options.modified.label}`,
        originalLabel: options.original.label,
        modifiedLabel: options.modified.label,
        originalText,
        modifiedText,
        languageId: resolveLanguageId(accessor, options),
        // Стороны вкладки — для TabInputTextDiff в API расширений; сторона без
        // uri (Clipboard) остаётся без ресурса.
        ...(options.original.uri !== undefined ? { originalUri: options.original.uri } : {}),
        ...(options.modified.uri !== undefined ? { modifiedUri: options.modified.uri } : {}),
    };

    // Дифф — снимок, а идентичность вкладки от содержимого не зависит: группа
    // дедупит её по `uri`. Поэтому если вкладка той же пары уже открыта,
    // обновляем её свежим снимком на месте — иначе повторный вызов
    // (единственный способ «обновить» дифф) вернул бы устаревший результат.
    const existing = editors.getPanes().find((p) => p.uri.toString() === input.uri.toString());
    if (existing instanceof DiffEditorPane) {
        existing.setInput(input);
        editors.activateTab(editors.getPanes().indexOf(existing));
        return "opened";
    }

    editors.openPane(
        new DiffEditorPane(accessor.get(TokenizationRegistryDIToken), accessor.get(TokenStyleResolverDIToken), input),
    );
    return "opened";
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

/** Язык подсветки: открытый буфер стороны с uri, иначе по расширению файла. */
function resolveLanguageId(accessor: ServiceAccessor, options: IOpenDiffPairOptions): string {
    const languages = accessor.get(LanguageServiceDIToken);
    const editors = accessor.get(EditorServiceDIToken);
    for (const side of [options.modified, options.original]) {
        if (side.uri === undefined) continue;
        const pane = findTextPane(editors, side.uri);
        if (pane !== undefined) return pane.languageId;
        const byResource = languages.getLanguageIdForResource(side.uri.path);
        if (byResource !== undefined) return byResource;
    }
    return "plaintext";
}

/**
 * Текст стороны; `null` — сторона не читается (и это ошибка по её политике).
 * Открытый буфер побеждает диск (несохранённые правки видны), кроме
 * `preferDisk` — там наоборот, содержимое буфера и есть вторая сторона.
 */
async function resolveSideText(accessor: ServiceAccessor, side: IDiffSideSpec): Promise<string | null> {
    if (side.text !== undefined) return side.text;
    if (side.uri === undefined) return "";

    if (side.preferDisk !== true) {
        const pane = findTextPane(accessor.get(EditorServiceDIToken), side.uri);
        if (pane !== undefined) return pane.getText();
    }

    const providers = accessor.get(FileSystemProviderRegistryDIToken);
    try {
        if (!providers.hasProvider(side.uri.scheme)) throw new Error(`no provider for ${side.uri.scheme}`);
        return new TextDecoder().decode(await providers.readFile(side.uri));
    } catch {
        return side.onMissing === "empty" ? "" : null;
    }
}

function findTextPane(editors: EditorService, uri: Uri): TextEditorPane | undefined {
    return editors
        .getPanes()
        .find((p): p is TextEditorPane => p instanceof TextEditorPane && p.uri.toString() === uri.toString());
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
