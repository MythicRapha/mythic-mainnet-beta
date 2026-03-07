import puppeteer from 'puppeteer';
import { execSync } from 'child_process';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = resolve(__dirname, '_frames');
const HTML_FILE = resolve(__dirname, 'dexscreener-banner-animated.html');
const OUTPUT_GIF = resolve(__dirname, 'dexscreener-banner-1500x500.gif');

const FPS = 20;
const DURATION_SEC = 4; // 4 second loop
const TOTAL_FRAMES = FPS * DURATION_SEC;
const FRAME_DELAY_MS = 1000 / FPS;

async function main() {
  // Clean and create frames dir
  if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true });
  mkdirSync(FRAMES_DIR);

  console.log(`Launching browser...`);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 500, deviceScaleFactor: 1 });
  await page.goto(`file://${HTML_FILE}`, { waitUntil: 'networkidle0' });

  // Wait for fonts to load
  await page.waitForFunction(() => document.fonts.ready.then(() => true), { timeout: 10000 });
  // Let animation warm up
  await new Promise(r => setTimeout(r, 2000));

  console.log(`Capturing ${TOTAL_FRAMES} frames at ${FPS}fps...`);

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const padded = String(i).padStart(4, '0');
    await page.screenshot({
      path: resolve(FRAMES_DIR, `frame_${padded}.png`),
      type: 'png',
    });
    await new Promise(r => setTimeout(r, FRAME_DELAY_MS));
    if (i % 10 === 0) process.stdout.write(`  frame ${i}/${TOTAL_FRAMES}\r`);
  }

  console.log(`\nAll frames captured. Closing browser.`);
  await browser.close();

  // Use ffmpeg to create high-quality GIF
  // Step 1: Generate palette for best color quality
  console.log(`Generating color palette...`);
  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${FRAMES_DIR}/frame_%04d.png" -vf "fps=${FPS},scale=1500:500:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" "${FRAMES_DIR}/palette.png"`,
    { stdio: 'inherit' }
  );

  // Step 2: Create GIF using palette
  console.log(`Creating GIF...`);
  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${FRAMES_DIR}/frame_%04d.png" -i "${FRAMES_DIR}/palette.png" -lavfi "fps=${FPS},scale=1500:500:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" -loop 0 "${OUTPUT_GIF}"`,
    { stdio: 'inherit' }
  );

  // Cleanup frames
  rmSync(FRAMES_DIR, { recursive: true });

  console.log(`\nDone! GIF saved to: ${OUTPUT_GIF}`);

  // Show file size
  const { statSync } = await import('fs');
  const stats = statSync(OUTPUT_GIF);
  console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(e => { console.error(e); process.exit(1); });
