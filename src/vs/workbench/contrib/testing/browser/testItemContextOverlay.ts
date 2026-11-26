import type { MenuContextKeys } from "../../../../platform/actions/common/menuRegistry.ts";
import { TestId } from "../../../api/common/testingWireTypes.ts";
import { capabilityContextKeys } from "../common/testProfileService.ts";
import type { ITestNode } from "../common/testService.ts";

/**
 * Upstream `getTestItemContextOverlay`: the keys a test's menus (row, gutter) are resolved with, with what the test
 * can do (`TestProfileService.capabilitiesForTest`).
 */
export function getTestItemContextOverlay(
    test: Pick<ITestNode, "item" | "controllerId">,
    capabilities: number,
): MenuContextKeys {
    return {
        testId: TestId.localId(test.item.extId),
        controllerId: test.controllerId,
        "testing.testItemHasUri": test.item.uri !== undefined,
        ...capabilityContextKeys(capabilities),
    };
}
