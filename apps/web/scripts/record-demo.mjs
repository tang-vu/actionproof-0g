/* global document */

import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";

import { chromium } from "@playwright/test";

const workspace = path.resolve(import.meta.dirname, "../../..");
const evidence = JSON.parse(
  await readFile(path.join(workspace, "docs/evidence/galileo-live.json"), "utf8"),
);
const originArgument = process.argv.find((value) => value.startsWith("--origin="));
const origin = new URL(
  originArgument?.slice("--origin=".length) ?? "https://actionproof.tangvu.dev",
).origin;
const outputDirectory = path.join(workspace, ".actionproof/demo");
const rawDirectory = path.join(outputDirectory, "raw");
await mkdir(rawDirectory, { recursive: true });

const safeTrace = `${origin}/trace/${evidence.safe.traceId}`;
const blockedTrace = `${origin}/trace/${evidence.dangerous.traceId}`;
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const baseName = `actionproof-judge-demo-${timestamp}`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: rawDirectory, size: { width: 1280, height: 720 } },
  colorScheme: "dark",
});
const page = await context.newPage();
const video = page.video();

async function caption(kicker, message) {
  await page.evaluate(
    ({ kickerText, messageText }) => {
      document.querySelector("#actionproof-demo-caption")?.remove();
      const element = document.createElement("aside");
      element.id = "actionproof-demo-caption";
      element.setAttribute("aria-hidden", "true");
      element.innerHTML = `<small>${kickerText}</small><strong>${messageText}</strong>`;
      Object.assign(element.style, {
        position: "fixed",
        left: "50%",
        bottom: "22px",
        transform: "translateX(-50%)",
        zIndex: "2147483647",
        width: "min(880px, calc(100vw - 48px))",
        display: "grid",
        gap: "7px",
        padding: "17px 22px",
        border: "1px solid rgba(98, 231, 225, 0.42)",
        borderRadius: "14px",
        background: "rgba(7, 12, 14, 0.94)",
        boxShadow: "0 18px 60px rgba(0, 0, 0, 0.52)",
        backdropFilter: "blur(14px)",
        color: "#edf7f4",
        fontFamily: "Inter, Segoe UI, sans-serif",
        pointerEvents: "none",
      });
      const small = element.querySelector("small");
      const strong = element.querySelector("strong");
      Object.assign(small.style, {
        color: "#62e7e1",
        fontFamily: "monospace",
        fontSize: "11px",
        fontWeight: "700",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
      });
      Object.assign(strong.style, {
        fontSize: "20px",
        fontWeight: "620",
        lineHeight: "1.35",
      });
      document.body.append(element);
    },
    { kickerText: kicker, messageText: message },
  );
}

async function pause(milliseconds) {
  await page.waitForTimeout(milliseconds);
}

async function open(url) {
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  if (response?.status() !== 200) throw new Error(`Demo page returned HTTP ${response?.status()}`);
}

try {
  await open(origin);
  await caption(
    "ACTIONPROOF · PROOF BEFORE ACTION",
    "A verifiable runtime firewall for autonomous agent transactions on 0G.",
  );
  await pause(5_000);

  await page.getByRole("heading", { name: "Allow. Block. Break." }).scrollIntoViewIfNeeded();
  await caption(
    "THE THREE-MINUTE PROOF",
    "One harmless action. One dangerous approval. One tampered attestation.",
  );
  await pause(5_000);

  await open(safeTrace);
  await page.getByText("All evidence bindings verify").waitFor();
  await caption(
    "01 / ALLOW",
    "The harmless counter action was simulated, assessed, stored, anchored, and executed once.",
  );
  await pause(6_000);

  await page.getByRole("heading", { name: "Evidence seal" }).scrollIntoViewIfNeeded();
  await caption(
    "CRYPTOGRAPHIC BINDING",
    "Action hash, canonical report hash, 0G Storage root, EIP-712 signature, and Chain receipts remain independently inspectable.",
  );
  await pause(6_000);

  await page.getByRole("heading", { name: "7 checks" }).scrollIntoViewIfNeeded();
  await caption(
    "INDEPENDENT VERIFICATION",
    "Seven fresh checks recompute the evidence. ERC-8004 agent 278 binds the action-agent wallet.",
  );
  await pause(6_000);

  await open(blockedTrace);
  await page.getByText("Unlimited ERC-20 approval", { exact: true }).first().waitFor();
  await caption(
    "02 / BLOCK",
    "An unlimited ERC-20 approval scores 100 risk and is anchored for audit—with no execution transaction.",
  );
  await pause(6_000);

  await page.getByRole("heading", { name: "Why block?" }).scrollIntoViewIfNeeded();
  await caption(
    "DETERMINISTIC RULE WINS",
    "UNLIMITED_ERC20_APPROVAL is a hard block. The model is advisory and cannot override it.",
  );
  await pause(6_000);

  await open(safeTrace);
  const tamperButton = page.getByRole("button", { name: "Run tamper test" });
  await tamperButton.scrollIntoViewIfNeeded();
  await caption(
    "03 / BREAK",
    "Now mutate one byte of calldata after attestation. The original proof must stop matching.",
  );
  await pause(4_000);
  await tamperButton.click();
  await page.getByText("Verification rejected").waitFor();
  await caption(
    "TAMPER REJECTED",
    "The action hash and attestation binding fail. Replay and duplicate execution are rejected onchain too.",
  );
  await pause(6_000);

  await open(origin);
  await caption(
    "ACTIONPROOF",
    "Facts, model judgment, immutable evidence, and enforcement stay separate. Proof before action.",
  );
  await pause(5_000);
} finally {
  await context.close();
  await browser.close();
}

if (!video) throw new Error("Playwright did not create a demo recording");
const rawPath = await video.path();
const webmPath = path.join(outputDirectory, `${baseName}.webm`);
await rename(rawPath, webmPath);

const mp4Path = path.join(outputDirectory, `${baseName}.mp4`);
const conversion = spawnSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    webmPath,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    mp4Path,
  ],
  { encoding: "utf8" },
);

process.stdout.write(
  JSON.stringify(
    {
      origin,
      safeTraceId: evidence.safe.traceId,
      dangerousTraceId: evidence.dangerous.traceId,
      webm: webmPath,
      mp4: conversion.status === 0 ? mp4Path : null,
      ffmpeg: conversion.status === 0 ? "converted" : "unavailable; WebM is ready",
    },
    null,
    2,
  ) + "\n",
);
