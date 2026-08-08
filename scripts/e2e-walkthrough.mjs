#!/usr/bin/env node
// Reusable end-to-end browser verification for the betting-market app.
//
// Spawns a real `npm start` production server against a THROWAWAY SQLite
// database (never data/market.db), drives it with real Chrome via
// puppeteer-core across three incognito browser contexts (alice, bob, and a
// logged-out guest), and asserts the full two-user trading walkthrough:
// registration, two-sided quoting, resting-price fills, self-trade
// rejection, cancellation, settlement, PnL, leaderboard, portfolios, and
// logged-out read-only access.
//
// Run: npm run e2e

import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

const PORT = 3107;
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const DB_PATH = path.join("/tmp", `bm_e2e_${process.pid}.db`);
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SERVER_BOOT_TIMEOUT_MS = 45_000;
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;

const PASSWORD = "password123";
const BINARY_TITLE = "Will it rain Friday?";
const NUMERIC_TITLE = "How many minutes late will Sam be?";

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ExpectationError extends Error {}

let stepNum = 0;

async function runStep(description, fn) {
  stepNum += 1;
  try {
    await fn();
    console.log(`STEP ${stepNum}: ${description} ... OK`);
  } catch (err) {
    console.error(`STEP ${stepNum}: ${description} ... FAILED`);
    if (!(err instanceof ExpectationError)) {
      console.error(err && err.stack ? err.stack : String(err));
    }
    throw err;
  }
}

// Prints the failing expectation + current URL + a page-text snippet, then
// throws. Every helper below funnels its failures through this so every
// failure in the run gets the same rich diagnostics.
async function fail(page, expectation) {
  const url = page ? page.url() : "<no page>";
  let snippet = "<no page>";
  if (page) {
    try {
      const body = await page.evaluate(() => document.body.innerText);
      snippet = body.length > 2000 ? `${body.slice(0, 2000)}...(truncated)` : body;
    } catch (e) {
      snippet = `<failed to read page text: ${e}>`;
    }
  }
  console.error(`\n  Expectation failed: ${expectation}`);
  console.error(`  Current URL: ${url}`);
  console.error(`  Page text snippet:\n----\n${snippet}\n----\n`);
  throw new ExpectationError(expectation);
}

// ---------------------------------------------------------------------------
// Generic page-interaction helpers (all failures route through fail())
// ---------------------------------------------------------------------------

async function waitFor(page, fn, args, expectation, timeout = DEFAULT_WAIT_TIMEOUT_MS) {
  try {
    await page.waitForFunction(fn, { timeout }, ...args);
  } catch (err) {
    if (err instanceof ExpectationError) throw err;
    await fail(page, expectation);
  }
}

async function expectContains(page, text, expectation, timeout = DEFAULT_WAIT_TIMEOUT_MS) {
  await waitFor(page, (t) => document.body.innerText.includes(t), [text], expectation ?? `page contains "${text}"`, timeout);
}

async function expectNotContains(page, text, expectation) {
  const body = await page.evaluate(() => document.body.innerText);
  if (body.includes(text)) {
    await fail(page, expectation ?? `page must NOT contain "${text}"`);
  }
}

async function expectElementMissing(page, selector, expectation) {
  const el = await page.$(selector);
  if (el) {
    await fail(page, expectation ?? `expected no element matching ${selector}`);
  }
}

async function setValue(page, selector, value) {
  const ok = await page.evaluate(
    (sel, v) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.value = v;
      return true;
    },
    selector,
    value,
  );
  if (!ok) await fail(page, `input field ${selector} exists (to set it to ${JSON.stringify(value)})`);
}

// Clicks the <button type="submit"> inside the <form> that contains
// `insideSelector` — avoids needing a unique selector on the button itself.
// A real DOM .click() runs full activation behavior (fires onClick, and for
// a plain submit button, native form submission), so this also correctly
// triggers window.confirm() where a handler calls it synchronously.
async function clickSubmitNear(page, insideSelector) {
  const ok = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const form = el.closest("form");
    if (!form) return false;
    const btn = form.querySelector('button[type="submit"]');
    if (!btn) return false;
    btn.click();
    return true;
  }, insideSelector);
  if (!ok) await fail(page, `a submit button exists inside the form containing ${insideSelector}`);
}

