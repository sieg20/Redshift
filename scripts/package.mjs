// Zips dist/ into redshift-web.zip, ready to upload to itch.io, Netlify and similar hosts
// (index.html at the root of the zip, forward-slash paths). Run with `npm run package`, which
// builds first.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('dist');
const OUT = path.resolve('redshift-web.zip');

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('dist/index.html not found: run `npm run build` first');
  process.exit(1);
}

const local = [];
const central = [];
let offset = 0;
// DOS date/time for every entry (the zip format needs one; the value doesn't matter here)
const d = new Date();
const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

for (const file of walk(ROOT)) {
  const name = Buffer.from(path.relative(ROOT, file).split(path.sep).join('/'));
  const data = fs.readFileSync(file);
  const packed = zlib.deflateRawSync(data, { level: 9 });
  // already-compressed files (mp3, jpg) barely shrink; store those as they are
  const deflate = packed.length < data.length * 0.95;
  const body = deflate ? packed : data;
  const crc = crc32(data);

  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(0x0800, 6); // UTF-8 names
  h.writeUInt16LE(deflate ? 8 : 0, 8);
  h.writeUInt16LE(dosTime, 10);
  h.writeUInt16LE(dosDate, 12);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(body.length, 18);
  h.writeUInt32LE(data.length, 22);
  h.writeUInt16LE(name.length, 26);
  local.push(h, name, body);

  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0);
  c.writeUInt16LE(20, 4);
  c.writeUInt16LE(20, 6);
  c.writeUInt16LE(0x0800, 8);
  c.writeUInt16LE(deflate ? 8 : 0, 10);
  c.writeUInt16LE(dosTime, 12);
  c.writeUInt16LE(dosDate, 14);
  c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(body.length, 20);
  c.writeUInt32LE(data.length, 24);
  c.writeUInt16LE(name.length, 28);
  c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += h.length + name.length + body.length;
}

const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(cd.length, 12);
end.writeUInt32LE(offset, 16);
fs.writeFileSync(OUT, Buffer.concat([...local, cd, end]));
console.log(`${path.basename(OUT)}: ${central.length / 2} files, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB`);
