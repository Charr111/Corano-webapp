import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import firebaseConfig from './firebase-applet-config.json';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const STORE_DATA_KEY = 'data/store-data.json';
const ROOT_ADMIN_EMAILS = ['apolokor@gmail.com', 'rony.daou83@gmail.com'];
const ALLOWED_UPLOAD_MIMES = ['image/webp', 'image/jpeg', 'image/png', 'image/avif'];
const MAX_UPLOAD_BYTES = 150 * 1024; // 150 KB hard cap for shrunk menu photos

const R2_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

interface R2RuntimeConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicBaseUrl: string;
}

function getR2Config(): R2RuntimeConfig {
  dotenv.config({ override: true });
  return {
    accountId: (process.env.R2_ACCOUNT_ID || '').trim(),
    accessKeyId: (process.env.R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: (process.env.R2_SECRET_ACCESS_KEY || '').trim(),
    bucketName: (process.env.R2_BUCKET_NAME || 'corano-images').trim(),
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || 'https://images.restocorano.com')
      .trim()
      .replace(/\/+$/, ''),
  };
}

function createR2Client(cfg: R2RuntimeConfig): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

function sanitizeFileName(rawName: string): string {
  const base = path.basename(rawName || 'image.webp');
  return base
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function stripHtmlTags(input: string): string {
  return String(input || '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function readLocalInitialSeed(): any {
  try {
    const seedPath = path.join(__dirname, 'src/data/initialStoreData.json');
    if (fs.existsSync(seedPath)) {
      return JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    }
  } catch (err) {
    console.warn('Warning reading local initialStoreData.json:', err);
  }
  return {
    version: Date.now(),
    updatedAt: new Date().toISOString(),
    settings: { currency: 'USD', exchangeRate: 89000 },
    categories: [],
    items: [],
    reviews: [],
    admins: [],
  };
}

function normalizeStoreData(raw: any): any {
  const fallback = readLocalInitialSeed();
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

async function readStoreDataFromR2(): Promise<any> {
  const cfg = getR2Config();
  if (cfg.accountId && cfg.accessKeyId && cfg.secretAccessKey) {
    const s3 = createR2Client(cfg);
    try {
      const getRes = await s3.send(
        new GetObjectCommand({
          Bucket: cfg.bucketName,
          Key: STORE_DATA_KEY,
        })
      );
      const bodyStr = await getRes.Body?.transformToString();
      if (bodyStr) {
        return normalizeStoreData(JSON.parse(bodyStr));
      }
    } catch (err: any) {
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
        const seed = readLocalInitialSeed();
        await writeStoreDataToR2(seed);
        return seed;
      }
      console.warn('Warning reading store-data.json from R2 S3, falling back:', err?.message);
    }
  }

  try {
    const pubRes = await fetch(`${cfg.publicBaseUrl}/${STORE_DATA_KEY}?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (pubRes.ok) {
      const data = await pubRes.json();
      return normalizeStoreData(data);
    }
  } catch {
    // ignore and use local seed
  }

  return readLocalInitialSeed();
}

async function writeStoreDataToR2(storeData: any): Promise<any> {
  const normalized = normalizeStoreData(storeData);
  normalized.version = Date.now();
  normalized.updatedAt = new Date().toISOString();

  try {
    const seedPath = path.join(__dirname, 'src/data/initialStoreData.json');
    fs.writeFileSync(seedPath, JSON.stringify(normalized, null, 2), 'utf-8');
  } catch {
    // Non-fatal in read-only filesystems
  }

  const cfg = getR2Config();
  if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error(
      'Missing Cloudflare R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).'
    );
  }

  const s3 = createR2Client(cfg);
  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.bucketName,
      Key: STORE_DATA_KEY,
      Body: Buffer.from(JSON.stringify(normalized), 'utf-8'),
      ContentType: 'application/json',
      CacheControl: 'no-cache, must-revalidate',
    })
  );

  return normalized;
}

async function verifyAdminAuthorization(
  authHeader: string | undefined,
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

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '15mb' }));

  // Preflight CORS for R2 endpoints
  app.options('/api/r2-upload', (_req, res) => {
    res.set(R2_CORS_HEADERS).status(204).end();
  });

  app.options('/api/r2-status', (_req, res) => {
    res.set(R2_CORS_HEADERS).status(204).end();
  });

  app.options('/api/r2-config', (_req, res) => {
    res.set(R2_CORS_HEADERS).status(204).end();
  });

  app.options('/api/r2-data', (_req, res) => {
    res.set(R2_CORS_HEADERS).status(204).end();
  });

  // GET /api/r2-data -> Returns sanitized public store data unless a valid Admin Bearer token is provided
  app.get('/api/r2-data', async (req, res) => {
    res.set({
      ...R2_CORS_HEADERS,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    try {
      const storeData = await readStoreDataFromR2();
      const authHeader = req.headers.authorization;
      if (authHeader) {
        const authCheck = await verifyAdminAuthorization(authHeader, storeData);
        if (authCheck.ok) {
          return res.status(200).json(storeData);
        }
      }
      return res.status(200).json(sanitizePublicStoreData(storeData));
    } catch (error: any) {
      console.error('Error reading R2 store data:', error);
      return res.status(500).json({ error: error?.message || 'Failed to read R2 store data' });
    }
  });

  // POST /api/r2-data -> Atomic server-side action patching (Multi-Admin Safe)
  app.post('/api/r2-data', async (req, res) => {
    res.set({
      ...R2_CORS_HEADERS,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });

    try {
      const body = req.body || {};
      const action = String(body.action || '').trim();
      if (!action) {
        return res.status(400).json({ error: 'Missing required action parameter.' });
      }

      const storeData = await readStoreDataFromR2();

      // 1. Public Action: Customer Review Submission (No Admin token required, strict XSS/spam protection)
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
          return res.status(400).json({
            error:
              'Valid name (max 60 chars), review text (max 500 chars), and integer rating (1-5) are required.',
          });
        }

        const pendingCount = (storeData.reviews || []).filter(
          (r: any) => r.status === 'pending'
        ).length;
        if (pendingCount >= 50) {
          return res.status(429).json({
            error: 'Maximum number of pending reviews reached. Please try again later.',
          });
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
        const saved = await writeStoreDataToR2(storeData);
        return res.status(200).json({
          ok: true,
          review: newReview,
          storeData: sanitizePublicStoreData(saved),
        });
      }

      // 2. All other actions require verified Google Admin authorization
      const authCheck = await verifyAdminAuthorization(req.headers.authorization, storeData);
      if (!authCheck.ok) {
        return res.status(403).json({ error: authCheck.error || 'Unauthorized admin request.' });
      }

      if (action === 'saveItem') {
        const rawItem = body.item || {};
        const title = String(rawItem.title || '').trim();
        const price = String(rawItem.price || '').trim();
        const category = String(rawItem.category || 'subs').trim().toLowerCase();

        if (!title || !price) {
          return res.status(400).json({ error: 'Product title and price are required.' });
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
          popular: Boolean(rawItem.popular),
        });

        const existingIdx = storeData.items.findIndex((i: any) => i.id === itemId);
        if (existingIdx >= 0) {
          storeData.items[existingIdx] = { ...storeData.items[existingIdx], ...cleanItem };
        } else {
          storeData.items.push(cleanItem);
        }

        const saved = await writeStoreDataToR2(storeData);
        return res.status(200).json({ ok: true, item: cleanItem, storeData: saved });
      }

      if (action === 'toggleItemStock') {
        const itemId = String(body.id || '').trim();
        const available = Boolean(body.available);
        const target = storeData.items.find((i: any) => i.id === itemId);
        if (!target) {
          return res.status(404).json({ error: 'Menu item not found.' });
        }
        target.available = available;
        const saved = await writeStoreDataToR2(storeData);
        return res.status(200).json({ ok: true, id: itemId, available, storeData: saved });
      }

      if (action === 'toggleItemPopular') {
        const itemId = String(body.id || '').trim();
        const popular = Boolean(body.popular);
        const target = storeData.items.find((i: any) => i.id === itemId);
        if (!target) {
          return res.status(404).json({ error: 'Menu item not found.' });
        }
        target.popular = popular;
        const saved = await writeStoreDataToR2(storeData);
        return res.status(200).json({ ok: true, id: itemId, popular, storeData: saved });
      }

      if (action === 'deleteItem') {
        const itemId = String(body.id || '').trim();
        storeData.items = (storeData.items || []).filter((i: any) => i.id !== itemId);
        const saved = await writeStoreDataToR2(storeData);
        return res.status(200).json({ ok: true, id: itemId, storeData: saved });
      }

      if (action === 'saveCategory') {
        const rawCat = body.category || {};
        const name = String(rawCat.name || '').trim();
        if (!name) {
          return res.status(400).json({ error: 'Category name is required.' });
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
          storeData.categories[existingIdx] = {
            ...storeData.categories[existingIdx],
            ...cleanCat,
          };
        } else {
          storeData.categories.push(cleanCat);
        }
        storeData.categories.sort((a: any, b: any) => (a.order ?? 99) - (b.order ?? 99));

        const saved = await writeStoreDataToR2(storeData);
        return res.status(200).json({ ok: true, category: cleanCat, storeData: saved });
      }

      if (action === 'deleteCategory') {
        const catId = String(body.id || '').trim();
        storeData.categories = (storeData.categories || []).filter((c: any) => c.id !== catId);
        const saved = await writeStoreDataToR2(storeData);
        return res.status(200).json({ ok: true, id: catId, storeData: saved });
      }

      if (action === 'updateSettings') {
        const currency = body.currency === 'LBP' ? 'LBP' : 'USD';
        const exchangeRate =
          typeof body.exchangeRate === 'number' && body.exchangeRate > 0
            ? body.exchangeRate
            : storeData.settings?.exchangeRate || 89000;
        storeData.settings = { currency, exchangeRate };
        const saved = await writeStoreDataToR2(storeData);
        return res.status(200).json({ ok: true, settings: storeData.settings, storeData: saved });
      }

      if (action === 'addAdminReview') {
        const rawRev = body.review || {};
        const author = stripHtmlTags(rawRev.author);
        const text = stripHtmlTags(rawRev.text);
        if (!author || !text) {
          return res.status(400).json({ error: 'Author and review text are required.' });
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
        const saved = await writeStoreDataToR2(storeData);
        return res.status(200).json({ ok: true, review: newReview, storeData: saved });
      }

      if (action === 'updateReviewStatus') {
        const revId = String(body.id || '').trim();
        const status = body.status === 'approved' ? 'approved' : 'rejected';
        const target = (storeData.reviews || []).find((r: any) => r.id === revId);
        if (!target) {
          return res.status(404).json({ error: 'Review not found.' });
        }
        target.status = status;
        const saved = await writeStoreDataToR2(storeData);
        return res.status(200).json({ ok: true, id: revId, status, storeData: saved });
      }

      if (action === 'deleteReview') {
        const revId = String(body.id || '').trim();
        storeData.reviews = (storeData.reviews || []).filter((r: any) => r.id !== revId);
        const saved = await writeStoreDataToR2(storeData);
        return res.status(200).json({ ok: true, id: revId, storeData: saved });
      }

      if (action === 'addAdminEmail') {
        const email = String(body.email || '')
          .trim()
          .toLowerCase();
        if (!email || !email.includes('@')) {
          return res.status(400).json({ error: 'Valid Gmail address is required.' });
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
        const saved = await writeStoreDataToR2(storeData);
        return res.status(200).json({ ok: true, admin: newAdmin, storeData: saved });
      }

      if (action === 'removeAdminEmail') {
        const email = String(body.email || '')
          .trim()
          .toLowerCase();
        storeData.admins = (storeData.admins || []).filter(
          (a: any) => String(a.email || '').toLowerCase() !== email
        );
        const saved = await writeStoreDataToR2(storeData);
        return res.status(200).json({ ok: true, email, storeData: saved });
      }

      if (action === 'restoreBackup') {
        const backup = body.backupData || {};
        if (!Array.isArray(backup.items) || !Array.isArray(backup.categories)) {
          return res.status(400).json({
            error: 'Invalid backup file format: items and categories arrays are required.',
          });
        }
        const restored = normalizeStoreData({
          ...storeData,
          ...backup,
        });
        const saved = await writeStoreDataToR2(restored);
        return res.status(200).json({ ok: true, storeData: saved });
      }

      return res.status(400).json({ error: `Unsupported action: ${action}` });
    } catch (error: any) {
      console.error('Error processing /api/r2-data POST:', error);
      return res.status(500).json({ error: error?.message || 'Failed to update R2 store data' });
    }
  });

  // Check R2 configuration status
  app.get('/api/r2-status', (_req, res) => {
    res.set(R2_CORS_HEADERS);
    const cfg = getR2Config();
    const missingVars: string[] = [];
    if (!cfg.accountId) missingVars.push('R2_ACCOUNT_ID');
    if (!cfg.accessKeyId) missingVars.push('R2_ACCESS_KEY_ID');
    if (!cfg.secretAccessKey) missingVars.push('R2_SECRET_ACCESS_KEY');

    res.json({
      configured: missingVars.length === 0,
      bucketName: cfg.bucketName,
      publicBaseUrl: cfg.publicBaseUrl,
      accountIdPreview: cfg.accountId ? `${cfg.accountId.slice(0, 6)}...` : '',
      missingVars,
    });
  });

  // Allow saving R2 credentials from Admin UI into .env and process.env if not yet set
  app.post('/api/r2-config', async (req, res) => {
    res.set(R2_CORS_HEADERS);
    try {
      const storeData = await readStoreDataFromR2();
      const authCheck = await verifyAdminAuthorization(req.headers.authorization, storeData);
      if (!authCheck.ok) {
        return res.status(403).json({ error: authCheck.error || 'Unauthorized admin request.' });
      }

      const { accountId, accessKeyId, secretAccessKey, bucketName, publicBaseUrl } = req.body || {};
      if (!accountId || !accessKeyId || !secretAccessKey) {
        return res
          .status(400)
          .json({ error: 'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required.' });
      }

      process.env.R2_ACCOUNT_ID = String(accountId).trim();
      process.env.R2_ACCESS_KEY_ID = String(accessKeyId).trim();
      process.env.R2_SECRET_ACCESS_KEY = String(secretAccessKey).trim();
      process.env.R2_BUCKET_NAME = String(bucketName || 'corano-images').trim();
      process.env.R2_PUBLIC_BASE_URL = String(
        publicBaseUrl || 'https://images.restocorano.com'
      )
        .trim()
        .replace(/\/+$/, '');

      const envPath = path.join(__dirname, '.env');
      let existingEnv = '';
      if (fs.existsSync(envPath)) {
        existingEnv = fs.readFileSync(envPath, 'utf-8');
      }
      const envLines = existingEnv
        .split('\n')
        .filter(
          (line) =>
            !line.startsWith('R2_ACCOUNT_ID=') &&
            !line.startsWith('R2_ACCESS_KEY_ID=') &&
            !line.startsWith('R2_SECRET_ACCESS_KEY=') &&
            !line.startsWith('R2_BUCKET_NAME=') &&
            !line.startsWith('R2_PUBLIC_BASE_URL=')
        );
      envLines.push(`R2_ACCOUNT_ID=${process.env.R2_ACCOUNT_ID}`);
      envLines.push(`R2_ACCESS_KEY_ID=${process.env.R2_ACCESS_KEY_ID}`);
      envLines.push(`R2_SECRET_ACCESS_KEY=${process.env.R2_SECRET_ACCESS_KEY}`);
      envLines.push(`R2_BUCKET_NAME=${process.env.R2_BUCKET_NAME}`);
      envLines.push(`R2_PUBLIC_BASE_URL=${process.env.R2_PUBLIC_BASE_URL}`);
      fs.writeFileSync(envPath, envLines.filter(Boolean).join('\n') + '\n', 'utf-8');

      return res.json({
        ok: true,
        configured: true,
        bucketName: process.env.R2_BUCKET_NAME,
        publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
      });
    } catch (error: any) {
      console.error('Error saving R2 config:', error);
      return res.status(500).json({ error: error?.message || 'Failed to save R2 configuration' });
    }
  });

  // Proxy image download helper
  app.get('/api/proxy-image', async (req, res) => {
    res.set(R2_CORS_HEADERS);
    try {
      const targetUrl = String(req.query.url || '');
      if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        return res.status(400).json({ error: 'Valid image URL required' });
      }
      const upstream = await fetch(targetUrl, {
        headers: {
          Accept: 'image/webp,image/avif,image/*,*/*;q=0.8',
          'User-Agent': 'CoranoMigrationBot/1.0',
        },
      });
      if (!upstream.ok) {
        return res
          .status(upstream.status)
          .json({ error: `Upstream image fetch failed (${upstream.status})` });
      }
      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      const arrayBuf = await upstream.arrayBuffer();
      res.set('Content-Type', contentType);
      return res.send(Buffer.from(arrayBuf));
    } catch (error: any) {
      console.error('Proxy image error:', error);
      return res.status(500).json({ error: error?.message || 'Failed to proxy image' });
    }
  });

  // Main Cloudflare R2 Image Upload Endpoint (Protected by Admin Bearer Token + MIME & 150 KB Size Cap)
  app.post('/api/r2-upload', async (req, res) => {
    res.set(R2_CORS_HEADERS);
    try {
      const storeData = await readStoreDataFromR2();
      const authCheck = await verifyAdminAuthorization(req.headers.authorization, storeData);
      if (!authCheck.ok) {
        return res.status(403).json({
          error: authCheck.error || 'Unauthorized photo upload attempt.',
        });
      }

      const cfg = getR2Config();
      if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey) {
        return res.status(400).json({
          error:
            'Cloudflare R2 credentials are not configured yet. Please enter R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.',
        });
      }

      const { fileName, contentType, base64Data, oldImageUrl, skipDeleteOld } = req.body || {};
      if (!fileName || !base64Data) {
        return res.status(400).json({ error: 'Missing required fields: fileName and base64Data' });
      }

      const finalContentType = String(contentType || 'image/webp').toLowerCase().trim();
      if (!ALLOWED_UPLOAD_MIMES.includes(finalContentType)) {
        return res.status(400).json({
          error: `Unsupported image MIME type: ${finalContentType}. Allowed: WebP, JPEG, PNG, AVIF.`,
        });
      }

      const cleanFileName = sanitizeFileName(fileName);
      const objectKey = `items/${cleanFileName}`;
      const normalizedBase64 = String(base64Data).replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(normalizedBase64, 'base64');

      if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
        return res.status(400).json({
          error: `Image size (${Math.round(buffer.length / 1024)} KB) exceeds the 150 KB maximum limit for menu items.`,
        });
      }

      const s3 = createR2Client(cfg);

      await s3.send(
        new PutObjectCommand({
          Bucket: cfg.bucketName,
          Key: objectKey,
          Body: buffer,
          ContentType: finalContentType,
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );

      const r2Prefix = `${cfg.publicBaseUrl}/items/`;
      if (
        !skipDeleteOld &&
        oldImageUrl &&
        typeof oldImageUrl === 'string' &&
        oldImageUrl.startsWith(r2Prefix)
      ) {
        const oldFileName = oldImageUrl.slice(r2Prefix.length).split('?')[0];
        const oldKey = `items/${sanitizeFileName(oldFileName)}`;
        if (oldKey && oldKey !== objectKey) {
          try {
            await s3.send(
              new DeleteObjectCommand({
                Bucket: cfg.bucketName,
                Key: oldKey,
              })
            );
          } catch (delErr) {
            console.warn('Non-fatal warning deleting old R2 object:', oldKey, delErr);
          }
        }
      }

      const publicUrl = `${cfg.publicBaseUrl}/${objectKey}`;
      return res.status(200).json({
        url: publicUrl,
        key: objectKey,
        sizeBytes: buffer.length,
      });
    } catch (error: any) {
      console.error('R2 upload error:', error);
      return res.status(500).json({
        error: error?.message || 'Failed to upload image to Cloudflare R2',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await viteConfigServer(createViteServer);
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

async function viteConfigServer(createViteServer: any) {
  return createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
}

startServer();
