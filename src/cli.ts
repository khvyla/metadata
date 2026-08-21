import { processMetadata, readStreamMetadata } from "./index";
const chunks: Buffer[] = [];
process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk))).on("end", async () => {
  const argument = process.argv.slice(2).join(" ");
  // npm.cmd may wrap a quoted argument in carets on Windows.
  const input = (argument.startsWith("^") && argument.endsWith("^") ? argument.replace(/\^/g, "") : argument) || Buffer.concat(chunks).toString();
  const streamUrl = process.argv.slice(2).find((value, index, values) => values[index - 1] === "--stream");
  console.log(JSON.stringify(streamUrl ? await readStreamMetadata(streamUrl) : processMetadata(input), null, 2));
});
