import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { Token } from "../../instantiation/common/diContainer.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import type { ContextKeyService } from "./contextKeyService.ts";

/**
 * Центр (`WorkbenchContextKeys`) опрашивает контрибьюторов перед резолвом каждого
 * бинда и на смене фокуса (pull): ключ самоисцеляется на следующем нажатии и не
 * залипает. Ключ с единственным переходом состояния фича вправе пушить сама —
 * контрибьютор для того, что выводится из фокуса или меняется без события.
 */
export interface IContextKeyContributor {
    updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void;
}

/** Центр резолвит их при своём создании: сюда — только фичи, которые и так поднимаются с workbench. */
export const ContextKeyContributorsDIToken = token<readonly Token<IContextKeyContributor>[]>("ContextKeyContributors");
