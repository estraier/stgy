import { closeSync, openSync, readSync } from "fs";
import { StringDecoder } from "string_decoder";

const BUFFER_SIZE = 64 * 1024;

export function forEachLineSync(
  filePath: string,
  callback: (line: string, lineNumber: number) => void,
): void {
  const descriptor = openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(BUFFER_SIZE);
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let lineNumber = 0;

  const emitCompleteLines = (text: string): void => {
    pending += text;
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      let line = pending.slice(0, newline);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      lineNumber += 1;
      callback(line, lineNumber);
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  };

  try {
    for (;;) {
      const size = readSync(descriptor, buffer, 0, buffer.length, null);
      if (size === 0) {
        break;
      }
      emitCompleteLines(decoder.write(buffer.subarray(0, size)));
    }
    emitCompleteLines(decoder.end());
    if (pending.length > 0) {
      lineNumber += 1;
      callback(pending.endsWith("\r") ? pending.slice(0, -1) : pending, lineNumber);
    }
  } finally {
    closeSync(descriptor);
  }
}
