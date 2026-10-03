import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { Token } from "../../instantiation/common/diContainer.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import type { ContextKeyService } from "./contextKeyService.ts";

/**
 * Фича, у которой есть контекст-ключи, зависящие от фокуса или от её
 * собственного состояния. Ключи принадлежат фиче, а освежает их центр
 * (`WorkbenchContextKeys`): перед резолвом каждого биндинга и на смене фокуса
 * он опрашивает всех контрибьюторов. Тайминг тот же, что у центральных ключей
 * (pull), поэтому ключ самоисцеляется на следующем же нажатии и не залипает.
 *
 * Ключ с единственным переходом состояния фича вправе пушить сама в момент
 * перехода (`contextKeys.set` из своего кода) — контрибьютор нужен для того,
 * что выводится из фокуса или меняется без события.
 */
export interface IContextKeyContributor {
    /** Выставить свои ключи; `active` — сфокусированный элемент дерева (или `null`). */
    updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void;
}

/**
 * Явный список токенов контрибьюторов (как `WorkbenchContributionsDIToken`, без
 * import-side-effect самрегистрации). Центр резолвит их при своём создании,
 * поэтому сюда кладут только фичи, которые и так поднимаются вместе с workbench.
 */
export const ContextKeyContributorsDIToken = token<readonly Token<IContextKeyContributor>[]>("ContextKeyContributors");
