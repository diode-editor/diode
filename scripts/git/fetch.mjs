#!/usr/bin/env node
// npm run git:fetch [-- <branch>…]: update origin/main (and the named branches)
// over https WITHOUT deleting other refs.
//
// The pitfall it closes: the machine has fetch.prune=true, so
// `git fetch <url> main:refs/remotes/origin/main` treats every other
// refs/remotes/origin/* as deleted on the server and removes it. --no-prune is required.
import { assertDiodeCheckout, die, git, gitOk, loud, REPO_URL, short } from "./lib.mjs";

assertDiodeCheckout();

const branches = ["main", ...process.argv.slice(2).filter((b) => b !== "main")];
for (const b of branches) if (b.startsWith("-")) die(`git:fetch takes only branch names, not "${b}"`);

const before = new Map(
    branches.map((b) => [
        b,
        gitOk("rev-parse", "-q", "--verify", `refs/remotes/origin/${b}`)
            ? git("rev-parse", `refs/remotes/origin/${b}`)
            : undefined,
    ]),
);
const refspecs = branches.map((b) => `+refs/heads/${b}:refs/remotes/origin/${b}`);
const code = loud("git", ["fetch", "--no-prune", "--no-tags", REPO_URL, ...refspecs]);
if (code !== 0) process.exit(code);

for (const b of branches) {
    const now = git("rev-parse", `refs/remotes/origin/${b}`);
    const was = before.get(b);
    const what = was === undefined ? "new" : was === now ? "unchanged" : `${short(was)} → ${short(now)}`;
    console.log(`origin/${b}: ${short(now)} (${what})`);
}
