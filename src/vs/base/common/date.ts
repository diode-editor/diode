/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/date.ts
// `Intl.*` is created lazily: the V8 snapshot forbids it at module top level.

import { Lazy } from "./lazy.ts";

export const safeIntl = {
    Segmenter(locales?: Intl.LocalesArgument, options?: Intl.SegmenterOptions): Lazy<Intl.Segmenter> {
        return new Lazy(() => {
            try {
                return new Intl.Segmenter(locales, options);
            } catch {
                return new Intl.Segmenter(undefined, options);
            }
        });
    },
};

const minute = 60;
const hour = minute * 60;
const day = hour * 24;
const week = day * 7;
const month = day * 30;
const year = day * 365;

function plural(value: number, one: string, many: string, ago: boolean | undefined): string {
    return `${String(value)} ${value === 1 ? one : many}${ago === true ? " ago" : ""}`;
}

/**
 * Create a difference of the time between now and the specified date.
 * Deviation: `now` is a parameter (no clock at module top level, and testable), the strings are English only
 * (no `localize`), and `useFullTimeWords` is dropped until something needs it.
 * @param date The date to generate the difference from.
 * @param now The current time, as `Date.now()`.
 * @param appendAgoLabel Whether to append the " ago" to the end.
 * @param disallowNow Whether to disallow the string "now" when the difference
 * is less than 30 seconds.
 */
export function fromNow(date: number, now: number, appendAgoLabel?: boolean, disallowNow?: boolean): string {
    const seconds = Math.round((now - date) / 1000);
    if (seconds < -30) {
        return `in ${fromNow(now + seconds * 1000, now, false)}`;
    }

    if (disallowNow !== true && seconds < 30) {
        return "now";
    }

    if (seconds < minute) {
        return plural(seconds, "sec", "secs", appendAgoLabel);
    }
    if (seconds < hour) {
        return plural(Math.round(seconds / minute), "min", "mins", appendAgoLabel);
    }
    if (seconds < day) {
        return plural(Math.round(seconds / hour), "hr", "hrs", appendAgoLabel);
    }
    if (seconds < week) {
        return plural(Math.round(seconds / day), "day", "days", appendAgoLabel);
    }
    if (seconds < month) {
        return plural(Math.round(seconds / week), "wk", "wks", appendAgoLabel);
    }
    if (seconds < year) {
        return plural(Math.round(seconds / month), "mo", "mos", appendAgoLabel);
    }
    return plural(Math.round(seconds / year), "yr", "yrs", appendAgoLabel);
}
