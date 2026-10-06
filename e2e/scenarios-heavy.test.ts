// Сценарии с настоящими JVM (тяжёлая полоса vitest.e2e.config.ts) — см. e2e/scenarios/suite.ts.
import { scenarioSuite } from "./scenarios/suite.ts";

await scenarioSuite("heavy");
