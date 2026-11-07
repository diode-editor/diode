import { codicon, type IProductIcon } from "../../../../base/common/codicons.ts";
import { TestResultState } from "../../../api/common/testingWireTypes.ts";

// Upstream `contrib/testing/browser/icons.ts`: the glyphs both testing views draw.

/** Upstream `testingStatesToIcons` with `testStatesToIconColors`; Running is the spinner. */
export const STATE_ICONS: Readonly<
    Partial<Record<TestResultState, { readonly icon: IProductIcon; readonly color: string }>>
> = {
    [TestResultState.Errored]: { icon: codicon("issues"), color: "testing.iconErrored" },
    [TestResultState.Failed]: { icon: codicon("error"), color: "testing.iconFailed" },
    [TestResultState.Passed]: { icon: codicon("pass"), color: "testing.iconPassed" },
    [TestResultState.Queued]: { icon: codicon("history"), color: "testing.iconQueued" },
    [TestResultState.Skipped]: { icon: codicon("debug-step-over"), color: "testing.iconSkipped" },
    [TestResultState.Unset]: { icon: codicon("circle-outline"), color: "testing.iconUnset" },
};

/** Upstream `testingRerunIcon`, `testingRunIcon`, `testingCancelIcon`. */
export const RERUN_ICON = codicon("debug-rerun");
export const RUN_ICON = codicon("run");
export const CANCEL_ICON = codicon("debug-stop");