async function clickSelector(page, selector, timeout = DEFAULT_WAIT_TIMEOUT_MS) {
  try {
    await page.waitForSelector(selector, { timeout });
  } catch {
    await fail(page, `element ${selector} appears (to click it)`);
  }
  await page.click(selector);
}

function autoAcceptDialogs(page) {
  page.on("dialog", async (dialog) => {
    try {
      await dialog.accept();
    } catch {
      /* ignore races with page navigation/close */
    }
  });
}

async function pollUntil(fn, isReady, timeout = DEFAULT_WAIT_TIMEOUT_MS, interval = 150) {
  const start = Date.now();
  let value;
  for (;;) {
    value = await fn();
    if (isReady(value)) return value;
    if (Date.now() - start >= timeout) return value;
    await sleep(interval);
  }
}

// ---------------------------------------------------------------------------
// App-specific structured readers
// ---------------------------------------------------------------------------

async function getTextsBySelector(page, selector) {
  return page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map((e) => e.textContent || ""), selector);
}

// Waits until the set of texts matching `selector` differs from `previous`
// AND contains `expectedSubstring`, then returns the new set. Comparing
// against a "before" snapshot (rather than just "does it contain X") avoids
// false-passing on a stale message left over from an earlier submission.
async function waitForNewMessage(page, previousTexts, expectedSubstring, selector, expectation, timeout = DEFAULT_WAIT_TIMEOUT_MS) {
  const previousJson = JSON.stringify(previousTexts);
  await waitFor(
    page,
    (prevJson, expected, sel) => {
      const texts = Array.from(document.querySelectorAll(sel)).map((e) => e.textContent || "");
      return JSON.stringify(texts) !== prevJson && texts.some((t) => t.includes(expected));
    },
    [previousJson, expectedSubstring, selector],
    expectation,
    timeout,
  );
  return getTextsBySelector(page, selector);
}

// .text-emerald-600 is exactly (and only) the QuoteForm/SettleForm SUCCESS
// message class; book price cells and the "Open" badge use -700, one shade
// darker, so this never collides with them.
async function submitQuoteExpectMessage(page, legs, expectedSubstring, expectation) {
  const before = await getTextsBySelector(page, ".text-emerald-600");
  await submitQuoteFields(page, legs);
  await clickSubmitNear(page, "#bidPrice");
  return waitForNewMessage(page, before, expectedSubstring, ".text-emerald-600", expectation);
}

// .text-red-600 is exactly the ActionState *error* class shared by every
// form (Register/Login/NewMarket/QuoteForm/SettleForm/CancelButton).
async function submitQuoteExpectError(page, legs, expectedSubstring, expectation) {
  const before = await getTextsBySelector(page, ".text-red-600");
  await submitQuoteFields(page, legs);
  await clickSubmitNear(page, "#bidPrice");
  return waitForNewMessage(page, before, expectedSubstring, ".text-red-600", expectation);
}

async function submitQuoteFields(page, { bidPrice, bidSize, offerPrice, offerSize }) {
  // Fields are uncontrolled and only auto-reset after a *successful*
  // submission, so always set all four explicitly (blank if unused) rather
  // than trusting leftover state from a previous attempt.
  await setValue(page, "#bidPrice", bidPrice != null ? String(bidPrice) : "");
  await setValue(page, "#bidSize", bidSize != null ? String(bidSize) : "");
  await setValue(page, "#offerPrice", offerPrice != null ? String(offerPrice) : "");
  await setValue(page, "#offerSize", offerSize != null ? String(offerSize) : "");
}

async function register(page, username, password) {
  await page.goto(`${BASE_URL}/register`, { waitUntil: "domcontentloaded" });
  await setValue(page, "#username", username);
  await setValue(page, "#password", password);
  await setValue(page, "#confirm", password);
  await clickSubmitNear(page, "#username");
}

async function waitForLoggedInOnMarkets(page, username, expectation, timeout = DEFAULT_WAIT_TIMEOUT_MS) {
  await waitFor(
    page,
    (u) => {
      if (location.pathname !== "/markets") return false;
      const nav = document.querySelector("nav");
      if (!nav) return false;
      return Array.from(nav.querySelectorAll("span")).some((s) => s.textContent.trim() === u);
    },
    [username],
    expectation,
    timeout,
  );
}

