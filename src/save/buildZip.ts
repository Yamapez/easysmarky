import { zipSync, type Zippable } from "fflate";
import type { BuiltZipEntry } from "../model/toParam";

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 各フィールドのテキストPNGエントリをまとめて ZIP(Blob) にする。
 */
export function buildAnswersZip(entries: BuiltZipEntry[]): Blob {
  const files: Zippable = {};
  for (const entry of entries) {
    files[entry.filename] = base64ToUint8Array(entry.base64);
  }
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: "application/zip" });
}
