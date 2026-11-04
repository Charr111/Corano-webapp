import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

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

// Runtime config state (reads from process.env and can also be updated via /api/r2-config)
function getR2Config(): R2RuntimeConfig {
  dotenv.config({ override: true });
  return {
    accountId: (process.env.R2_ACCOUNT_ID || '').trim(),
    accessKeyId: (process.env.R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: (process.env.R2_SECRET_ACCESS_KEY || '').trim(),
    bucketName: (process.env.R2_BUCKET_NAME || 'corano-images').trim(),
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || 'https://images.restocorano.com').trim().replace(/\/+$/, ''),
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

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

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
  app.post('/api/r2-config', (req, res) => {
    res.set(R2_CORS_HEADERS);
    try {
      const { accountId, accessKeyId, secretAccessKey, bucketName, publicBaseUrl } = req.body || {};
      if (!accountId || !accessKeyId || !secretAccessKey) {
        return res.status(400).json({ error: 'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required.' });
      }

      process.env.R2_ACCOUNT_ID = String(accountId).trim();
      process.env.R2_ACCESS_KEY_ID = String(accessKeyId).trim();
      process.env.R2_SECRET_ACCESS_KEY = String(secretAccessKey).trim();
      process.env.R2_BUCKET_NAME = String(bucketName || 'corano-images').trim();
      process.env.R2_PUBLIC_BASE_URL = String(publicBaseUrl || 'https://image.restocorano.com').trim().replace(/\/+$/, '');

      // Persist to local .env so restarts keep the credentials
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

  // Proxy image download helper for migration fallback if browser CORS is blocked
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
        return res.status(upstream.status).json({ error: `Upstream image fetch failed (${upstream.status})` });
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

  // Main Cloudflare R2 Upload Endpoint
  app.post('/api/r2-upload', async (req, res) => {
    res.set(R2_CORS_HEADERS);
    try {
      const cfg = getR2Config();
      if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey) {
        return res.status(400).json({
          error:
            'Cloudflare R2 credentials are not configured yet. Please enter R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in the Admin R2 Setup panel or AI Studio Secrets.',
        });
      }

      const { fileName, contentType, base64Data, oldImageUrl, skipDeleteOld } = req.body || {};
      if (!fileName || !base64Data) {
        return res.status(400).json({ error: 'Missing required fields: fileName and base64Data' });
      }

      const cleanFileName = sanitizeFileName(fileName);
      const objectKey = `items/${cleanFileName}`;
      const normalizedBase64 = String(base64Data).replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(normalizedBase64, 'base64');

      const s3 = createR2Client(cfg);

      await s3.send(
        new PutObjectCommand({
          Bucket: cfg.bucketName,
          Key: objectKey,
          Body: buffer,
          ContentType: contentType || 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );

      // Clean up replaced old R2 object if applicable and safe
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
