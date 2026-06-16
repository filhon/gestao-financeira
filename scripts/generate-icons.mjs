import sharp from "sharp";
import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const iconsDir = path.join(publicDir, "icons");
const appDir = path.join(rootDir, "src", "app");

if (!existsSync(iconsDir)) {
  await mkdir(iconsDir, { recursive: true });
}

const darkSvg = path.join(publicDir, "icon-dark.svg");
const blueSvg = path.join(publicDir, "favicon.svg");

// Dark PNG icons (mobile / PWA)
const icons = [
  { size: 16, name: "icon-16.png" },
  { size: 32, name: "icon-32.png" },
  { size: 96, name: "icon-96.png" },
  { size: 180, name: "apple-touch-icon.png" },
  { size: 192, name: "icon-192.png" },
  { size: 192, name: "icon-maskable-192.png" },
  { size: 512, name: "icon-512.png" },
  { size: 512, name: "icon-maskable-512.png" },
];

for (const { size, name } of icons) {
  await sharp(darkSvg)
    .resize(size, size)
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(path.join(iconsDir, name));
  console.log(`  public/icons/${name} (${size}x${size})`);
}

// favicon.ico — blue brand icon, multi-size (16 + 32 + 48)
// ICO format: ICONDIR header + one ICONDIRENTRY per size + PNG data
async function buildIco(sizes) {
  const pngs = await Promise.all(
    sizes.map((size) =>
      sharp(blueSvg).resize(size, size).png({ compressionLevel: 9 }).toBuffer(),
    ),
  );

  const headerSize = 6;
  const directoryEntrySize = 16;
  const directorySize = directoryEntrySize * sizes.length;
  const dataOffset = headerSize + directorySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: ICO
  header.writeUInt16LE(sizes.length, 4); // count

  const entries = [];
  let currentOffset = dataOffset;

  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const png = pngs[i];
    const entry = Buffer.alloc(directoryEntrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(png.length, 8); // bytes in resource
    entry.writeUInt32LE(currentOffset, 12); // offset to data
    entries.push(entry);
    currentOffset += png.length;
  }

  return Buffer.concat([header, ...entries, ...pngs]);
}

const icoBuffer = await buildIco([16, 32, 48]);
await writeFile(path.join(appDir, "favicon.ico"), icoBuffer);
console.log(`  src/app/favicon.ico (16x16 + 32x32 + 48x48, blue)`);

console.log("\nDone.");
