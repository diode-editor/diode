import type { IContextKeyContributor } from "../../platform/contextkey/common/contextKeyContributor.ts";
import type { Token } from "../../platform/instantiation/common/diContainer.ts";
import { FindServiceDIToken } from "../contrib/find/browser/findService.ts";
import { HoverServiceDIToken } from "../contrib/hover/browser/hoverService.ts";
import { InlineCompletionsServiceDIToken } from "../contrib/inlineCompletions/browser/inlineCompletionsService.ts";
import { ParameterHintsServiceDIToken } from "../contrib/parameterHints/browser/parameterHintsService.ts";
import { SearchComponentDIToken } from "../contrib/search/browser/searchComponent.ts";
import { CompletionServiceDIToken } from "../contrib/suggest/browser/completionService.ts";

import { SidebarServiceDIToken } from "./parts/sidebar/sidebarService.ts";

/**
 * Явный список фич, которые сами выставляют свои контекст-ключи (зеркало
 * `WORKBENCH_CONTRIBUTIONS`). `WorkbenchContextKeys` опрашивает их в этом
 * порядке перед резолвом каждого биндинга и на смене фокуса. Новый фичевый
 * ключ — метод `updateContextKeys` у фичи и строка здесь, а не правка центра.
 */
export const WORKBENCH_CONTEXT_KEY_CONTRIBUTORS: readonly Token<IContextKeyContributor>[] = [
    SearchComponentDIToken,
    // Виджеты над редактором: их *Visible-ключи гейтят Enter/Escape/Tab/стрелки.
    FindServiceDIToken,
    CompletionServiceDIToken,
    HoverServiceDIToken,
    ParameterHintsServiceDIToken,
    InlineCompletionsServiceDIToken,
    // Видимость вьюлетов: ключ объявляет дескриптор контейнера (visibleContextKey).
    SidebarServiceDIToken,
];
