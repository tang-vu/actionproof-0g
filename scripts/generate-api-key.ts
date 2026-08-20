import { createHash, randomBytes } from "node:crypto";

const key = `ap_live_${randomBytes(32).toString("base64url")}`;
const digest = createHash("sha256").update(key).digest("hex");

console.log(
  "Store the API key in the tenant's secret manager. It will not be shown again by ActionProof.",
);
console.log(`API key: ${key}`);
console.log(`apiKeySha256: ${digest}`);
