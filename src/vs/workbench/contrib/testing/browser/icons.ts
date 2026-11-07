import { codicon, type IProductIcon } from "../../../../base/common/codicons.ts";
import { TestResultState } from "../../../api/common/testingWireTypes.ts";

// Upstream `contrib/testing/browser/icons.ts` with `testStatesToIconColors` of `theme.ts`.

export interface ITestStateIcon {
    readonly icon: IProductIcon;
    /** A theme token. */
    readonly color: string;
}

/** Upstream `testingRunIcon`. */
export const testingRunIcon = codicon("run");
/** Upstream `testingRunAllIcon`. */
export const testingRunAllIcon = codicon("run-all");

/** Upstream `testingStatesToIcons` with `testStatesToIconColors`; Running is the spinner. */
export const testingStatesToIcons: Readonly<Partial<Record<TestResultState, ITestStateIcon>>> = {
    [TestResultState.Errored]: { icon: codicon("issues"), color: "testing.iconErrored" },
    [TestResultState.Failed]: { icon: codicon("error"), color: "testing.iconFailed" },
    [TestResultState.Passed]: { icon: codicon("pass"), color: "testing.iconPassed" },
    [TestResultState.Queued]: { icon: codicon("history"), color: "testing.iconQueued" },
    [TestResultState.Skipped]: { icon: codicon("debug-step-over"), color: "testing.iconSkipped" },
    [TestResultState.Unset]: { icon: codicon("circle-outline"), color: "testing.iconUnset" },
};
