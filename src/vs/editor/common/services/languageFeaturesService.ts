import { LanguageFeatureRegistry } from "../languageFeatureRegistry.ts";
import type { HoverProvider } from "../languages/iHoverSource.ts";

import type { ILanguageFeaturesService } from "./languageFeatures.ts";

/** Реализация {@link ILanguageFeaturesService}: по пустому реестру на фичу. */
export class LanguageFeaturesService implements ILanguageFeaturesService {
    public readonly hoverProvider = new LanguageFeatureRegistry<HoverProvider>();
}
