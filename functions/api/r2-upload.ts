// Zero-dependency Cloudflare Pages Function for https://restocorano.com/api/r2-upload
// Protected by Google Admin Bearer Token verification, MIME validation, and 150 KB size cap.

import firebaseConfig from '../../firebase-applet-config.json';

const STORE_DATA_KEY = 'data/store-data.json';
const ROOT_ADMIN_EMAILS = ['apolokor@gmail.com'];
const ALLOWED_UPLOAD_MIMES = ['image/webp', 'image/jpeg', 'image/png', 'image/avif'];
const MAX_UPLOAD_BYTES = 150 * 1024; // 150 KB hard cap for shrunk menu photos

const R2_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

function sanitizeFileName(rawName: string): string {
  const parts = String(rawName || 'image.webp').split(/[/\\]/);
  const base = parts[parts.length - 1] || 'image.webp';
  return base
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function base64ToUint8Array(base64: string): Uint8Array {
  const cleaned = base64.replace(/^data:[^;]+;base64,/, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return toHex(hash);
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

async function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode('AWS4' + secretKey), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

async function signedR2Request(params: {
  method: 'GET' | 'PUT' | 'DELETE';
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  objectKey: string;
  body?: Uint8Array;
  contentType?: string;
  cacheControl?: string;
}): Promise<Response> {
  const {
    method,
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    objectKey,
    body = new Uint8Array(0),
    contentType,
    cacheControl,
  } = params;

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${bucketName}/${objectKey}`;
  const endpoint = `https://${host}${canonicalUri}`;
  const region = 'auto';
  const service = 's3';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = await sha256Hex(body);

  const headersMap: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  if (cacheControl) headersMap['cache-control'] = cacheControl;
  if (contentType) headersMap['content-type'] = contentType;

  const sortedHeaderKeys = Object.keys(headersMap).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headersMap[k]}\n`).join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const fetchHeaders: Record<string, string> = {
    ...headersMap,
    Authorization: authorizationHeader,
  };

  return fetch(endpoint, {
    method,
    headers: fetchHeaders,
    body: method === 'PUT' ? (body as unknown as BodyInit) : undefined,
  });
}

function getBoundR2Bucket(env: any): any {
  if (!env || typeof env !== 'object') return null;
  return (
    env.BUCKET ||
    env['corano-images'] ||
    env.CORANO_IMAGES ||
    env.corano_images ||
    Object.values(env).find(
      (val: any) => val && typeof val === 'object' && typeof val.put === 'function'
    )
  );
}

async function readDynamicAdminsFromEnv(env: any): Promise<any[]> {
  try {
    const r2Bucket = getBoundR2Bucket(env);
    if (r2Bucket && typeof r2Bucket.get === 'function') {
      const obj = await r2Bucket.get(STORE_DATA_KEY);
      if (obj) {
        const parsed = JSON.parse(await obj.text());
        const baseAdmins = Array.isArray(parsed?.admins) ? [...parsed.admins] : [];
        const removed = Array.isArray(parsed?.removedAdmins)
          ? parsed.removedAdmins.map((e: any) => String(e || '').trim().toLowerCase())
          : [];
        if (
          !baseAdmins.some(
            (a: any) => String(a?.email || '').trim().toLowerCase() === 'rony.daou83@gmail.com'
          ) &&
          !removed.includes('rony.daou83@gmail.com')
        ) {
          baseAdmins.push({ email: 'rony.daou83@gmail.com' });
        }
        return baseAdmins;
      }
    }
  } catch {
    // ignore
  }
  return [{ email: 'rony.daou83@gmail.com' }, { email: 'ghassan1w2@gmail.com' }];
}

async function verifyAdminAuthorization(
  authHeader: string | null,
  env: any
): Promise<{ ok: boolean; email?: string; error?: string }> {
  const token = String(authHeader || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!token) {
    return { ok: false, error: 'Missing Authorization Bearer token.' };
  }

  let verifiedEmail = '';

  // Method 1: Official Google Identity Toolkit verification for Firebase Auth ID tokens
  try {
    const apiKey = firebaseConfig.apiKey;
    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
      }
    );
    if (lookupRes.ok) {
      const lookupData: any = await lookupRes.json();
      const userObj = lookupData?.users?.[0];
      if (userObj && userObj.email && userObj.emailVerified !== false) {
        verifiedEmail = String(userObj.email).trim().toLowerCase();
      }
    }
  } catch {
    // fallback to oauth2 tokeninfo below
  }

  // Method 2: Google OAuth2 tokeninfo verification fallback
  if (!verifiedEmail) {
    try {
      const infoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`
      );
      if (infoRes.ok) {
        const infoData: any = await infoRes.json();
        if (
          infoData?.email &&
          (infoData.email_verified === 'true' || infoData.email_verified === true)
        ) {
          verifiedEmail = String(infoData.email).trim().toLowerCase();
        }
      }
    } catch {
      // ignore
    }
  }

  if (!verifiedEmail) {
    return { ok: false, error: 'Invalid or expired Google Admin authentication token.' };
  }

  if (ROOT_ADMIN_EMAILS.includes(verifiedEmail)) {
    return { ok: true, email: verifiedEmail };
  }

  const dynamicAdmins = await readDynamicAdminsFromEnv(env);
  const isDynamic = dynamicAdmins.some(
    (a: any) => String(a?.email || '').trim().toLowerCase() === verifiedEmail
  );

  if (!isDynamic) {
    return {
      ok: false,
      error: `Account ${verifiedEmail} is not authorized as an Admin.`,
    };
  }

  return { ok: true, email: verifiedEmail };
}

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: R2_CORS_HEADERS,
  });
};

