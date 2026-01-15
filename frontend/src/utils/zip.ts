export type ZipInputFile = {
  name: string;
  data: Uint8Array;
};

export interface IZipWriter {
  addFile(name: string, data: Uint8Array, now: Date): Promise<void>;
  finalize(): Promise<void>;
}

export interface WritableFileStreamMinimal {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

const CRC32_TABLE = new Uint32Array(256).map((_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array, currentCrc = 0xffffffff): number {
  let c = currentCrc;
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

function toDosTimeDate(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

export class ZipStreamWriter implements IZipWriter {
  private writer: WritableFileStreamMinimal;
  private entries: Array<{ name: string; crc: number; size: number; time: number; date: number; offset: number }> = [];
  private currentOffset = 0;

  constructor(writer: WritableFileStreamMinimal) {
    this.writer = writer;
  }

  private async write(data: Uint8Array) {
    await this.writer.write(data);
    this.currentOffset += data.length;
  }

  async addFile(name: string, data: Uint8Array, now: Date) {
    const enc = new TextEncoder();
    const nameBytes = enc.encode(name);
    const { time, date } = toDosTimeDate(now);
    const c = crc32(data);
    const size = data.length;

    const localHeader = concat([
      u32le(0x04034b50), u16le(20), u16le(0x0800), u16le(0),
      u16le(time), u16le(date), u32le(c), u32le(size), u32le(size),
      u16le(nameBytes.length), u16le(0), nameBytes
    ]);

    const offset = this.currentOffset;
    await this.write(localHeader);
    await this.write(data);

    this.entries.push({ name, crc: c, size, time, date, offset });
  }

  async finalize() {
    const centralStart = this.currentOffset;
    const enc = new TextEncoder();

    for (const e of this.entries) {
      const nameBytes = enc.encode(e.name);
      await this.write(concat([
        u32le(0x02014b50), u16le(20), u16le(20), u16le(0x0800), u16le(0),
        u16le(e.time), u16le(e.date), u32le(e.crc), u32le(e.size), u32le(e.size),
        u16le(nameBytes.length), u16le(0), u16le(0), u16le(0), u16le(0),
        u32le(0), u32le(e.offset), nameBytes
      ]));
    }

    const centralSize = this.currentOffset - centralStart;
    await this.write(concat([
      u32le(0x06054b50), u16le(0), u16le(0),
      u16le(this.entries.length), u16le(this.entries.length),
      u32le(centralSize), u32le(centralStart), u16le(0)
    ]));

    await this.writer.close();
  }
}

export class InMemoryZipWriter implements IZipWriter {
  private files: ZipInputFile[] = [];
  private fileName: string;

  constructor(fileName: string) {
    this.fileName = fileName;
  }

  async addFile(name: string, data: Uint8Array, _now: Date) {
    this.files.push({ name, data });
  }

  async finalize() {
    const now = new Date();
    const { time, date } = toDosTimeDate(now);
    const enc = new TextEncoder();

    const entries: Array<{ name: string; crc: number; size: number; time: number; date: number; offset: number }> = [];
    const outParts: Uint8Array[] = [];
    let offset = 0;

    for (const f of this.files) {
      const nameBytes = enc.encode(f.name);
      const c = crc32(f.data);
      const size = f.data.length;
      const local = concat([
        u32le(0x04034b50), u16le(20), u16le(0x0800), u16le(0),
        u16le(time), u16le(date), u32le(c), u32le(size), u32le(size),
        u16le(nameBytes.length), u16le(0), nameBytes
      ]);
      outParts.push(local, f.data);
      entries.push({ name: f.name, crc: c, size, time, date, offset });
      offset += local.length + f.data.length;
    }

    const centralStart = offset;
    const centralParts: Uint8Array[] = [];
    for (const e of entries) {
      const nameBytes = enc.encode(e.name);
      centralParts.push(concat([
        u32le(0x02014b50), u16le(20), u16le(20), u16le(0x0800), u16le(0),
        u16le(e.time), u16le(e.date), u32le(e.crc), u32le(e.size), u32le(e.size),
        u16le(nameBytes.length), u16le(0), u16le(0), u16le(0), u16le(0),
        u32le(0), u32le(e.offset), nameBytes
      ]));
    }
    const centralDir = concat(centralParts);
    const end = concat([
      u32le(0x06054b50), u16le(0), u16le(0),
      u16le(entries.length), u16le(entries.length),
      u32le(centralDir.length), u32le(centralStart), u16le(0)
    ]);

    const zipBytes = concat([...outParts, centralDir, end]);
    const blob = new Blob([zipBytes], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = this.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
