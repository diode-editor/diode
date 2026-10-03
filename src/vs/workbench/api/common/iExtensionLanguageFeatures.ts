import type { IDisposable } from "@tuidom/core/common/disposable";

import type {
    ICompletionRequest,
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../editor/common/languages/iCompletionSource.ts";
import type {
    ICoreDefinitionLocation,
    IDefinitionRequest,
} from "../../../editor/common/languages/iDefinitionSource.ts";
import type { ICoreHover, IHoverRequest } from "../../../editor/common/languages/iHoverSource.ts";
import type { ICoreReference, IReferenceRequest } from "../../../editor/common/languages/iReferenceSource.ts";
import type {
    ICoreSignatureHelp,
    ISignatureHelpRequest,
} from "../../../editor/common/languages/iSignatureHelpSource.ts";

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
    provideDefinition(handle: number, request: IDefinitionRequest): Promise<readonly ICoreDefinitionLocation[]>;
    provideReferences(handle: number, request: IReferenceRequest): Promise<readonly ICoreReference[]>;
    provideSignatureHelp(handle: number, request: ISignatureHelpRequest): Promise<ICoreSignatureHelp | null>;
    provideCompletionItems(handle: number, request: ICompletionRequest): Promise<ICoreCompletionResult>;
    resolveCompletionItem(id: string): Promise<ICoreResolvedCompletion | null>;
}
