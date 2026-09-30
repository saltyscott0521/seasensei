// One-off generation, for `docker exec <container> node server/generate.mjs [--force]` or local runs.
// Prints the result and writes it to the archive like the scheduler would. `--dry` prints without saving.
import { generateDiscussion } from "./discussion.mjs";
import { publish, describeError } from "./publish.mjs";

const args = new Set(process.argv.slice(2));
try {
  if (args.has("--dry")) {
    const { discussion } = await generateDiscussion();
    console.log(JSON.stringify(discussion, null, 2));
  } else {
    const { status, discussion } = await publish({ force: args.has("--force") });
    console.log(`${status}: ${discussion.date} — ${discussion.headline}`);
  }
} catch (e) {
  console.error(`generation failed: ${describeError(e)}`);
  process.exit(1);
}
