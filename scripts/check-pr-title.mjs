#!/usr/bin/env node
/**
 * The PR title must be English: the squash merge makes it the commit subject, and git-cliff
 * turns `feat`/`fix`/`perf` subjects into the release changelog (docs/COMMITS.md).
 *
 *   node scripts/check-pr-title.mjs "<title>"   or, in CI, the title from $GITHUB_EVENT_PATH
 */

import { readFileSync } from "node:fs";

import { hasCyrillic } from "./check-cyrillic.mjs";

export function titleProblem(title) {
    if (hasCyrillic(title)) return "the PR title has Cyrillic — titles and commit messages are English (docs/COMMITS.md)";
    return null;
}

function main() {
    const title =
        process.argv[2] ?? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")).pull_request.title;
    const problem = titleProblem(title);
    console.log(`check-pr-title: ${JSON.stringify(title)}`);
    if (problem !== null) console.error(problem);
    return problem === null ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
