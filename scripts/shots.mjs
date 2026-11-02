import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

const dir = process.argv[2] ?? "docs/screenshots";

const server = await createServer({
  root: "src",
  plugins: [react()],
  server: { port: 0, fs: { strict: false } },
  logLevel: "error",
});
await server.listen();
const port = server.config.server.port ?? server.httpServer.address().port;

const browser = await chromium.launch({ channel: "chrome" });
const errors = [];

const capture = async (theme, steps) => {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
  });
  await page.addInitScript(
    (value) => localStorage.setItem("theme", value),
    theme,
  );
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}`);
  await steps(page);
  await page.close();
};

const shot = async (page, name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log(`wrote ${name}.png`);
};

const tab = (page, name) =>
  page.getByRole("button", { name, exact: true }).first().click();

const open = async (page, name) => {
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
  await page.waitForTimeout(500);
};

const functions = (suffix) => async (page) => {
  await page.waitForSelector(".fn-row", { timeout: 15000 });
  await shot(page, `functions-list${suffix}`);
  await tab(page, "Tree");
  await page.waitForSelector(".fn-tree .react-flow__node", { timeout: 15000 });
  await page.waitForTimeout(900);
  await shot(page, `functions-tree${suffix}`);
};

await capture("light", functions(""));
await capture("dark", functions("-dark"));

await capture("light", async (page) => {
  await page.waitForSelector(".fn-row", { timeout: 15000 });
  await tab(page, "Contract");
  await page.waitForSelector(".react-flow__node", { timeout: 15000 });
  await page.waitForTimeout(900);
  await shot(page, "contract-canvas");

  await tab(page, "Code");
  await page.waitForSelector(".code-folder", { timeout: 15000 });
  await shot(page, "code-folders");

  await open(page, "src");
  await open(page, "workflows");
  await open(page, "runner.ts");
  await page.waitForSelector(".code-fnnode", { timeout: 15000 });
  await shot(page, "code-call-graph");

  await page.locator(".code-fnnode").first().click();
  await page.waitForSelector(".code-fnnode.picked", { timeout: 15000 });
  await page.waitForTimeout(700);
  await shot(page, "function-source");
});

if (errors.length) console.log("console errors:\n" + errors.join("\n"));

await browser.close();
await server.close();
process.exit(0);
