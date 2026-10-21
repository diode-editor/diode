import { afterEach, beforeEach } from "vitest";

import { UnexpectedErrorCollector } from "./unexpectedErrors.ts";

// A test with its own `setUnexpectedErrorHandler` overrides the collector — then there is nothing to collect.
const collector = new UnexpectedErrorCollector();

beforeEach(() => {
    collector.install();
});

afterEach((context) => {
    collector.check(context.task.result?.state === "fail");
});
