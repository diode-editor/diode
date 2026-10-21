// Тяжёлая полоса vitest.e2e.config.ts: сценарии с настоящими JVM.
import { scenarioSuite } from "./scenarios/suite.ts";

await scenarioSuite("heavy");
