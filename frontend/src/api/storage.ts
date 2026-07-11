import type { PresignedPostResult } from "./models";

export async function uploadToPresigned(
  presigned: PresignedPostResult,
  file: Blob | ArrayBuffer | Uint8Array,
  filename?: string,
  contentType?: string,
): Promise<void> {
  const form = new FormData();
  Object.entries(presigned.fields).forEach(([key, value]) => form.append(key, value));
  const blob =
    file instanceof Blob
      ? file
      : new Blob(
          [
            file instanceof Uint8Array
              ? (file.buffer.slice(
                  file.byteOffset,
                  file.byteOffset + file.byteLength,
                ) as ArrayBuffer)
              : (file as ArrayBuffer),
          ],
          {
            type: contentType || presigned.fields["Content-Type"] || "application/octet-stream",
          },
        );
  form.append("file", blob, filename ?? "upload.bin");
  const res = await fetch(presigned.url, {
    method: "POST",
    body: form,
    credentials: "omit",
  });
  if (!(res.status === 200 || res.status === 201 || res.status === 204)) {
    const text = await res.text().catch(() => "");
    throw new Error(`upload failed: ${res.status} ${text}`);
  }
}
