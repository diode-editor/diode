import { Disposable } from "../../base/common/lifecycle.ts";
import type { ServiceAccessor } from "../../platform/instantiation/common/diContainer.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken } from "../../platform/instantiation/common/diContainer.ts";
import type { LifecyclePhase } from "../services/lifecycle/common/lifecyclePhase.ts";

import type { IWorkbenchContributionRegistration, WorkbenchContributionPhase } from "./iWorkbenchContribution.ts";

export const WorkbenchContributionsDIToken =
    token<readonly IWorkbenchContributionRegistration[]>("WorkbenchContributions");
export const WorkbenchContributionsRegistryDIToken = token<WorkbenchContributionsRegistry>(
    "WorkbenchContributionsRegistry",
);

/**
 * Реестр workbench-contributions: по фазе инстанцирует свою пачку через DI
 * (`accessor.get(token)` — авто-инжект `static dependencies` + кэш-синглтон) и
 * забирает владение жизнью (`register`), поэтому dispose реестра сматывает все
 * contribution'ы. `blockStartup` корень (`WorkbenchComponent`) прогоняет сам, в
 * конструкторе; остальное привязано к фазам `LifecycleService`: корень зовёт
 * {@link instantiateByPhase} на каждый переход — `ready` наступает в `mount()`,
 * `eventually` — после первого кадра.
 */
export class WorkbenchContributionsRegistry extends Disposable {
    public static dependencies = [ServiceAccessorDIToken, WorkbenchContributionsDIToken] as const;

    public constructor(
        private readonly accessor: ServiceAccessor,
        private readonly registrations: readonly IWorkbenchContributionRegistration[],
    ) {
        super();
    }

    /** Фазы, на которые contribution'ов нет (`starting`, `restored`), ничего не резолвят. */
    public instantiateByPhase(phase: WorkbenchContributionPhase | LifecyclePhase): void {
        for (const registration of this.registrations) {
            if (registration.phase !== phase) continue;
            this.register(this.accessor.get(registration.token));
        }
    }
}
