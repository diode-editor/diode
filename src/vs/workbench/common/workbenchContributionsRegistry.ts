import { Disposable } from "../../base/common/lifecycle.ts";
import type { ServiceAccessor } from "../../platform/instantiation/common/diContainer.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken } from "../../platform/instantiation/common/diContainer.ts";
import { getInstantiationTracer } from "../../platform/instantiation/common/instantiationTrace.ts";
import type { LifecyclePhase } from "../services/lifecycle/common/lifecyclePhase.ts";

import type { IWorkbenchContributionRegistration, WorkbenchContributionPhase } from "./iWorkbenchContribution.ts";

export const WorkbenchContributionsDIToken =
    token<readonly IWorkbenchContributionRegistration[]>("WorkbenchContributions");
export const WorkbenchContributionsRegistryDIToken = token<WorkbenchContributionsRegistry>(
    "WorkbenchContributionsRegistry",
);

/**
 * Owns the lifetime of instantiated contributions. The root runs `blockStartup` itself in its
 * constructor, other phases run on `LifecycleService` transitions; `afterRestored` has no
 * transition of its own: its batch runs first in the transition to `eventually`.
 */
export class WorkbenchContributionsRegistry extends Disposable {
    public static dependencies = [ServiceAccessorDIToken, WorkbenchContributionsDIToken] as const;

    public constructor(
        private readonly accessor: ServiceAccessor,
        private readonly registrations: readonly IWorkbenchContributionRegistration[],
    ) {
        super();
    }

    /** Phases without contributions (`starting`, `restored`) resolve nothing. */
    public instantiateByPhase(phase: WorkbenchContributionPhase | LifecyclePhase): void {
        if (phase === "eventually") this.instantiate("afterRestored");
        this.instantiate(phase);
    }

    private instantiate(phase: WorkbenchContributionPhase | LifecyclePhase): void {
        const tracer = getInstantiationTracer();
        for (const registration of this.registrations) {
            if (registration.phase !== phase) continue;
            const get = () => this.accessor.get(registration.token);
            this.register(tracer === undefined ? get() : tracer.contribution(phase, get));
        }
    }
}
