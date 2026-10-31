import * as fs from "node:fs";
import * as path from "node:path";

import { describeRejection } from "../../../base/common/describeRejection.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import { ApiTrace } from "../common/apiTrace.ts";

const FLUSH_DELAY_MS = 250;

/** Resolved now: an extension may `process.chdir`. Synchronous append: the last rows are written on `exit`. */
export function openApiTrace(file: string, logger: ILogger): ApiTrace {
    const target = path.resolve(file);
    const trace = new ApiTrace({
        write: (text) => {
            fs.appendFileSync(target, text);
        },
        schedule: (flush) => {
            setTimeout(flush, FLUSH_DELAY_MS).unref();
        },
        onError: (error) => {
            logger.warn(`DIODE_API_TRACE: journal ${target} stopped: ${describeRejection(error)}`);
        },
    });
    process.on("exit", () => {
        trace.flush();
    });
    return trace;
}
