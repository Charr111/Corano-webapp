// Zero-dependency Cloudflare Pages Function for https://restocorano.com/api/r2-upload
// Supports either native Cloudflare R2 Bucket binding (env.BUCKET) or S3-compatible API credentials
// using standard Web Crypto API (crypto.subtle) with zero Node-only npm packages.

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

async function getSignatureKey(secretKey: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode('AWS4' + secretKey), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

async function signedR2Request(params: {
  method: 'PUT' | 'DELETE';
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

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: R2_CORS_HEADERS,
  });
};

export const onRequestPost = async (context: any) => {
  try {
    const env = context.env || {};
    const body = await context.request.json();
    const { fileName, contentType, base64Data, oldImageUrl, skipDeleteOld } = body || {};

    if (!fileName || !base64Data) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: fileName and base64Data' }),
        { status: 400, headers: { ...R2_CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const cleanFileName = sanitizeFileName(fileName);
    const objectKey = `items/${cleanFileName}`;
    const bytes = base64ToUint8Array(String(base64Data));
    const publicBaseUrl = String(env.R2_PUBLIC_BASE_URL || 'https://images.restocorano.com').replace(/\/+$/, '');
    const bucketName = String(env.R2_BUCKET_NAME || 'corano-images');
    const cacheControl = 'public, max-age=31536000, immutable';
    const finalContentType = contentType || 'image/webp';

    // Option A: If Cloudflare Pages has a native R2 bucket binding (e.g., BUCKET, corano-images, CORANO_IMAGES, or any bound R2 bucket)
    const r2Bucket =
      env.BUCKET ||
      env['corano-images'] ||
      env.CORANO_IMAGES ||
      env.corano_images ||
      Object.values(env).find(
        (val: any) => val && typeof val === 'object' && typeof val.put === 'function'
      );
    if (r2Bucket && typeof r2Bucket.put === 'function') {
      await r2Bucket.put(objectKey, bytes, {
        httpMetadata: {
          contentType: finalContentType,
          cacheControl,
        },
      });

      const r2Prefix = `${publicBaseUrl}/items/`;
      if (!skipDeleteOld && oldImageUrl && typeof oldImageUrl === 'string' && oldImageUrl.startsWith(r2Prefix)) {
        const oldFileName = oldImageUrl.slice(r2Prefix.length).split('?')[0];
        const oldKey = `items/${sanitizeFileName(oldFileName)}`;
        if (oldKey && oldKey !== objectKey && typeof r2Bucket.delete === 'function') {
          await r2Bucket.delete(oldKey).catch(() => {});
        }
      }
    } else {
      // Option B: S3-compatible API using Web Crypto AWS Signature V4
      const accountId = String(env.R2_ACCOUNT_ID || '').trim();
      const accessKeyId = String(env.R2_ACCESS_KEY_ID || '').trim();
      const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || '').trim();

      if (!accountId || !accessKeyId || !secretAccessKey) {
        return new Response(
          JSON.stringify({
            error: 'Missing Cloudflare R2 environment variables (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) or BUCKET binding on Cloudflare Pages.',
          }),
          { status: 400, headers: { ...R2_CORS_HEADERS, 'Content-Type': 'application/json' } }
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
          { status: 502, headers: { ...R2_CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }

      const r2Prefix = `${publicBaseUrl}/items/`;
      if (!skipDeleteOld && oldImageUrl && typeof oldImageUrl === 'string' && oldImageUrl.startsWith(r2Prefix)) {
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
        headers: { ...R2_CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal R2 upload error' }),
      { status: 500, headers: { ...R2_CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
};
