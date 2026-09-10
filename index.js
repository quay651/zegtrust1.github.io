import { runTransactionCheck } from "./checks/transactionCheck.js";
import { runDefacementCheck } from "./checks/defacementCheck.js";
import { runSpeedCheck } from "./checks/speedCheck.js";
import { runUptimeSummary } from "./checks/uptimeSummary.js";
import { sendReport } from "./report/sendReport.js";

const env = process.env;

async function main() {
  console.log("Running ZEG site monitor...");

  const [transaction, defacement, speed, uptime] = await Promise.all([
    runTransactionCheck(env).catch((err) => ({ ok: false, steps: [], error: err.message })),
    runDefacementCheck(env).catch((err) => ({ ok: false, pages: [], error: err.message })),
    runSpeedCheck(env).catch((err) => ({ ok: false, pages: [], error: err.message })),
    runUptimeSummary(env).catch(() => null),
  ]);

  const results = { transaction, defacement, speed, uptime };

  console.log(JSON.stringify(results, null, 2));

  await sendReport(env, results);

  const overallOk = [transaction, defacement, speed, uptime].every((r) => r === null || r.ok);
  console.log(overallOk ? "All checks passed." : "Some checks failed — report sent.");

  // Exit non-zero on failure so the GitHub Action run itself shows red,
  // giving a second layer of visibility beyond the email.
  process.exit(overallOk ? 0 : 1);
}

main();
