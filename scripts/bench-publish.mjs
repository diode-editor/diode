#!/usr/bin/env node
/**
 * Lays out the file-open bench report into the `bench-data` data branch (its checkout is
 * `--out`); the page diode-editor.github.io/benchmarks/ reads the layout (see BRANCH_README).
 *
 *   node scripts/bench-publish.mjs --report out/open.json --md out/BENCH-OPEN.md --out ../bench-data
 *
 * The date and commit in the file name come from the report, not the machine clock: publishing
 * the same report again overwrites the file and doesn't duplicate the index entry.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BRANCH_README = `# bench-data

Diode benchmark data branch. The \`.github/workflows/bench.yml\` job writes it
(on every push to main and on manual dispatch) via \`scripts/bench-publish.mjs\`; don't commit here by hand.
The history feeds the page <https://diode-editor.github.io/benchmarks/>, which reads
\`open/index.json\` and the raw reports from here via raw.githubusercontent.com.

- \`open/index.json\`: the list of runs (newest last);
- \`open/<date>-<commit>.json\`: a run report, format is \`FullReport\` from \`e2e/bench/openReport.ts\`;
- \`open/latest.json\`, \`open/latest.md\`: the latest run.

Methodology and what is measured: \`docs/public/BENCH-OPEN.md\` in \`main\`.
`;

function parseArgs(argv) {
    const args = { report: null, md: null, out: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            const v = argv[++i];
            if (v === undefined) throw new Error(`${arg}: missing value`);
            return v;
        };
        if (arg === "--report") args.report = value();
        else if (arg === "--md") args.md = value();
        else if (arg === "--out") args.out = value();
        else throw new Error(`unknown argument: ${arg}`);
    }
    for (const key of ["report", "md", "out"]) {
        if (args[key] === null) throw new Error(`--${key} is required`);
    }
    return args;
}

export function runFileName(report) {
    const date = String(report.generatedAt).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error(`generatedAt is not an ISO date: ${String(report.generatedAt)}`);
    const commit = String(report.commit)
        .replace(/[^0-9a-f]/gi, "")
        .slice(0, 12);
    if (commit === "") throw new Error(`commit is empty: ${String(report.commit)}`);
    return `${date}-${commit}.json`;
}

/** Exactly what the page needs to pick a run without reading it. */
export function indexEntry(report, file) {
    return {
        file,
        generatedAt: report.generatedAt,
        commit: report.commit,
        binaryVersion: report.binaryVersion,
        ci: report.env?.ci === true,
        conditions: report.env?.conditions ?? "",
        sizes: report.sizes.map((s) => s.key),
    };
}

/** The same file is replaced in place. */
export function upsertIndex(entries, entry) {
    const next = entries.filter((e) => e.file !== entry.file);
    const at = entries.findIndex((e) => e.file === entry.file);
    if (at >= 0) next.splice(at, 0, entry);
    else next.push(entry);
    return next;
}

export function publish({ reportJson, markdown, outDir }) {
    const report = JSON.parse(reportJson);
    const openDir = join(outDir, "open");
    mkdirSync(openDir, { recursive: true });

    const file = runFileName(report);
    writeFileSync(join(openDir, file), reportJson.endsWith("\n") ? reportJson : reportJson + "\n");
    writeFileSync(join(openDir, "latest.json"), reportJson.endsWith("\n") ? reportJson : reportJson + "\n");
    writeFileSync(join(openDir, "latest.md"), markdown);

    const indexPath = join(openDir, "index.json");
    const entries = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : [];
    const updated = upsertIndex(entries, indexEntry(report, file));
    writeFileSync(indexPath, JSON.stringify(updated, null, 2) + "\n");

    const readmePath = join(outDir, "README.md");
    if (!existsSync(readmePath)) writeFileSync(readmePath, BRANCH_README);
    return { file, runs: updated.length };
}

if ((process.argv[1] ?? "").endsWith("bench-publish.mjs")) {
    const args = parseArgs(process.argv.slice(2));
    const result = publish({
        reportJson: readFileSync(args.report, "utf8"),
        markdown: readFileSync(args.md, "utf8"),
        outDir: args.out,
    });
    console.log(`[bench-publish] ${result.file} → ${args.out}/open (runs in index: ${String(result.runs)})`);
}