async function createMarket(page, { title, type = "binary", unit }) {
  await page.goto(`${BASE_URL}/markets/new`, { waitUntil: "domcontentloaded" });
  await setValue(page, "#title", title);
  if (type === "numeric") {
    await clickSelector(page, 'input[name="type"][value="numeric"]');
    await waitFor(page, () => !!document.querySelector("#unit"), [], "unit field appears after selecting Numeric", 5000);
    if (unit) await setValue(page, "#unit", unit);
  }
  await clickSubmitNear(page, "#title");
  await waitFor(
    page,
    () => /^\/markets\/\d+$/.test(location.pathname),
    [],
    `redirected to /markets/<id> after creating "${title}"`,
  );
  const match = new URL(page.url()).pathname.match(/^\/markets\/(\d+)$/);
  return match[1];
}

// Order book: reads the two <h3>Bids</h3>/<h3>Offers</h3> sections under
// "Order book". A side reads [] when the page shows "No bids"/"No offers".
async function getBook(page) {
  return page.evaluate(() => {
    function section(label) {
      const h3 = Array.from(document.querySelectorAll("h3")).find((h) => h.textContent.trim() === label);
      if (!h3) return [];
      const sib = h3.nextElementSibling;
      if (!sib || sib.tagName !== "TABLE") return [];
      return Array.from(sib.querySelectorAll("tbody tr")).map((tr) => {
        const tds = tr.querySelectorAll("td");
        return { price: tds[0].textContent.trim(), size: tds[1].textContent.trim() };
      });
    }
    return { bids: section("Bids"), offers: section("Offers") };
  });
}

function levelsEqual(actual, expected) {
  if (actual.length !== expected.length) return false;
  return actual.every((lvl, i) => lvl.price === expected[i].price && lvl.size === String(expected[i].size));
}

async function expectBook(page, expectedBids, expectedOffers, expectation, timeout = DEFAULT_WAIT_TIMEOUT_MS) {
  const start = Date.now();
  let last = { bids: [], offers: [] };
  for (;;) {
    last = await getBook(page);
    if (levelsEqual(last.bids, expectedBids) && levelsEqual(last.offers, expectedOffers)) return;
    if (Date.now() - start >= timeout) break;
    await sleep(200);
  }
  await fail(
    page,
    `${expectation} — expected bids=${JSON.stringify(expectedBids)} offers=${JSON.stringify(expectedOffers)}, ` +
      `got bids=${JSON.stringify(last.bids)} offers=${JSON.stringify(last.offers)}`,
  );
}

// Generic "<h2>Heading</h2>" + (<p>empty-state text</p> | <table>) reader,
// used for "Your open orders", "Open positions", "Realized PnL". Returns
// null if the heading itself isn't present (e.g. "Your open orders" is only
// rendered at all when there's at least one open order).
async function getH2Section(page, heading) {
  return page.evaluate((h2Text) => {
    const h2 = Array.from(document.querySelectorAll("h2")).find((h) => h.textContent.trim() === h2Text);
    if (!h2) return null;
    const sib = h2.nextElementSibling;
    if (!sib) return null;
    if (sib.tagName === "P") return { empty: true, text: sib.textContent.trim() };
    const rows = Array.from(sib.querySelectorAll("tbody tr")).map((tr) =>
      Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim()),
    );
    return { empty: false, rows };
  }, heading);
}

async function cancelOrderRow(page, side, price, expectation) {
  const ok = await page.evaluate(
    (sideText, priceText) => {
      const h2 = Array.from(document.querySelectorAll("h2")).find((h) => h.textContent.trim() === "Your open orders");
      if (!h2) return false;
      const table = h2.nextElementSibling;
      if (!table || table.tagName !== "TABLE") return false;
      const row = Array.from(table.querySelectorAll("tbody tr")).find((tr) => {
        const tds = tr.querySelectorAll("td");
        return tds[0].textContent.trim() === sideText && tds[1].textContent.trim() === priceText;
      });
      if (!row) return false;
      const btn = row.querySelector('button[type="submit"]');
      if (!btn) return false;
      btn.click();
      return true;
    },
    side,
    price,
  );
  if (!ok) await fail(page, expectation ?? `a "${side} ${price}" row exists in "Your open orders" (to cancel it)`);
}

