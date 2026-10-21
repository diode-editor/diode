#!/usr/bin/env node
// postinstall: prefetches the binary. A network error here doesn't fail `npm install`:
// the binary is downloaded on first run (bin/diode.js). So the package installs in
// offline builds and with `--ignore-scripts`, and fails only where it is actually run.
import { download, isInstalled } from "./lib/binary.js";

if (!isInstalled()) {
    try {
        await download();
    } catch (error) {
        console.error(`diode: postinstall download skipped (${error.message}); will retry on first run`);
    }
}
