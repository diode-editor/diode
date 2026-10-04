import type * as vscode from "vscode";

import { implementsApi } from "./apiSurface.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import { EventEmitter, ExtensionKind, Uri } from "./vscodeTypes.ts";
import { type IWireExtensionDescription, parseWireExtensionActivated, parseWireExtensionCatalog } from "./wireTypes.ts";

/**
 * `vscode.extensions` поверх каталога, который раздаёт хост.
 *
 * Состав знает ТОЛЬКО хост (он сканирует user-data и держит регистрации), а
 * субпроцесс — исполнитель: каталог приезжает уведомлением `extensions.catalog`
 * (семя на handshake, до первой активации — расширения зовут `getExtension` уже
 * в `activate()`), а флаг `isActive` доводится точечным `extensions.activated`,
 * чтобы не гонять по проводу весь список манифестов на каждую активацию.
 *
 * `exports` (публичный API расширения — то, что вернул его `activate()`) по
 * проводу не ездит вовсе: все расширения живут в ЭТОМ субпроцессе, и значение
 * лежит в общей карте {@link IExtensionsNamespace.exportsById}, которую
 * наполняет точка входа субпроцесса.
 */
export interface IExtensionsNamespace {
    readonly extensions: typeof vscode.extensions;
    /**
     * Публичные API активированных расширений (id → возвращённое `activate()`).
     * Владелец — точка входа субпроцесса; namespace только читает.
     */
    readonly exportsById: Map<string, unknown>;
    /**
     * Каждый принятый каталог целиком (а не только смена состава, как
     * `onDidChange`): по нему субпроцесс индексирует корни расширений
     * (`ExtensionPaths`) ещё до их активации.
     */
    readonly onDidReceiveCatalog: vscode.Event<readonly IWireExtensionDescription[]>;
}

/**
 * `activate()` у полученного `Extension` НЕ реализован — осознанно.
 * Активацией у нас распоряжается хост (события активации, per-extension
 * изоляция, оживление после смерти субпроцесса), и honest-путь «субпроцесс
 * просит хост поднять соседа» — это отдельная задача с собственным RPC и
 * гонками. Уже активное расширение при этом отвечает как в эталоне: `activate()`
 * возвращает его `exports`, потому что активировать нечего.
 */
const ACTIVATE_NOT_IMPLEMENTED =
    "extension.activate() is not implemented in Diode: activation is driven by the host. " +
    "Extensions that are already active return their exports.";

export function createExtensionsNamespace(rpc: SubprocessRpc): IExtensionsNamespace {
    const exportsById = new Map<string, unknown>();
    /**
     * Последний каталог от хоста в порядке, в котором его прислали. Объекты
     * пересобираются только на новом каталоге — идентичность в пределах одного
     * состава стабильна (`getExtension(id) === getExtension(id)`, как в
     * эталоне): сравнение по ссылке в расширениях встречается, и плодить новый
     * объект на каждый геттер мы уже обжигались на `activeTextEditor`.
     */
    let known: readonly vscode.Extension<unknown>[] = [];
    /** Те же объекты по lowercase-id — для `getExtension`. */
    let byLowerId = new Map<string, vscode.Extension<unknown>>();
    /** id активных — отдельно от каталога: `extensions.activated` двигает только его. */
    const activeIds = new Set<string>();
    const changeEmitter = new EventEmitter<void>();
    const catalogEmitter = new EventEmitter<readonly IWireExtensionDescription[]>();

    /**
     * `Extension` — живой вид на состояние, а не снимок: `isActive`/`exports`
     * читаются геттерами. Расширение вправе подержать ссылку и спросить позже
     * (типовой путь «дождаться, пока сосед активируется»).
     */
    const toExtension = (description: IWireExtensionDescription): vscode.Extension<unknown> => ({
        id: description.id,
        extensionUri: Uri.file(description.extensionPath),
        extensionPath: description.extensionPath,
        packageJSON: description.packageJSON,
        extensionKind: ExtensionKind.UI,
        get isActive(): boolean {
            return activeIds.has(description.id);
        },
        get exports(): unknown {
            return exportsById.get(description.id);
        },
        activate: (): Thenable<unknown> =>
            activeIds.has(description.id)
                ? Promise.resolve(exportsById.get(description.id))
                : Promise.reject(new Error(ACTIVATE_NOT_IMPLEMENTED)),
    });

    rpc.handleNotification("extensions.catalog", (params) => {
        const parsed = parseWireExtensionCatalog(params);
        if (parsed === null) return;
        const before = known.map((e) => e.id);
        known = parsed.extensions.map(toExtension);
        byLowerId = new Map(known.map((e) => [e.id.toLowerCase(), e]));
        // Активными считаем тех, кого хост назвал активными, плюс тех, кого мы
        // уже видели ожившими: каталог мог уехать из хоста раньше, чем
        // `extensions.activated`, и терять флаг на этом нельзя.
        for (const description of parsed.extensions) {
            if (description.isActive) activeIds.add(description.id);
        }
        for (const id of [...activeIds]) {
            if (!parsed.extensions.some((d) => d.id === id)) activeIds.delete(id);
        }
        // `onDidChange` — про СОСТАВ (install/uninstall/enable/disable), как в
        // эталоне; на активацию он не стреляет, поэтому сравниваем именно id.
        const after = known.map((e) => e.id);
        if (before.length !== after.length || before.some((id, i) => id !== after[i])) changeEmitter.fire();
        catalogEmitter.fire(parsed.extensions);
    });

    rpc.handleNotification("extensions.activated", (params) => {
        const id = parseWireExtensionActivated(params);
        // Stryker disable next-line ConditionalExpression: снятый guard кладёт в `activeIds` сам `null`, а с ним `activeIds.has(<любой id>)` не меняется — мутант эквивалентен, наблюдать нечего
        if (id === null) return;
        activeIds.add(id);
    });

    const extensions = {
        get all(): readonly vscode.Extension<unknown>[] {
            return known;
        },
        // Регистр id в эталоне не важен (`ExtensionIdentifier.equals` сравнивает
        // lowercase): расширения пишут id руками и промахиваются регистром.
        // `T` — утверждение вызывающего о форме `exports` (как в эталоне):
        // проверить его нечем, поэтому сужение — каст.
        getExtension: <T = unknown>(extensionId: string): vscode.Extension<T> | undefined =>
            byLowerId.get(extensionId.toLowerCase()) as vscode.Extension<T> | undefined,
        onDidChange: changeEmitter.event,
    };

    return {
        extensions: implementsApi<typeof vscode.extensions>()(extensions),
        exportsById,
        onDidReceiveCatalog: catalogEmitter.event,
    };
}
