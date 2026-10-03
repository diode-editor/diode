import type { IContextKeyContributor } from "../../platform/contextkey/common/contextKeyContributor.ts";
import type { Token } from "../../platform/instantiation/common/diContainer.ts";
import { SearchComponentDIToken } from "../contrib/search/browser/searchComponent.ts";

/**
 * Явный список фич, которые сами выставляют свои контекст-ключи (зеркало
 * `WORKBENCH_CONTRIBUTIONS`). `WorkbenchContextKeys` опрашивает их в этом
 * порядке перед резолвом каждого биндинга и на смене фокуса. Новый фичевый
 * ключ — метод `updateContextKeys` у фичи и строка здесь, а не правка центра.
 */
export const WORKBENCH_CONTEXT_KEY_CONTRIBUTORS: readonly Token<IContextKeyContributor>[] = [SearchComponentDIToken];