export const onRequestPost = async (context: any) => {
  const jsonHeaders = { ...R2_CORS_HEADERS, 'Content-Type': 'application/json' };
  try {
    const env = context.env || {};
    const authHeader = context.request.headers.get('Authorization');
    const authCheck = await verifyAdminAuthorization(authHeader, env);
    if (!authCheck.ok) {
      return new Response(
        JSON.stringify({ error: authCheck.error || 'Unauthorized photo upload attempt.' }),
        { status: 403, headers: jsonHeaders }
      );
    }

    const body = await context.request.json();
    const { fileName, contentType, base64Data, oldImageUrl, skipDeleteOld } = body || {};

    if (!fileName || !base64Data) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: fileName and base64Data' }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const finalContentType = String(contentType || 'image/webp').toLowerCase().trim();
    if (!ALLOWED_UPLOAD_MIMES.includes(finalContentType)) {
      return new Response(
        JSON.stringify({
          error: `Unsupported image MIME type: ${finalContentType}. Allowed: WebP, JPEG, PNG, AVIF.`,
        }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const cleanFileName = sanitizeFileName(fileName);
    const objectKey = `items/${cleanFileName}`;
    const bytes = base64ToUint8Array(String(base64Data));

    if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
      return new Response(
        JSON.stringify({
          error: `Image size (${Math.round(bytes.byteLength / 1024)} KB) exceeds the 150 KB maximum limit for menu items.`,
        }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const publicBaseUrl = String(
      env.R2_PUBLIC_BASE_URL || 'https://images.restocorano.com'
    ).replace(/\/+$/, '');
    const bucketName = String(env.R2_BUCKET_NAME || 'corano-images');
    const cacheControl = 'public, max-age=31536000, immutable';

    const r2Bucket = getBoundR2Bucket(env);
    if (r2Bucket && typeof r2Bucket.put === 'function') {
      await r2Bucket.put(objectKey, bytes, {
        httpMetadata: {
          contentType: finalContentType,
          cacheControl,
        },
      });

      const r2Prefix = `${publicBaseUrl}/items/`;
      if (
        !skipDeleteOld &&
        oldImageUrl &&
        typeof oldImageUrl === 'string' &&
        oldImageUrl.startsWith(r2Prefix)
      ) {
        const oldFileName = oldImageUrl.slice(r2Prefix.length).split('?')[0];
        const oldKey = `items/${sanitizeFileName(oldFileName)}`;
        if (oldKey && oldKey !== objectKey && typeof r2Bucket.delete === 'function') {
          await r2Bucket.delete(oldKey).catch(() => {});
        }
      }
    } else {
      const accountId = String(env.R2_ACCOUNT_ID || '').trim();
      const accessKeyId = String(env.R2_ACCESS_KEY_ID || '').trim();
      const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || '').trim();

      if (!accountId || !accessKeyId || !secretAccessKey) {
        return new Response(
          JSON.stringify({
            error:
              'Missing Cloudflare R2 environment variables (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) or BUCKET binding on Cloudflare Pages.',
          }),
          { status: 400, headers: jsonHeaders }
        );
      }

      const putRes = await signedR2Request({
        method: 'PUT',
        accountId,
        accessKeyId,
        secretAccessKey,
        bucketName,
        objectKey,
        body: bytes,
        contentType: finalContentType,
        cacheControl,
      });

      if (!putRes.ok) {
        const errText = await putRes.text();
        return new Response(
          JSON.stringify({ error: `R2 PUT failed (${putRes.status}): ${errText}` }),
          { status: 502, headers: jsonHeaders }
        );
      }

      const r2Prefix = `${publicBaseUrl}/items/`;
      if (
        !skipDeleteOld &&
        oldImageUrl &&
        typeof oldImageUrl === 'string' &&
        oldImageUrl.startsWith(r2Prefix)
      ) {
        const oldFileName = oldImageUrl.slice(r2Prefix.length).split('?')[0];
        const oldKey = `items/${sanitizeFileName(oldFileName)}`;
        if (oldKey && oldKey !== objectKey) {
          await signedR2Request({
            method: 'DELETE',
            accountId,
            accessKeyId,
            secretAccessKey,
            bucketName,
            objectKey: oldKey,
          }).catch(() => {});
        }
      }
    }

    return new Response(
      JSON.stringify({
        url: `${publicBaseUrl}/${objectKey}`,
        key: objectKey,
        sizeBytes: bytes.byteLength,
      }),
      {
        status: 200,
        headers: jsonHeaders,
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal R2 upload error' }),
      { status: 500, headers: jsonHeaders }
    );
  }
};
