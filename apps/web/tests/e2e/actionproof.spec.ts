import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    )
    .toBe(false);
}

test("landing page communicates the layered trust model", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Proof before action/i })).toBeVisible();
  await expect(page.getByText("The model is one witness. Never the judge.")).toBeVisible();
  await expect(page.getByText(/Local sandbox evidence is isolated/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Inspect preserved proof/ })).toHaveAttribute(
    "href",
    "/trace/fdad8624-8cce-4b8a-8576-c724463469c7",
  );
});

test("read-only hosted mode guides judges through preserved live evidence", async ({ page }) => {
  await page.route("**/v1/integrations", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        mode: "live",
        writesEnabled: false,
        operatorAuthorization: { required: false, configured: false },
        network: { name: "0G Galileo Testnet", chainId: 16602 },
        services: [],
      }),
    });
  });
  await page.goto("/analyze");

  const safeProof = page.getByRole("link", { name: /Inspect safe Galileo proof/ });
  await expect(safeProof).toBeVisible();
  await expect(safeProof).toHaveAttribute("href", "/trace/fdad8624-8cce-4b8a-8576-c724463469c7");

  await page.getByRole("tab", { name: /Unlimited approval/ }).click();
  const blockedProof = page.getByRole("link", { name: /Inspect blocked Galileo proof/ });
  await expect(blockedProof).toHaveAttribute("href", "/trace/e68696d3-e399-49f9-ab70-3188fac06ab1");
  await expect(page.getByText("Public evidence mode")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("safe action produces a verifiable trace and rejects tampering", async ({
  page,
}, testInfo) => {
  await page.goto("/analyze");
  await expect(page.getByRole("heading", { name: "Analyze an agent action" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Analyze & attest/ })).toBeEnabled();
  await page.getByRole("button", { name: /Analyze & attest/ }).click();

  await expect(page.getByText("Allowed", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: /Open public trace/ }).click();
  await expect(page.getByText("All evidence bindings verify")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.getByText(/sandbox mode/)).toBeVisible();
  const verifyButton = page.getByRole("button", { name: "Verify evidence now" });
  await expect(verifyButton).toBeVisible();
  await verifyButton.click();
  await expect(verifyButton).toBeEnabled();

  if (process.env.ACTIONPROOF_CAPTURE_SCREENSHOT === "1") {
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({
      path:
        testInfo.project.name === "chromium"
          ? "../../docs/images/actionproof-console.png"
          : "../../docs/images/actionproof-mobile.png",
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "Run tamper test" }).click();
  await expect(page.getByText("Verification rejected")).toBeVisible();
});

test("unlimited approval is blocked before execution", async ({ page }) => {
  await page.goto("/analyze");
  await page.getByRole("tab", { name: /Unlimited approval/ }).click();
  await expect(page.getByRole("button", { name: /Analyze & attest/ })).toBeEnabled();
  await page.getByRole("button", { name: /Analyze & attest/ }).click();

  await expect(page.getByText("Blocked", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: /Open public trace/ }).click();
  await expect(page.getByText("Unlimited ERC-20 approval")).toBeVisible();
  await expect(page.getByText("All evidence bindings verify")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
