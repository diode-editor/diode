import { Disposable } from "@tuidom/all/common/disposable";
import type { ServiceAccessor } from "../../platform/instantiation/common/diContainer.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";

import { ServiceAccessorDIToken } from "./coreTokens.ts";
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
 * contribution'ы. Фазы прогоняет владелец корня: `Restored` — в
 * `WorkbenchComponent.mount()`, `Eventually` — `main.ts` после первого кадра.
 */
export class WorkbenchContributionsRegistry extends Disposable {
    public static dependencies = [ServiceAccessorDIToken, WorkbenchContributionsDIToken] as const;

    public constructor(
        private readonly accessor: ServiceAccessor,
        private readonly registrations: readonly IWorkbenchContributionRegistration[],
    ) {
        super();
    }

    public instantiateByPhase(phase: WorkbenchContributionPhase): void {
        for (const registration of this.registrations) {
            if (registration.phase !== phase) continue;
            this.register(this.accessor.get(registration.token));
        }
    }
}
