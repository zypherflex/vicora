import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

/**
 * The licensed broker's journey through the brokerage desk on the seeded (fictional) Lakeshore import:
 * desk → customs file → classification assist from the client's approved library → line review →
 * pre-filing review → ask the file → ready to file → demonstration filing (nothing is sent to CBP).
 */
const PASSWORD = "VicoraDemo!2026";

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

async function clickAndExpectOk(page: Page, button: Locator, path: RegExp) {
  const [res] = await Promise.all([page.waitForResponse((r) => path.test(new URL(r.url()).pathname) && r.request().method() !== "GET"), button.click()]);
  expect(res.status(), `${res.url()} → ${await res.text()}`).toBeLessThan(300);
  return res;
}

test("licensed broker prepares, reviews and files an entry through the demonstration adapter", async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await signIn(browser, "ruth@harborline.demo");
  await expect(page).toHaveURL(/\/customs$/);
  await expect(page.getByRole("heading", { name: "Brokerage desk" })).toBeVisible();
  await expect(page.getByText("CBP ACE: not connected").first()).toBeVisible();

  await page.locator("[data-lane=review]").getByRole("link", { name: /VCR-26-001002/ }).click();
  await expect(page.getByRole("heading", { name: /Customs file · VCR-26-001002/ })).toBeVisible();
  await expect(page.locator("[data-finding='CLIENT:POA_MISSING']")).toHaveCount(0);
  await expect(page.getByText("Line 2: no classification").first()).toBeVisible();

  // Classification assist on the new SKU finds the client's approved precedent for its sibling product.
  const line2 = page.locator("details", { hasText: "Line 2: Stoneware dinnerware 16pc green" });
  await line2.locator("summary").click();
  await line2.getByRole("button", { name: "Classification assist" }).click();
  await expect(line2.getByText("Same part number")).toHaveCount(0);
  await expect(line2.getByText(/Shared words: stoneware, dinnerware/)).toBeVisible();
  await expect(line2.getByText("Unverified")).toBeVisible();
  await clickAndExpectOk(page, line2.getByRole("button", { name: "Use this precedent" }).first(), /\/classification$/);

  // The broker confirms the line.
  if (!(await line2.evaluate((d) => (d as HTMLDetailsElement).open))) await line2.locator("summary").click();
  await expect(line2.locator("input[name=hts]")).toHaveValue("6912.00.4810");
  await line2.locator("input[name=reviewed]").check();
  await clickAndExpectOk(page, line2.getByRole("button", { name: "Save" }), /\/lines\/[^/]+$/);

  // Pre-filing review is now clear of blockers.
  await clickAndExpectOk(page, page.getByRole("button", { name: "Run again" }), /\/review$/);
  await expect(page.getByText("No open blockers")).toBeVisible();

  // Ask the file: the answer cites the commercial invoice.
  await page.getByLabel("Question about this file").fill("What is the total invoice value?");
  await clickAndExpectOk(page, page.getByRole("button", { name: "Ask", exact: true }), /\/questions$/);
  await expect(page.getByText(/Total Invoice Value: USD 48,960\.00/).first()).toBeVisible();

  // Ready to file, then the demonstration filing with explicit confirmation.
  await clickAndExpectOk(page, page.getByRole("button", { name: "Move to ready to file" }), /\/status$/);
  await expect(page.getByText("Ready to file").first()).toBeVisible();
  await page.getByLabel(/I am a licensed customs broker/).check();
  await clickAndExpectOk(page, page.getByRole("button", { name: /Submit via Demonstration/ }), /\/filing$/);
  await expect(page.getByText(/Demo filing DEMO-/)).toBeVisible();
});
