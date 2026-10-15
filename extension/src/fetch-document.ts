/**
 * A document on another origin of the same site, fetched by the extension itself.
 *
 * A content script is held to the page's CORS rules in Chromium, so the page agent cannot read
 * `download.elster.de` from a tab on `www.elster.de`. The extension's own fetch can, with the host
 * permission the person gave that origin, and it carries the browser's cookies for it. The caller
 * has already decided (`judgeDownloadReach`, then the per-site level on THIS origin); what is left
 * here is the bound on the answer, and that a redirect did not carry the request somewhere else.
 */

import { downloadFilename } from '@beifahrer/core';

export interface FetchedDocument {
  url: string;
  filename: string;
  mime: string;
  size: number;
  base64: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function fetchDocument(
  url: string,
  maxBytes: number,
): Promise<FetchedDocument | { error: 'failed' | 'invalid'; message: string }> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include', redirect: 'follow' });
  } catch (err) {
    return { error: 'failed', message: `the browser could not fetch it: ${(err as Error).message}` };
  }
  // A redirect to another origin would reach a host nobody judged: refuse it, whatever it serves.
  if (new URL(res.url || url).origin !== new URL(url).origin) {
    return { error: 'invalid', message: 'the link redirected to another origin, which was not followed' };
  }
  if (!res.ok) return { error: 'failed', message: `the site answered ${res.status}` };
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { error: 'invalid', message: `${declared} bytes, over the ${maxBytes} limit` };
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    return { error: 'invalid', message: `${buf.byteLength} bytes, over the ${maxBytes} limit` };
  }
  return {
    url: res.url || url,
    filename: downloadFilename(res.headers.get('content-disposition'), res.url || url),
    mime: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim(),
    size: buf.byteLength,
    base64: toBase64(buf),
  };
}
