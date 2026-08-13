import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const forbidden = [
  /(?:PRIVATE_KEY|SECRET|API_KEY)\s*=\s*(?!(?:$|your-|replace-|<|0x\.{3}))[^\s]+/im,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

const allowedFiles = new Set([".env.example", "pnpm-lock.yaml", "scripts/check-secrets.ts"]);
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split(/\r?\n/u)
  .filter(Boolean)
  .filter((file) => !allowedFiles.has(file));

const leaks: string[] = [];
for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (content.includes("\0")) continue;
  if (forbidden.some((pattern) => pattern.test(content))) leaks.push(file);
}

if (leaks.length > 0) {
  console.error(`Potential secrets found in repository files: ${leaks.join(", ")}`);
  process.exit(1);
}

console.log(`Secret scan passed (${files.length} repository files checked).`);
