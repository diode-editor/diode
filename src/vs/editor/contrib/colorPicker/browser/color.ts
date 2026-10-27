import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import type { ILanguageFeatureTarget, LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type {
    DocumentColorProvider,
    IColorInformation,
    IDocumentColorRequest,
} from "../../../common/languages/iColorSource.ts";

import { DefaultDocumentColorProvider } from "./defaultDocumentColorProvider.ts";

/** Values of `editor.defaultColorDecorators`. */
export type DefaultColorDecoratorsEnablement = "auto" | "always" | "never";

async function collect(
    provider: DocumentColorProvider,
    request: IDocumentColorRequest,
    token: ICancellationToken,
    colors: IColorInformation[],
): Promise<boolean> {
    const documentColors = await provider.provideDocumentColors(request, token);
    if (Array.isArray(documentColors)) {
        // Not `push(...)`: a spread of hundreds of thousands of colors overflows the call stack.
        for (const color of documentColors as readonly IColorInformation[]) colors.push(color);
    }
    return Array.isArray(documentColors);
}

/**
 * Port of upstream `getColors`/`_findColorData`: every provider but the default one; if any of them
 * answered (even with nothing), only their colors. Otherwise the default detector, unless `never`;
 * `always` asks it on par with the rest.
 */
export async function getColors(
    registry: LanguageFeatureRegistry<DocumentColorProvider>,
    model: ILanguageFeatureTarget,
    request: IDocumentColorRequest,
    token: ICancellationToken,
    defaultColorDecoratorsEnablement: DefaultColorDecoratorsEnablement = "auto",
): Promise<IColorInformation[]> {
    let validDocumentColorProviderFound = false;
    let defaultProvider: DefaultDocumentColorProvider | undefined;
    const colorData: IColorInformation[] = [];
    const documentColorProviders = registry.ordered(model);
    for (let i = documentColorProviders.length - 1; i >= 0; i--) {
        const provider = documentColorProviders[i];
        if (defaultColorDecoratorsEnablement !== "always" && provider instanceof DefaultDocumentColorProvider) {
            defaultProvider = provider;
        } else {
            try {
                if (await collect(provider, request, token, colorData)) {
                    validDocumentColorProviderFound = true;
                }
            } catch (e) {
                onUnexpectedError(e);
            }
        }
    }
    if (validDocumentColorProviderFound) {
        return colorData;
    }
    if (defaultProvider && defaultColorDecoratorsEnablement !== "never") {
        await collect(defaultProvider, request, token, colorData);
        return colorData;
    }
    return [];
}
