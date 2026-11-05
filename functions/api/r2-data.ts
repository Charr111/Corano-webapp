// Zero-dependency Cloudflare Pages Function for https://restocorano.com/api/r2-data
// Supports native Cloudflare R2 Bucket binding (env.BUCKET, env['corano-images'], or any bound bucket)
// as well as S3-compatible Web Crypto API fallback.

import initialSeedData from '../../src/data/initialStoreData.json';
import firebaseConfig from '../../firebase-applet-config.json';

const STORE_DATA_KEY = 'data/store-data.json';
const ROOT_ADMIN_EMAILS = ['apolokor@gmail.com', 'rony.daou83@gmail.com'];

const R2_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

function stripHtmlTags(input: string): string {
  return String(input || '')
    .replace(/<[^>]*>/g, '')
    .trim();
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
  method: 'GET' | 'PUT';
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

function normalizeStoreData(raw: any): any {
  const fallback: any = initialSeedData || {
    version: Date.now(),
    updatedAt: new Date().toISOString(),
    settings: { currency: 'USD', exchangeRate: 89000 },
    categories: [],
    items: [],
    reviews: [],
    admins: [],
  };
  if (!raw || typeof raw !== 'object') return fallback;
  return {
    version: typeof raw.version === 'number' ? raw.version : Date.now(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    settings: {
      currency: raw.settings?.currency === 'LBP' ? 'LBP' : 'USD',
      exchangeRate:
        typeof raw.settings?.exchangeRate === 'number' && raw.settings.exchangeRate > 0
          ? raw.settings.exchangeRate
          : 89000,
    },
    categories: Array.isArray(raw.categories) ? raw.categories : fallback.categories || [],
    items: Array.isArray(raw.items) ? raw.items : fallback.items || [],
    reviews: Array.isArray(raw.reviews) ? raw.reviews : fallback.reviews || [],
    admins: Array.isArray(raw.admins) ? raw.admins : fallback.admins || [],
  };
}

function sanitizePublicStoreData(storeData: any): any {
  return {
    ...storeData,
    reviews: (storeData?.reviews || []).filter(
      (r: any) => !r.status || r.status === 'approved'
    ),
    admins: [],
  };
}

async function readStoreDataFromEnv(env: any): Promise<any> {
  const r2Bucket = getBoundR2Bucket(env);
  if (r2Bucket && typeof r2Bucket.get === 'function') {
    const obj = await r2Bucket.get(STORE_DATA_KEY);
    if (obj) {
      const text = await obj.text();
      if (text) {
        return normalizeStoreData(JSON.parse(text));
      }
    } else if (typeof r2Bucket.put === 'function') {
      const seed = normalizeStoreData(initialSeedData);
      await r2Bucket.put(STORE_DATA_KEY, JSON.stringify(seed), {
        httpMetadata: {
          contentType: 'application/json',
          cacheControl: 'no-cache, must-revalidate',
        },
      });
      return seed;
    }
  }

  const accountId = String(env?.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = String(env?.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env?.R2_SECRET_ACCESS_KEY || '').trim();
  const bucketName = String(env?.R2_BUCKET_NAME || 'corano-images').trim();

  if (accountId && accessKeyId && secretAccessKey) {
    const getRes = await signedR2Request({
      method: 'GET',
      accountId,
      accessKeyId,
      secretAccessKey,
      bucketName,
      objectKey: STORE_DATA_KEY,
    });
    if (getRes.ok) {
      const text = await getRes.text();
      return normalizeStoreData(JSON.parse(text));
    }
  }

  const publicBaseUrl = String(env?.R2_PUBLIC_BASE_URL || 'https://images.restocorano.com').replace(
    /\/+$/,
    ''
  );
  try {
    const pubRes = await fetch(`${publicBaseUrl}/${STORE_DATA_KEY}?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (pubRes.ok) {
      return normalizeStoreData(await pubRes.json());
    }
  } catch {
    // ignore
  }

  return normalizeStoreData(initialSeedData);
}

async function writeStoreDataToEnv(env: any, storeData: any): Promise<any> {
  const normalized = normalizeStoreData(storeData);
  normalized.version = Date.now();
  normalized.updatedAt = new Date().toISOString();
  const jsonString = JSON.stringify(normalized);

  const r2Bucket = getBoundR2Bucket(env);
  if (r2Bucket && typeof r2Bucket.put === 'function') {
    await r2Bucket.put(STORE_DATA_KEY, jsonString, {
      httpMetadata: {
        contentType: 'application/json',
        cacheControl: 'no-cache, must-revalidate',
      },
    });
    return normalized;
  }

  const accountId = String(env?.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = String(env?.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env?.R2_SECRET_ACCESS_KEY || '').trim();
  const bucketName = String(env?.R2_BUCKET_NAME || 'corano-images').trim();

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing Cloudflare R2 bucket binding (corano-images) or R2 environment variables on Cloudflare Pages.'
    );
  }

  const bytes = new TextEncoder().encode(jsonString);
  const putRes = await signedR2Request({
    method: 'PUT',
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    objectKey: STORE_DATA_KEY,
    body: bytes,
    contentType: 'application/json',
    cacheControl: 'no-cache, must-revalidate',
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`R2 store-data PUT failed (${putRes.status}): ${errText}`);
  }

  return normalized;
}

async function verifyAdminAuthorization(
  authHeader: string | null,
  storeData: any
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

  const isRoot = ROOT_ADMIN_EMAILS.includes(verifiedEmail);
  const isDynamic =
    Array.isArray(storeData?.admins) &&
    storeData.admins.some((a: any) => String(a?.email || '').trim().toLowerCase() === verifiedEmail);

  if (!isRoot && !isDynamic) {
    return {
      ok: false,
      error: `Account ${verifiedEmail} is not authorized as an Admin.`,
    };
  }

  return { ok: true, email: verifiedEmail };
}

function sanitizeRecord(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: R2_CORS_HEADERS,
  });
};

export const onRequestGet = async (context: any) => {
  try {
    const storeData = await readStoreDataFromEnv(context.env || {});
    const authHeader = context.request.headers.get('Authorization');
    if (authHeader) {
      const authCheck = await verifyAdminAuthorization(authHeader, storeData);
      if (authCheck.ok) {
        return new Response(JSON.stringify(storeData), {
          status: 200,
          headers: {
            ...R2_CORS_HEADERS,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        });
      }
    }
    return new Response(JSON.stringify(sanitizePublicStoreData(storeData)), {
      status: 200,
      headers: {
        ...R2_CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message || 'Failed to read R2 store data' }),
      {
        status: 500,
        headers: { ...R2_CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  }
};

export const onRequestPost = async (context: any) => {
  const jsonHeaders = {
    ...R2_CORS_HEADERS,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  };

  try {
    const env = context.env || {};
    const body = await context.request.json();
    const action = String(body?.action || '').trim();

    if (!action) {
      return new Response(JSON.stringify({ error: 'Missing required action parameter.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const storeData = await readStoreDataFromEnv(env);

    // 1. Public Action: Submit Customer Review (Strict XSS & 50-pending-review spam cap)
    if (action === 'submitPublicReview') {
      const author = stripHtmlTags(body.author);
      const text = stripHtmlTags(body.text);
      const rating = Number(body.rating);

      if (
        !author ||
        author.length > 60 ||
        !text ||
        text.length > 500 ||
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5
      ) {
        return new Response(
          JSON.stringify({
            error:
              'Valid name (max 60 chars), review text (max 500 chars), and integer rating (1-5) are required.',
          }),
          { status: 400, headers: jsonHeaders }
        );
      }

      const pendingCount = (storeData.reviews || []).filter(
        (r: any) => r.status === 'pending'
      ).length;
      if (pendingCount >= 50) {
        return new Response(
          JSON.stringify({
            error: 'Maximum number of pending reviews reached. Please try again later.',
          }),
          { status: 429, headers: jsonHeaders }
        );
      }

      const newReview = {
        id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        author,
        text,
        rating,
        date: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        status: 'pending' as const,
      };

      storeData.reviews = [newReview, ...(storeData.reviews || [])];
      const saved = await writeStoreDataToEnv(env, storeData);
      return new Response(
        JSON.stringify({
          ok: true,
          review: newReview,
          storeData: sanitizePublicStoreData(saved),
        }),
        {
          status: 200,
          headers: jsonHeaders,
        }
      );
    }

    // 2. Admin-only Actions
    const authHeader = context.request.headers.get('Authorization');
    const authCheck = await verifyAdminAuthorization(authHeader, storeData);
    if (!authCheck.ok) {
      return new Response(
        JSON.stringify({ error: authCheck.error || 'Unauthorized admin request.' }),
        { status: 403, headers: jsonHeaders }
      );
    }

    if (action === 'saveItem') {
      const rawItem = body.item || {};
      const title = String(rawItem.title || '').trim();
      const price = String(rawItem.price || '').trim();
      const category = String(rawItem.category || 'subs').trim().toLowerCase();

      if (!title || !price) {
        return new Response(
          JSON.stringify({ error: 'Product title and price are required.' }),
          { status: 400, headers: jsonHeaders }
        );
      }

      const itemId =
        rawItem.id && String(rawItem.id).trim()
          ? String(rawItem.id).trim()
          : `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const cleanItem = sanitizeRecord({
        id: itemId,
        title,
        price,
        category,
        desc: rawItem.desc !== undefined ? String(rawItem.desc) : '',
        img: rawItem.img !== undefined ? String(rawItem.img) : '',
        available: rawItem.available !== false,
        order: typeof rawItem.order === 'number' ? rawItem.order : 99,
        addons: Array.isArray(rawItem.addons)
          ? rawItem.addons.map((a: any) => String(a).trim()).filter(Boolean)
          : [],
        isNew: Boolean(rawItem.isNew),
      });

      const existingIdx = storeData.items.findIndex((i: any) => i.id === itemId);
      if (existingIdx >= 0) {
        storeData.items[existingIdx] = { ...storeData.items[existingIdx], ...cleanItem };
      } else {
        storeData.items.push(cleanItem);
      }

      const saved = await writeStoreDataToEnv(env, storeData);
      return new Response(JSON.stringify({ ok: true, item: cleanItem, storeData: saved }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    if (action === 'toggleItemStock') {
      const itemId = String(body.id || '').trim();
      const available = Boolean(body.available);
      const target = storeData.items.find((i: any) => i.id === itemId);
      if (!target) {
        return new Response(JSON.stringify({ error: 'Menu item not found.' }), {
          status: 404,
          headers: jsonHeaders,
        });
      }
      target.available = available;
      const saved = await writeStoreDataToEnv(env, storeData);
      return new Response(
        JSON.stringify({ ok: true, id: itemId, available, storeData: saved }),
        { status: 200, headers: jsonHeaders }
      );
    }

    if (action === 'deleteItem') {
      const itemId = String(body.id || '').trim();
      storeData.items = (storeData.items || []).filter((i: any) => i.id !== itemId);
      const saved = await writeStoreDataToEnv(env, storeData);
      return new Response(JSON.stringify({ ok: true, id: itemId, storeData: saved }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    if (action === 'saveCategory') {
      const rawCat = body.category || {};
      const name = String(rawCat.name || '').trim();
      if (!name) {
        return new Response(JSON.stringify({ error: 'Category name is required.' }), {
          status: 400,
          headers: jsonHeaders,
        });
      }
      const catId =
        rawCat.id && String(rawCat.id).trim()
          ? String(rawCat.id).trim()
          : name.toLowerCase().replace(/\s+/g, '-');

      const cleanCat = sanitizeRecord({
        id: catId,
        name,
        order:
          typeof rawCat.order === 'number'
            ? rawCat.order
            : (storeData.categories?.length || 0) + 1,
        description: rawCat.description ? String(rawCat.description).trim() : undefined,
      });

      const existingIdx = storeData.categories.findIndex((c: any) => c.id === catId);
      if (existingIdx >= 0) {
        storeData.categories[existingIdx] = { ...storeData.categories[existingIdx], ...cleanCat };
      } else {
        storeData.categories.push(cleanCat);
      }
      storeData.categories.sort((a: any, b: any) => (a.order ?? 99) - (b.order ?? 99));

      const saved = await writeStoreDataToEnv(env, storeData);
      return new Response(JSON.stringify({ ok: true, category: cleanCat, storeData: saved }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    if (action === 'deleteCategory') {
      const catId = String(body.id || '').trim();
      storeData.categories = (storeData.categories || []).filter((c: any) => c.id !== catId);
      const saved = await writeStoreDataToEnv(env, storeData);
      return new Response(JSON.stringify({ ok: true, id: catId, storeData: saved }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    if (action === 'updateSettings') {
      const currency = body.currency === 'LBP' ? 'LBP' : 'USD';
      const exchangeRate =
        typeof body.exchangeRate === 'number' && body.exchangeRate > 0
          ? body.exchangeRate
          : storeData.settings?.exchangeRate || 89000;
      storeData.settings = { currency, exchangeRate };
      const saved = await writeStoreDataToEnv(env, storeData);
      return new Response(
        JSON.stringify({ ok: true, settings: storeData.settings, storeData: saved }),
        { status: 200, headers: jsonHeaders }
      );
    }

    if (action === 'addAdminReview') {
      const rawRev = body.review || {};
      const author = stripHtmlTags(rawRev.author);
      const text = stripHtmlTags(rawRev.text);
      if (!author || !text) {
        return new Response(
          JSON.stringify({ error: 'Author and review text are required.' }),
          { status: 400, headers: jsonHeaders }
        );
      }
      const newReview = {
        id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        author,
        text,
        rating: Number(rawRev.rating) || 5,
        date:
          rawRev.date ||
          new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
        status: 'approved' as const,
      };
      storeData.reviews = [newReview, ...(storeData.reviews || [])];
      const saved = await writeStoreDataToEnv(env, storeData);
      return new Response(JSON.stringify({ ok: true, review: newReview, storeData: saved }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    if (action === 'updateReviewStatus') {
      const revId = String(body.id || '').trim();
      const status = body.status === 'approved' ? 'approved' : 'rejected';
      const target = (storeData.reviews || []).find((r: any) => r.id === revId);
      if (!target) {
        return new Response(JSON.stringify({ error: 'Review not found.' }), {
          status: 404,
          headers: jsonHeaders,
        });
      }
      target.status = status;
      const saved = await writeStoreDataToEnv(env, storeData);
      return new Response(JSON.stringify({ ok: true, id: revId, status, storeData: saved }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    if (action === 'deleteReview') {
      const revId = String(body.id || '').trim();
      storeData.reviews = (storeData.reviews || []).filter((r: any) => r.id !== revId);
      const saved = await writeStoreDataToEnv(env, storeData);
      return new Response(JSON.stringify({ ok: true, id: revId, storeData: saved }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    if (action === 'addAdminEmail') {
      const email = String(body.email || '')
        .trim()
        .toLowerCase();
      if (!email || !email.includes('@')) {
        return new Response(JSON.stringify({ error: 'Valid Gmail address is required.' }), {
          status: 400,
          headers: jsonHeaders,
        });
      }
      const newAdmin = {
        id: email,
        email,
        addedBy: authCheck.email || 'root-admin',
        createdAt: new Date().toISOString(),
      };
      const existingIdx = (storeData.admins || []).findIndex(
        (a: any) => String(a.email || '').toLowerCase() === email
      );
      if (existingIdx >= 0) {
        storeData.admins[existingIdx] = newAdmin;
      } else {
        storeData.admins = [...(storeData.admins || []), newAdmin];
      }
      const saved = await writeStoreDataToEnv(env, storeData);
      return new Response(JSON.stringify({ ok: true, admin: newAdmin, storeData: saved }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    if (action === 'removeAdminEmail') {
      const email = String(body.email || '')
        .trim()
        .toLowerCase();
      storeData.admins = (storeData.admins || []).filter(
        (a: any) => String(a.email || '').toLowerCase() !== email
      );
      const saved = await writeStoreDataToEnv(env, storeData);
      return new Response(JSON.stringify({ ok: true, email, storeData: saved }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    if (action === 'restoreBackup') {
      const backup = body.backupData || {};
      if (!Array.isArray(backup.items) || !Array.isArray(backup.categories)) {
        return new Response(
          JSON.stringify({
            error: 'Invalid backup file format: items and categories arrays are required.',
          }),
          { status: 400, headers: jsonHeaders }
        );
      }
      const restored = normalizeStoreData({
        ...storeData,
        ...backup,
      });
      const saved = await writeStoreDataToEnv(env, restored);
      return new Response(JSON.stringify({ ok: true, storeData: saved }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    return new Response(JSON.stringify({ error: `Unsupported action: ${action}` }), {
      status: 400,
      headers: jsonHeaders,
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message || 'Failed to update R2 store data' }),
      { status: 500, headers: jsonHeaders }
    );
  }
};
