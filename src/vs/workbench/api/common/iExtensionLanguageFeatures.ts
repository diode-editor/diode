import type { IDisposable } from "@tuidom/core/common/disposable";

import type { ICoreHover, IHoverRequest } from "../../../editor/common/languages/iHoverSource.ts";

import type { IWireLanguageProviderRegistration } from "./wireTypes.ts";

/**
 * «Port» поверх {@link ExtensionHost}: языковые провайдеры субпроцесса и вызов
 * каждого по handle. Как {@link IExtensionFileSystemBridge}, описывает, что
 * Workbench'у нужно от host'а: реализует его сам `ExtensionHost` (структурно), а
 * в `ILanguageFeaturesService` прокси регистрирует `LanguageFeaturesAdapter`
 * (upstream `MainThreadLanguageFeatures`).
 */
export interface IExtensionLanguageFeaturesBridge {
    /** Живые регистрации провайдеров (`languages.register`). */
    getLanguageProviders(): readonly IWireLanguageProviderRegistration[];
    /** Состав регистраций изменился (регистрация, снятие, смерть субпроцесса). */
    onLanguageProvidersChanged(cb: () => void): IDisposable;
    provideHover(handle: number, request: IHoverRequest): Promise<ICoreHover | undefined>;
}
