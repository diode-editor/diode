import { afterEach, beforeEach } from "vitest";

import { UnexpectedErrorCollector } from "./unexpectedErrors.ts";

// Общий setupFiles vitest: непредвиденная ошибка за время теста роняет тест.
// Тест, которому нужен свой обработчик, ставит его сам (`setUnexpectedErrorHandler`)
// — тогда собирать становится нечего.
const collector = new UnexpectedErrorCollector();

beforeEach(() => {
    collector.install();
});

afterEach((context) => {
    collector.check(context.task.result?.state === "fail");
});