async function waitForOrderRowGone(page, side, price, expectation, timeout = DEFAULT_WAIT_TIMEOUT_MS) {
  await waitFor(
    page,
    (sideText, priceText) => {
      const h2 = Array.from(document.querySelectorAll("h2")).find((h) => h.textContent.trim() === "Your open orders");
      if (!h2) return true; // whole section gone -> definitely gone
      const table = h2.nextElementSibling;
      if (!table || table.tagName !== "TABLE") return true;
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      return !rows.some((tr) => {
        const tds = tr.querySelectorAll("td");
        return tds[0].textContent.trim() === sideText && tds[1].textContent.trim() === priceText;
      });
    },
    [side, price],
    expectation,
    timeout,
  );
}

async function getLeaderboardRows(page) {
  return page.evaluate(() => {
    const h1 = Array.from(document.querySelectorAll("h1")).find((h) => h.textContent.trim() === "Leaderboard");
    if (!h1) return [];
    const el = h1.nextElementSibling;
    if (!el || el.tagName !== "TABLE") return [];
    return Array.from(el.querySelectorAll("tbody tr")).map((tr) =>
      Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim()),
    );
  });
}

async function getCumulativePnlText(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) return null;
    const p = Array.from(header.querySelectorAll("p")).find((el) => el.textContent.includes("Cumulative PnL:"));
    if (!p) return null;
    const span = p.querySelector("span");
    return span ? span.textContent.trim() : null;
  });
}

// ---------------------------------------------------------------------------
// Process / port lifecycle helpers
// ---------------------------------------------------------------------------

function waitForPort(port, host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    (function attempt() {
      const socket = net.createConnection({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for ${host}:${port} to accept connections after ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    })();
  });
}

function isPortOpen(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function unlinkQuiet(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    /* ignore missing file */
  }
}

let serverProc = null;
let browser = null;
let cleanedUp = false;

