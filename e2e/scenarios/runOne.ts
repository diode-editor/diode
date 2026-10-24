import { relative } from "node:path";

import { loadScenarios, runScenario } from "./framework.ts";

// `npx tsx e2e/scenarios/runOne.ts <name>…`: the named scenarios only (a demo under work), with their
// screenshots; `npm run screenshots` runs them all and writes the gallery.

async function main(): Promise<void> {
    const names = new Set(process.argv.slice(2));
    if (names.size === 0) throw new Error("usage: tsx e2e/scenarios/runOne.ts <scenario name>…");
    const scenarios = (await loadScenarios()).filter((spec) => names.has(spec.name));
    const missing = [...names].filter((name) => !scenarios.some((spec) => spec.name === name));
    if (missing.length > 0) throw new Error(`unknown scenario(s): ${missing.join(", ")}`);
    for (const spec of scenarios) {
        const skip = spec.requires?.();
        if (skip !== undefined) {
            process.stdout.write(`↷ ${spec.name}: ${skip}\n`);
            continue;
        }
        process.stdout.write(`▶ ${spec.name}\n`);
        for (const shot of await runScenario(spec)) {
            process.stdout.write(`  ✓ ${relative(process.cwd(), shot.path)}\n`);
        }
    }
}

await main();
process.exit(0);
