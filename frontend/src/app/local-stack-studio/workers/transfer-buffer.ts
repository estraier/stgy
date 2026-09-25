export type TransferableTypedArray =
  | Uint8Array
  | Uint16Array
  | Int32Array
  | Float32Array
  | Float64Array;

export function transferableBuffer(view: TransferableTypedArray): ArrayBuffer {
  const buffer = view.buffer;
  if (
    buffer instanceof ArrayBuffer &&
    view.byteOffset === 0 &&
    view.byteLength === buffer.byteLength
  ) {
    return buffer;
  }

  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(buffer, view.byteOffset, view.byteLength));
  return copy.buffer as ArrayBuffer;
}
