/**
 * What `page.upload` carries and how much of it (ADR 0027).
 *
 * The bridge reads the files from the person's upload folder and hands the bytes to the extension,
 * which builds `File` objects in the page. The limits live here so the bridge (before it reads)
 * and the extension (before it builds) refuse by the same numbers.
 */

/** One file on its way into the page. */
export interface UploadFile {
  name: string;
  mime: string;
  size: number;
  base64: string;
}

/** What comes back: never the bytes. */
export interface UploadedFile {
  name: string;
  mime: string;
  size: number;
}

export const MAX_UPLOAD_FILES = 10;
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** The type a file name suggests; `application/octet-stream` when it suggests none. */
export function mimeOfName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(MIME_BY_EXTENSION, ext)
    ? MIME_BY_EXTENSION[ext]!
    : 'application/octet-stream';
}

/** Why a set of files may not go, or null when it may. Sizes are the real ones, not the claimed. */
export function uploadRefusal(files: readonly { size: number }[]): string | null {
  if (files.length === 0) return 'no files given';
  if (files.length > MAX_UPLOAD_FILES) return `at most ${MAX_UPLOAD_FILES} files per call`;
  let total = 0;
  for (const file of files) {
    if (file.size > MAX_UPLOAD_FILE_BYTES)
      return `a file is larger than ${MAX_UPLOAD_FILE_BYTES / 1024 / 1024} MiB`;
    total += file.size;
  }
  if (total > MAX_UPLOAD_TOTAL_BYTES)
    return `together the files are larger than ${MAX_UPLOAD_TOTAL_BYTES / 1024 / 1024} MiB`;
  return null;
}
