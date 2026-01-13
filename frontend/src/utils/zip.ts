export type ZipInputFile = {
  name: string;
  data: Uint8Array;
};

type ZipEntry = {
  name: string;
  crc32: number;
  size: number;
  time: number;
  date: number;
  offset: number;
};

function toDosTimeDate(d: Date): { time: number; date: number } {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = d.getSeconds();

  const dosTime = (hours << 11) | (minutes << 5) | (Math.floor(seconds / 2) & 0x1f);
  const dosDate = ((Math.max(1980, year) - 1980) << 9) | (month << 5) | day;
  return { time: dosTime & 0xffff, date: dosDate & 0xffff };
}

function makeCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = makeCrc32Table();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  return b;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function buildZipStore(files: ZipInputFile[], now: Date): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = toDosTimeDate(now);

  const entries: ZipEntry[] = [];
  const outParts: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.data;
    const c = crc32(data);
    const size = data.length >>> 0;

    const local = concat([
      u32le(0x04034b50),
      u16le(20),
      u16le(0x0800),
      u16le(0),
      u16le(time),
      u16le(date),
      u32le(c),
      u32le(size),
      u32le(size),
      u16le(nameBytes.length),
      u16le(0),
      nameBytes,
    ]);

    outParts.push(local);
    outParts.push(data);

    entries.push({
      name: f.name,
      crc32: c,
      size,
      time,
      date,
      offset,
    });

    offset += local.length + data.length;
  }

  const centralStart = offset;
  const centralParts: Uint8Array[] = [];

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    centralParts.push(
      concat([
        u32le(0x02014b50),
        u16le(20),
        u16le(20),
        u16le(0x0800),
        u16le(0),
        u16le(e.time),
        u16le(e.date),
        u32le(e.crc32),
        u32le(e.size),
        u32le(e.size),
        u16le(nameBytes.length),
        u16le(0),
        u16le(0),
        u16le(0),
        u16le(0),
        u32le(0),
        u32le(e.offset),
        nameBytes,
      ]),
    );
  }

  const centralDir = concat(centralParts);
  const centralSize = centralDir.length;

  const end = concat([
    u32le(0x06054b50),
    u16le(0),
    u16le(0),
    u16le(entries.length),
    u16le(entries.length),
    u32le(centralSize),
    u32le(centralStart),
    u16le(0),
  ]);

  return concat([...outParts, centralDir, end]);
}
