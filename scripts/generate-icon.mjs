// Dependency-free, reproducible Code60 wordmark. Run when changing the icon.
import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const size = 1024;
const pixels = Buffer.alloc((size * 4 + 1) * size);
const glyphs = {
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  6: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
};
function fill(x, y, width, height, color) {
  for (let row = y; row < y + height; row++)
    for (let col = x; col < x + width; col++) {
      const offset = row * (size * 4 + 1) + 1 + col * 4;
      pixels.set([...color, 255], offset);
    }
}
fill(0, 0, size, size, [23, 28, 31]);
function word(text, y, scale, color) {
  const left = Math.floor((size - (text.length * 6 - 1) * scale) / 2);
  for (const [index, letter] of [...text].entries()) {
    for (const [line, row] of glyphs[letter].entries()) {
      for (const [column, bit] of [...row].entries()) {
        if (bit === "1")
          fill(left + (index * 6 + column) * scale, y + line * scale, scale, scale, color);
      }
    }
  }
}
word("CODE", 210, 32, [236, 238, 237]);
word("60", 500, 48, [67, 179, 174]);
function chunk(type, data) {
  const content = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, content, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
await writeFile(
  "packaging/icon.png",
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
