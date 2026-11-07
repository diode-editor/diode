import { Uri } from "../../../../base/common/uri.ts";
import type { MenuContextKeys } from "../../../../platform/actions/common/menuRegistry.ts";
import { type IWireTestMessageArg, TestId } from "../../../api/common/testingWireTypes.ts";
import { resourceContextKeysOf } from "../../../browser/resourceContextKeys.ts";

import { messageOf, type TestMessageSubject } from "./testMessageView.ts";

/**
 * Upstream's keys of `testing/message/context` and `testing/message/content`: `testMessage` (the message's
 * `contextValue`), `testResultOutdated`, the test's `testId` and `controllerId`; and the resource keys of the
 * message's place, else its test's (upstream sees the active editor's: the message's when it is peeked there).
 */
export function testMessageMenuKeys(subject: TestMessageSubject): MenuContextKeys {
    const message = messageOf(subject);
    const { item } = subject.test;
    const where = message.location?.uri ?? item.uri;
    return {
        testId: TestId.localId(item.extId),
        controllerId: subject.test.controllerId,
        testMessage: message.contextValue ?? "",
        // Upstream retires a result when its test changes; ours are not retired.
        testResultOutdated: false,
        ...(where === undefined ? {} : resourceContextKeysOf(Uri.parse(where))),
    };
}

/** Upstream `getMessageArgs`: the extension's command gets `{ test, message }`. */
export function testMessageArg(subject: TestMessageSubject): IWireTestMessageArg {
    return { $testMessageTestId: subject.test.item.extId, message: messageOf(subject) };
}
