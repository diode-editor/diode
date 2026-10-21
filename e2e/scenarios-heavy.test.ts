// Heavy lane of vitest.e2e.config.ts: scenarios with real JVMs.
import { scenarioSuite } from "./scenarios/suite.ts";

await scenarioSuite("heavy");