async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;

  if (browser) {
    let procPid;
    try {
      procPid = browser.process() ? browser.process().pid : undefined;
    } catch {
      /* ignore */
    }
    try {
      await Promise.race([browser.close(), sleep(8000)]);
    } catch (e) {
      console.error("Error closing browser:", e);
    }
    if (procPid) {
      try {
        process.kill(procPid, 0); // throws if the process is already gone
        process.kill(procPid, "SIGKILL");
        console.log(`Force-killed lingering Chrome process ${procPid}.`);
      } catch {
        /* already gone — fine */
      }
    }
  }

  if (serverProc && serverProc.exitCode === null && serverProc.signalCode === null) {
    try {
      process.kill(-serverProc.pid, "SIGTERM");
    } catch {
      try {
        serverProc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    const died = await waitForExit(serverProc, 5000);
    if (!died) {
      try {
        process.kill(-serverProc.pid, "SIGKILL");
      } catch {
        try {
          serverProc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }
  }

  for (const suffix of ["", "-wal", "-shm"]) {
    unlinkQuiet(DB_PATH + suffix);
  }
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(1);
});
process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let exitCode = 0;

  try {
    if (await isPortOpen(PORT, HOST)) {
      throw new Error(`Port ${PORT} is already in use — refusing to start (leftover process from a previous run?).`);
    }

    unlinkQuiet(DB_PATH);
    console.log(`Starting prod server: PORT=${PORT} DATABASE_PATH=${DB_PATH}`);
    serverProc = spawn("npm", ["start"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB_PATH },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    serverProc.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
    serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

    await waitForPort(PORT, HOST, SERVER_BOOT_TIMEOUT_MS);
    console.log(`Server is accepting connections on port ${PORT}.`);

    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    const aliceCtx = await browser.createBrowserContext();
    const bobCtx = await browser.createBrowserContext();
    const guestCtx = await browser.createBrowserContext();
    const alicePage = await aliceCtx.newPage();
    const bobPage = await bobCtx.newPage();
    const guestPage = await guestCtx.newPage();
    autoAcceptDialogs(alicePage);
    autoAcceptDialogs(bobPage);
    autoAcceptDialogs(guestPage);

    let binaryMarketId;
    let numericMarketId;

    // 1. Register alice and bob in their own incognito contexts.
    await runStep('alice registers, lands on /markets with nav showing "alice"; bob registers likewise', async () => {
      await register(alicePage, "alice", PASSWORD);
      await waitForLoggedInOnMarkets(alicePage, "alice", 'alice lands on /markets with nav chip "alice" after registering');

      await register(bobPage, "bob", PASSWORD);
      await waitForLoggedInOnMarkets(bobPage, "bob", 'bob lands on /markets with nav chip "bob" after registering');
    });

    // 2. Case-insensitive duplicate username is rejected.
    await runStep('registering username "ALICE" (case-insensitive dup) is rejected', async () => {
      await register(guestPage, "ALICE", PASSWORD);
      await expectContains(guestPage, "That username is taken.", 'register("ALICE") shows "That username is taken."');
      const p = new URL(guestPage.url()).pathname;
      if (p !== "/register") await fail(guestPage, "stays on /register after a rejected duplicate username");
    });

    // 3. alice creates the binary market.
    await runStep(`alice creates binary market "${BINARY_TITLE}"`, async () => {
      binaryMarketId = await createMarket(alicePage, { title: BINARY_TITLE, type: "binary" });
      await expectContains(alicePage, BINARY_TITLE, "market detail shows the title");
      await expectContains(alicePage, "Yes/No", "market detail shows the Yes/No type badge");
      await expectContains(alicePage, "Created by alice", 'market detail shows creator "alice"');
      await expectContains(alicePage, "Open", "market detail shows the Open state indicator");
      const quoteFormPresent = await alicePage.$("#bidPrice");
      if (!quoteFormPresent) await fail(alicePage, "quote form is visible (#bidPrice present) on a fresh open market");
    });

    // 4. alice submits one two-sided quote: bid 4x10 AND offer 6x10.
    await runStep("alice submits two-sided quote 4x10 / 6x10 (both rest, no trade)", async () => {
      const msgs = await submitQuoteExpectMessage(
        alicePage,
        { bidPrice: 4, bidSize: 10, offerPrice: 6, offerSize: 10 },
        "resting at 4",
        'success message mentions a resting bid ("resting at 4")',
      );
      const joined = msgs.join(" | ");
      if (!joined.includes("resting at 6")) {
        await fail(alicePage, `success message should also mention a resting offer ("resting at 6"); got: ${joined}`);
      }
      await expectBook(
        alicePage,
        [{ price: "4", size: 10 }],
        [{ price: "6", size: 10 }],
        "book shows bid level 4 size 10 and offer level 6 size 10",
      );
    });

    // 5. bob navigates to the market via the /markets list link and bids 4.5x5.
    await runStep("bob opens the market via the /markets list link and bids 4.5x5 (rests)", async () => {
      await bobPage.goto(`${BASE_URL}/markets`, { waitUntil: "domcontentloaded" });
      await expectContains(bobPage, BINARY_TITLE, "/markets list shows the open binary market");
      await clickSelector(bobPage, `a[href="/markets/${binaryMarketId}"]`);
      await waitFor(
        bobPage,
        (id) => location.pathname === `/markets/${id}`,
        [binaryMarketId],
        "bob navigates to the market detail page via the list link",
      );
      await expectContains(bobPage, BINARY_TITLE, "bob is on the correct market detail page");

      await submitQuoteExpectMessage(bobPage, { bidPrice: 4.5, bidSize: 5 }, "resting at 4.5", "bob's 4.5x5 bid rests");
      await expectBook(
        bobPage,
        [
          { price: "4.5", size: 5 },
          { price: "4", size: 10 },
        ],
        [{ price: "6", size: 10 }],
        "book bids show 4.5(5) then 4(10)",
      );
    });

    // 6. bob bids 6.5x4 -> trades 4 @ 6 (resting price, price improvement).
    await runStep('bob bids 6.5x4 -> buys 4 @ 6 (resting price, message says "4 @ 6" not "@ 6.5")', async () => {
      const msgs = await submitQuoteExpectMessage(
        bobPage,
        { bidPrice: 6.5, bidSize: 4 },
        "4 @ 6",
        'fill message contains "4 @ 6"',
      );
      const joined = msgs.join(" | ");
      if (joined.includes("@ 6.5")) {
        await fail(bobPage, `fill message must NOT reference the taker's limit price 6.5 as the fill price; got: ${joined}`);
      }
      await expectBook(
        bobPage,
        [
          { price: "4.5", size: 5 },
          { price: "4", size: 10 },
        ],
        [{ price: "6", size: 6 }],
        "offers now show 6 with size 6",
      );
      await expectContains(bobPage, "bob bought 4 from alice @ 6", "trade tape shows bob bought 4 from alice @ 6");
    });

    // 7. bob cancels his 4.5 bid.
    await runStep("bob cancels his 4.5 bid; bids show only 4(10)", async () => {
      await cancelOrderRow(bobPage, "Bid", "4.5", "cancel bob's 4.5 bid row in Your open orders");
      await waitForOrderRowGone(bobPage, "Bid", "4.5", "bob's 4.5 bid disappears from Your open orders after cancel");
      await expectBook(bobPage, [{ price: "4", size: 10 }], [{ price: "6", size: 6 }], "bids show only 4(10) after cancel");
    });

    // 8. alice's offer 4x5 self-trades against her own resting bid -> rejected whole.
    await runStep('alice offer 4x5 is rejected (self-trade, "cancel it first"); book unchanged', async () => {
      // alice's page has been idle (since step 4) while bob traded against her
      // resting orders in steps 5-7. revalidatePath (fired by bob's own
      // successful actions) only invalidates the *server* cache; it doesn't
      // push updates into alice's already-open session — that only happens on
      // her own next navigation/action or the app's 4s AutoRefresh poll. Force
      // a fresh fetch here so the "book unchanged" assertion below compares
      // against true current state instead of racing that timer.
      await alicePage.reload({ waitUntil: "domcontentloaded" });
      const msgs = await submitQuoteExpectError(
        alicePage,
        { offerPrice: 4, offerSize: 5 },
        "cancel it first",
        'self-trade rejection message contains "cancel it first"',
      );
      if (!msgs.join(" | ").toLowerCase().includes("nothing was submitted")) {
        await fail(alicePage, `self-trade rejection should note nothing was submitted; got: ${msgs.join(" | ")}`);
      }
      await expectBook(
        alicePage,
        [{ price: "4", size: 10 }],
        [{ price: "6", size: 6 }],
        "book unchanged after rejected self-trade: bid 4(10), offer 6(6)",
      );
    });

    // 9. alice offer 6.2x5 rests; bob 6.3x9 sweeps 6@6 + 3@6.2; alice cancels the remaining 6.2 offer.
    await runStep('alice offer 6.2x5 rests; bob 6.3x9 sweeps "6 @ 6" + "3 @ 6.2"; alice cancels remaining 6.2 offer', async () => {
      await submitQuoteExpectMessage(alicePage, { offerPrice: 6.2, offerSize: 5 }, "resting at 6.2", "alice's 6.2x5 offer rests");
      await expectBook(
        alicePage,
        [{ price: "4", size: 10 }],
        [
          { price: "6", size: 6 },
          { price: "6.2", size: 5 },
        ],
        "offers now show 6(6) and 6.2(5)",
      );

      const msgs = await submitQuoteExpectMessage(
        bobPage,
        { bidPrice: 6.3, bidSize: 9 },
        "6 @ 6",
        'bob\'s 6.3x9 bid message contains "6 @ 6"',
      );
      if (!msgs.join(" | ").includes("3 @ 6.2")) {
        await fail(bobPage, `bob's 6.3x9 fill message should also contain "3 @ 6.2"; got: ${msgs.join(" | ")}`);
      }
      await expectBook(bobPage, [{ price: "4", size: 10 }], [{ price: "6.2", size: 2 }], "offers now show only 6.2 size 2");

      await cancelOrderRow(alicePage, "Offer", "6.2", "cancel alice's remaining 6.2 offer");
      await waitForOrderRowGone(alicePage, "Offer", "6.2", "alice's 6.2 offer disappears after cancel");
      await expectBook(alicePage, [{ price: "4", size: 10 }], [], "offers empty after alice cancels the remaining 6.2 offer");
    });

    // 10. alice settles YES.
    await runStep(
      'alice clicks "Settle YES" (confirm accepted) -> "Settled at 10", forms gone, her 4 bid auto-cancelled',
      async () => {
        await clickSelector(alicePage, 'button[name="outcome"][value="yes"]');
        await expectContains(alicePage, "Settled at 10", 'settled banner shows "Settled at 10"');
        await expectElementMissing(alicePage, "#bidPrice", "quote form is gone after settling");
        await expectElementMissing(alicePage, 'button[name="outcome"]', "settle form is gone after settling");
        await expectBook(alicePage, [], [], "book is empty after settling (resting orders auto-cancelled)");
        const orders = await getH2Section(alicePage, "Your open orders");
        if (orders !== null) {
          await fail(alicePage, `"Your open orders" section should be gone entirely after settling; got ${JSON.stringify(orders)}`);
        }
      },
    );

    // 11. bob creates the numeric market; alice quotes two-sided; bob's offer fills at price improvement.
    await runStep(
      'bob creates numeric market "How many minutes late will Sam be?"; alice 20x3/30x3; bob offer 18x2 fills "2 @ 20.00"',
      async () => {
        numericMarketId = await createMarket(bobPage, { title: NUMERIC_TITLE, type: "numeric", unit: "min" });
        await expectContains(bobPage, NUMERIC_TITLE, "numeric market detail shows the title");
        await expectContains(bobPage, "Numeric · min", 'numeric market detail shows the "Numeric · min" type badge');

        await alicePage.goto(`${BASE_URL}/markets/${numericMarketId}`, { waitUntil: "domcontentloaded" });
        await expectContains(alicePage, NUMERIC_TITLE, "alice is on the numeric market page");
        const aliceMsgs = await submitQuoteExpectMessage(
          alicePage,
          { bidPrice: 20, bidSize: 3, offerPrice: 30, offerSize: 3 },
          "resting at 20.00",
          "alice's numeric bid 20x3 rests",
        );
        if (!aliceMsgs.join(" | ").includes("resting at 30.00")) {
          await fail(alicePage, `alice's numeric quote should also mention a resting offer at 30.00; got: ${aliceMsgs.join(" | ")}`);
        }
        await expectBook(
          alicePage,
          [{ price: "20.00", size: 3 }],
          [{ price: "30.00", size: 3 }],
          "numeric book shows bid 20.00x3 and offer 30.00x3",
        );

        await bobPage.goto(`${BASE_URL}/markets/${numericMarketId}`, { waitUntil: "domcontentloaded" });
        await submitQuoteExpectMessage(
          bobPage,
          { offerPrice: 18, offerSize: 2 },
          "2 @ 20.00",
          'bob\'s offer 18x2 fills at the resting price, message contains "2 @ 20.00"',
        );
        await expectBook(
          bobPage,
          [{ price: "20.00", size: 1 }],
          [{ price: "30.00", size: 3 }],
          "book bids show 20.00 size 1 after the fill",
        );
      },
    );

    // 12. bob settles the numeric market at 27.5.
    await runStep('bob settles the numeric market at 27.5 (confirm accepted) -> settled banner shows "27.50"', async () => {
      await setValue(bobPage, "#value", "27.5");
      await clickSubmitNear(bobPage, "#value");
      await expectContains(bobPage, "Settled at 27.50", 'numeric settled banner shows "Settled at 27.50"');
    });

    // 13. Leaderboard.
    await runStep('/leaderboard shows bob then alice, "+36.40" / "-36.40"', async () => {
      await alicePage.goto(`${BASE_URL}/leaderboard`, { waitUntil: "domcontentloaded" });
      const rows = await pollUntil(() => getLeaderboardRows(alicePage), (v) => v.length >= 2);
      if (rows.length < 2) await fail(alicePage, `leaderboard should have at least 2 rows; got ${JSON.stringify(rows)}`);
      const [bobRow, aliceRow] = rows;
      if (bobRow[1] !== "bob" || bobRow[2] !== "+36.40") {
        await fail(alicePage, `expected leaderboard row 1 = bob / +36.40; got ${JSON.stringify(bobRow)}`);
      }
      if (aliceRow[1] !== "alice" || aliceRow[2] !== "-36.40") {
        await fail(alicePage, `expected leaderboard row 2 = alice / -36.40; got ${JSON.stringify(aliceRow)}`);
      }
    });

    // 14. Portfolios.
    await runStep(
      "/users/alice shows -36.40 total, both markets realized, no open positions; /users/bob mirrors +36.40",
      async () => {
        await alicePage.goto(`${BASE_URL}/users/alice`, { waitUntil: "domcontentloaded" });
        const alicePnl = await pollUntil(() => getCumulativePnlText(alicePage), (v) => v !== null);
        if (alicePnl !== "-36.40") await fail(alicePage, `alice's cumulative PnL should read "-36.40"; got "${alicePnl}"`);

        const aliceOpen = await pollUntil(() => getH2Section(alicePage, "Open positions"), (v) => v !== null);
        if (!aliceOpen || !aliceOpen.empty || aliceOpen.text !== "No open positions.") {
          await fail(alicePage, `alice should show "No open positions."; got ${JSON.stringify(aliceOpen)}`);
        }

        const aliceRealized = await pollUntil(() => getH2Section(alicePage, "Realized PnL"), (v) => v !== null);
        if (!aliceRealized || aliceRealized.empty) {
          await fail(alicePage, `alice should have a non-empty Realized PnL table; got ${JSON.stringify(aliceRealized)}`);
        }
        const aliceTitles = aliceRealized.rows.map((r) => r[0]);
        if (!aliceTitles.includes(BINARY_TITLE) || !aliceTitles.includes(NUMERIC_TITLE)) {
          await fail(alicePage, `alice's realized table should include both markets; got ${JSON.stringify(aliceRealized.rows)}`);
        }
        const aliceNumericRow = aliceRealized.rows.find((r) => r[0] === NUMERIC_TITLE);
        if (!aliceNumericRow[1].includes("27.50")) {
          await fail(alicePage, `alice's numeric realized row should show settled at 27.50; got ${JSON.stringify(aliceNumericRow)}`);
        }

        await bobPage.goto(`${BASE_URL}/users/bob`, { waitUntil: "domcontentloaded" });
        const bobPnl = await pollUntil(() => getCumulativePnlText(bobPage), (v) => v !== null);
        if (bobPnl !== "+36.40") await fail(bobPage, `bob's cumulative PnL should read "+36.40"; got "${bobPnl}"`);

        const bobOpen = await pollUntil(() => getH2Section(bobPage, "Open positions"), (v) => v !== null);
        if (!bobOpen || !bobOpen.empty || bobOpen.text !== "No open positions.") {
          await fail(bobPage, `bob should show "No open positions."; got ${JSON.stringify(bobOpen)}`);
        }

        const bobRealized = await pollUntil(() => getH2Section(bobPage, "Realized PnL"), (v) => v !== null);
        const bobTitles = bobRealized && !bobRealized.empty ? bobRealized.rows.map((r) => r[0]) : [];
        if (!bobTitles.includes(BINARY_TITLE) || !bobTitles.includes(NUMERIC_TITLE)) {
          await fail(bobPage, `bob's realized table should include both markets; got ${JSON.stringify(bobRealized)}`);
        }
      },
    );

    // 15. Logged-out spot-check.
    await runStep(
      "logged-out guest can browse /markets, the settled market (no forms), /leaderboard; /markets/new redirects to /login",
      async () => {
        await guestPage.goto(`${BASE_URL}/markets`, { waitUntil: "domcontentloaded" });
        await expectContains(guestPage, BINARY_TITLE, "guest sees the settled binary market listed on /markets");
        await expectContains(guestPage, NUMERIC_TITLE, "guest sees the settled numeric market listed on /markets");

        await guestPage.goto(`${BASE_URL}/markets/${binaryMarketId}`, { waitUntil: "domcontentloaded" });
        await expectContains(guestPage, "Settled at 10", "guest sees the settled banner on the binary market page");
        await expectElementMissing(guestPage, "#bidPrice", "guest sees no quote form on a settled market");
        await expectElementMissing(guestPage, 'button[name="outcome"]', "guest sees no settle form on a settled market");
        await expectNotContains(guestPage, "Log in to trade", 'guest should not see "Log in to trade" on a settled market');

        await guestPage.goto(`${BASE_URL}/leaderboard`, { waitUntil: "domcontentloaded" });
        await expectContains(guestPage, "bob", "guest can view /leaderboard (bob row)");
        await expectContains(guestPage, "alice", "guest can view /leaderboard (alice row)");

        await guestPage.goto(`${BASE_URL}/markets/new`, { waitUntil: "domcontentloaded" });
        await waitFor(
          guestPage,
          () => location.pathname === "/login",
          [],
          "logged-out visit to /markets/new redirects to /login",
        );
      },
    );

    console.log(`\nAll steps passed: ${stepNum}/15.`);
  } catch (err) {
    exitCode = 1;
    console.error(`\ne2e walkthrough FAILED at STEP ${stepNum} (${Math.max(stepNum - 1, 0)}/15 prior steps passed).`);
    if (!(err instanceof ExpectationError)) {
      console.error(err && err.stack ? err.stack : String(err));
    }
  } finally {
    await cleanup();
  }

  process.exit(exitCode);
}

main().catch(async (err) => {
  console.error("Fatal error outside main's try/catch:", err);
  await cleanup();
  process.exit(1);
});
