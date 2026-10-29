import "./env";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { dhash } from "../src/lib/media";
// npm run hash:compare -- <dir>  : hamming distance of every image vs the first, for tuning NEAR_DUP_THRESHOLD
async function main() {
  const dir = process.argv[2]; const files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  const ref = await dhash(join(dir, files.find((f) => f.startsWith("orig")) ?? files[0]));
  for (const f of files) { const h = await dhash(join(dir, f)); const d = h && ref ? [...h].filter((b, i) => b !== ref[i]).length : -1; console.log(String(d).padStart(3), f); }
}
main();
