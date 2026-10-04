import type {
    ILanguageFeatureTarget,
    LanguageFeatureRegistry,
} from "../../../../editor/common/languageFeatureRegistry.ts";
import type {
    ICoreRenameLocation,
    ICoreRenameResult,
    IRenameRequest,
    RenameProvider,
} from "../../../../editor/common/languages/iRenameSource.ts";

/**
 * Что сказали о позиции rename-провайдеры документа. `name` — текущее имя
 * символа (placeholder поля ввода); `null` — никто имени не назвал, и
 * вызывающий добирает слово под кареткой сам. `rejectReason` — «здесь
 * переименовать нельзя»: поле ввода не открывается вовсе, человек видит
 * причину.
 */
export interface IPreparedRename {
    readonly name: string | null;
    readonly rejectReason?: string;
}

/**
 * Опрашивает rename-провайдеров документа по порядку `ordered` (upstream
 * `editor/contrib/rename/browser/rename.ts:RenameSkeleton.resolveRenameLocation`)
 * — в отличие от definition и references, ответы НЕ склеиваются: результат
 * всей операции определяет ПЕРВЫЙ провайдер, которому есть что сказать.
 *
 * Отказ провайдера перебор останавливает (upstream копит причины и идёт
 * дальше): правки накладывает сам провайдер, и спрашивать следующего после
 * «здесь нельзя» значит дать второму переименовать то, что первый запретил.
 * Сбойный провайдер (отказ самого RPC) — «сказать нечего», как у definition.
 */
export async function prepareRename(
    registry: LanguageFeatureRegistry<RenameProvider>,
    target: ILanguageFeatureTarget,
    request: IRenameRequest,
): Promise<IPreparedRename> {
    for (const provider of registry.ordered(target)) {
        const location = await provider.prepareRename(request).catch((): ICoreRenameLocation | null => null);
        if (location === null) continue;
        if (location.kind === "reject") return { name: null, rejectReason: location.reason };
        return { name: location.name };
    }
    return { name: null };
}

/**
 * Переименовывает символ первым провайдером документа, давшим правки
 * (upstream `RenameSkeleton.provideRenameEdits`). Провайдер без правок
 * пропускается, провайдер с отказом перебор останавливает — его сообщение
 * едет человеку. Ни одного провайдера или ни одного результата — `applied:
 * false` без сообщения: переименовывать было нечего.
 */
export async function renameSymbol(
    registry: LanguageFeatureRegistry<RenameProvider>,
    target: ILanguageFeatureTarget,
    request: IRenameRequest,
    newName: string,
): Promise<ICoreRenameResult> {
    for (const provider of registry.ordered(target)) {
        const result = await provider
            .provideRenameEdits(request, newName)
            .catch((): ICoreRenameResult => ({ applied: false, error: "Rename failed" }));
        if (result.applied || result.error !== undefined) return result;
    }
    return { applied: false };
}
