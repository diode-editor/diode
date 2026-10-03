import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/**
 * Сервис расширений окна (аналог vscode `IExtensionService`, узкий срез):
 * владелец цикла «набор → регистрация в extension host'е → стартовая
 * активация». Механику (RPC, субпроцесс) держит `ExtensionHost`, политику —
 * «что и когда активировать» — сервис.
 *
 * Набор статичен на время жизни окна (установленное начинает работать после
 * перезагрузки), поэтому событий изменения состава нет.
 */
export interface IExtensionService {
    /** Весь просканированный набор (пользовательские, затем встроенные). */
    readonly extensions: readonly IExtension[];
    getExtension(id: string): IExtension | undefined;
    /**
     * Барьер: расширения зарегистрированы в host'е, а события, запрошенные до
     * этого, проиграны (аналог `whenInstalledExtensionsRegistered`).
     */
    whenInstalledExtensionsRegistered(): Promise<void>;
    /**
     * Активация по событию. До барьера событие запоминается и проигрывается
     * после регистрации — оно не теряется, даже если пришло раньше (файл открыт
     * до регистрации расширений); промис резолвится на барьере.
     */
    activateByEvent(event: string): Promise<void>;
    /** Проход `workspaceContains:` по папкам воркспейса; до барьера — его делает старт. */
    activateByWorkspaceContains(): Promise<void>;
    /**
     * Регистрация набора в extension host'е и стартовая активация. Зовёт старт
     * окна в фазе `restored` (`workbenchStartup.ts`), один раз.
     */
    start(): Promise<void>;
}

export const ExtensionServiceDIToken = token<IExtensionService>("ExtensionService");
