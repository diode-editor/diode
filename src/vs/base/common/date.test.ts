import { describe, expect, it } from "vitest";

import { fromNow } from "./date.ts";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("fromNow", () => {
    it.each([
        [0, "now"],
        [29 * SECOND, "now"],
        [30 * SECOND, "30 secs ago"],
        [59 * SECOND, "59 secs ago"],
        [MINUTE, "1 min ago"],
        [5 * MINUTE, "5 mins ago"],
        [HOUR, "1 hr ago"],
        [3 * HOUR, "3 hrs ago"],
        [DAY, "1 day ago"],
        [6 * DAY, "6 days ago"],
        [7 * DAY, "1 wk ago"],
        [20 * DAY, "3 wks ago"],
        [30 * DAY, "1 mo ago"],
        [60 * DAY, "2 mos ago"],
        [365 * DAY, "1 yr ago"],
        [3 * 365 * DAY, "3 yrs ago"],
    ])("%i ms ago with the ago label is %s", (delta, expected) => {
        expect(fromNow(NOW - delta, NOW, true)).toBe(expected);
    });

    it.each([
        [30 * SECOND, "30 secs"],
        [MINUTE, "1 min"],
        [2 * MINUTE, "2 mins"],
        [HOUR, "1 hr"],
        [2 * HOUR, "2 hrs"],
        [DAY, "1 day"],
        [2 * DAY, "2 days"],
        [7 * DAY, "1 wk"],
        [14 * DAY, "2 wks"],
        [30 * DAY, "1 mo"],
        [90 * DAY, "3 mos"],
        [365 * DAY, "1 yr"],
        [730 * DAY, "2 yrs"],
    ])("%i ms ago without the label is %s", (delta, expected) => {
        expect(fromNow(NOW - delta, NOW)).toBe(expected);
    });

    it("a second ago is singular, 30 seconds ahead or less is still now", () => {
        expect(fromNow(NOW - 1 * SECOND, NOW, true, true)).toBe("1 sec ago");
        expect(fromNow(NOW - 1 * SECOND, NOW, false, true)).toBe("1 sec");
        expect(fromNow(NOW + 30 * SECOND, NOW, true)).toBe("now");
    });

    it("a date in the future reads as `in …` without the ago label", () => {
        expect(fromNow(NOW + 31 * SECOND, NOW, true)).toBe("in 31 secs");
        expect(fromNow(NOW + 2 * DAY, NOW, true)).toBe("in 2 days");
    });
});
