import { Config } from "./config";
import { StorageObjectId, StorageObjectListRange } from "./models/storage";
import { makeStorageService } from "./services/storageFactory";
import path from "path";
import { readFile, writeFile } from "fs/promises";
import { lookup as mimeLookup } from "mime-types";

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function parseStoragePath(p: string): StorageObjectId {
  const m = /^([^:]+):\/(.+)$/.exec(p);
  if (!m) throw new Error(`invalid storage path: ${p}`);
  return { bucket: m[1], key: m[2] };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(`Usage:
  ts-node src/storageUtil.ts head <bucket:/key>
  ts-node src/storageUtil.ts list <bucket:/key> [offset limit]
  ts-node src/storageUtil.ts save <bucket:/key> localPath
  ts-node src/storageUtil.ts load <bucket:/key> localPath
  ts-node src/storageUtil.ts copy <bucket:/srcKey> <bucket:/dstKey>
  ts-node src/storageUtil.ts move <bucket:/srcKey> <bucket:/dstKey>
  ts-node src/storageUtil.ts delete <bucket:/srcKey>
  ts-node src/storageUtil.ts presigned-post <bucket:/key> localPath
`);
    process.exit(1);
  }
  const command = args[0];
  const storagePath = args[1];
  const localPath = args[2];
  const svc = makeStorageService(Config.STORAGE_DRIVER);
  const id = parseStoragePath(storagePath);
  switch (command) {
    case "head": {
      const meta = await svc.headObject(id);
      const outObj = { ...meta, publicUrl: svc.publicUrl(id) };
      console.log(JSON.stringify(outObj, null, 2));
      break;
    }
    case "list": {
      let range = undefined;
      if (args.length >= 4) {
        range = { offset: parseInt(args[2]), limit: parseInt(args[3]) } as StorageObjectListRange;
      }
      const objs = await svc.listObjects(id, range);
      const sliced = objs.map((obj) => ({
        ...obj,
        publicUrl: svc.publicUrl({ bucket: obj.bucket, key: obj.key }),
      }));
      console.log(JSON.stringify(sliced, null, 2));
      break;
    }
    case "load": {
      if (!localPath) throw new Error("localPath required");
      const bytes = await svc.loadObject(id);
      await writeFile(localPath, bytes);
      console.log(`saved -> ${localPath} (${bytes.length} bytes)`);
      break;
    }
    case "save": {
      if (!localPath) throw new Error("localPath required");
      const buf = await readFile(localPath);
      const ct = mimeLookup(localPath) || "application/octet-stream";
      await svc.saveObject(id, new Uint8Array(buf), ct);
      console.log(`uploaded <- ${localPath} (${buf.byteLength} bytes)`);
      break;
    }
    case "copy": {
      if (!localPath) throw new Error("destination key required");
      const dstId = parseStoragePath(localPath);
      await svc.copyObject(id, dstId);
      console.log(`copied ${storagePath} -> ${localPath}`);
      break;
    }
    case "move": {
      if (!localPath) throw new Error("destination key required");
      const dstId = parseStoragePath(localPath);
      await svc.moveObject(id, dstId);
      console.log(`moved ${storagePath} -> ${localPath}`);
      break;
    }
    case "delete": {
      await svc.deleteObject(id);
      console.log("deleted");
      break;
    }
    case "presigned-post": {
      if (!localPath) throw new Error("localPath required");
      const ct = mimeLookup(localPath) || "application/octet-stream";
      const presigned = await svc.createPresignedPost({
        bucket: id.bucket,
        key: id.key,
        contentTypeWhitelist: ct,
      });
      const form = new FormData();
      for (const [k, v] of Object.entries(presigned.fields)) {
        form.append(k, v as string);
      }
      const buf = await readFile(localPath);
      const ab = bufferToArrayBuffer(buf);
      const blob = new Blob([ab], { type: ct });
      form.append("file", blob, path.basename(localPath));
      const resp = await fetch(presigned.url, { method: "POST", body: form });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`upload failed: ${resp.status} ${resp.statusText}\n${text}`);
      }
      console.log("uploaded via presigned POST");
      break;
    }
    default: {
      throw new Error(`Unknown command: ${command}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
