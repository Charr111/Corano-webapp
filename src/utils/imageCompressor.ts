// Pure Client-Side Browser Auto-Shrink Utility (< 55 KB Target Budget + iOS Safari/WebKit Fix)
// and Firestore Payload Sanitization helpers.

import { auth } from '../firebase';

export interface CompressedImageResult {
  base64Data: string;
  contentType: 'image/webp' | 'image/jpeg';
  extension: 'webp' | 'jpg';
  originalSizeKB: number;
  compressedSizeKB: number;
  sizeBytes: number;
  width: number;
  height: number;
}

const TARGET_MAX_BYTES = 55 * 1024; // ~55 KB target budget
const MAX_DIMENSION = 600; // c_limit 600px max width/height
const QUALITY_STEPS = [0.72, 0.62, 0.52, 0.44, 0.36];

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to decode image in browser'));
    };
    img.src = objectUrl;
  });
}

function renderToCanvas(img: HTMLImageElement, targetWidth: number, targetHeight: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(targetWidth));
  canvas.height = Math.max(1, Math.round(targetHeight));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context');
  }
  // Clean dark-neutral fill for transparent edges if JPEG wins, while keeping crisp rendering
  ctx.fillStyle = '#141311';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToBlobStrict(
  canvas: HTMLCanvasElement,
  mimeType: 'image/webp' | 'image/jpeg',
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          // iOS Safari / Mobile WebKit Fix:
          // Reject silent uncompressed image/png fallbacks when image/webp was requested
          if (mimeType === 'image/webp' && blob.type !== 'image/webp') {
            resolve(null);
            return;
          }
          resolve(blob);
        },
        mimeType,
        quality
      );
    } catch {
      resolve(null);
    }
  });
}

