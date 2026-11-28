// Port of upstream `services/userActivity/browser/domActivityTracker.ts` (1.127), same constants. The document is the
// root view: every key and click reaches its capture phase, overlays included. Upstream also counts `touchstart`; a
// terminal has no touch. The wheel is not activity there either.

import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Disposable, MutableDisposable, toDisposable } from "../../../../base/common/lifecycle.ts";
import type { IUserActivityService } from "../common/userActivityService.ts";

/**
 * Every interval the tracker checks whether there was input. After `MIN_INTERVALS_WITHOUT_ACTIVITY` quiet ones the
 * user is inactive: at most `CHECK_INTERVAL * (MIN_INTERVALS_WITHOUT_ACTIVITY + 1)` ms without input, plus the
 * service's debounce.
 */
export const CHECK_INTERVAL = 30_000;

/** See {@link CHECK_INTERVAL}. */
export const MIN_INTERVALS_WITHOUT_ACTIVITY = 2;

export class DomActivityTracker extends Disposable {
    public constructor(root: TUIElement, userActivityService: IUserActivityService) {
        super();

        let intervalsWithoutActivity = MIN_INTERVALS_WITHOUT_ACTIVITY;
        let intervalTimer: ReturnType<typeof setInterval> | undefined;
        const cancelInterval = (): void => {
            clearInterval(intervalTimer);
            intervalTimer = undefined;
        };
        this.register(toDisposable(cancelInterval));
        const activeMutex = this.register(new MutableDisposable());

        const onInterval = (): void => {
            if (++intervalsWithoutActivity === MIN_INTERVALS_WITHOUT_ACTIVITY) {
                activeMutex.clear();
                cancelInterval();
            }
        };

        const onActivity = (): void => {
            // Was inactive: the user has come back.
            if (intervalsWithoutActivity === MIN_INTERVALS_WITHOUT_ACTIVITY) {
                activeMutex.value = userActivityService.markActive();
                cancelInterval();
                intervalTimer = setInterval(onInterval, CHECK_INTERVAL);
            }
            intervalsWithoutActivity = 0;
        };

        // Capture: before any widget stops the event.
        for (const type of ["keydown", "mousedown"] as const) {
            root.addEventListener(type, onActivity, { capture: true });
            this.register(
                toDisposable(() => {
                    root.removeEventListener(type, onActivity, { capture: true });
                }),
            );
        }

        onActivity();
    }
}
