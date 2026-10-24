import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

/**
 * Full booking-to-delivery journey through the browser, one signed-in browser context per party:
 * shipper books → broker quotes → shipper accepts → broker tenders → carrier accepts and dispatches
 * → driver records milestones and POD on the mobile view → broker invoices → shipper pays in the
 * payment sandbox → the signed webhook marks the invoice paid. All organizations are fictional demo data.
 */
const PASSWORD = "VicoraDemo!2026";

async function signIn(browser: Browser, email: string, mobile = false): Promise<Page> {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : {});
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

async function selectOptionContaining(select: Locator, text: string) {
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  if (!value) throw new Error(`No option containing "${text}"`);
  await select.selectOption(value);
}

/** Clicks and waits for the API call it triggers to succeed (forms re-render once the server state changes). */
async function clickAndExpectOk(page: Page, button: Locator, path: RegExp) {
  const [res] = await Promise.all([page.waitForResponse((r) => path.test(new URL(r.url()).pathname) && r.request().method() !== "GET"), button.click()]);
  expect(res.status(), `${res.url()} → ${await res.text()}`).toBeLessThan(300);
  return res;
}

function inputLocal(hoursFromNow: number) {
  const d = new Date(Date.now() + hoursFromNow * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

test("booking to delivery, invoice and sandbox payment", async ({ browser }) => {
  const title = `E2E patio load ${Date.now().toString(36)}`;

  /* ---------------------------------------------------------------- Shipper books */
  const shipper = await signIn(browser, "leo@lakeshore.demo");
  await shipper.goto("/shipments/new");
  await shipper.getByRole("button", { name: "Full truckload" }).click();
  await shipper.getByLabel("Title").fill(title);
  await shipper.getByRole("button", { name: "Continue" }).click();

  const names = shipper.getByLabel("Location name");
  const cities = shipper.getByLabel("City");
  const states = shipper.getByLabel("State");
  await names.nth(0).fill("Lakeshore Joliet DC");
  await cities.nth(0).fill("Joliet");
  await states.nth(0).selectOption("IL");
  await shipper.getByLabel("Window opens").nth(0).fill(inputLocal(-6));
  await shipper.getByLabel("Window closes").nth(0).fill(inputLocal(-2));
  await names.nth(1).fill("Lakeshore Dallas DC");
  await cities.nth(1).fill("Dallas");
  await states.nth(1).selectOption("TX");
  await shipper.getByRole("button", { name: "Continue" }).click();

  await shipper.getByLabel("Description").first().fill("Boxed patio sets");
  await shipper.getByLabel("Qty").first().fill("20");
  await shipper.getByLabel("Weight (lb)").first().fill("16000");
  await shipper.getByRole("button", { name: "Continue" }).click();
  await shipper.getByRole("button", { name: "Request quotes" }).click();
  await shipper.waitForURL(/\/shipments\/[0-9a-f-]{36}\?tab=quotes/);
  const shipmentId = /\/shipments\/([0-9a-f-]{36})/.exec(shipper.url())![1];
  await expect(shipper.getByText("Quote requested").first()).toBeVisible();

  /* ---------------------------------------------------------------- Broker quotes */
  const broker = await signIn(browser, "dana@meridian.demo");
  await broker.goto(`/shipments/${shipmentId}?tab=quotes`);
  await broker.getByLabel("Unit amount").first().fill("2450");
  await broker.getByLabel("Transit days").fill("2");
  await broker.getByLabel("Your cost (private)").fill("2300");
  await clickAndExpectOk(broker, broker.getByRole("button", { name: "Submit quote" }), /\/quotes$/);
  await expect(broker.getByText("Your quote")).toBeVisible();

  /* ---------------------------------------------------------------- Shipper accepts */
  await shipper.reload();
  await expect(shipper.getByText("$2,450.00").first()).toBeVisible();
  // Broker's private cost is never rendered to the shipper.
  await expect(shipper.getByText("$2,300.00")).toHaveCount(0);
  await clickAndExpectOk(shipper, shipper.getByRole("button", { name: "Accept quote" }), /\/accept$/);
  await expect(shipper.getByText("Booked").first()).toBeVisible();

  /* ---------------------------------------------------------------- Broker tenders to Ironwood */
  await broker.goto(`/shipments/${shipmentId}?tab=dispatch`);
  await selectOptionContaining(broker.locator("select[name=carrierOrgId]"), "Ironwood Transport");
  await broker.getByLabel("Offered rate (USD)").fill("2100");
  await expect(broker.getByText("Projected margin")).toContainText("$350.00");
  await clickAndExpectOk(broker, broker.getByRole("button", { name: "Send tender" }), /\/tenders$/);

  /* ---------------------------------------------------------------- Carrier accepts and dispatches */
  const carrier = await signIn(browser, "ops@ironwood.demo");
  await carrier.goto("/tenders");
  const row = carrier.getByRole("row").filter({ has: carrier.locator(`a[href*="${shipmentId}"]`) });
  await clickAndExpectOk(carrier, row.getByRole("button", { name: "Accept tender" }), /\/respond$/);
  await carrier.goto(`/shipments/${shipmentId}?tab=dispatch`);
  // The carrier sees its own rate but not what the customer pays.
  await expect(carrier.getByText("$2,450.00")).toHaveCount(0);
  await selectOptionContaining(carrier.locator("select[name=driverId]"), "Carlos Mendez");
  await selectOptionContaining(carrier.locator("select[name=equipmentId]"), "IW-202");
  await clickAndExpectOk(carrier, carrier.getByRole("button", { name: "Dispatch", exact: true }), /\/dispatch$/);

  /* ---------------------------------------------------------------- Driver, on a phone */
  const driver = await signIn(browser, "carlos@ironwood.demo", true);
  await expect(driver).toHaveURL(/\/driver/);
  await driver.goto(`/driver/${shipmentId}`);
  for (const step of ["arrived at pickup", "picked up", "in transit", "arrived at delivery"]) {
    await driver.getByLabel("Attach my device location (asks for permission)").uncheck();
    await clickAndExpectOk(driver, driver.getByRole("button", { name: new RegExp(`^Record ${step}`, "i") }), /\/milestones$/);
    await driver.reload();
  }
  await driver.getByLabel("Attach my device location (asks for permission)").uncheck();
  await driver.getByRole("button", { name: /^Record delivered/i }).click();
  await expect(driver.getByText(/proof of delivery/i).first()).toBeVisible();
  await driver.getByLabel("Signed by").fill("R. Diaz");
  await clickAndExpectOk(driver, driver.getByRole("button", { name: /^Record delivered/i }), /\/milestones$/);

  /* ---------------------------------------------------------------- Broker invoices */
  await broker.goto(`/shipments/${shipmentId}?tab=finance`);
  await broker.getByRole("button", { name: "Create invoice from confirmed charges" }).click();
  await broker.waitForURL(/\/finance\/invoices\//);
  const invoiceUrl = new URL(broker.url()).pathname;
  await expect(broker.getByText("$2,450.00").first()).toBeVisible();

  /* ---------------------------------------------------------------- Shipper pays (sandbox) */
  const ap = await signIn(browser, "ap@lakeshore.demo");
  await ap.goto(invoiceUrl);
  await clickAndExpectOk(ap, ap.getByRole("button", { name: /Pay \$2,450\.00 \(sandbox\)/ }), /\/pay$/);
  // The in-process job runner delivers the signed sandbox webhook; the page refreshes itself.
  await expect(async () => {
    await ap.reload();
    await expect(ap.getByText("succeeded").first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });

  /* ---------------------------------------------------------------- Everyone sees the delivered state */
  await shipper.goto(`/shipments/${shipmentId}?tab=timeline`);
  await expect(shipper.getByText("Delivered").first()).toBeVisible();
  await expect(shipper.getByText(/Delivered — Dallas, TX/).first()).toBeVisible();
});