async function encodeBestFormatAtQuality(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<{ blob: Blob; contentType: 'image/webp' | 'image/jpeg'; extension: 'webp' | 'jpg' }> {
  const [webpBlob, jpegBlob] = await Promise.all([
    canvasToBlobStrict(canvas, 'image/webp', quality),
    canvasToBlobStrict(canvas, 'image/jpeg', quality),
  ]);

  if (webpBlob && jpegBlob) {
    if (webpBlob.size <= jpegBlob.size) {
      return { blob: webpBlob, contentType: 'image/webp', extension: 'webp' };
    }
    return { blob: jpegBlob, contentType: 'image/jpeg', extension: 'jpg' };
  }

  if (webpBlob) {
    return { blob: webpBlob, contentType: 'image/webp', extension: 'webp' };
  }

  if (jpegBlob) {
    return { blob: jpegBlob, contentType: 'image/jpeg', extension: 'jpg' };
  }

  throw new Error('Browser failed to encode image to WebP or JPEG');
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to convert compressed Blob to Base64'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Compresses any File or Blob in the browser using proportional c_limit downscaling (max 600px),
 * parallel WebP + JPEG encoding (with strict iOS Safari/WebKit PNG fallback rejection),
 * and a multi-step quality & dimension loop targeting <= 55 KB.
 */
export async function compressImageToBudget(
  fileOrBlob: Blob,
  maxDimension: number = MAX_DIMENSION,
  targetMaxBytes: number = TARGET_MAX_BYTES
): Promise<CompressedImageResult> {
  const originalSizeKB = Math.max(1, Math.round(fileOrBlob.size / 1024));
  const img = await loadImageFromBlob(fileOrBlob);

  const srcWidth = img.naturalWidth || img.width || 600;
  const srcHeight = img.naturalHeight || img.height || 600;

  // Proportional downscale (c_limit: never upscale smaller images)
  let width = srcWidth;
  let height = srcHeight;
  if (width > maxDimension || height > maxDimension) {
    if (width >= height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  let canvas = renderToCanvas(img, width, height);
  let bestCandidate = await encodeBestFormatAtQuality(canvas, QUALITY_STEPS[0]);

  for (let i = 0; i < QUALITY_STEPS.length; i++) {
    const q = QUALITY_STEPS[i];
    const candidate = i === 0 ? bestCandidate : await encodeBestFormatAtQuality(canvas, q);
    if (candidate.blob.size < bestCandidate.blob.size) {
      bestCandidate = candidate;
    }
    if (bestCandidate.blob.size <= targetMaxBytes) {
      break;
    }
  }

  // If a heavily textured camera photo is still above 55 KB, scale dimensions down by 0.82x (up to 2 passes)
  let scalePasses = 0;
  while (bestCandidate.blob.size > targetMaxBytes && scalePasses < 2 && width > 260 && height > 260) {
    scalePasses++;
    width = Math.round(width * 0.82);
    height = Math.round(height * 0.82);
    canvas = renderToCanvas(img, width, height);
    const scaledCandidate = await encodeBestFormatAtQuality(canvas, 0.52);
    if (scaledCandidate.blob.size < bestCandidate.blob.size) {
      bestCandidate = scaledCandidate;
    }
    if (bestCandidate.blob.size <= targetMaxBytes) {
      break;
    }
    const lowerCandidate = await encodeBestFormatAtQuality(canvas, 0.42);
    if (lowerCandidate.blob.size < bestCandidate.blob.size) {
      bestCandidate = lowerCandidate;
    }
  }

  const base64Data = await blobToBase64(bestCandidate.blob);
  const compressedSizeKB = Math.max(1, Math.round(bestCandidate.blob.size / 1024));

  return {
    base64Data,
    contentType: bestCandidate.contentType,
    extension: bestCandidate.extension,
    originalSizeKB,
    compressedSizeKB,
    sizeBytes: bestCandidate.blob.size,
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * Generates a clean, URL-safe slug from any text string.
 */
export function sanitizeSlug(text: string): string {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'item';
}

/**
 * Generates a collision-proof R2 filename incorporating category, unique ID/timestamp, and title.
 * Prevents items with the same title in different categories (e.g., "Kabab" in mashewe vs. sajj)
 * from ever overwriting each other.
 */
export function buildCollisionProofFileName(
  category: string,
  uniqueId: string,
  title: string,
  extension: 'webp' | 'jpg'
): string {
  const catSlug = sanitizeSlug(category || 'menu');
  const idSlug = sanitizeSlug(uniqueId || String(Date.now()));
  const titleSlug = sanitizeSlug(title || 'item');
  return `${catSlug}-${idSlug}-${titleSlug}.${extension}`;
}

/**
 * Normalizes a Cloudinary URL to ensure it requests `f_auto,q_auto,w_600,c_limit`
 * and appends `?migration_fetch=1` so the browser never reuses a non-CORS cached response.
 * Also returns a canonical deduplication key so shared images (e.g. S/M/L sizes) upload only once.
 */
export function prepareCloudinaryMigrationUrl(rawUrl: string): {
  fetchUrl: string;
  dedupeKey: string;
} {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed.includes('res.cloudinary.com')) {
    const sep = trimmed.includes('?') ? '&' : '?';
    return {
      fetchUrl: `${trimmed}${sep}migration_fetch=1`,
      dedupeKey: trimmed.split('?')[0],
    };
  }

  const withoutQuery = trimmed.split('?')[0];
  // Extract canonical asset identifier after /image/upload/ (stripping existing transforms)
  const uploadMarker = '/image/upload/';
  const idx = withoutQuery.indexOf(uploadMarker);
  if (idx === -1) {
    return {
      fetchUrl: `${withoutQuery}?migration_fetch=1`,
      dedupeKey: withoutQuery,
    };
  }

  const prefix = withoutQuery.slice(0, idx + uploadMarker.length);
  const rest = withoutQuery.slice(idx + uploadMarker.length);
  const segments = rest.split('/');

  // Remove transformation segments (segments containing commas or starting with w_, f_, q_, c_, etc. before version/public_id)
  while (
    segments.length > 1 &&
    (segments[0].includes(',') || /^(f_|q_|w_|h_|c_|dpr_|fl_|e_|g_|ar_)/.test(segments[0]))
  ) {
    segments.shift();
  }

  const assetPath = segments.join('/');
  const canonicalDedupeKey = `${prefix}${assetPath}`;
  const optimizedUrl = `${prefix}f_auto,q_auto,w_600,c_limit/${assetPath}?migration_fetch=1`;

  return {
    fetchUrl: optimizedUrl,
    dedupeKey: canonicalDedupeKey,
  };
}

/**
 * Fetches an image Blob with cache-busted CORS mode, falling back to /api/proxy-image if needed.
 */
export async function fetchImageBlobForMigration(rawUrl: string): Promise<Blob> {
  const { fetchUrl } = prepareCloudinaryMigrationUrl(rawUrl);
  try {
    const res = await fetch(fetchUrl, {
      mode: 'cors',
      cache: 'no-store',
    });
    if (res.ok) {
      return await res.blob();
    }
  } catch {
    // Fall through to server-side proxy
  }

  const proxyRes = await fetch(`/api/proxy-image?url=${encodeURIComponent(fetchUrl)}`, {
    cache: 'no-store',
  });
  if (!proxyRes.ok) {
    throw new Error(`Failed to fetch source image (${proxyRes.status})`);
  }
  return await proxyRes.blob();
}

/**
 * Uploads a compressed image payload to /api/r2-upload and returns the resulting R2 URL.
 */
export async function uploadCompressedToR2(params: {
  fileName: string;
  contentType: string;
  base64Data: string;
  oldImageUrl?: string;
  skipDeleteOld?: boolean;
}): Promise<{ url: string; key: string; sizeBytes: number }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Please sign in with your Google Admin account before uploading photos.');
  }
  const idToken = await currentUser.getIdToken();

  const res = await fetch('/api/r2-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(params),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    throw new Error(data.error || `R2 upload failed with status ${res.status}`);
  }
  return data;
}

/**
 * Strips `undefined` values and any disallowed local `id` field before writing to Firestore.
 */
export function sanitizeFirestorePayload<T extends Record<string, any>>(payload: T): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (key === 'id' || value === undefined) continue;
    if (Array.isArray(value)) {
      cleaned[key] = value.filter((item) => item !== undefined);
    } else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      cleaned[key] = sanitizeFirestorePayload(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}
