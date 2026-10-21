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
 * `name: null` — никто имени не назвал, вызывающий добирает слово под кареткой сам;
 * `rejectReason` — поле ввода не открывается, человек видит причину.
 */
export interface IPreparedRename {
    readonly name: string | null;
    readonly rejectReason?: string;
}

/**
 * Ответы не склеиваются: всё решает ПЕРВЫЙ провайдер, которому есть что сказать. Отказ перебор
 * останавливает (upstream копит причины и идёт дальше): правки накладывает сам провайдер, и
 * следующий переименовал бы то, что первый запретил. Сбой RPC — «сказать нечего».
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

/** Провайдер без правок пропускается, отказ перебор останавливает; нет результата — `applied: false` без сообщения. */
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
