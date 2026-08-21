import { processMetadata } from "./index";
const chunks: Buffer[] = [];
process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk))).on("end", () => {
  const argument = process.argv.slice(2).join(" ");
  // npm.cmd may wrap a quoted argument in carets on Windows.
  const input = (argument.startsWith("^") && argument.endsWith("^") ? argument.replace(/\^/g, "") : argument) || Buffer.concat(chunks).toString();
  console.log(JSON.stringify(processMetadata(input), null, 2));
});
