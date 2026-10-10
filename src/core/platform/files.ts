import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNative } from './routerlink.ts';
import { bytesToBase64 } from '../pdf.ts';

/** Saves a file to the app cache and opens the Android share sheet (or downloads in a browser). */
export async function shareFile(name: string, data: Uint8Array | string, mime: string): Promise<void> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (!isNative()) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const written = await Filesystem.writeFile({ path: name, data: bytesToBase64(bytes), directory: Directory.Cache });
  try {
    await Share.share({ title: name, files: [written.uri], dialogTitle: name });
  } catch (e) {
    // Closing the share sheet without choosing an app is not an error.
    if (!/cancel/i.test(String((e as Error)?.message ?? e))) throw e;
  }
}

/**
 * Keeps a copy inside the app's private storage (not visible to other apps).
 * Used for the automatic backup taken before erasing data.
 */
export async function savePrivateCopy(name: string, text: string): Promise<string> {
  if (!isNative()) {
    await shareFile(name, text, 'application/json');
    return name;
  }
  const path = `backups/${name}`;
  await Filesystem.writeFile({ path, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
  return path;
}

/** Lets the user pick a text file (e.g. a backup) and returns its contents. */
export function pickTextFile(accept = '.json,application/json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve(await file.text());
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
