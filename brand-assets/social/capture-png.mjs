import puppeteer from 'puppeteer';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { statSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_FILE = resolve(__dirname, 'dexscreener-banner-animated.html');
const OUTPUT_PNG = resolve(__dirname, 'mythic-x-banner-1500x500.png');

async function main() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  // 2x device scale for ultra-crisp rendering (outputs 3000x1000 actual pixels)
  await page.setViewport({ width: 1500, height: 500, deviceScaleFactor: 2 });
  await page.goto(`file://${HTML_FILE}`, { waitUntil: 'networkidle0' });

  // Wait for fonts
  await page.waitForFunction(() => document.fonts.ready.then(() => true), { timeout: 10000 });

  // Let animation run to a good frame — t≈2.5s gives nice mid-breathe prism + visible code
  await new Promise(r => setTimeout(r, 3000));

  console.log('Capturing ultra-HD PNG...');
  await page.screenshot({
    path: OUTPUT_PNG,
    type: 'png',
    omitBackground: false,
  });

  await browser.close();

  const size = statSync(OUTPUT_PNG).size;
  console.log(`Done! PNG saved to: ${OUTPUT_PNG}`);
  console.log(`Resolution: 3000x1000 (2x retina)`);
  console.log(`File size: ${(size / 1024).toFixed(0)} KB`);
}

main().catch(e => { console.error(e); process.exit(1); });
