import { describe, expect, it } from "vitest";

import { AdjustableClock, AdjustableClockDIToken, ClockDIToken } from "../../platform/clock/common/clock.ts";
import { Container } from "../../platform/instantiation/common/diContainer.ts";

import { coreModuleLate } from "./coreModule.ts";

describe("coreModule", () => {
    it("the clock is one movable instance: the inspector moves the clock the timers run on", () => {
        const container = new Container();

        container.use(coreModuleLate);

        expect(container.get(ClockDIToken)).toBeInstanceOf(AdjustableClock);
        expect(container.get(ClockDIToken)).toBe(container.get(AdjustableClockDIToken));
    });
});
