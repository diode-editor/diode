import { afterEach, beforeEach } from "vitest";

import { UnexpectedErrorCollector } from "./unexpectedErrors.ts";

// Тест со своим `setUnexpectedErrorHandler` перебивает сборщик — тогда собирать нечего.
const collector = new UnexpectedErrorCollector();

beforeEach(() => {
    collector.install();
});

afterEach((context) => {
    collector.check(context.task.result?.state === "fail");
});
