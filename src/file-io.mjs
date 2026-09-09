import { openSync, readSync, closeSync } from 'node:fs';
export function readPrefix(filename, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes < 0 || maxBytes > 2 * 1024 * 1024) throw new Error('Invalid text read byte limit');
  const buffer = Buffer.alloc(maxBytes);
  const fd = openSync(filename, 'r');
  let used = 0;
  try {
    while (used < maxBytes) {
      const count = readSync(fd, buffer, used, maxBytes - used, used);
      if (!count) break;
      used += count;
    }
  } finally { closeSync(fd); }
  return buffer.subarray(0, used);
}
