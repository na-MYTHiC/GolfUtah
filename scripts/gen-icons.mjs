/**
 * Regenerates public/icon-*.png from public/icon.svg.
 * Run after changing the icon:  node scripts/gen-icons.mjs
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";

// 180 is the iOS home-screen size; 192/512 are what the PWA manifest
// wants; the rest cover older iPad/iPhone touch icons.
const SIZES = [76, 120, 152, 167, 180, 192, 512];
const svg = readFileSync("public/icon.svg");

for (const size of SIZES) {
  await sharp(svg, { density: 400 }).resize(size, size).png().toFile(`public/icon-${size}.png`);
  console.log(`icon-${size}.png`);
}
