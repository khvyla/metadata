const { mkdirSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const root = resolve(__dirname);
const target = join(root, "samples", "independent-corpus", "source");
const manifest = JSON.parse(readFileSync(join(root, "independent-corpus-manifest.json"), "utf8"));

async function download(recording) {
  const output = join(target, `${recording.id}.mp3`);
  if (existsSync(output)) return;
  const response = await fetch(recording.assetUrl, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`${recording.id}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024 || bytes.length > 35 * 1024 * 1024) throw new Error(`${recording.id}: unexpected ${bytes.length}-byte response`);
  writeFileSync(output, bytes);
  console.log(`Downloaded ${recording.id} (${bytes.length} bytes)`);
}

async function main() {
  mkdirSync(target, { recursive: true });
  for (const recording of manifest.recordings) await download(recording);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
