import type { MenuContextKeys } from "../../../../platform/actions/common/menuRegistry.ts";
import { TestId } from "../../../api/common/testingWireTypes.ts";
import type { ITestNode } from "../common/testService.ts";

/** Upstream `getTestItemContextOverlay`: the keys a test's menus (row, gutter) are resolved with. */
export function getTestItemContextOverlay(test: Pick<ITestNode, "item" | "controllerId">): MenuContextKeys {
    return {
        testId: TestId.localId(test.item.extId),
        controllerId: test.controllerId,
        "testing.testItemHasUri": test.item.uri !== undefined,
    };
}
