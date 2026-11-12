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
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const STORE_DATA_KEY = 'data/store-data.json';
const AI_CONVERSATIONS_KEY = 'data/ai-conversations.json';
const MAX_AI_CONVERSATIONS = 30;
const ROOT_ADMIN_EMAILS = ['apolokor@gmail.com'];
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
      aiEnabled: raw.settings?.aiEnabled !== false,
      aiBubbleLabel:
        typeof raw.settings?.aiBubbleLabel === 'string' && raw.settings.aiBubbleLabel.trim()
          ? stripHtmlTags(raw.settings.aiBubbleLabel).slice(0, 28)
          : 'Corano AI',
      promoBannerEnabled: raw.settings?.promoBannerEnabled === true,
      promoBannerUrl:
        typeof raw.settings?.promoBannerUrl === 'string' ? raw.settings.promoBannerUrl.trim() : '',
      promoBannerDelaySeconds:
        typeof raw.settings?.promoBannerDelaySeconds === 'number' &&
        raw.settings.promoBannerDelaySeconds >= 0 &&
        raw.settings.promoBannerDelaySeconds <= 60
          ? Math.round(raw.settings.promoBannerDelaySeconds)
          : 2,
      promoBannerMaxPerDay:
        typeof raw.settings?.promoBannerMaxPerDay === 'number' &&
        raw.settings.promoBannerMaxPerDay >= 0 &&
        raw.settings.promoBannerMaxPerDay <= 20
          ? Math.round(raw.settings.promoBannerMaxPerDay)
          : 2,
      promoBannerClickToMenu: raw.settings?.promoBannerClickToMenu !== false,
      promoBannerTargetUrl:
        typeof raw.settings?.promoBannerTargetUrl === 'string' && raw.settings.promoBannerTargetUrl.trim().length > 0
          ? raw.settings.promoBannerTargetUrl.trim()
          : '/menu',
      promoBannerDiscountEnabled: raw.settings?.promoBannerDiscountEnabled === true,
      promoBannerDiscountType:
        raw.settings?.promoBannerDiscountType === 'fixed' ? 'fixed' : 'percent',
      promoBannerDiscountValue:
        typeof raw.settings?.promoBannerDiscountValue === 'number' &&
        Number.isFinite(raw.settings.promoBannerDiscountValue) &&
        raw.settings.promoBannerDiscountValue >= 0
          ? Math.round(raw.settings.promoBannerDiscountValue * 100) / 100
          : 0,
      activePromoBannerId:
        typeof raw.settings?.activePromoBannerId === 'string'
          ? raw.settings.activePromoBannerId.trim()
          : '',
      savedPromoBanners: Array.isArray(raw.settings?.savedPromoBanners)
        ? raw.settings.savedPromoBanners
            .filter((b: any) => b && typeof b.imgUrl === 'string' && b.imgUrl.trim().length > 0)
            .slice(0, 15)
            .map((b: any) => ({
              id: String(b.id || `banner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
              label: typeof b.label === 'string' ? stripHtmlTags(b.label).slice(0, 60) : '',
              imgUrl: String(b.imgUrl).trim(),
              delaySeconds:
                typeof b.delaySeconds === 'number' && b.delaySeconds >= 0 && b.delaySeconds <= 60
                  ? Math.round(b.delaySeconds)
                  : 2,
              maxPerDay:
                typeof b.maxPerDay === 'number' && b.maxPerDay >= 0 && b.maxPerDay <= 20
                  ? Math.round(b.maxPerDay)
                  : 2,
              clickToMenu: b.clickToMenu !== false,
              targetUrl:
                typeof b.targetUrl === 'string' && b.targetUrl.trim().length > 0
                  ? b.targetUrl.trim()
                  : '/menu',
              discountEnabled: b.discountEnabled === true,
              discountType: b.discountType === 'fixed' ? 'fixed' : 'percent',
              discountValue:
                typeof b.discountValue === 'number' &&
                Number.isFinite(b.discountValue) &&
                b.discountValue >= 0
                  ? Math.round(b.discountValue * 100) / 100
                  : 0,
              sizeBadge: typeof b.sizeBadge === 'string' ? stripHtmlTags(b.sizeBadge).slice(0, 60) : '',
              createdAt:
                typeof b.createdAt === 'string' && b.createdAt.trim()
                  ? b.createdAt.trim()
                  : new Date().toISOString(),
            }))
        : [],
    },
    categories: Array.isArray(raw.categories) ? raw.categories : fallback.categories || [],
    items: (Array.isArray(raw.items) ? raw.items : fallback.items || []).map((it: any) => {
      const idLower = String(it?.id || '').toLowerCase().trim();
      const titleLower = String(it?.title || '').toLowerCase().trim();
      if (idLower === 'truffle-burger' || titleLower === 'truffle burger') {
        return { ...it, isNew: false };
      }
      return it;
    }),
    reviews: Array.isArray(raw.reviews) ? raw.reviews : fallback.reviews || [],
    removedAdmins: Array.isArray(raw.removedAdmins) ? raw.removedAdmins : [],
    admins: (() => {
      const baseAdmins = Array.isArray(raw.admins) ? [...raw.admins] : [...(fallback.admins || [])];
      const removed = Array.isArray(raw.removedAdmins)
        ? raw.removedAdmins.map((e: any) => String(e || '').trim().toLowerCase())
        : [];
      const hasRony = baseAdmins.some(
        (a: any) => String(a?.email || '').trim().toLowerCase() === 'rony.daou83@gmail.com'
      );
      if (!hasRony && !removed.includes('rony.daou83@gmail.com')) {
        baseAdmins.unshift({
          id: 'rony.daou83@gmail.com',
          email: 'rony.daou83@gmail.com',
          addedBy: 'apolokor@gmail.com',
          createdAt: '2026-11-05T12:04:09.334Z',
        });
      }
      return baseAdmins;
    })(),
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

async function readAiConversationsFromR2(): Promise<any[]> {
  const cfg = getR2Config();
  if (cfg.accountId && cfg.accessKeyId && cfg.secretAccessKey) {
    try {
      const s3 = createR2Client(cfg);
      const getRes = await s3.send(
        new GetObjectCommand({
          Bucket: cfg.bucketName,
          Key: AI_CONVERSATIONS_KEY,
        })
      );
      const bodyStr = await getRes.Body?.transformToString();
      if (bodyStr) {
        const parsed = JSON.parse(bodyStr);
        if (Array.isArray(parsed)) return parsed;
        if (Array.isArray(parsed?.conversations)) return parsed.conversations;
      }
    } catch (err: any) {
      if (err?.name !== 'NoSuchKey' && err?.$metadata?.httpStatusCode !== 404) {
        console.warn('Warning reading ai-conversations.json from R2:', err?.message);
      }
    }
  }
  return [];
}

async function writeAiConversationsToR2(conversations: any[]): Promise<void> {
  const cfg = getR2Config();
  if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey) return;
  const s3 = createR2Client(cfg);
  const safeList = Array.isArray(conversations)
    ? conversations.slice(0, MAX_AI_CONVERSATIONS)
    : [];
  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.bucketName,
      Key: AI_CONVERSATIONS_KEY,
      Body: Buffer.from(JSON.stringify(safeList), 'utf-8'),
      ContentType: 'application/json',
      CacheControl: 'no-cache, no-store, must-revalidate',
    })
  );
}

function roundToCleanLbpServer(rawLbp: number): number {
  const rounded = Math.round(rawLbp);
  if (rounded === 712000) return 700000;
  if (rounded >= 10000) {
    return Math.round(rounded / 10000) * 10000;
  }
  return rounded;
}

function formatItemPriceForAi(
  rawPrice: string | number | undefined,
  currency: 'USD' | 'LBP',
  rate: number = 89000
): string {
  const str = String(rawPrice ?? '').trim();
  if (!str) return currency === 'LBP' ? '0 L.L.' : '$0';
  if (currency === 'USD') {
    return `$${str.replace(/^\$/, '')}`;
  }
  const cleanUsd = str.replace(/\$/g, '').trim();
  const converted = cleanUsd.replace(/\d+(?:\.\d+)?/g, (match) => {
    const num = parseFloat(match);
    if (isNaN(num)) return match;
    return roundToCleanLbpServer(num * rate).toLocaleString('en-US');
  });
  return `${converted} L.L.`;
}

function normalizeLebaneseFrancoText(input: string): string {
  return String(input || '')
    .toLowerCase()
    .split(/(\s+)/)
    .map((token) => {
      if (!/[a-z]/i.test(token) || /^7up$/i.test(token)) return token;
      return token
        .replace(/7/g, 'h')
        .replace(/3/g, 'a')
        .replace(/2/g, 'a')
        .replace(/5/g, 'kh')
        .replace(/8/g, 'gh')
        .replace(/9/g, 's');
    })
    .join('');
}

function expandLebaneseFrancoToken(word: string): string[] {
  const w = word.toLowerCase().trim();
  if (!w) return [];
  const variants = new Set<string>([w]);
  if (/[235789]/.test(w) && !/^7up$/i.test(w)) {
    variants.add(
      w
        .replace(/7/g, 'h')
        .replace(/3/g, 'a')
        .replace(/2/g, 'a')
        .replace(/5/g, 'kh')
        .replace(/8/g, 'gh')
        .replace(/9/g, 's')
    );
    variants.add(
      w
        .replace(/7/g, 'h')
        .replace(/3/g, 'aa')
        .replace(/2/g, 'q')
        .replace(/5/g, 'kh')
        .replace(/8/g, 'gh')
        .replace(/9/g, 's')
    );
    variants.add(
      w
        .replace(/7/g, 'h')
        .replace(/3/g, 'a')
        .replace(/2/g, 'k')
        .replace(/5/g, 'kh')
        .replace(/8/g, 'gh')
        .replace(/9/g, 's')
    );
  }

  for (const v of Array.from(variants)) {
    if (
      v === 'hommos' ||
      v === 'homos' ||
      v === 'hummus' ||
      v === 'humus' ||
      v === '7ommos' ||
      v === '7omos' ||
      v === '7ummus' ||
      v === 'حمص'
    ) {
      variants.add('hummus');
      variants.add('hommos');
      variants.add('homos');
      variants.add('humus');
    } else if (v === 'toum' || v === 'thoum' || v === 'tom' || v === 'garlic' || v === 'ثوم' || v === 'توم') {
      variants.add('garlic');
      variants.add('toum');
    } else if (
      v === 'sandwiche' ||
      v === 'sandwish' ||
      v === 'sandwiches' ||
      v === 'sando' ||
      v === 'sandos' ||
      v === 'pita' ||
      v === '3arabi' ||
      v === 'aarabi' ||
      v === 'سندويش' ||
      v === 'ساندويش' ||
      v === 'عربي'
    ) {
      variants.add('sandwich');
    } else if (
      v === 'baguette' ||
      v === 'franje' ||
      v === 'frenji' ||
      v === 'sub' ||
      v === 'subs' ||
      v === 'باجيت' ||
      v === 'افرنجي' ||
      v === 'ساب'
    ) {
      variants.add('sub');
    } else if (
      v === 'sajj' ||
      v === 'saj' ||
      v === 'markouk' ||
      v === 'mar2ouk' ||
      v === 'صاج' ||
      v === 'مرقوق'
    ) {
      variants.add('sajj');
      variants.add('saj');
    } else if (v === 'asmar' || v === '2asmar' || v === 'أسمر' || v === 'اسمر') {
      variants.add('brown');
    } else if (v === 'mayo' || v === 'mayonnaise' || v === 'مايونيز' || v === 'مايو') {
      variants.add('mayo');
      variants.add('mayonnaise');
    } else if (v === 'debes' || v === 'debs' || v === 'remen' || v === 'remmen' || v === 'دبس') {
      variants.add('debes');
      variants.add('debs');
      variants.add('remen');
      variants.add('remmen');
    } else if (v === 'kabis' || v === 'kabbis' || v === 'pickle' || v === 'pickles' || v === 'كبيس') {
      variants.add('kabis');
      variants.add('pickles');
    } else if (
      v === 'jou3an' ||
      v === 'jouaan' ||
      v === 'joo3an' ||
      v === 'jou3ane' ||
      v === 'ji3t' ||
      v === 'yshabbe3' ||
      v === 'yshabe3' ||
      v === 'yshebbe3' ||
      v === 'mshabbe3' ||
      v === 't2il' ||
      v === 't2ile' ||
      v === 'tkil' ||
      v === 'tkile' ||
      v === 'dsem' ||
      v === 'dasm' ||
      v === 'mdebbas' ||
      v === 'جوعان' ||
      v === 'يشبع' ||
      v === 'تقيلة' ||
      v === 'دسم'
    ) {
      variants.add('filling');
    } else if (
      v === 'ghada' ||
      v === '8ada' ||
      v === 'sheghel' ||
      v === 'shoghol' ||
      v === 'talabiyye' ||
      v === 'sari3' ||
      v === 'mashshi' ||
      v === 'lunch' ||
      v === 'office' ||
      v === 'غدا' ||
      v === 'شغل' ||
      v === 'طلبية' ||
      v === 'عالسريع'
    ) {
      variants.add('lunch');
    } else if (
      v === '3asha' ||
      v === 'aasha' ||
      v === 'sahar' ||
      v === 'sahseha' ||
      v === 'عشا' ||
      v === 'سهر'
    ) {
      variants.add('dinner');
    } else if (
      v === 'sfine' ||
      v === 'sfinet' ||
      v === 'sfineh' ||
      v === 'سفينة'
    ) {
      variants.add('breast');
      variants.add('charcoal');
    } else if (
      v === 'fahem' ||
      v === 'fa7em' ||
      v === 'fahm' ||
      v === 'fa7m' ||
      v === 'عالفحم' ||
      v === 'فحم'
    ) {
      variants.add('charcoal');
      variants.add('fahem');
    } else if (
      v === 'pane' ||
      v === 'paneh' ||
      v === 'بانيه'
    ) {
      variants.add('pane');
      variants.add('crispy');
    } else if (
      v === 'm2armash' ||
      v === 'ma2armash' ||
      v === 'mkarmash' ||
      v === 'ma2li' ||
      v === 'makli' ||
      v === 'crunchy' ||
      v === 'مقرمش' ||
      v === 'مقلي'
    ) {
      variants.add('crispy');
    } else if (
      v === 'say7a' ||
      v === 'sayha' ||
      v === 'سايحة'
    ) {
      variants.add('cheese');
      variants.add('cheddar');
      variants.add('mozzarella');
    } else if (
      v === 'dazzine' ||
      v === 'dazine' ||
      v === 'dozen' ||
      v === 'دزينة'
    ) {
      variants.add('dozen');
    } else if (
      v === 'rkakat' ||
      v === 'rakakat' ||
      v === 'r2a2at' ||
      v === 'رقاقات'
    ) {
      variants.add('cheese');
      variants.add('rolls');
      variants.add('dozen');
    } else if (
      v === 'mo3ajanet' ||
      v === 'mouajanet' ||
      v === 'mshakale' ||
      v === 'mchakale' ||
      v === 'معجنات'
    ) {
      variants.add('mouajanet');
      variants.add('mchakale');
    } else if (
      v === 'wara2' ||
      v === 'warak' ||
      v === '3enab' ||
      v === 'enab' ||
      v === 'yalanji' ||
      v === 'ورق' ||
      v === 'عنب'
    ) {
      variants.add('wara2');
      variants.add('3enab');
    } else if (
      v === 'sawda' ||
      v === 'sawdet' ||
      v === 'asabe' ||
      v === 'liver' ||
      v === 'سودة' ||
      v === 'كبدة'
    ) {
      variants.add('liver');
      variants.add('sawda');
    } else if (
      v === 'makanek' ||
      v === 'ma2anek' ||
      v === 'makanik' ||
      v === 'مقانق'
    ) {
      variants.add('makanek');
    } else if (
      v === 'soujouk' ||
      v === 'sujuk' ||
      v === 'sojok' ||
      v === 'سجق'
    ) {
      variants.add('soujouk');
    } else if (
      v === '8anam' ||
      v === 'ghanam' ||
      v === 'sheep' ||
      v === 'lamb' ||
      v === 'غنم'
    ) {
      variants.add('ghanam');
      variants.add('sheep');
      variants.add('lahme');
    } else if (
      v === 'tarator' ||
      v === 'tahini' ||
      v === 'طراطور' ||
      v === 'طحينة'
    ) {
      variants.add('tarator');
      variants.add('falafel');
    } else if (
      v === 'jarjir' ||
      v === 'jarjeer' ||
      v === 'rocca' ||
      v === 'جرجير' ||
      v === 'روكا'
    ) {
      variants.add('rocca');
      variants.add('quinoa');
    } else if (
      v === 'shmandar' ||
      v === 'beetroot' ||
      v === 'شمندر'
    ) {
      variants.add('beetroot');
      variants.add('quinoa');
    } else if (
      v === 'jawz' ||
      v === 'walnut' ||
      v === 'جوز'
    ) {
      variants.add('walnut');
      variants.add('quinoa');
    } else if (
      v === 'ardishoke' ||
      v === 'artichoke' ||
      v === 'أرضي'
    ) {
      variants.add('artichoke');
      variants.add('corano');
    } else if (
      v === 'asperges' ||
      v === 'asparagus' ||
      v === 'هليون'
    ) {
      variants.add('asperges');
      variants.add('corano');
    } else if (
      v === 'habash' ||
      v === '7abash' ||
      v === 'turkey' ||
      v === 'حبش'
    ) {
      variants.add('turkey');
    } else if (
      v === 'dura' ||
      v === 'doura' ||
      v === 'corn' ||
      v === 'ذرة'
    ) {
      variants.add('corn');
    } else if (
      v === 'salameh' ||
      v === 'salami' ||
      v === 'jambon' ||
      v === 'ham' ||
      v === 'سلامي' ||
      v === 'جامبون'
    ) {
      variants.add('salameh');
      variants.add('ham');
    } else if (
      v === 'wled' ||
      v === 'awled' ||
      v === 'walad' ||
      v === 'kids' ||
      v === 'children' ||
      v === 'أولاد' ||
      v === 'ولاد'
    ) {
      variants.add('kids');
    } else if (
      v === '3ayran' ||
      v === 'ayran' ||
      v === 'aayran' ||
      v === 'laban' ||
      v === 'عيران' ||
      v === 'لبن'
    ) {
      variants.add('ayran');
      variants.add('laban');
    } else if (
      v === 'bira' ||
      v === 'beer' ||
      v === 'بيرة'
    ) {
      variants.add('beer');
    } else if (
      v === '3asir' ||
      v === 'aasir' ||
      v === 'laymoun' ||
      v === 'orange' ||
      v === 'عصير' ||
      v === 'ليمون'
    ) {
      variants.add('orange');
      variants.add('juice');
    } else if (
      v === 'lent' ||
      v === 'lenten' ||
      v === 'fasting' ||
      v === 'ate3' ||
      v === '2ate3' ||
      v === 'aate3' ||
      v === 'kate3' ||
      v === 'qate3' ||
      v === 'ati3' ||
      v === '2ati3' ||
      v === 'aati3' ||
      v === 'kati3' ||
      v === 'qati3' ||
      v === 'atea' ||
      v === 'katea' ||
      v === 'qatea' ||
      v === 'atia' ||
      v === 'katia' ||
      v === 'qatia' ||
      v === 'at3' ||
      v === '2at3' ||
      v === 'kat3' ||
      v === 'qat3' ||
      v === 'siyam' ||
      v === 'syam' ||
      v === 'siyame' ||
      v === 'syame' ||
      v === '9iyam' ||
      v === '9yam' ||
      v === 'soyam' ||
      v === 'souyam' ||
      v === 'sayem' ||
      v === '9ayem' ||
      v === 'nebate' ||
      v === 'nabati' ||
      v === 'nabate' ||
      v === 'vegetarian' ||
      v === 'vegan' ||
      v === 'meatless' ||
      v === 'veggie' ||
      v === 'قاطع' ||
      v === 'صيامي' ||
      v === 'صيام' ||
      v === 'نباتي'
    ) {
      variants.add('lent');
      variants.add('siyam');
      variants.add('vegetarian');
    } else if (
      v === 'kilo' ||
      v === 'kilos' ||
      v === '1kg' ||
      v === 'كيلو' ||
      v === 'بالكيلو' ||
      v === 'nos' ||
      v === 'noss' ||
      v === 'half' ||
      v === 'نص' ||
      v === 'نصف'
    ) {
      variants.add('kilo');
    } else if (
      v === '3ayle' ||
      v === 'aayle' ||
      v === 'ayle' ||
      v === '3aile' ||
      v === 'family' ||
      v === 'group' ||
      v === 'groups' ||
      v === 'sharing' ||
      v === 'share' ||
      v === 'jem3a' ||
      v === 'jam3a' ||
      v === 'sahra' ||
      v === 'عيلة' ||
      v === 'عائلة' ||
      v === 'جمعة' ||
      v === 'سهرة' ||
      v === 'مجموعة'
    ) {
      variants.add('sharing');
    }
  }

  return Array.from(variants).filter((v) => v.length > 2);
}

function detectUserLanguage(msg: string): 'English' | 'Lebanese' | 'Arabic' {
  if (/[\u0600-\u06FF]/.test(msg)) return 'Arabic';
  const combined = `${msg} ${normalizeLebaneseFrancoText(msg)}`;
  if (
    /\b(shu|chou|baddi|bade|badde|atyab|3andkon|andkon|3endkon|endkon|3endak|3enddak|aandak|andak|bala|bla|bela|bdoun|bidoun|toum|thoum|basal|5as|khas|akel|akl|akil|ate3|2ate3|aate3|kate3|qate3|ati3|2ati3|aati3|kati3|qati3|at3|siyam|syam|kabis|feter|banadoura|kifak|ahla|shi|fi|akid|tayeb|wajbe|7ar|har|shawarma|tawouk|kbeir|kbir|zghir|sghir|wassat|wasat|as3ar|asaar|se3er|seaer|7a2|ha2|la7me|lahme|djej|djeij|jebne|batata|7doud|hdoud|b7doud|bhdoud|ta7et|tahet|a2al|aqal|2arib|arib|ma3|ma33|maa|sa7en|sahen|betnasahne|btensah|btensahne|btonsa7ne|jou3an|jouaan|jou3ane|ji3t|yshabbe3|yshabe3|mdebbas|ghada|8ada|3asha|aasha|sheghel|shoghol|talabiyye|sari3|mashshi|sahar|sahseha|fahem|fa7em|sfine|sfinet|farrouj|farouj|say7a|sayha|m2armash|dazzine|dazine|rkakat|rakakat|mo3ajanet|mouajanet|wara2|3enab|sawda|makanek|soujouk|8anam|ghanam|tarator|jarjir|shmandar|jawz|ardishoke|habash|dura|salameh|7asesiye|hassasiyeh|mashta2at|halib|wled|awled|khafif|5afif|3ayran|ayran|bira|3asir|laymoun|zyede|zyedeh|katter|jnab|m7ammas|fare2|farek|3ouroudat|fate7in|halla2|weyn|tekram|3youne)\b/i.test(
      combined
    ) ||
    /[235789][a-z]|[a-z][235789]/i.test(msg)
  ) {
    return 'Lebanese';
  }
  return 'English';
}

function classifyTopicTag(msg: string): string {
  const q = `${msg} ${normalizeLebaneseFrancoText(msg)}`.toLowerCase();
  if (
    /allerg|7asesiye|hassasiyeh|gluten|celiac|coeliac|dairy|lactose|halib|mashta2at|nut|walnut|jawz|without|no |bala |bla |bela |bdoun |bidoun |fik tshil|shil |lent|ate3|2ate3|aate3|kate3|qate3|ati3|2ati3|aati3|kati3|qati3|at3|siyam|syam|meatless|قاطع|صيامي|صيام|نباتي|حساسية|بدون|بلا|مكسرات|جوز|حليب/.test(
      q
    )
  ) {
    return 'Ingredients & Allergies';
  }
  if (/healthy|light|diet|calorie|fit|protein|gym|salad|quinoa|khafif|5afif|asmar|jarjir|shmandar|صحي|دايت|لايت|سلطة|خفيف|بروتين|أسمر/.test(q)) {
    return 'Healthy & Light';
  }
  if (/spicy|hot|chili|har|7ar|harra|soujouk|reb 7ar|toum w 7ar|حار|حد|حر|سجق/.test(q)) {
    return 'Spicy Dishes';
  }
  if (/burger|sub|baguette|franje|frenji|fajita|philadelphia|philly|crispy|crunchy|pane|m2armash|thierry|corano|tweety|tandoori|submarine|برغر|ساب|كريسبي|بانيه|باجيت/.test(q)) {
    return 'Burgers & Subs';
  }
  if (/pizza|pasta|penne|margherita|marguerita|pepperoni|بيتزا|باستا/.test(q)) {
    return 'Pizza & Pasta';
  }
  if (/sandwich|sandwish|sando|tawouk|kafta|kabab|mashewe|mashawi|farrouj|farouj|sfine|fahem|falafel|wrap|sajj|saj|markouk|makanek|sawda|ghanam|ساندويش|طاووق|كفتة|كباب|مشاوي|فروج|فلافل|صاج|مقانق|سودة/.test(q)) {
    return 'Sandwiches & Wraps';
  }
  if (/price|cost|cheap|how much|ll|lbp|dollar|usd|se3er|seaer|as3ar|asaar|7doud|hdoud|ta7et|tahet|a2al|aqal|budget|combo|promo|discount|offer|3ouroudat|سعر|أسعار|بكم|قديش|تحت|حدود|عروضات|خصم/.test(q)) {
    return 'Prices & Budget';
  }
  if (/popular|best|top|special|signature|atyab|ashhar|betnasahne|btensah|moukheef|أطيب|أشهر|بتنصح/.test(q)) {
    return 'Popular & Best Sellers';
  }
  return 'General Inquiry';
}

const NEGATION_TRIGGER_REGEX =
  /\b(without|no|free|not|avoid|allerg\w*|intoleran\w*|7asesiye|hassasiyeh|bala|bla|bela|bdoun|bidoun|bedoun|badoon|ma\s+bheb|ma\s+b7eb|mish|mesh|fik\s+tshil|shil)\b|بدون|بلا|من دون|حساسية|ما بحب|فيك تشيل|شيل/i;

const INGREDIENT_EXCLUSION_GROUPS: Array<{
  labelEn: string;
  labelLb: string;
  labelAr: string;
  queryTriggers: RegExp;
  itemMatchTerms: string[];
}> = [
  {
    labelEn: 'garlic',
    labelLb: 'toum (garlic)',
    labelAr: 'ثوم',
    queryTriggers: /\b(garlic|toum|thoum|tom|aioli)\b|ثوم|توم/i,
    itemMatchTerms: ['garlic', 'toum', 'aioli'],
  },
  {
    labelEn: 'mayo',
    labelLb: 'mayo',
    labelAr: 'مايونيز',
    queryTriggers: /\b(mayo|mayonnaise)\b|مايونيز|مايو/i,
    itemMatchTerms: ['mayo', 'mayonnaise'],
  },
  {
    labelEn: 'onions',
    labelLb: 'basal (onions)',
    labelAr: 'بصل',
    queryTriggers: /\b(onion|onions|basal|bassal|biwas|biwaz)\b|بصل/i,
    itemMatchTerms: ['onion', 'onions', 'biwas', 'biwaz'],
  },
  {
    labelEn: 'lettuce',
    labelLb: 'khas (lettuce)',
    labelAr: 'خس',
    queryTriggers: /\b(lettuce|5as|5ass|khas|khass)\b|خس/i,
    itemMatchTerms: ['lettuce', 'iceberg', 'romaine'],
  },
  {
    labelEn: 'cheese / dairy',
    labelLb: 'jebne / mashta2at 7alib (cheese & dairy)',
    labelAr: 'جبنة / مشتقات الحليب',
    queryTriggers: /\b(cheese|dairy|lactose|halib|7alib|mashta2at|jebne|jebneh|jibne|cheddar|mozzarella|7alloum|halloum|halloumi)\b|جبن|جبنة|ألبان|حليب|حلوم/i,
    itemMatchTerms: [
      'cheese',
      'cheddar',
      'mozzarella',
      'parmesan',
      'halloumi',
      'feta',
      'kashkaval',
      'swiss',
      'emmental',
      'cream',
    ],
  },
  {
    labelEn: 'nuts / walnuts',
    labelLb: 'jawz / mukassarat (nuts)',
    labelAr: 'جوز / مكسرات',
    queryTriggers: /\b(nut|nuts|walnut|walnuts|jawz|loz|peanuts?|almonds?)\b|جوز|لوز|فستق|مكسرات/i,
    itemMatchTerms: ['walnut', 'walnuts', 'nut', 'nuts', 'almond', 'peanut', 'pecan', 'cashew'],
  },
  {
    labelEn: 'spicy ingredients',
    labelLb: '7ar (spicy)',
    labelAr: 'حر / حار',
    queryTriggers: /\b(spicy|hot|chili|jalapeno|har|7ar|harra|7arra)\b|حار|حد|حر/i,
    itemMatchTerms: ['spicy', 'jalapeno', 'chili', 'dynamite', 'mexican', 'harra'],
  },
  {
    labelEn: 'mushrooms',
    labelLb: 'feter / champignon (mushrooms)',
    labelAr: 'فطر',
    queryTriggers: /\b(mushroom|mushrooms|feter|fotor|champignon)\b|فطر/i,
    itemMatchTerms: ['mushroom', 'mushrooms'],
  },
  {
    labelEn: 'pickles',
    labelLb: 'kabis (pickles)',
    labelAr: 'كبيس',
    queryTriggers: /\b(pickle|pickles|pickels|kabis|kabbis)\b|كبيس|مخلل/i,
    itemMatchTerms: ['pickle', 'pickles', 'kabis'],
  },
  {
    labelEn: 'tomatoes',
    labelLb: 'banadoura (tomatoes)',
    labelAr: 'بندورة',
    queryTriggers: /\b(tomato|tomatoes|banadoura)\b|بندورة|طماطم/i,
    itemMatchTerms: ['tomato', 'tomatoes'],
  },
  {
    labelEn: 'bacon / ham / salami',
    labelLb: 'bacon / jambon / salameh',
    labelAr: 'بيكون / جامبون / سلامي',
    queryTriggers: /\b(bacon|pork|ham|jambon|salameh|salami)\b|بيكون|جامبون|سلامي/i,
    itemMatchTerms: ['bacon', 'pork', 'ham', 'salameh', 'salami'],
  },
  {
    labelEn: 'avocado',
    labelLb: 'avocado',
    labelAr: 'أفوكادو',
    queryTriggers: /\b(avocado)\b|أفوكادو|افوكادو/i,
    itemMatchTerms: ['avocado'],
  },
  {
    labelEn: 'corn',
    labelLb: 'dura (corn)',
    labelAr: 'ذرة',
    queryTriggers: /\b(corn|dura|doura)\b|ذرة/i,
    itemMatchTerms: ['corn'],
  },
  {
    labelEn: 'meat or chicken (Lent / Meatless)',
    labelLb: 'la7me aw djej (akel ate3)',
    labelAr: 'لحم أو دجاج (أكل قاطع / صيامي)',
    queryTriggers:
      /\b(meat|meatless|meat-free|la7me|lahme|la7em|lahem|beef|chicken|djej|djeij|lamb|8anam|ghanam|lent|lenten|ate3|2ate3|aate3|kate3|qate3|ati3|2ati3|aati3|kati3|qati3|at3|2at3|kat3|qat3|siyam|syam|siyame|syame|soyam|souyam|sayem|9ayem)\b|لحمة|لحم|دجاج|فروج|قاطع|صيامي|صيام/i,
    itemMatchTerms: ['__LENT_OR_MEATLESS__'],
  },
];

const LENT_OR_MEATLESS_DIRECT_REGEX =
  /\b(lent|lenten|fasting|ate3|2ate3|aate3|kate3|qate3|ati3|2ati3|aati3|kati3|qati3|atea|katea|qatea|atia|katia|qatia|at3|2at3|kat3|qat3|siyam|syam|siyame|syame|9iyam|9yam|soyam|souyam|sayem|9ayem|nebate|nabati|nabate|vegetarian|vegan|meatless|meat-free|veggie)\b|أكل\s*قاطع|اكل\s*قاطع|أكل\s*صيامي|اكل\s*صيامي|قاطع|صيامي|صيام|نباتي/i;

function isLentOrMeatlessQuery(message: string): boolean {
  const combined = `${message} ${normalizeLebaneseFrancoText(message)}`;
  if (LENT_OR_MEATLESS_DIRECT_REGEX.test(combined)) return true;
  if (
    NEGATION_TRIGGER_REGEX.test(combined) &&
    /\b(meat|la7me|lahme|la7em|lahem|beef|chicken|djej|djeij|lamb|8anam|ghanam)\b|لحمة|لحم|دجاج|فروج/i.test(
      combined
    )
  ) {
    return true;
  }
  return false;
}

function isItemMeatOrChicken(item: any): boolean {
  const titleLower = String(item?.title || '').toLowerCase().trim();
  const catLower = String(item?.category || '').toLowerCase().trim();
  const descLower = String(item?.desc || '').toLowerCase().trim();
  const combined = `${titleLower} ${catLower} ${descLower}`;

  if (
    /\b(lent|lenten|ate3|2ate3|qate3|kate3|siyam|syam|falafel|tuna|crab|halloumi|mozzarella\s+sticks|mozzarella\s+pane|marguerita|margherita|vegetarian|hummus|hommos|motabal|moutabal|batata\s+harra|wara2|cheese\s+rolls|fries\s+sando|quinoa|fatouche|fattoush|tabbouleh|french\s+fries|potato\s+wedges|baked\s+potato)\b|قاطع|صيامي|صيام|فلافل|حمص|متبل|بطاطا\s+حرة|حلوم/i.test(
      `${titleLower} ${catLower}`
    )
  ) {
    return false;
  }

  if (
    catLower.includes('burger') &&
    !titleLower.includes('mozzarella') &&
    !titleLower.includes('halloumi') &&
    !titleLower.includes('veggie') &&
    !titleLower.includes('vegetarian') &&
    !titleLower.includes('lent') &&
    !titleLower.includes('ate3') &&
    !titleLower.includes('fish') &&
    !titleLower.includes('tuna') &&
    !titleLower.includes('crab')
  ) {
    return true;
  }

  return /\b(beef|chicken|djeij|djej|farrouj|farouj|tawouk|tawook|taouk|kafta|kefta|kabab|kebab|lahme|la7me|lahem|la7em|ghanam|8anam|sheep|lamb|makanek|ma2anek|soujouk|sujuk|sawda|liver|ham|salameh|salami|bacon|pork|pepperoni|turkey|steak|philly|fajita|francisco|rosted|philadelphia|twister|crispy|crunchy|nuggets|tenders|wings|jaweneh|shish|chich|skewers|mashewe|mashawi|kebbe|kibbeh|mchakale|mshakale|submarine)\b|لحمة|لحم|دجاج|فروج|طاووق|كفتة|كباب|سجق|مقانق|سودة|كبة|حبش|بيبروني/i.test(
    combined
  );
}

function getLentPriorityScore(item: any): number {
  if (isItemMeatOrChicken(item)) return 0;
  const titleLower = String(item?.title || '').toLowerCase().trim();
  const catLower = String(item?.category || '').toLowerCase().trim();
  const descLower = String(item?.desc || '').toLowerCase().trim();
  const combined = `${titleLower} ${catLower} ${descLower}`;

  if (
    /\b(lent|lenten|ate3|2ate3|qate3|kate3|siyam|syam|siyame|syame)\b|قاطع|صيامي|صيام/i.test(
      combined
    )
  ) {
    return 75;
  }

  if (catLower.includes('falafel') || titleLower.includes('falafel')) return 64;
  if (titleLower.includes('tuna')) return 62;
  if (titleLower.includes('crab')) return 62;
  if (titleLower.includes('mozzarella pane')) return 62;
  if (titleLower.includes('halloumi')) return 60;
  if (titleLower.includes('mozzarella sticks')) return 60;
  if (titleLower.includes('marguerita') || titleLower.includes('margherita')) return 60;
  if (titleLower.includes('vegetarian')) return 60;
  if (titleLower.includes('hummus') || titleLower.includes('hommos')) return 58;
  if (titleLower.includes('motabal') || titleLower.includes('moutabal')) return 58;
  if (titleLower.includes('batata harra')) return 58;

  if (
    titleLower.includes('wara2') ||
    titleLower.includes('cheese rolls') ||
    titleLower.includes('fries sando') ||
    titleLower.includes('quinoa') ||
    titleLower.includes('fatouche') ||
    titleLower.includes('tabbouleh') ||
    titleLower.includes('french fries') ||
    titleLower.includes('wedges') ||
    titleLower.includes('baked potato')
  ) {
    return 40;
  }

  return 20;
}

function extractExclusionsFromMessage(message: string): {
  excludedTerms: string[];
  labelsEn: string[];
  labelsLb: string[];
  labelsAr: string[];
} {
  const combined = `${message} ${normalizeLebaneseFrancoText(message)}`;
  const isLentQuery = isLentOrMeatlessQuery(message);
  if (!NEGATION_TRIGGER_REGEX.test(combined) && !isLentQuery) {
    return { excludedTerms: [], labelsEn: [], labelsLb: [], labelsAr: [] };
  }
  const excludedTerms: string[] = [];
  const labelsEn: string[] = [];
  const labelsLb: string[] = [];
  const labelsAr: string[] = [];

  if (isLentQuery) {
    excludedTerms.push('__LENT_OR_MEATLESS__');
    labelsEn.push('meat or chicken (Lent / Meatless)');
    labelsLb.push('la7me aw djej (akel ate3)');
    labelsAr.push('لحم أو دجاج (أكل قاطع / صيامي)');
  }

  if (NEGATION_TRIGGER_REGEX.test(combined)) {
    for (const group of INGREDIENT_EXCLUSION_GROUPS) {
      if (group.itemMatchTerms.includes('__LENT_OR_MEATLESS__') && isLentQuery) {
        continue;
      }
      if (group.queryTriggers.test(combined)) {
        excludedTerms.push(...group.itemMatchTerms);
        labelsEn.push(group.labelEn);
        labelsLb.push(group.labelLb);
        labelsAr.push(group.labelAr);
      }
    }
  }

  return {
    excludedTerms: Array.from(new Set(excludedTerms)),
    labelsEn,
    labelsLb,
    labelsAr,
  };
}

function itemContainsExcludedTerm(item: any, excludedTerms: string[]): boolean {
  if (!excludedTerms.length) return false;

  const checksLentMeatless = excludedTerms.includes('__LENT_OR_MEATLESS__');
  if (checksLentMeatless && isItemMeatOrChicken(item)) {
    return true;
  }

  const otherTerms = excludedTerms.filter((t) => t !== '__LENT_OR_MEATLESS__');
  if (!otherTerms.length) {
    return false;
  }

  const desc = String(item?.desc || '').trim();
  // When filtering out a specific allergen/ingredient (e.g. garlic, mayo), skip items that have no listed ingredients to verify
  if (!desc) return true;
  const haystack = `${String(item?.title || '')} ${desc}`.toLowerCase();
  return otherTerms.some((term) => haystack.includes(term.toLowerCase()));
}

interface BudgetAndComboSpec {
  maxBudgetUsd: number | null;
  wantsCombo: boolean;
}

function getItemComboAddonUsd(item: any): number | null {
  if (!Array.isArray(item?.addons)) return null;
  for (const rawAddon of item.addons) {
    const str = String(rawAddon || '');
    if (/combo|fries\s*&\s*drink/i.test(str)) {
      const m = str.match(/\$\s*(\d+(?:\.\d+)?)/);
      return m ? parseFloat(m[1]) : 2.81;
    }
  }
  return null;
}

function extractBudgetAndComboSpec(message: string, exchangeRate = 89000): BudgetAndComboSpec {
  const qRaw = message.toLowerCase();
  const qNorm = normalizeLebaneseFrancoText(message);
  const q = `${qRaw} ${qNorm}`;

  const wantsCombo =
    /\b(combo|with\s+fries|fries\s+and\s+drink|fries\s*&\s*drink|drink\s+and\s+fries|with\s+pepsi|kamen\s+pepsi|بطاطا\s+وبيبسي|بيبسي\s+وبطاطا|كومبو|مع\s+بطاطا|مع\s+بيبسي)\b/i.test(
      q
    ) ||
    /\b(ma3|ma33|ma333|maa|ma|m3)\b[\s\S]{0,35}\b(pepsi|batata|fries|drink|7up|mirinda|cola)\b/i.test(
      q
    ) ||
    /\b(pepsi|batata)\b[\s\S]{0,20}\b(w|and|ma3|ma33|maa)\b[\s\S]{0,20}\b(pepsi|batata|fries|drink)\b/i.test(
      q
    );

  let maxBudgetUsd: number | null = null;

  const usdPatterns = [
    /(?:under|less\s+than|below|max|maximum|up\s+to|budget|around|within|for|tahet|ta7et|tahit|taht|t7t|7doud|hdoud|b7doud|bhdoud|a2al\s+men|aqal\s+men|akal\s+men|aal\s+men|2arib|arib|qarib|bi|b|ب|تحت|بحدود|حدود|أقل\s+من|اقل\s+من|بأقل\s+من)\s*(?:men|mn|el|l|al|ال)?\s*\$\s*(\d+(?:\.\d+)?)/i,
    /(?:under|less\s+than|below|max|maximum|up\s+to|budget|around|within|for|tahet|ta7et|tahit|taht|t7t|7doud|hdoud|b7doud|bhdoud|a2al\s+men|aqal\s+men|akal\s+men|aal\s+men|2arib|arib|qarib|bi|b|ب|تحت|بحدود|حدود|أقل\s+من|اقل\s+من|بأقل\s+من)\s*(?:men|mn|el|l|al|ال)?\s*(\d+(?:\.\d+)?)\s*(?:\$|usd|dollars?|dolar|دولار)/i,
    /\$\s*(\d+(?:\.\d+)?)\s*(?:or\s+less|max|budget|and\s+under)/i,
    /(\d+(?:\.\d+)?)\s*\$\s*(?:or\s+less|max|budget|and\s+under|tahet|ta7et|7doud|hdoud)?/i,
  ];

  for (const pat of usdPatterns) {
    const m = q.match(pat);
    if (m && m[1]) {
      const val = parseFloat(m[1]);
      if (val > 0 && val <= 500) {
        maxBudgetUsd = val;
        break;
      }
    }
  }

  if (maxBudgetUsd === null) {
    const lbpMatch = q.match(
      /(\d{3,4}(?:[,\s]\d{3})+|\d{5,8})\s*(?:l\.?l\.?|lbp|lira|ليرة|ل\.ل)/i
    );
    if (lbpMatch && lbpMatch[1]) {
      const rawLbp = parseFloat(lbpMatch[1].replace(/[,\s]/g, ''));
      if (rawLbp >= 50000) {
        maxBudgetUsd = Number((rawLbp / (exchangeRate || 89000)).toFixed(2));
      }
    }
  }

  return { maxBudgetUsd, wantsCombo };
}

function itemFitsBudgetAndCombo(item: any, spec: BudgetAndComboSpec): boolean {
  const basePrice = Number(item?.price || 0);
  if (Number.isNaN(basePrice) || basePrice <= 0) return false;
  const comboAddon = getItemComboAddonUsd(item);

  if (spec.wantsCombo && spec.maxBudgetUsd !== null) {
    if (comboAddon === null) return false;
    return basePrice + comboAddon <= spec.maxBudgetUsd + 0.05;
  }
  if (spec.maxBudgetUsd !== null) {
    return basePrice <= spec.maxBudgetUsd + 0.05;
  }
  if (spec.wantsCombo) {
    return comboAddon !== null;
  }
  return true;
}

function formatItemPriceWithComboBreakdown(
  item: any,
  currency: 'USD' | 'LBP',
  exchangeRate: number,
  spec: BudgetAndComboSpec
): string {
  const baseStr = formatItemPriceForAi(item.price, currency, exchangeRate);
  const comboAddon = getItemComboAddonUsd(item);
  if ((spec.wantsCombo || spec.maxBudgetUsd !== null) && comboAddon !== null) {
    const totalUsd = Number((Number(item.price || 0) + comboAddon).toFixed(2));
    const comboAddonStr = formatItemPriceForAi(comboAddon, currency, exchangeRate);
    const totalStr = formatItemPriceForAi(totalUsd, currency, exchangeRate);
    return `${baseStr} + ${comboAddonStr} Combo (Fries & Drink) = ${totalStr} total`;
  }
  return baseStr;
}

function extractPositiveQueryWords(
  message: string,
  excludedTerms: string[],
  budgetSpec?: BudgetAndComboSpec
): string[] {
  const activeSpec = budgetSpec || extractBudgetAndComboSpec(message);
  const stopAndNegationWords = new Set([
    'without',
    'bala',
    'bla',
    'bela',
    'bdoun',
    'bidoun',
    'need',
    'want',
    'food',
    'foods',
    'meal',
    'meals',
    'eat',
    'eating',
    'akel',
    'akl',
    'akil',
    '2akel',
    '2akl',
    'أكل',
    'اكل',
    'baddi',
    'bade',
    'badde',
    'shi',
    'chi',
    'che',
    'she',
    'chu',
    'shu',
    'chou',
    'like',
    'thing',
    'things',
    'have',
    'has',
    'had',
    'are',
    'was',
    'were',
    'does',
    'did',
    'what',
    'which',
    'where',
    'when',
    'who',
    'how',
    'why',
    'this',
    'that',
    'these',
    'those',
    'some',
    'any',
    'all',
    'types',
    'type',
    'kind',
    'kinds',
    'recommend',
    'something',
    'anything',
    'options',
    'option',
    'dishes',
    'dish',
    'items',
    'item',
    'your',
    'you',
    'the',
    'and',
    'for',
    'with',
    'from',
    'menu',
    'corano',
    'most',
    'popular',
    'best',
    'top',
    'good',
    'nice',
    'filling',
    'please',
    'can',
    'give',
    'show',
    'tell',
    'atyab',
    '2atyab',
    'ashhar',
    '2ashhar',
    'a7san',
    'ahsan',
    'أطيب',
    'اطيب',
    'أشهر',
    'اشهر',
    'أحسن',
    'احسن',
    'شي',
    'شيء',
    'شو',
    'عندك',
    'عندكم',
    'عندكن',
    '3andkon',
    'andkon',
    '3endkon',
    'endkon',
    'indak',
    '3indak',
    '3endak',
    '3enddak',
    'aandak',
    'andak',
    '3andak',
    'ma3',
    'ma33',
    'ma333',
    'maa',
    'tahet',
    'ta7et',
    'tahit',
    'taht',
    '7doud',
    'hdoud',
    'b7doud',
    'bhdoud',
    'a2al',
    'aqal',
    'akal',
    'aal',
    '2arib',
    'arib',
    'qarib',
    'men',
    'sa7en',
    'sahen',
    'kamen',
    'kaman',
    'kmn',
    'كمان',
    'alba',
    '2alba',
    'qalba',
    'kalba',
    'balba',
    'b2alba',
    'قلبها',
    'بقلبها',
    'fiha',
    'fiya',
    'fia',
    'fih',
    'فيها',
    'فيه',
    'inside',
    'into',
    '3elbet',
    'elbet',
    'aalbet',
    'علبة',
    'under',
    'below',
    'less',
    'than',
    'around',
    'within',
    'budget',
    'dollar',
    'dollars',
    'dolar',
    'usd',
    'ana',
    '3emel',
    'aamel',
    '3am',
    'aam',
    'btonsa7ne',
    'btensa7ne',
    'btonsa7ni',
    'btensa7ni',
    'ekol',
    '2ekol',
    'akol',
    ...(activeSpec.wantsCombo
      ? [
          'pepsi',
          'batata',
          'fries',
          'drink',
          'drinks',
          'combo',
          '7up',
          'mirinda',
          'cola',
          'بطاطا',
          'بيبسي',
          'مشروب',
          'كومبو',
        ]
      : []),
    ...excludedTerms,
    ...(excludedTerms.length > 0
      ? [
          'toum',
          'thoum',
          'basal',
          'bassal',
          '5as',
          'khas',
          'khass',
          'jebne',
          'jebneh',
          'jibne',
          'kabis',
          'feter',
          'banadoura',
          'garlic',
          'onion',
          'onions',
          'lettuce',
          'la7me',
          'lahme',
          'la7em',
          'lahem',
          'djej',
          'djeij',
          'meat',
          'chicken',
          'beef',
          'لحمة',
          'لحم',
          'دجاج',
          'فروج',
        ]
      : []),
  ]);

  const rawTokens = message
    .toLowerCase()
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !stopAndNegationWords.has(w));

  const expanded: string[] = [];
  for (const token of rawTokens) {
    for (const v of expandLebaneseFrancoToken(token)) {
      if (!stopAndNegationWords.has(v) && !expanded.includes(v)) {
        expanded.push(v);
      }
    }
  }
  return expanded;
}

function buildPhoneticSkeleton(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f')
    .replace(/gh/g, 'g')
    .replace(/kh/g, 'k')
    .replace(/sh|ch/g, 's')
    .replace(/ge|ij|dj/g, 'j')
    .replace(/oo|ou|ow|aw/g, 'u')
    .replace(/ee|ea|ie|ey|y/g, 'i')
    .replace(/aa|ae|e/g, 'a')
    .replace(/[cq]/g, 'k')
    .replace(/z/g, 's')
    .replace(/(.)\1+/g, '$1');
}

function damerauLevenshteinDistance(a: string, b: string): number {
  const alen = a.length;
  const blen = b.length;
  if (alen === 0) return blen;
  if (blen === 0) return alen;
  if (Math.abs(alen - blen) > 2) return 99;

  const dp: number[][] = Array.from({ length: alen + 1 }, () => new Array(blen + 1).fill(0));
  for (let i = 0; i <= alen; i++) dp[i][0] = i;
  for (let j = 0; j <= blen; j++) dp[0][j] = j;

  for (let i = 1; i <= alen; i++) {
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[i - 1] ? 0 : 1;
      const subCost = a[i - 1] === b[j - 1] ? 0 : 1;
      void cost;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + subCost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + subCost);
      }
    }
  }
  return dp[alen][blen];
}

function resolveFuzzyMenuTokens(words: string[], storeData: any): string[] {
  if (!words.length) return [];
  const vocabSet = new Set<string>([
    'farrouj',
    'tawouk',
    'falafel',
    'philadelphia',
    'fajita',
    'francisco',
    'halloumi',
    'mozzarella',
    'marguerita',
    'margherita',
    'vegetarian',
    'quinoa',
    'tabbouleh',
    'fatouche',
    'motabal',
    'hummus',
    'soujouk',
    'makanek',
    'kafta',
    'kabab',
    'mashewe',
    'crispy',
    'burger',
    'sandwich',
    'submarine',
    'pepperoni',
    'tandoori',
    'mexican',
    'twister',
    'nuggets',
    'tenders',
    'wedges',
    'coleslaw',
    'caesar',
    'lent',
    'lenten',
    'siyam',
    'ate3',
    'ati3',
  ]);

  for (const item of storeData?.items || []) {
    const titleTokens = String(item?.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/);
    const catTokens = String(item?.category || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/);
    for (const t of [...titleTokens, ...catTokens]) {
      if (t.length >= 4) vocabSet.add(t);
    }
  }

  const vocabList = Array.from(vocabSet);
  const result = new Set<string>(words);

  for (const w of words) {
    if (w.length < 4 || !/^[a-z]+$/.test(w) || vocabSet.has(w)) continue;
    const wSkel = buildPhoneticSkeleton(w);
    let bestCandidate = '';
    let bestDist = 99;

    for (const cand of vocabList) {
      if (Math.abs(cand.length - w.length) > 2) continue;
      if (cand[0] !== w[0] && buildPhoneticSkeleton(cand)[0] !== wSkel[0]) continue;

      const candSkel = buildPhoneticSkeleton(cand);
      if (wSkel.length >= 3 && wSkel === candSkel) {
        bestCandidate = cand;
        bestDist = 0;
        break;
      }

      const dist = damerauLevenshteinDistance(w, cand);
      const maxAllowed = cand.length >= 6 ? 2 : 1;
      if (dist <= maxAllowed && dist < bestDist) {
        bestDist = dist;
        bestCandidate = cand;
      }
    }

    if (bestCandidate) {
      result.add(bestCandidate);
    }
  }

  return Array.from(result);
}

const LIGHT_HEALTHY_DIET_REGIME_REGEX =
  /\b(light|healthy|diet|dieting|regime|rejim|rjim|rijim|so77e|so7e|sa77e|sa7e|sohhe|sohe|se77e|se7e|sihhi|calorie|calories|low\s*cal|fit|fitness)\b|صحي|دايت|لايت|ريجيم|رجيم|حمية/i;

function isLightHealthyDietRegimeQuery(message: string): boolean {
  const combined = `${message} ${normalizeLebaneseFrancoText(message)}`.toLowerCase();
  if (!LIGHT_HEALTHY_DIET_REGIME_REGEX.test(combined)) return false;
  if (
    /\b(salad|salads|fatouche|fattoush|tabbouleh|taboule|quinoa|caesar|coleslaw|rocca)\b|سلطة|سلطات|فتوش|تبولة|كينوا/i.test(
      combined
    )
  ) {
    return false;
  }
  return true;
}

function getDishFamilyKey(item: any): string {
  const titleLower = String(item?.title || '')
    .toLowerCase()
    .trim();
  if (titleLower.includes('farrouj') || titleLower.includes('farouj')) return 'family:farrouj';
  if (titleLower.startsWith('french fries')) return 'family:french-fries';
  if (titleLower.startsWith('potato wedges')) return 'family:potato-wedges';
  if (titleLower.startsWith('baked potato')) return 'family:baked-potato';
  if (titleLower.startsWith('fatouche')) return 'family:fatouche';
  if (titleLower.startsWith('tabbouleh')) return 'family:tabbouleh';
  if (titleLower.startsWith('coleslaw')) return 'family:coleslaw';
  if (titleLower.startsWith('seasonal')) return 'family:seasonal';
  if (titleLower.startsWith('pepsi')) return 'family:pepsi';
  if (titleLower.startsWith('7up')) return 'family:7up';
  if (titleLower.startsWith('mirinda')) return 'family:mirinda';
  if (titleLower.startsWith('water')) return 'family:water';
  return `item:${String(item?.id || titleLower)}`;
}

function extractHistoryRotationState(
  history: Array<{ role?: string; text?: string; recommendedItemIds?: string[] }>
): {
  previouslyRecommendedIds: Set<string>;
  previousAssistantTurns: number;
} {
  const previouslyRecommendedIds = new Set<string>();
  let previousAssistantTurns = 0;

  if (Array.isArray(history)) {
    for (const h of history) {
      if (h?.role === 'assistant') {
        previousAssistantTurns += 1;
      }
      if (Array.isArray(h?.recommendedItemIds)) {
        for (const id of h.recommendedItemIds) {
          if (id) previouslyRecommendedIds.add(String(id));
        }
      }
    }
  }

  return { previouslyRecommendedIds, previousAssistantTurns };
}

function computePositiveKeywordScore(item: any, words: string[]): number {
  if (!words.length) return 0;
  const titleLower = String(item?.title || '').toLowerCase();
  const descLower = String(item?.desc || '').toLowerCase();
  const catLower = String(item?.category || '').toLowerCase();
  const combined = `${titleLower} ${catLower} ${descLower}`;

  let score = 0;
  for (const w of words) {
    if (w === 'crispy' || w === 'crunchy' || w === 'pane' || w === 'كريسبي' || w === 'مقرمش' || w === 'بانيه') {
      if (w === 'pane' || w === 'بانيه') {
        if (titleLower.includes('pane')) score += 45;
        else if (titleLower.includes('crispy') || titleLower.includes('sticks')) score += 24;
      } else if (titleLower.includes('crispy') && titleLower.includes('tenders')) {
        score += 54;
      } else if (titleLower.includes('crispy') || titleLower.includes('pane')) {
        score += 26;
      } else if (
        descLower.includes('crispy') ||
        descLower.includes('breaded') ||
        descLower.includes('fried chicken')
      ) {
        score += 20;
      }
      continue;
    }
    if (
      w === 'cheesy' ||
      w === 'cheese' ||
      w === 'cheddar' ||
      w === 'mozzarella' ||
      w === 'halloumi' ||
      w === 'halloum' ||
      w === '7alloum' ||
      w === 'jebne' ||
      w === 'jebneh' ||
      w === 'jibne' ||
      w === 'جبنة' ||
      w === 'جبن'
    ) {
      const hasCheeseInTitle =
        titleLower.includes('cheddar') ||
        titleLower.includes('cheese') ||
        titleLower.includes('mozzarella') ||
        titleLower.includes('halloumi') ||
        titleLower.includes('pane');
      const hasCheeseInDesc =
        descLower.includes('cheddar') ||
        descLower.includes('cheese') ||
        descLower.includes('mozzarella') ||
        descLower.includes('halloumi');
      if (hasCheeseInTitle && descLower.length > 10) {
        score += 25;
      } else if (hasCheeseInDesc && descLower.length > 15) {
        score += 23;
      } else if (hasCheeseInTitle || hasCheeseInDesc) {
        score += 15;
      }
      continue;
    }
    if (w === 'filling') {
      if (
        titleLower.includes('platter') ||
        titleLower.includes('corano') ||
        titleLower.includes('thierry') ||
        titleLower.includes('truffle') ||
        titleLower.includes('cheddar pane') ||
        titleLower.includes('philly steak') ||
        titleLower.includes('bbq burger') ||
        titleLower.includes('charcoal tawouk') ||
        titleLower.includes('mixed grill')
      ) {
        score += 38;
      } else if (catLower.includes('burger') || catLower.includes('sub') || catLower.includes('mashewe')) {
        score += 22;
      }
      continue;
    }
    if (w === 'lunch') {
      if (catLower.includes('sub') || catLower.includes('burger') || catLower.includes('light') || catLower.includes('sandwich')) {
        score += 28;
      }
      continue;
    }
    if (w === 'dinner') {
      if (
        catLower.includes('burger') ||
        catLower.includes('sub') ||
        catLower.includes('saj') ||
        titleLower.includes('soujouk') ||
        titleLower.includes('makanek') ||
        titleLower.includes('falafel') ||
        titleLower.includes('batata harra') ||
        titleLower.includes('liver')
      ) {
        score += 28;
      }
      continue;
    }
    if (w === 'kids') {
      if (
        titleLower.includes('nuggets') ||
        titleLower.includes('tenders') ||
        titleLower.includes('french fries') ||
        titleLower.includes('mozzarella sticks') ||
        titleLower.includes('classic burger') ||
        titleLower.includes('marguerita')
      ) {
        score += 44;
      }
      continue;
    }
    if (w === 'sajj' || w === 'saj' || w === 'صاج') {
      if (catLower.includes('saj') || descLower.includes('saj')) {
        score += 42;
      }
      continue;
    }
    if (w === 'brown') {
      if (descLower.includes('brown bread') || descLower.includes('brown baguette') || catLower.includes('light')) {
        score += 40;
      }
      continue;
    }
    if (w === 'charcoal' || w === 'fahem') {
      if (titleLower.includes('charcoal') || descLower.includes('fahem')) {
        score += 42;
      } else if (catLower.includes('mashewe')) {
        score += 32;
      }
      continue;
    }
    if (w === 'breast') {
      if (titleLower.includes('breast') || descLower.includes('sfinet')) {
        score += 42;
      } else if (descLower.includes('chicken breast')) {
        score += 24;
      }
      continue;
    }
    if (w === 'dozen') {
      if (titleLower.includes('dozen') || titleLower.includes('mouajanet')) {
        score += 44;
      }
      continue;
    }
    if (w === 'liver' || w === 'sawda') {
      if (titleLower.includes('liver') || descLower.includes('sawda')) {
        score += 46;
      }
      continue;
    }
    if (
      w === 'mashewe' ||
      w === 'mashawi' ||
      w === 'mashawe' ||
      w === 'meshwe' ||
      w === 'mechwe' ||
      w === 'fa7em' ||
      w === 'fahem' ||
      w === 'grill' ||
      w === 'grilled' ||
      w === 'مشاوي' ||
      w === 'مشوي'
    ) {
      if (catLower.includes('mashewe')) {
        if (
          titleLower.includes('lahme platter') ||
          (titleLower.includes('lahme') && !titleLower.includes('kg'))
        ) {
          score += 46;
        } else if (
          (titleLower.includes('tawouk') || titleLower.includes('tawook')) &&
          !titleLower.includes('kg')
        ) {
          score += 44;
        } else if (
          titleLower === 'farrouj dine in' ||
          titleLower === 'farrouj delivery'
        ) {
          score += 42;
        } else if (titleLower.includes('mixed grill') && !titleLower.includes('kg')) {
          score += 38;
        } else if (
          (titleLower.includes('kafta') || titleLower.includes('kabab')) &&
          !titleLower.includes('kg')
        ) {
          score += 36;
        } else if (!titleLower.includes('kg')) {
          score += 33;
        } else {
          score += 28;
        }
      } else if (
        titleLower.includes('grilled') ||
        titleLower.includes('charcoal') ||
        descLower.includes('skewers') ||
        descLower.includes('shish') ||
        descLower.includes('chich')
      ) {
        score += 16;
      }
      continue;
    }
    if (w === 'farrouj' || w === 'farouj' || w === 'فروج') {
      if (titleLower.includes('farrouj') || titleLower.includes('farouj')) score += 32;
      continue;
    }
    if (w === 'tawouk' || w === 'tawook' || w === 'taouk' || w === 'طاووق') {
      if (
        titleLower.includes('tawouk') ||
        titleLower.includes('tawook') ||
        titleLower.includes('taouk')
      ) {
        score += catLower.includes('mashewe') ? 28 : 24;
      } else if (
        descLower.includes('tawouk') ||
        descLower.includes('tawook') ||
        descLower.includes('taouk')
      ) {
        score += 16;
      }
      continue;
    }
    if (
      w === 'lahme' ||
      w === 'la7me' ||
      w === 'lamb' ||
      w === 'ghanam' ||
      w === '8anam' ||
      w === 'sheep' ||
      w === 'لحمة' ||
      w === 'غنم'
    ) {
      if (titleLower.includes('lahme') || titleLower.includes('sheep') || titleLower.includes('ghanam')) {
        score += catLower.includes('mashewe') ? 28 : 26;
      } else if (descLower.includes('lahme') || descLower.includes('sheep') || descLower.includes('skewers')) {
        score += 18;
      }
      continue;
    }
    if (w === 'kafta' || w === 'kefta' || w === 'كفتة') {
      if (titleLower.includes('kafta')) score += 24;
      else if (descLower.includes('kafta')) score += 16;
      continue;
    }
    if (w === 'kabab' || w === 'kebab' || w === 'كباب') {
      if (titleLower.includes('kabab') || titleLower.includes('kebab')) score += 24;
      else if (descLower.includes('kabab') || descLower.includes('kebab')) score += 16;
      continue;
    }
    if (
      w === 'spicy' ||
      w === 'hot' ||
      w === '7ar' ||
      w === 'har' ||
      w === 'harra' ||
      w === '7arra' ||
      w === 'حار' ||
      w === 'حد' ||
      w === 'حر'
    ) {
      if (
        titleLower.includes('spicy') ||
        titleLower.includes('harra') ||
        titleLower.includes('soujouk') ||
        titleLower.includes('tandoori') ||
        titleLower.includes('mexican') ||
        titleLower.includes('7ar')
      ) {
        score += 22;
      } else if (
        descLower.includes('spicy') ||
        descLower.includes('jalapeno') ||
        descLower.includes('chili') ||
        descLower.includes('harra')
      ) {
        score += 16;
      }
      continue;
    }
    if (w === 'healthy' || w === 'light' || w === 'diet' || w === 'protein' || w === 'gym' || w === 'صحي' || w === 'لايت' || w === 'دايت' || w === 'بروتين') {
      if (catLower.includes('light') || catLower.includes('healthy')) {
        score += 36;
      } else if (catLower.includes('salad')) {
        score += 22;
      } else if (titleLower.includes('light') || titleLower.includes('salad') || titleLower.includes('quinoa') || titleLower.includes('breast')) {
        score += 18;
      }
      continue;
    }
    if (w === 'lent' || w === 'siyam' || w === 'vegetarian') {
      const lentScore = getLentPriorityScore(item);
      if (lentScore > 0) {
        score += lentScore;
      }
      continue;
    }
    if (w === 'kilo' || w === '1kg') {
      if (catLower.includes('mashewe') && titleLower.includes('kg')) {
        score += 58;
      }
      continue;
    }
    if (w === 'sharing') {
      if (catLower.includes('mashewe') && titleLower.includes('kg')) {
        score += 54;
      } else if (
        titleLower === 'farrouj dine in' ||
        titleLower === 'farrouj delivery' ||
        titleLower.includes('mixed grill')
      ) {
        score += 46;
      } else if (titleLower.includes('dozen') || titleLower.includes('mouajanet')) {
        score += 40;
      } else if (catLower.includes('pizza') || titleLower.includes('xl')) {
        score += 34;
      }
      continue;
    }
    if (w === 'burger' || w === 'burgers' || w === 'برغر') {
      if (catLower.includes('burger') || titleLower.includes('burger')) score += 20;
      continue;
    }
    if (w === 'sub' || w === 'subs' || w === 'ساب') {
      if (catLower.includes('sub') || titleLower.includes('sub')) score += 20;
      continue;
    }
    if (
      w === 'sandwich' ||
      w === 'sandwiches' ||
      w === 'sandwish' ||
      w === 'sandwiche' ||
      w === 'sando' ||
      w === 'sandos' ||
      w === 'سندويش' ||
      w === 'ساندويش'
    ) {
      if (catLower.includes('sandwich') || titleLower.includes('sandwich') || titleLower.includes('sando')) {
        score += 24;
      } else if (catLower.includes('sub') || catLower.includes('saj') || catLower.includes('light')) {
        score += 14;
      }
      continue;
    }
    if (w === 'salad' || w === 'salads' || w === 'سلطة') {
      if (catLower.includes('salad') || titleLower.includes('salad')) score += 20;
      continue;
    }
    if (titleLower.includes(w)) score += 22;
    else if (catLower.includes(w)) score += 16;
    else if (descLower.includes(w)) score += 14;
    else if (combined.includes(w)) score += 8;
  }
  return score;
}

const DISH_CARRIER_REGEX =
  /\b(sandwich|sandwiches|sandwish|sandwiche|sando|sandos|sub|subs|baguette|franje|frenji|burger|burgers|wrap|wraps|saj|sajj|markouk|platter|platters|sa7en|sahen|wajbe|wajbet|meal|meals|salad|salads|pizza|pasta|سندويش|ساندويش|ساب|باجيت|برغر|صاج|مرقوق|صحن|وجبة|سلطة|بيتزا|باستا)\b/i;

const INSIDE_DISH_PHRASE_REGEX =
  /\b(b\s*alba|b\s*2alba|balba|b2alba|fiha|fiya|fia|with\s+[\w\s]{1,25}\s+in\b|فيها|بقلبها)\b/i;

const STANDALONE_SAUCE_OR_MEZZA_REGEX =
  /\b(sauce|sauces|dip|dips|hommos|7ommos|homos|7omos|hummus|7ummus|humus|toum|thoum|garlic|aioli|bbq|barbecue|caesar|cheddar\s+sauce|cocktail|mayo|mayonnaise|mustard|debes|debs|remen|remmen|balsamic|kabis|reb\s+7ar|reb\s+har|toum\s+w\s+7ar|toum\s+w\s+har|steak\s+sauce|thiery\s+sauce|burger\s+sauce|صوص|حمص|ثوم|توم|مايونيز|خردل|كبيس|دبس|رب\s+حر)\b/i;

const CARRIER_WORD_SET = new Set([
  'sandwich',
  'sandwiches',
  'sandwish',
  'sandwiche',
  'sando',
  'sandos',
  'sub',
  'subs',
  'burger',
  'burgers',
  'wrap',
  'wraps',
  'saj',
  'sajj',
  'salad',
  'salads',
  'pizza',
  'pasta',
  'platter',
  'platters',
  'mashewe',
  'mashawi',
  'mashawe',
  'meshwe',
  'mechwe',
  'سندويش',
  'ساندويش',
  'ساب',
  'برغر',
  'صاج',
  'سلطة',
  'بيتزا',
  'باستا',
  'مشاوي',
  'مشوي',
]);

function getStrictPositiveMatchedItems(
  message: string,
  storeData: any,
  excludedTerms: string[],
  budgetSpec?: BudgetAndComboSpec
): any[] {
  const rate = storeData.settings?.exchangeRate || 89000;
  const activeBudgetSpec = budgetSpec || extractBudgetAndComboSpec(message, rate);
  const qCombined = `${message} ${normalizeLebaneseFrancoText(message)}`.toLowerCase();
  const wantsDishWithIngredient =
    DISH_CARRIER_REGEX.test(qCombined) || INSIDE_DISH_PHRASE_REGEX.test(qCombined);
  const mentionsSauceOrMezza = STANDALONE_SAUCE_OR_MEZZA_REGEX.test(qCombined);

  const isAskingForDrinkOrSauce =
    !activeBudgetSpec.wantsCombo &&
    !wantsDishWithIngredient &&
    (/\b(drink|drinks|pepsi|7up|mirinda|water|juice|3asir|laymoun|orange|ayran|3ayran|laban|beer|bira|perrier|h2o|ice\s+tea|مشروب|عصير|مياه|عيران|لبن|بيرة)\b/i.test(
      qCombined
    ) ||
      mentionsSauceOrMezza);

  const allSafeItems = (storeData.items || []).filter(
    (i: any) => i.available !== false && !itemContainsExcludedTerm(i, excludedTerms)
  );
  const basePool = isAskingForDrinkOrSauce
    ? allSafeItems
    : allSafeItems.filter((i: any) => {
        const cat = String(i.category || '').toLowerCase();
        return !cat.includes('drink') && !cat.includes('sauce') && !cat.includes('beverage');
      });

  const budgetFilteredPool = basePool.filter((i: any) => itemFitsBudgetAndCombo(i, activeBudgetSpec));
  const pool = budgetFilteredPool.length > 0 ? budgetFilteredPool : basePool;

  const rawWords = resolveFuzzyMenuTokens(
    extractPositiveQueryWords(message, excludedTerms, activeBudgetSpec),
    storeData
  );
  // When asking for a dish with a specific sauce (e.g. "sando with bbq sauce"), drop generic word "sauce" so other sauces don't match
  const words =
    wantsDishWithIngredient && rawWords.length > 1
      ? rawWords.filter((w) => w !== 'sauce' && w !== 'sauces' && w !== 'صوص')
      : rawWords;

  if (!words.length) {
    if (
      (activeBudgetSpec.maxBudgetUsd !== null || activeBudgetSpec.wantsCombo) &&
      budgetFilteredPool.length > 0
    ) {
      return [...budgetFilteredPool].sort((a: any, b: any) => {
        const aPop = a.popular ? 1 : 0;
        const bPop = b.popular ? 1 : 0;
        if (bPop !== aPop) return bPop - aPop;
        return (a.order ?? 99) - (b.order ?? 99);
      });
    }
    return [];
  }

  const carrierWords = words.filter((w) => CARRIER_WORD_SET.has(w));
  const ingredientWords = words.filter((w) => !CARRIER_WORD_SET.has(w));
  const wantsHalfKilo = /\b(1\/2|half|nos|noss|نص|نصف)\b/i.test(qCombined);
  const wantsFullKilo = /\b(1\s*kg|1\s*kilo|kilo\s+mashewe|mashewe\s+bil\s+kilo|بالكيلو)\b/i.test(
    qCombined
  );
  const wantsDineIn = /\b(dine\s*in|bil\s*ma7al|bl\s*ma7al|bil\s*mahal|bl\s*mahal|بالمحل|بالصالة)\b/i.test(qCombined);
  const wantsDelivery = /\b(delivery|deliv|take\s*away|takeaway|ديليفري|دليفري)\b/i.test(qCombined);
  const wantsSmallSize = /\b(sghir|zghir|small|صغير)\b/i.test(qCombined);
  const wantsMediumSize = /\b(wassat|wasat|medium|وسط)\b/i.test(qCombined);
  const wantsLargeSize = /\b(kbir|kbeir|large|xl|1\.25|كبير)\b/i.test(qCombined);

  let matched = pool
    .map((item: any) => {
      let posScore = computePositiveKeywordScore(item, words);
      const titleLower = String(item?.title || '').toLowerCase();
      const catLower = String(item?.category || '').toLowerCase();

      if (catLower.includes('mashewe') && titleLower.includes('kg')) {
        if (wantsHalfKilo && titleLower.includes('1/2')) {
          posScore += 28;
        } else if (wantsFullKilo && !titleLower.includes('1/2')) {
          posScore += 24;
        }
      }
      if (titleLower.includes('farrouj')) {
        if (wantsHalfKilo && titleLower.includes('1/2')) posScore += 26;
        if (wantsDineIn && titleLower.includes('dine')) posScore += 24;
        if (wantsDelivery && titleLower.includes('deliv')) posScore += 24;
      }
      if (posScore > 0) {
        if (wantsSmallSize && (/\bs\.?\b|small/i.test(titleLower))) posScore += 18;
        if (wantsMediumSize && (/\bm\.?\b|medium/i.test(titleLower))) posScore += 18;
        if (wantsLargeSize && (/\bl\.?\b|\bxl\b|large|1\.25/i.test(titleLower))) posScore += 18;
      }

      const hasCarrierMatch =
        carrierWords.length > 0 ? computePositiveKeywordScore(item, carrierWords) > 0 : true;
      const hasIngredientMatch =
        ingredientWords.length > 0 ? computePositiveKeywordScore(item, ingredientWords) > 0 : false;

      // Compound bonus when an item satisfies BOTH the requested dish type (e.g. sandwich/sando/sub) AND the requested sauce/ingredient inside it
      if (wantsDishWithIngredient && hasCarrierMatch && hasIngredientMatch) {
        posScore += 45;
      }
      return {
        item,
        posScore,
        hasCarrierMatch,
        hasIngredientMatch,
      };
    })
    .filter((entry: any) => entry.posScore > 0);

  // Case 1: Guest asked for a Sandwich/Sub/Burger/Dish WITH a specific sauce/ingredient inside (e.g. "sando with toum in", "bade sandwiche b alba toum")
  if (wantsDishWithIngredient && ingredientWords.length > 0) {
    const bothMatched = matched.filter((e: any) => e.hasCarrierMatch && e.hasIngredientMatch);
    const ingredientOnlyMatched = matched.filter((e: any) => e.hasIngredientMatch);
    if (bothMatched.length > 0) {
      matched = bothMatched;
    } else if (ingredientOnlyMatched.length > 0) {
      matched = ingredientOnlyMatched;
    }
  }
  // Case 2: Guest asked for a standalone Sauce / Dip / Mezza (e.g. "bade 7ommos kamen", "bade toum", "honey mustard") without asking for a sandwich/platter
  else if (!wantsDishWithIngredient && mentionsSauceOrMezza) {
    const titleOrCatMatched = matched.filter((e: any) => {
      const titleLower = String(e.item?.title || '').toLowerCase();
      const catLower = String(e.item?.category || '').toLowerCase();
      return words.some((w) => titleLower.includes(w) || catLower.includes(w));
    });
    if (titleOrCatMatched.length > 0) {
      matched = titleOrCatMatched;
    }
  }

  matched.sort((a: any, b: any) => {
    if (b.posScore !== a.posScore) return b.posScore - a.posScore;
    const aPop = a.item.popular ? 1 : 0;
    const bPop = b.item.popular ? 1 : 0;
    if (aPop !== bPop) return bPop - aPop;
    return (a.item.order ?? 99) - (b.item.order ?? 99);
  });

  return matched.map((m: any) => m.item);
}

function selectVariedItemsFromPool(
  orderedMatches: any[],
  previouslyRecommendedIds: Set<string>,
  previousAssistantTurns: number,
  enforceCategoryDiversity: boolean,
  limit = 4
): any[] {
  if (!orderedMatches.length) return [];
  if (orderedMatches.length <= limit) return orderedMatches;

  const seenFamilies = new Set<string>();
  const primaryPool: any[] = [];
  const variantOverflow: any[] = [];

  for (const item of orderedMatches) {
    const fam = getDishFamilyKey(item);
    if (!seenFamilies.has(fam)) {
      seenFamilies.add(fam);
      primaryPool.push(item);
    } else {
      variantOverflow.push(item);
    }
  }

  const workingPool = primaryPool.length >= limit ? primaryPool : [...primaryPool, ...variantOverflow];

  const unseen = workingPool.filter((i) => !previouslyRecommendedIds.has(String(i.id)));
  const seen = workingPool.filter((i) => previouslyRecommendedIds.has(String(i.id)));

  const rotatedSeen =
    seen.length > 1
      ? [
          ...seen.slice((previousAssistantTurns * 2) % seen.length),
          ...seen.slice(0, (previousAssistantTurns * 2) % seen.length),
        ]
      : seen;

  const candidateOrder = [...unseen, ...rotatedSeen];

  if (!enforceCategoryDiversity) {
    return candidateOrder.slice(0, limit);
  }

  const distinctCategories = new Set(
    candidateOrder.map((i) => String(i.category || '').toLowerCase())
  );
  if (distinctCategories.size <= 1) {
    return candidateOrder.slice(0, limit);
  }

  const selected: any[] = [];
  const selectedIds = new Set<string>();
  const catCounts = new Map<string, number>();

  for (const item of candidateOrder) {
    if (selected.length >= limit) break;
    const id = String(item.id);
    const cat = String(item.category || '').toLowerCase();
    if (!selectedIds.has(id) && (catCounts.get(cat) || 0) === 0) {
      selected.push(item);
      selectedIds.add(id);
      catCounts.set(cat, 1);
    }
  }

  for (const item of candidateOrder) {
    if (selected.length >= limit) break;
    const id = String(item.id);
    const cat = String(item.category || '').toLowerCase();
    if (!selectedIds.has(id) && (catCounts.get(cat) || 0) < 2) {
      selected.push(item);
      selectedIds.add(id);
      catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
    }
  }

  for (const item of candidateOrder) {
    if (selected.length >= limit) break;
    const id = String(item.id);
    if (!selectedIds.has(id)) {
      selected.push(item);
      selectedIds.add(id);
    }
  }

  return selected;
}

const SIGNATURE_BEST_QUERY_REGEX =
  /\b(best|popular|atyab|2atyab|ashhar|2ashhar|favorite|top|recommend|special)\b|أطيب|اطيب|أشهر|اشهر|شو بتنصح/i;

function getSignatureBestPicksFromPool(pool: any[]): any[] {
  const picks: any[] = [];
  const usedIds = new Set<string>();

  const findAndAdd = (matcher: (item: any) => boolean) => {
    const found = pool.find((item) => !usedIds.has(String(item.id)) && matcher(item));
    if (found) {
      usedIds.add(String(found.id));
      picks.push(found);
    }
  };

  // 1. Famous Barbecue Chicken Sub (Famous Crispy BBQ)
  findAndAdd(
    (i) =>
      String(i.id) === '1YsUMiTfk2OBDpJpNnuQ' ||
      String(i.title || '').toLowerCase().includes('famous crispy bbq') ||
      (String(i.title || '').toLowerCase().includes('famous') &&
        String(i.title || '').toLowerCase().includes('bbq'))
  );

  // 2. Chicken Corano Sub (Chicken Corano)
  findAndAdd(
    (i) =>
      String(i.id) === 'd7RltNIWPyWLRnyzeVah' ||
      String(i.title || '').toLowerCase().includes('chicken corano')
  );

  // 3. Farrouj (Farrouj Dine In or Farrouj)
  findAndAdd(
    (i) =>
      String(i.id) === 'PtmFvRE079t6A0xJNI7N' ||
      String(i.title || '').toLowerCase() === 'farrouj dine in' ||
      String(i.title || '').toLowerCase().includes('farrouj')
  );

  // 4. Tawouk in Sandwiches (ID: sM7HMeH7eJXJ3IydhtzN, title: "Tawouk" in category "sandwiches")
  findAndAdd(
    (i) =>
      String(i.id) === 'sM7HMeH7eJXJ3IydhtzN' ||
      (String(i.category || '').toLowerCase().includes('sandwich') &&
        String(i.title || '').toLowerCase().trim() === 'tawouk')
  );
  if (picks.length < 4) {
    findAndAdd(
      (i) =>
        String(i.category || '').toLowerCase().includes('sandwich') &&
        String(i.title || '').toLowerCase().includes('tawouk')
    );
  }
  if (picks.length < 4) {
    findAndAdd((i) => String(i.title || '').toLowerCase().includes('tawouk'));
  }

  return picks;
}

function getTurnTargetItems(
  message: string,
  storeData: any,
  excludedTerms: string[],
  history: Array<{ role?: string; text?: string; recommendedItemIds?: string[] }> = [],
  budgetSpec?: BudgetAndComboSpec
): {
  turnItems: any[];
  strictMatches: any[];
  previousAssistantTurns: number;
  budgetSpec: BudgetAndComboSpec;
  isSignatureBestQuery?: boolean;
  healthyStage?: 'light_first' | 'salads_followup';
} {
  const rate = storeData.settings?.exchangeRate || 89000;
  const activeBudgetSpec = budgetSpec || extractBudgetAndComboSpec(message, rate);
  const { previouslyRecommendedIds, previousAssistantTurns } = extractHistoryRotationState(history);

  // Two-stage Light / Healthy / Diet / Regime rule:
  // Always show "light & healthy" category items first; if the guest keeps asking, show "salads".
  if (isLightHealthyDietRegimeQuery(message)) {
    const safePool = (storeData.items || []).filter(
      (i: any) =>
        i.available !== false &&
        !itemContainsExcludedTerm(i, excludedTerms) &&
        itemFitsBudgetAndCombo(i, activeBudgetSpec)
    );
    const lightItems = safePool
      .filter((i: any) => {
        const cat = String(i.category || '').toLowerCase();
        return cat.includes('light') || cat.includes('healthy');
      })
      .sort((a: any, b: any) => {
        const aPop = a.popular ? 1 : 0;
        const bPop = b.popular ? 1 : 0;
        if (bPop !== aPop) return bPop - aPop;
        return (a.order ?? 99) - (b.order ?? 99);
      });

    const saladItems = safePool
      .filter((i: any) => String(i.category || '').toLowerCase().includes('salad'))
      .sort((a: any, b: any) => {
        const aPop = a.popular ? 1 : 0;
        const bPop = b.popular ? 1 : 0;
        if (bPop !== aPop) return bPop - aPop;
        return (a.order ?? 99) - (b.order ?? 99);
      });

    const unseenLightItems = lightItems.filter(
      (i: any) => !previouslyRecommendedIds.has(String(i.id))
    );

    if (unseenLightItems.length > 0) {
      const turnItems = selectVariedItemsFromPool(
        lightItems,
        previouslyRecommendedIds,
        previousAssistantTurns,
        false,
        4
      );
      return {
        turnItems,
        strictMatches: lightItems,
        previousAssistantTurns,
        budgetSpec: activeBudgetSpec,
        healthyStage: 'light_first',
      };
    }

    if (saladItems.length > 0) {
      const turnItems = selectVariedItemsFromPool(
        saladItems,
        previouslyRecommendedIds,
        previousAssistantTurns,
        false,
        4
      );
      return {
        turnItems,
        strictMatches: saladItems,
        previousAssistantTurns,
        budgetSpec: activeBudgetSpec,
        healthyStage: 'salads_followup',
      };
    }
  }

  // Dedicated Lent / Meatless / Akel Ate3 ("Lent", "Lent food", "Lent menu", "ate3", "Akel ate3", "akl ati3", "food without meat", "bala lahme", "bala djej", "أكل قاطع") handler:
  if (isLentOrMeatlessQuery(message) || excludedTerms.includes('__LENT_OR_MEATLESS__')) {
    const lentTerms = Array.from(new Set([...excludedTerms, '__LENT_OR_MEATLESS__']));
    const allMeatlessItems = (storeData.items || []).filter(
      (i: any) =>
        i.available !== false &&
        !isItemMeatOrChicken(i) &&
        !itemContainsExcludedTerm(i, lentTerms) &&
        itemFitsBudgetAndCombo(i, activeBudgetSpec)
    );
    const meatlessFoodItems = allMeatlessItems.filter((i: any) => {
      const cat = String(i.category || '').toLowerCase();
      return !cat.includes('drink') && !cat.includes('sauce') && !cat.includes('beverage');
    });
    const workingMeatlessPool =
      meatlessFoodItems.length > 0 ? meatlessFoodItems : allMeatlessItems;

    const qLent = `${message} ${normalizeLebaneseFrancoText(message)}`.toLowerCase();
    const wantsSpecificBurger = /\b(burger|burgers|برغر)\b/i.test(qLent);
    const wantsSpecificPizza = /\b(pizza|pizzas|بيتزا)\b/i.test(qLent);
    const wantsSpecificFalafel = /\b(falafel|فلافل)\b/i.test(qLent);
    const wantsSpecificSubOrSando = /\b(sub|subs|sandwich|sandwiches|sandwish|sando|ساب|سندويش|ساندويش)\b/i.test(
      qLent
    );
    const wantsSpecificSalad = /\b(salad|salads|سلطة|سلطات)\b/i.test(qLent);

    const scoredLent = workingMeatlessPool
      .map((item: any) => {
        const baseLentScore = getLentPriorityScore(item);
        const titleLower = String(item.title || '').toLowerCase();
        const catLower = String(item.category || '').toLowerCase();
        let bonus = 0;

        if (wantsSpecificBurger && (catLower.includes('burger') || titleLower.includes('mozzarella pane'))) {
          bonus += 50;
        }
        if (wantsSpecificPizza && catLower.includes('pizza')) {
          bonus += 50;
        }
        if (wantsSpecificFalafel && (catLower.includes('falafel') || titleLower.includes('falafel'))) {
          bonus += 50;
        }
        if (
          wantsSpecificSubOrSando &&
          (catLower.includes('sub') ||
            catLower.includes('sandwich') ||
            catLower.includes('falafel') ||
            titleLower.includes('sub') ||
            titleLower.includes('sando'))
        ) {
          bonus += 40;
        }
        if (wantsSpecificSalad && (catLower.includes('salad') || titleLower.includes('salad'))) {
          bonus += 45;
        }
        if (item.popular) bonus += 6;

        return {
          item,
          score: baseLentScore + bonus,
          baseLentScore,
        };
      })
      .filter((entry: any) => entry.baseLentScore > 0);

    const primaryLentMatches = scoredLent
      .filter((e: any) => e.baseLentScore >= 58 || e.score >= 80)
      .sort((a: any, b: any) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.item.order ?? 99) - (b.item.order ?? 99);
      })
      .map((e: any) => e.item);

    const allRankedLentMatches = scoredLent
      .sort((a: any, b: any) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.item.order ?? 99) - (b.item.order ?? 99);
      })
      .map((e: any) => e.item);

    const orderedLentPool =
      primaryLentMatches.length >= 4 ? primaryLentMatches : allRankedLentMatches;

    if (orderedLentPool.length > 0) {
      const turnItems = selectVariedItemsFromPool(
        orderedLentPool,
        previouslyRecommendedIds,
        previousAssistantTurns,
        true,
        4
      );
      return {
        turnItems,
        strictMatches: orderedLentPool,
        previousAssistantTurns,
        budgetSpec: activeBudgetSpec,
      };
    }
  }

  const strictMatches = getStrictPositiveMatchedItems(
    message,
    storeData,
    excludedTerms,
    activeBudgetSpec
  );
  const q = `${message} ${normalizeLebaneseFrancoText(message)}`.toLowerCase();

  const isSingleCategoryQuery =
    /\b(mashewe|mashawi|mashawe|meshwe|mechwe|مشاوي|مشوي|pizza|بيتزا|falafel|فلافل|sajj|saj|صاج)\b/i.test(
      q
    );

  if (strictMatches.length > 0) {
    const turnItems = selectVariedItemsFromPool(
      strictMatches,
      previouslyRecommendedIds,
      previousAssistantTurns,
      !isSingleCategoryQuery,
      4
    );
    return { turnItems, strictMatches, previousAssistantTurns, budgetSpec: activeBudgetSpec };
  }

  const topicTag = classifyTopicTag(message);
  const isAskingForDrinkOrSauce =
    !activeBudgetSpec.wantsCombo &&
    /\b(drink|drinks|pepsi|water|juice|sauce|dip|مشروب|عصير|مياه|صوص)\b/i.test(q);
  const allAvailableItems: any[] = (storeData.items || []).filter(
    (i: any) => i.available !== false && !itemContainsExcludedTerm(i, excludedTerms)
  );
  const candidateItems = isAskingForDrinkOrSauce
    ? allAvailableItems
    : allAvailableItems.filter((i: any) => {
        const cat = String(i.category || '').toLowerCase();
        return !cat.includes('drink') && !cat.includes('sauce') && !cat.includes('beverage');
      });
  const basePool = candidateItems.length > 0 ? candidateItems : allAvailableItems;
  const budgetPool = basePool.filter((i: any) => itemFitsBudgetAndCombo(i, activeBudgetSpec));
  const pool = budgetPool.length > 0 ? budgetPool : basePool;

  const isSignatureBestQuery =
    SIGNATURE_BEST_QUERY_REGEX.test(q) &&
    topicTag !== 'Healthy & Light' &&
    !isAskingForDrinkOrSauce;

  if (isSignatureBestQuery) {
    const signatureFour = getSignatureBestPicksFromPool(pool);
    const allFourAlreadySeen =
      signatureFour.length > 0 &&
      signatureFour.every((item) => previouslyRecommendedIds.has(String(item.id)));
    if (signatureFour.length > 0 && !allFourAlreadySeen) {
      return {
        turnItems: signatureFour.slice(0, 4),
        strictMatches: [],
        previousAssistantTurns,
        budgetSpec: activeBudgetSpec,
        isSignatureBestQuery: true,
      };
    }
  }

  const isLentQuery = excludedTerms.includes('__LENT_OR_MEATLESS__') || isLentOrMeatlessQuery(message);

  const scored = pool.map((item) => {
    let score = 0;
    const catLower = String(item.category || '').toLowerCase();
    const descLower = String(item.desc || '').toLowerCase();
    if (isLentQuery) {
      score += getLentPriorityScore(item);
    }
    if (item.popular) score += 14;
    if (item.isNew) score += 5;
    if (descLower.length > 10) score += 4;
    if (
      topicTag === 'Healthy & Light' &&
      (catLower.includes('light') || catLower.includes('healthy') || catLower.includes('salad'))
    ) {
      score += 22;
    }
    return { item, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.item.order ?? 99) - (b.item.order ?? 99);
  });

  const rankedGeneralPool = scored.map((s) => s.item);
  const turnItems = selectVariedItemsFromPool(
    rankedGeneralPool,
    previouslyRecommendedIds,
    previousAssistantTurns,
    true,
    4
  );

  return {
    turnItems,
    strictMatches: [],
    previousAssistantTurns,
    budgetSpec: activeBudgetSpec,
    isSignatureBestQuery,
  };
}

const RESTAURANT_INFO_REGEX =
  /\b(delivery|deliver|tawsil|tawseel|phone|number|telefon|telephone|whatsapp|contact|opening\s+hours|open\s+now|fate7in|fat7in|halla2|when\s+do\s+you\s+open|when\s+do\s+you\s+close|aya\s+se3a|ayya\s+se3a|se3a\s+btefta7o|btefta7o|btsakro|betsakro|location|address|where\s+are\s+you|weyn|google\s+map|maw2a3|mawka3|3enwen|aenwen|kif\s+betlob|kif\s+b2dar\s+etlob|توصيل|دليفري|ديليفري|رقم|تلفون|هاتف|واتساب|ساعات\s+العمل|فاتحين|بتفتحوا|بتسكروا|موقعكم|عنوانكم|وين\s+موقعكم)\b/i;

const PROMO_OFFERS_QUERY_REGEX =
  /\b(promo|promotion|promotions|discount|discounts|offer|offers|deal|deals|3ouroudat|aouroudat|3ared|aared|7asem|hasem|عروضات|عروض|عرض|خصم|حسم)\b/i;

const COMPARISON_OR_CUSTOMIZATION_QUERY_REGEX =
  /\b(shu\s+l\s+fare2|chou\s+l\s+farek|fare2\s+bayn|farek\s+bayn|difference\s+between|compare|fiha|fiya|shu\s+b\s*alba|chou\s+b\s*alba|what\s+is\s+in|what's\s+in|ingredients?\s+of|fini\s+otlob|fik\s+tshil|zyede|zyedeh|katter|3a\s+jnab|on\s+the\s+side|m7ammas|toasted|شو\s+الفرق|الفرق\s+بين|فيا|فيها|شو\s+مكونات|زيادة|كتّر|عجنب|محمّص)\b/i;

function getActivePromoDetailsForAi(storeData: any): {
  active: boolean;
  badgeText: string;
  targetName: string;
  promoItems: any[];
  summaryEn: string;
  summaryLb: string;
  summaryAr: string;
} {
  const settings = storeData?.settings || {};
  const enabled = settings.promoBannerEnabled !== false && Boolean(settings.promoBannerUrl);
  const discType = settings.promoDiscountType;
  const discVal = Number(settings.promoDiscountValue || 0);
  if (!enabled || (discType !== 'percentage' && discType !== 'fixed') || discVal <= 0) {
    return {
      active: false,
      badgeText: '',
      targetName: '',
      promoItems: [],
      summaryEn: '',
      summaryLb: '',
      summaryAr: '',
    };
  }

  const currency: 'USD' | 'LBP' = settings.currency === 'LBP' ? 'LBP' : 'USD';
  const rate = Number(settings.exchangeRate || 89000);
  const badgeText =
    discType === 'percentage'
      ? `${Math.round(discVal)}% OFF`
      : `-${formatItemPriceForAi(discVal, currency, rate)}`;

  const linkType = settings.promoBannerLinkType || 'none';
  const targetVal = String(settings.promoBannerLinkValue || '').trim().toLowerCase();
  const availableItems = (storeData?.items || []).filter((i: any) => i.available !== false);

  let promoItems: any[] = [];
  let targetName = 'selected menu items';

  if (linkType === 'item' && targetVal) {
    promoItems = availableItems.filter(
      (i: any) =>
        String(i.id || '').toLowerCase() === targetVal ||
        String(i.title || '').toLowerCase() === targetVal
    );
    if (promoItems[0]) targetName = promoItems[0].title;
  } else if (linkType === 'category' && targetVal) {
    promoItems = availableItems.filter((i: any) => {
      const itemCat = String(i.category || '').toLowerCase();
      if (itemCat === targetVal) return true;
      const catObj = (storeData?.categories || []).find(
        (c: any) => String(c.id || '').toLowerCase() === targetVal
      );
      return catObj ? itemCat === String(catObj.name || '').toLowerCase() : false;
    });
    targetName = targetVal.charAt(0).toUpperCase() + targetVal.slice(1);
  }

  if (promoItems.length === 0) {
    return {
      active: false,
      badgeText: '',
      targetName: '',
      promoItems: [],
      summaryEn: '',
      summaryLb: '',
      summaryAr: '',
    };
  }

  const computeDiscountedUsd = (rawUsd: number): number => {
    if (discType === 'percentage') {
      return Math.max(0, Number((rawUsd * (1 - discVal / 100)).toFixed(2)));
    }
    return Math.max(0, Number((rawUsd - discVal).toFixed(2)));
  };

  const sampleList = promoItems
    .slice(0, 3)
    .map((i: any) => {
      const origPrice = formatItemPriceForAi(i.price, currency, rate);
      const newUsd = computeDiscountedUsd(Number(i.price || 0));
      const newPrice = formatItemPriceForAi(newUsd, currency, rate);
      return `${i.title} (now ${newPrice} instead of ${origPrice})`;
    })
    .join(', ');

  return {
    active: true,
    badgeText,
    targetName,
    promoItems: promoItems.slice(0, 4),
    summaryEn: `Today's active promo is ${badgeText} on ${targetName}: ${sampleList}!`,
    summaryLb: `3anna 3ared khas el youm (${badgeText}) 3ala ${targetName}: ${sampleList}!`,
    summaryAr: `لدينا عرض خاص اليوم (${badgeText}) على ${targetName}: ${sampleList}!`,
  };
}

function shouldUseInstantDeterministicFastPath(
  message: string,
  exclusions: { excludedTerms: string[] },
  budgetSpec: BudgetAndComboSpec,
  strictMatches: any[]
): boolean {
  const q = `${message} ${normalizeLebaneseFrancoText(message)}`.toLowerCase();
  if (COMPARISON_OR_CUSTOMIZATION_QUERY_REGEX.test(q) && exclusions.excludedTerms.length === 0) {
    return false;
  }
  if (PROMO_OFFERS_QUERY_REGEX.test(q)) return true;
  if (exclusions.excludedTerms.length > 0) return true;
  if (isLentOrMeatlessQuery(message)) return true;
  if (isLightHealthyDietRegimeQuery(message)) return true;
  if (budgetSpec.maxBudgetUsd !== null || budgetSpec.wantsCombo) return true;
  if (strictMatches.length > 0) return true;
  if (RESTAURANT_INFO_REGEX.test(q)) return true;
  if (
    /\b(popular|best|top|recommend|favorite|special|atyab|ashhar|betnasahne|btensah|moukheef|healthy|light|diet|regime|rejim|rjim|so77e|so7e|sa77e|sa7e|khafif|5afif|lent|lenten|ate3|2ate3|aate3|kate3|qate3|siyam|syam|vegetarian|vegan|nebate|nabati|sharing|family|group|3ayle|aayle|jem3a|jam3a|sahra|jou3an|yshabbe3|ghada|3asha|sahar|wled|kids|crispy|pane|cheesy|mashewe|mashawi|farrouj|sfine|fahem|burger|sub|sandwich|sandwish|sajj|saj|salad|pizza|pasta|أطيب|أشهر|صحي|دايت|لايت|ريجيم|رجيم|قاطع|صيامي|نباتي|عيلة|عائلة|جمعة|مشاوي|جوعان|غدا|عشا|صاج)\b/i.test(
      q
    )
  ) {
    return true;
  }
  return false;
}

function runDeterministicMenuMatcher(
  message: string,
  storeData: any,
  history: Array<{ role?: string; text?: string; recommendedItemIds?: string[] }> = []
): {
  reply: string;
  recommendedItemIds: string[];
  summary: string;
  topicTag: string;
  language: 'English' | 'Lebanese' | 'Arabic';
} {
  const lang = detectUserLanguage(message);
  const topicTag = classifyTopicTag(message);
  const currency: 'USD' | 'LBP' = storeData.settings?.currency === 'LBP' ? 'LBP' : 'USD';
  const rate = storeData.settings?.exchangeRate || 89000;
  const exclusions = extractExclusionsFromMessage(message);
  const budgetSpec = extractBudgetAndComboSpec(message, rate);
  const q = `${message} ${normalizeLebaneseFrancoText(message)}`.toLowerCase();
  const promoDetails = getActivePromoDetailsForAi(storeData);

  if (PROMO_OFFERS_QUERY_REGEX.test(q) && promoDetails.active) {
    const promoPicks = promoDetails.promoItems;
    const reply =
      lang === 'Arabic'
        ? `أهلاً وسهلاً بك! ${promoDetails.summaryAr} تصفح الأصناف بالأسفل للطلب مباشرة.`
        : lang === 'Lebanese'
        ? `Ahla w sahla! Tekram 3aynak — ${promoDetails.summaryLb} Choufon ta7et بالصورة!`
        : `Welcome to Corano! ${promoDetails.summaryEn} Tap any card below to view details.`;
    return {
      reply,
      recommendedItemIds: promoPicks.map((p: any) => String(p.id)),
      summary: `Guest asked about active promos; highlighted ${promoDetails.badgeText} on ${promoDetails.targetName}.`,
      topicTag: 'Prices & Budget',
      language: lang,
    };
  }

  const {
    turnItems: topPicks,
    previousAssistantTurns,
    isSignatureBestQuery,
    healthyStage,
  } = getTurnTargetItems(message, storeData, exclusions.excludedTerms, history, budgetSpec);

  const wantsDetailedIngredients = COMPARISON_OR_CUSTOMIZATION_QUERY_REGEX.test(q);
  const pickNames = topPicks
    .map((p) => {
      const priceText = formatItemPriceWithComboBreakdown(p, currency, rate, budgetSpec);
      if (wantsDetailedIngredients && p.desc) {
        return `${p.title} (${priceText} — ${p.desc})`;
      }
      return `${p.title} (${priceText})`;
    })
    .join(', ');

  const isMasheweQuery =
    /\b(mashewe|mashawi|mashawe|meshwe|mechwe|grill|grilled|مشاوي|مشوي)\b/i.test(q);
  const isInfoQuery = RESTAURANT_INFO_REGEX.test(q);
  const variantIdx = previousAssistantTurns % 3;

  let reply = '';
  if (
    isInfoQuery &&
    exclusions.excludedTerms.length === 0 &&
    !budgetSpec.wantsCombo &&
    budgetSpec.maxBudgetUsd === null
  ) {
    if (lang === 'Arabic') {
      reply = `أهلاً وسهلاً! نفتح يومياً من 11:00 صباحاً حتى 12:00 منتصف الليل، وللتوصيل تواصل معنا على 03220810 أو عبر واتساب. إليك أيضاً أشهر أطباقنا: ${pickNames}!`;
    } else if (lang === 'Lebanese') {
      reply = `Ahla w sahla! Maftou7in kel youm 11:00 AM – 12:00 AM, w lal delivery e7kina 3ala 03 220 810 aw WhatsApp. W hayde men atyab asnafna: ${pickNames}!`;
    } else {
      reply = `Welcome to Corano! We're open daily 11:00 AM – 12:00 AM; call or WhatsApp +961 3 220 810 for delivery. Here are also top picks to try: ${pickNames}!`;
    }
  } else if (exclusions.excludedTerms.includes('__LENT_OR_MEATLESS__') || isLentOrMeatlessQuery(message)) {
    if (lang === 'Arabic') {
      const arLentTemplates = [
        `تكرم عينك! إليك أطيب خيارات الأكل القاطع / الصيامي المحضرة بدون لحم أو دجاج لدينا: ${pickNames}. شوف الأصناف بالأسفل!`,
        `بكل سرور! إليك تشكيلة ثانية من الأكل القاطع الخالي تماماً من اللحم والدجاج: ${pickNames}.`,
        `أهلاً بك! نرشح لك أيضاً هذه الأصناف الشهية من الأكل القاطع: ${pickNames}!`,
      ];
      reply = arLentTemplates[variantIdx];
    } else if (lang === 'Lebanese') {
      const lbLentTemplates = [
        `Ahla w sahla! Tekram 3aynak, hayde atyab kheyarat el akel el ate3 (bala la7me w bala djej): ${pickNames}. Choufon ta7et!`,
        `Min 3youne! Hayde تشكيلة tenye men atyab el akel el ate3 3anna: ${pickNames}.`,
        `Miyet ahla! Jareb kamen hal asnaf el taybe men el akel el ate3: ${pickNames}!`,
      ];
      reply = lbLentTemplates[variantIdx];
    } else {
      const enLentTemplates = [
        `Welcome to Corano! Here are our top Lent & meatless dishes prepared completely without meat or chicken: ${pickNames}.`,
        `Here are more delicious Lent & meatless favorites from our kitchen: ${pickNames}!`,
        `Happy to help! You can also enjoy these fresh meatless picks: ${pickNames}.`,
      ];
      reply = enLentTemplates[variantIdx];
    }
  } else if (healthyStage === 'light_first') {
    if (lang === 'Arabic') {
      reply = `أهلاً وسهلاً! للأكل الصحي والدايت، ننصحك أولاً بتشكيلة قسم Light & Healthy الخفيفة والغنية بالبروتين: ${pickNames}.`;
    } else if (lang === 'Lebanese') {
      reply = `Ahla w sahla! Lal diet w el akel el so77e, jarreb awwal shi تشكيلة el Light & Healthy 3anna: ${pickNames}!`;
    } else {
      reply = `Welcome to Corano! For a clean, diet-friendly meal, try these favorites from our Light & Healthy menu: ${pickNames}.`;
    }
  } else if (healthyStage === 'salads_followup') {
    if (lang === 'Arabic') {
      reply = `تكرم عينك! بالإضافة لقسم اللايت، إليك أشهى السلطات الطازجة والصحية لدينا: ${pickNames}.`;
    } else if (lang === 'Lebanese') {
      reply = `Tekram 3aynak! Bil idafe lal Light & Healthy, hayde atyab el Salads el fresh 3anna: ${pickNames}!`;
    } else {
      reply = `Here are our fresh, nutrient-packed salads from our Salads section that are great for your diet: ${pickNames}!`;
    }
  } else if (exclusions.excludedTerms.length > 0) {
    if (lang === 'Arabic') {
      const arTemplates = [
        `من عيوني! هذه الأطباق محضرة بدون ${exclusions.labelsAr.join(' أو ')}: ${pickNames}. ويمكنك طلب أي تعديل إضافي عند الطلب!`,
        `تكرم عينك! إليك خيارات أخرى شهية خالية من ${exclusions.labelsAr.join(' أو ')}: ${pickNames}.`,
        `أهلاً بك! نرشح لك أيضاً هذه الأصناف بدون ${exclusions.labelsAr.join(' أو ')}: ${pickNames}.`,
      ];
      reply = arTemplates[variantIdx];
    } else if (lang === 'Lebanese') {
      const lbTemplates = [
        `Min 3youne! Hayde atyab el asnaf 3anna bala ${exclusions.labelsLb.join(' aw ')}: ${pickNames}. W fik totlob ayya ta3dil 3al WhatsApp!`,
        `Tekram 3aynak! Hayde kamen kheyarat tenye taybe bala ${exclusions.labelsLb.join(' aw ')}: ${pickNames}.`,
        `Miyet ahla! Jareb kamen hal asnaf el fresh bala ${exclusions.labelsLb.join(' aw ')}: ${pickNames}!`,
      ];
      reply = lbTemplates[variantIdx];
    } else {
      const enTemplates = [
        `Certainly! Here are delicious options prepared without ${exclusions.labelsEn.join(' or ')}: ${pickNames}.`,
        `Here are more fresh options from our kitchen made without ${exclusions.labelsEn.join(' or ')}: ${pickNames}!`,
        `Happy to help! You can also enjoy these dishes prepared without ${exclusions.labelsEn.join(' or ')}: ${pickNames}.`,
      ];
      reply = enTemplates[variantIdx];
    }
  } else if (budgetSpec.wantsCombo || budgetSpec.maxBudgetUsd !== null) {
    const budgetLabel =
      budgetSpec.maxBudgetUsd !== null
        ? formatItemPriceForAi(budgetSpec.maxBudgetUsd, currency, rate)
        : '';
    if (lang === 'Arabic') {
      reply = budgetLabel
        ? `تكرم عينك! إليك أطيب الخيارات مع كومبو (بطاطا وبيبسي) ضمن ميزانية ${budgetLabel}: ${pickNames}.`
        : `أهلاً وسهلاً! إليك أطيب الخيارات مع كومبو (بطاطا وبيبسي): ${pickNames}.`;
    } else if (lang === 'Lebanese') {
      reply = budgetLabel
        ? `Tekram 3aynak! Hayde atyab el asnaf ma3 Combo (Batata w Pepsi) b 7doud el ${budgetLabel}: ${pickNames}!`
        : `Ahla w sahla! Hayde atyab el asnaf ma3 Combo (Batata w Pepsi): ${pickNames}!`;
    } else {
      reply = budgetLabel
        ? `Here are our top picks with the Combo (Fries & Drink) within your ${budgetLabel} budget: ${pickNames}!`
        : `Here are our top picks available with the full Combo (Fries & Drink): ${pickNames}!`;
    }
  } else if (isMasheweQuery) {
    if (lang === 'Arabic') {
      const arMashewe = [
        `أهلاً وسهلاً! لدينا مشاوي عالفحم (لحمة، طاووق، فروج، كفتة، كباب، مشكل، وبالكيلو/نصف كيلو). ننصحك بـ: ${pickNames}!`,
        `تكرم عينك! إليك المزيد من أشهى أطباق المشاوي على الفحم لدينا: ${pickNames}.`,
        `من ركن المشاوي على الفحم في كورانو، نرشح لك أيضاً: ${pickNames}!`,
      ];
      reply = arMashewe[variantIdx];
    } else if (lang === 'Lebanese') {
      const lbMashewe = [
        `Ahla w sahla! 3anna mashewe 3al fahem (Lahme, Tawouk, Farrouj, Kafta, Kabab, Mixed Grill, w bil kilo/nos kilo). Jarreb: ${pickNames}!`,
        `Tekram 3aynak! Hayde تشكيلة tenye men atyab el mashewe 3al fahem 3anna: ${pickNames}.`,
        `Men atyab el mashewe 3al fahem bi Corano kamen fik tjareb: ${pickNames}!`,
      ];
      reply = lbMashewe[variantIdx];
    } else {
      const enMashewe = [
        `Welcome to Corano! We serve charcoal Lahme, Tawouk, Farrouj, Kafta, Kabab, Mixed Grill, plus 1/2 kg & 1 kg platters. Try: ${pickNames}!`,
        `Here are more delicious charcoal-grilled Mashewe picks from our grill: ${pickNames}!`,
        `From our charcoal grill, we also highly recommend trying: ${pickNames}.`,
      ];
      reply = enMashewe[variantIdx];
    }
  } else if (isSignatureBestQuery) {
    if (lang === 'Arabic') {
      reply = `أهلاً وسهلاً! أشهر 4 أصناف لدينا هي Famous Crispy BBQ Sub، Chicken Corano Sub، الفروج المشوي، والطاووق: ${pickNames}!`;
    } else if (lang === 'Lebanese') {
      reply = `Ahla w sahla! Ashhar 4 asnaf 3anna henni Famous Crispy BBQ Sub, Chicken Corano Sub, Farrouj 3al fahem, w Tawouk: ${pickNames}!`;
    } else {
      reply = `Welcome to Corano! Our 4 signature best-sellers are Famous Crispy BBQ Sub, Chicken Corano Sub, Charcoal Farrouj, and Tawouk: ${pickNames}!`;
    }
  } else if (lang === 'Arabic') {
    const arGeneral = [
      `أهلاً وسهلاً بك في كورانو! تكرم عينك، ننصحك بتجربة هذه الأصناف الشهية: ${pickNames}. تصفحها بالأسفل!`,
      `من عيوني! إليك تشكيلة ثانية مميزة تناسب طلبك: ${pickNames}.`,
      `صحتين سلف! نرشح لك أيضاً تجربة هذه الأصناف الطازجة: ${pickNames}!`,
    ];
    reply = arGeneral[variantIdx];
  } else if (lang === 'Lebanese') {
    const lbGeneral = [
      `Ahla w sahla! Tekram 3aynak, bansa7ak tjareb hal asnaf el taybe 3anna: ${pickNames}. Choufon ta7et!`,
      `Min 3youne! Hayde تشكيلة tenye taybe ktir bteneseb talabak: ${pickNames}.`,
      `Sa7tein salaf! Jareb kamen hal kheyarat el fresh men matbakh Corano: ${pickNames}!`,
    ];
    reply = lbGeneral[variantIdx];
  } else {
    const enGeneral = [
      `Welcome to Corano! Based on your craving, we recommend trying: ${pickNames}. Tap any card below for details!`,
      `Here is another delicious selection from our kitchen that matches your request: ${pickNames}.`,
      `Happy to recommend more! You'll also love these freshly prepared picks: ${pickNames}!`,
    ];
    reply = enGeneral[variantIdx];
  }

  return {
    reply,
    recommendedItemIds: topPicks.map((p) => String(p.id)),
    summary: `Guest asked about ${topicTag.toLowerCase()} ("${message.slice(
      0,
      60
    )}"); recommended ${topPicks.map((p) => p.title).join(', ')}.`,
    topicTag,
    language: lang,
  };
}

function buildCoranoMenuSystemPrompt(
  storeData: any,
  excludedTerms: string[] = [],
  turnItems: any[] = [],
  previousAssistantTurns = 0,
  budgetSpec: BudgetAndComboSpec = { maxBudgetUsd: null, wantsCombo: false }
): string {
  const currency: 'USD' | 'LBP' = storeData.settings?.currency === 'LBP' ? 'LBP' : 'USD';
  const rate = storeData.settings?.exchangeRate || 89000;
  const promoDetails = getActivePromoDetailsForAi(storeData);

  const outOfStockTitles: string[] = [];
  const safeAvailableItems: any[] = [];

  for (const item of storeData.items || []) {
    if (item.available === false) {
      outOfStockTitles.push(String(item.title || ''));
      continue;
    }
    if (itemContainsExcludedTerm(item, excludedTerms)) {
      continue;
    }
    safeAvailableItems.push(item);
  }

  // Cap menu context to top 20 most relevant available dishes (turnItems first, then popular/top-ordered)
  // to cut prompt token size by 75% for 4x faster LLM inference
  const turnIdSet = new Set(turnItems.map((i) => String(i.id)));
  const prioritizedContextItems = [
    ...turnItems,
    ...safeAvailableItems
      .filter((i) => !turnIdSet.has(String(i.id)))
      .sort((a, b) => {
        const aPop = a.popular ? 1 : 0;
        const bPop = b.popular ? 1 : 0;
        if (bPop !== aPop) return bPop - aPop;
        return (a.order ?? 99) - (b.order ?? 99);
      }),
  ].slice(0, 20);

  const availableLines = prioritizedContextItems.map((item) => {
    const priceStr = formatItemPriceWithComboBreakdown(item, currency, rate, budgetSpec);
    const popFlag = item.popular ? ' [★ POPULAR]' : '';
    const descStr = item.desc ? ` | Ingredients: ${item.desc}` : '';
    return `ID:${item.id} | Name: ${item.title} | Category: ${item.category} | Price: ${priceStr}${popFlag}${descStr}`;
  });

  const promoRuleBlock = promoDetails.active
    ? `\nACTIVE PROMO DISCOUNT TODAY:\n- ${promoDetails.summaryEn}\n- Mention this promo if the guest asks about offers, discounts, promos ("3ouroudat"), or the discounted item/category!\n`
    : '';

  const budgetAndComboRuleBlock =
    budgetSpec.wantsCombo || budgetSpec.maxBudgetUsd !== null
      ? `\nBUDGET & COMBO ("MA3 PEPSI W BATATA") RULE ACTIVE FOR THIS QUESTION:\n- The guest asked for ${
          budgetSpec.wantsCombo ? 'a Combo (with Fries / Batata & Drink / Pepsi)' : 'dishes'
        }${
          budgetSpec.maxBudgetUsd !== null
            ? ` under a maximum budget of ${formatItemPriceForAi(budgetSpec.maxBudgetUsd, currency, rate)}`
            : ''
        }.\n- In your reply, explicitly state each recommended dish's base price AND its +${formatItemPriceForAi(
          2.81,
          currency,
          rate
        )} Combo (Fries & Drink) total so the guest sees the exact math under their budget!\n`
      : '';

  const priorityHighlightBlock =
    turnItems.length > 0
      ? `\nSELECTED DISHES FOR THIS TURN (YOU MUST RETURN THESE EXACT IDs IN recommendedItemIds AND HIGHLIGHT THEM IN YOUR REPLY):\n${turnItems
          .map(
            (item) =>
              `- ID:${item.id} | Name: ${item.title} | Category: ${item.category} | Price: ${formatItemPriceWithComboBreakdown(
                item,
                currency,
                rate,
                budgetSpec
              )}${item.desc ? ` | Ingredients: ${item.desc}` : ''}`
          )
          .join('\n')}\n`
      : '';

  const repeatVarietyBlock =
    previousAssistantTurns > 0
      ? `\nFOLLOW-UP / REPEAT QUESTION VARIETY RULE (Turn #${previousAssistantTurns + 1} in this chat):\n- Do NOT repeat your exact wording or opening sentence from earlier messages in this chat.\n- Vary your tone naturally and introduce the newly selected dishes listed in SELECTED DISHES FOR THIS TURN above!\n`
      : '';

  return `You are "Corano AI", the warm, hospitable Lebanese AI Waiter at Corano Restaurant in Lebanon (Open daily 11:00 AM - 12:00 AM, Phone/WhatsApp: 03 220 810).
Your job is to help guests choose dishes, compare items, answer ingredient or allergy questions accurately, and recommend 1 to 4 dishes from our LIVE AVAILABLE MENU below.

STRICT RULES:
1. LANGUAGE MIRRORING & LEBANESE HOSPITALITY:
   - If the guest writes in English -> reply in warm, appetizing English (set language="English").
   - If the guest writes in Lebanese Franco / Arabizi -> reply naturally in warm Lebanese Franco / Arabizi using authentic phrases like "Ahla w sahla!", "Tekram 3aynak!", "Min 3youne!", "Sa7tein!" (set language="Lebanese").
   - If the guest writes in Arabic script (العربية) -> reply in natural Lebanese/Arabic script (set language="Arabic").
2. RELY ON ITEM NAME, CATEGORY, AND INGREDIENTS:
   - Always check the item's Name, Category, AND Ingredients for every question (including "fiha...", "shu l fare2 bayn...", or customization questions like "zyede toum", "bala basal", "sauce 3a jnab", "m7ammas").
3. STRICT INGREDIENT & ALLERGY EXCLUSION ("WITHOUT" / "BALA" / "3ANDE 7ASESIYE" / "بدون" / "بلا"):
   - When a guest asks for food WITHOUT an ingredient or mentions an allergy (e.g. "without garlic", "bala toum", "no mayo", "bla basal", "nut allergy / jawz", "dairy / mashta2at 7alib"), NEVER recommend any dish whose Name or Ingredients contains that ingredient.
4. USE THE SELECTED DISHES FOR THIS TURN:
   - Use the exact IDs listed in "SELECTED DISHES FOR THIS TURN" for your recommendedItemIds array and naturally mention those dishes in your reply.
5. ONLY RECOMMEND IN-STOCK ITEMS:
   - Never recommend out-of-stock items (${outOfStockTitles.length > 0 ? outOfStockTitles.join(', ') : 'none currently out of stock'}).
6. EXACT PRICES:
   - Quote the exact prices shown in the menu below (${currency === 'LBP' ? 'in L.L.' : 'in $ USD'}).
7. KEEP REPLIES SHORT & CRISP (2 TO 2.5 LINES / 1 TO 2 SENTENCES MAX):
   - Because interactive Dish Cards with photos, titles, and prices appear right below your text bubble, keep your reply super concise (around 2 to 2.5 lines max)! Only list full ingredients in text when the guest specifically asks what is inside a dish or asks for the difference ("shu l fare2") between dishes.
8. Set topicTag to one of: "Popular & Best Sellers", "Burgers & Subs", "Healthy & Light", "Ingredients & Allergies", "Spicy Dishes", "Prices & Budget", "Sandwiches & Wraps", "Pizza & Pasta", "General Inquiry".
9. Set summary to a 1-sentence English summary for the restaurant owner.

FEW-SHOT STYLE EXAMPLES (2 TO 2.5 LINES MAX):
- Guest (Lebanese Franco - Craving): "shu betnasahne baddi shi tayeb w yshabbe3 lal ghada?"
  Reply: "Ahla w sahla! Tekram 3aynak — eza jou3an jarreb el Chicken Corano aw Chicken Thierry bl Subs, aw el Truffle Burger w Charcoal Tawouk. Choufon ta7et!"
- Guest (Lebanese Franco - Ingredients & Customization): "fiha toum l chicken sub? w fini otloba zyede toum w bala basal?"
  Reply: "Min 3youne! El Chicken Sub fiha chicken breast, khas, banadoura, kabis, mixed cheese w aioli sauce, w akid fik totloba zyede toum aw bala basal بس تحكينا عالواتساب!"
- Guest (Lebanese Franco - Comparison): "shu l fare2 bayn chicken corano w chicken thierry?"
  Reply: "Ahla fik! El Chicken Corano fiha chicken breast, jebne, basal, sweet pepper w special sauce, baynama el Chicken Thierry fiha marinated chicken ma3 fries, salameh, jebne w honey mustard!"
- Guest (English - Gym / High Protein): "What do you recommend for a clean high-protein meal after the gym?"
  Reply: "Welcome to Corano! Try our Chicken Breast Platter with grilled potatoes, our Light Chicken or Chicken Avocado in 24cm brown bread, or our Quinoa Salad."
- Guest (Arabic - Gathering / Sahra): "نحنا سهرانين ٤ اشخاص شو عندكن مشاوي ومقبلات للمشاركة؟"
  Reply: "أهلا وسهلا فيكن! للسهرة بنصحكن بصحن المشاوي المشكل أو كيلو مشاوي عالفحم، ومعهن حمص، بطاطا حرة ودزينة رقاقات جبنة أو سمبوسك. صحتين سلف!"
${promoRuleBlock}${budgetAndComboRuleBlock}${priorityHighlightBlock}${repeatVarietyBlock}
TOP RELEVANT CORANO MENU DISHES (${availableLines.length} dishes):
${availableLines.join('\n')}`;
}

async function generateCoranoAiResponse(
  message: string,
  history: Array<{ role: string; text: string; recommendedItemIds?: string[] }>,
  storeData: any
): Promise<{
  reply: string;
  recommendedItemIds: string[];
  summary: string;
  topicTag: string;
  language: 'English' | 'Lebanese' | 'Arabic';
}> {
  const rate = storeData.settings?.exchangeRate || 89000;
  const exclusions = extractExclusionsFromMessage(message);
  const budgetSpec = extractBudgetAndComboSpec(message, rate);
  const { turnItems, strictMatches, previousAssistantTurns } = getTurnTargetItems(
    message,
    storeData,
    exclusions.excludedTerms,
    history,
    budgetSpec
  );

  // Instant Sub-Second Fast-Path (< 0.2s) for pre-written prompts, strict menu matches, ingredient exclusions, and Budget/Combo queries
  if (shouldUseInstantDeterministicFastPath(message, exclusions, budgetSpec, strictMatches)) {
    return runDeterministicMenuMatcher(message, storeData, history);
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return runDeterministicMenuMatcher(message, storeData, history);
  }

  const strictMatchIds = new Set(strictMatches.map((m: any) => String(m.id)));
  const turnTargetIds = turnItems.map((i: any) => String(i.id));
  const systemInstruction = buildCoranoMenuSystemPrompt(
    storeData,
    exclusions.excludedTerms,
    turnItems,
    previousAssistantTurns,
    budgetSpec
  );
  const conversationContext =
    history.length > 0
      ? `Recent conversation:\n${history
          .map((h) => `${h.role === 'user' ? 'Guest' : 'Corano AI'}: ${String(h.text || '').slice(0, 300)}`)
          .join('\n')}\n\nGuest's latest message: ${message}`
      : `Guest's message: ${message}`;

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 3200,
      retryOptions: {
        attempts: 1,
      },
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      reply: {
        type: Type.STRING,
        description: 'Warm, concise reply in the guest language (English, Lebanese Franco, or Arabic).',
      },
      recommendedItemIds: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Up to 4 exact item IDs from the LIVE AVAILABLE CORANO MENU.',
      },
      summary: {
        type: Type.STRING,
        description: '1-sentence English summary of what the guest asked and what was recommended.',
      },
      topicTag: {
        type: Type.STRING,
        description:
          'One of: Popular & Best Sellers, Burgers & Subs, Healthy & Light, Ingredients & Allergies, Spicy Dishes, Prices & Budget, Sandwiches & Wraps, Pizza & Pasta, General Inquiry.',
      },
      language: {
        type: Type.STRING,
        description: 'One of: English, Lebanese, Arabic.',
      },
    },
    required: ['reply', 'recommendedItemIds', 'summary', 'topicTag', 'language'],
  };

  // Single fast Gemini call (gemini-2.5-flash with thinkingBudget: 0 and strict 3200ms timeout)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3200);
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: conversationContext,
      config: {
        abortSignal: controller.signal,
        temperature: previousAssistantTurns > 0 ? 0.55 : 0.35,
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    clearTimeout(timer);
    const rawText = (response.text ?? '').trim();
    if (rawText) {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed.reply === 'string' && parsed.reply.trim()) {
        const lang: 'English' | 'Lebanese' | 'Arabic' =
          parsed.language === 'Arabic' || parsed.language === 'Lebanese'
            ? parsed.language
            : detectUserLanguage(message);

        let finalIds = turnTargetIds.slice(0, 4);
        if (finalIds.length === 0) {
          finalIds = (Array.isArray(parsed.recommendedItemIds) ? parsed.recommendedItemIds : [])
            .map(String)
            .filter((id: string) => {
              const found = (storeData.items || []).find((i: any) => String(i.id) === id);
              if (!found || found.available === false) return false;
              if (itemContainsExcludedTerm(found, exclusions.excludedTerms)) return false;
              if (strictMatchIds.size > 0 && !strictMatchIds.has(id)) return false;
              return true;
            })
            .slice(0, 4);
        }

        return {
          reply: parsed.reply.trim(),
          recommendedItemIds: finalIds,
          summary:
            typeof parsed.summary === 'string' && parsed.summary.trim()
              ? parsed.summary.trim()
              : `Guest asked: "${message.slice(0, 70)}"`,
          topicTag:
            typeof parsed.topicTag === 'string' && parsed.topicTag.trim()
              ? parsed.topicTag.trim()
              : classifyTopicTag(message),
          language: lang,
        };
      }
    }
  } catch {
    // Proceed immediately to Layer 4 deterministic matcher
  } finally {
    clearTimeout(timer);
  }

  // Layer 4: Deterministic Zero-Bug Safety Net
  return runDeterministicMenuMatcher(message, storeData, history);
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
      const rawIp =
        (req.headers['cf-connecting-ip'] as string) ||
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        'anon';
      let hash = 5381;
      const str = `corano-ip-${rawIp}`;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
      }
      const clientIpHash = (hash >>> 0).toString(36);

      const authHeader = req.headers.authorization;
      if (authHeader) {
        const authCheck = await verifyAdminAuthorization(authHeader, storeData);
        if (authCheck.ok) {
          return res.status(200).json({ ...storeData, clientIpHash });
        }
      }
      return res.status(200).json({ ...sanitizePublicStoreData(storeData), clientIpHash });
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

        const discountEnabled = Boolean(rawItem.discountEnabled);
        const discountType = rawItem.discountType === 'fixed' ? 'fixed' : 'percent';
        const rawDiscVal = Number(rawItem.discountValue);
        const discountValue =
          discountEnabled && Number.isFinite(rawDiscVal) && rawDiscVal > 0
            ? discountType === 'percent'
              ? Math.min(99, Math.max(1, Math.round(rawDiscVal)))
              : Math.round(rawDiscVal * 100) / 100
            : 0;

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
          discountEnabled: Boolean(discountEnabled && discountValue > 0),
          discountType,
          discountValue,
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

        const parsedOrder =
          typeof rawCat.order === 'number' && Number.isFinite(rawCat.order)
            ? rawCat.order
            : parseFloat(String(rawCat.order ?? '').trim().replace(/,/g, '.'));

        const cleanCat = sanitizeRecord({
          id: catId,
          name,
          order: Number.isFinite(parsedOrder)
            ? parsedOrder
            : (storeData.categories?.length || 0) + 1,
          description: rawCat.description ? String(rawCat.description).trim() : undefined,
        });

        const existingIdx = storeData.categories.findIndex((c: any) => c.id === catId);
        if (existingIdx >= 0) {
          const previousNameLower = String(storeData.categories[existingIdx]?.name || '')
            .trim()
            .toLowerCase();
          const nextNameLower = name.toLowerCase();
          storeData.categories[existingIdx] = {
            ...storeData.categories[existingIdx],
            ...cleanCat,
          };

          if (
            previousNameLower &&
            previousNameLower !== nextNameLower &&
            Array.isArray(storeData.items)
          ) {
            storeData.items = storeData.items.map((item: any) => {
              const itemCatLower = String(item?.category || '').trim().toLowerCase();
              if (itemCatLower === previousNameLower || itemCatLower === catId.toLowerCase()) {
                return { ...item, category: nextNameLower };
              }
              return item;
            });
          }
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
        const currency =
          body.currency === 'LBP' || body.currency === 'USD'
            ? body.currency
            : storeData.settings?.currency === 'LBP'
            ? 'LBP'
            : 'USD';
        const exchangeRate =
          typeof body.exchangeRate === 'number' && body.exchangeRate > 0
            ? body.exchangeRate
            : storeData.settings?.exchangeRate || 89000;
        const aiEnabled =
          typeof body.aiEnabled === 'boolean'
            ? body.aiEnabled
            : storeData.settings?.aiEnabled !== false;
        const aiBubbleLabel =
          typeof body.aiBubbleLabel === 'string' && stripHtmlTags(body.aiBubbleLabel)
            ? stripHtmlTags(body.aiBubbleLabel).slice(0, 28)
            : storeData.settings?.aiBubbleLabel || 'Corano AI';
        const promoBannerEnabled =
          typeof body.promoBannerEnabled === 'boolean'
            ? body.promoBannerEnabled
            : storeData.settings?.promoBannerEnabled === true;
        const promoBannerUrl =
          typeof body.promoBannerUrl === 'string'
            ? body.promoBannerUrl.trim()
            : storeData.settings?.promoBannerUrl || '';
        const promoBannerDelaySeconds =
          typeof body.promoBannerDelaySeconds === 'number' &&
          body.promoBannerDelaySeconds >= 0 &&
          body.promoBannerDelaySeconds <= 60
            ? Math.round(body.promoBannerDelaySeconds)
            : typeof storeData.settings?.promoBannerDelaySeconds === 'number'
            ? storeData.settings.promoBannerDelaySeconds
            : 2;
        const promoBannerMaxPerDay =
          typeof body.promoBannerMaxPerDay === 'number' &&
          body.promoBannerMaxPerDay >= 0 &&
          body.promoBannerMaxPerDay <= 20
            ? Math.round(body.promoBannerMaxPerDay)
            : typeof storeData.settings?.promoBannerMaxPerDay === 'number'
            ? storeData.settings.promoBannerMaxPerDay
            : 2;
        const promoBannerClickToMenu =
          typeof body.promoBannerClickToMenu === 'boolean'
            ? body.promoBannerClickToMenu
            : storeData.settings?.promoBannerClickToMenu !== false;
        const promoBannerTargetUrl =
          typeof body.promoBannerTargetUrl === 'string' && body.promoBannerTargetUrl.trim().length > 0
            ? body.promoBannerTargetUrl.trim()
            : storeData.settings?.promoBannerTargetUrl || '/menu';
        const promoBannerDiscountEnabled =
          typeof body.promoBannerDiscountEnabled === 'boolean'
            ? body.promoBannerDiscountEnabled
            : storeData.settings?.promoBannerDiscountEnabled === true;
        const promoBannerDiscountType =
          body.promoBannerDiscountType === 'fixed' || body.promoBannerDiscountType === 'percent'
            ? body.promoBannerDiscountType
            : storeData.settings?.promoBannerDiscountType === 'fixed'
            ? 'fixed'
            : 'percent';
        const promoBannerDiscountValue =
          typeof body.promoBannerDiscountValue === 'number' &&
          Number.isFinite(body.promoBannerDiscountValue) &&
          body.promoBannerDiscountValue >= 0
            ? Math.round(body.promoBannerDiscountValue * 100) / 100
            : typeof storeData.settings?.promoBannerDiscountValue === 'number'
            ? storeData.settings.promoBannerDiscountValue
            : 0;
        const activePromoBannerId =
          typeof body.activePromoBannerId === 'string'
            ? body.activePromoBannerId.trim()
            : storeData.settings?.activePromoBannerId || '';
        const savedPromoBanners = Array.isArray(body.savedPromoBanners)
          ? body.savedPromoBanners
              .filter((b: any) => b && typeof b.imgUrl === 'string' && b.imgUrl.trim().length > 0)
              .slice(0, 15)
              .map((b: any) => ({
                id: String(b.id || `banner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
                label: typeof b.label === 'string' ? stripHtmlTags(b.label).slice(0, 60) : '',
                imgUrl: String(b.imgUrl).trim(),
                delaySeconds:
                  typeof b.delaySeconds === 'number' && b.delaySeconds >= 0 && b.delaySeconds <= 60
                    ? Math.round(b.delaySeconds)
                    : 2,
                maxPerDay:
                  typeof b.maxPerDay === 'number' && b.maxPerDay >= 0 && b.maxPerDay <= 20
                    ? Math.round(b.maxPerDay)
                    : 2,
                clickToMenu: b.clickToMenu !== false,
                targetUrl:
                  typeof b.targetUrl === 'string' && b.targetUrl.trim().length > 0
                    ? b.targetUrl.trim()
                    : '/menu',
                discountEnabled: b.discountEnabled === true,
                discountType: b.discountType === 'fixed' ? 'fixed' : 'percent',
                discountValue:
                  typeof b.discountValue === 'number' &&
                  Number.isFinite(b.discountValue) &&
                  b.discountValue >= 0
                    ? Math.round(b.discountValue * 100) / 100
                    : 0,
                sizeBadge: typeof b.sizeBadge === 'string' ? stripHtmlTags(b.sizeBadge).slice(0, 60) : '',
                createdAt:
                  typeof b.createdAt === 'string' && b.createdAt.trim()
                    ? b.createdAt.trim()
                    : new Date().toISOString(),
              }))
          : Array.isArray(storeData.settings?.savedPromoBanners)
          ? storeData.settings.savedPromoBanners
          : [];
        storeData.settings = {
          currency,
          exchangeRate,
          aiEnabled,
          aiBubbleLabel,
          promoBannerEnabled,
          promoBannerUrl,
          promoBannerDelaySeconds,
          promoBannerMaxPerDay,
          promoBannerClickToMenu,
          promoBannerTargetUrl,
          promoBannerDiscountEnabled,
          promoBannerDiscountType,
          promoBannerDiscountValue,
          activePromoBannerId,
          savedPromoBanners,
        };
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
        storeData.removedAdmins = (storeData.removedAdmins || []).filter(
          (e: any) => String(e || '').toLowerCase() !== email
        );
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
        const removedSet = new Set(
          (storeData.removedAdmins || []).map((e: any) => String(e || '').toLowerCase())
        );
        removedSet.add(email);
        storeData.removedAdmins = Array.from(removedSet);
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

      const { fileName, contentType, base64Data, oldImageUrl, skipDeleteOld, isPromoBanner } =
        req.body || {};
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

      const isBannerUpload = Boolean(isPromoBanner) || cleanFileName.startsWith('promo-banner-');
      const maxAllowedBytes = isBannerUpload ? 8 * 1024 * 1024 : MAX_UPLOAD_BYTES;

      if (buffer.length === 0 || buffer.length > maxAllowedBytes) {
        return res.status(400).json({
          error: isBannerUpload
            ? `Banner image size (${Math.round(buffer.length / 1024)} KB) exceeds the 8 MB maximum limit.`
            : `Image size (${Math.round(buffer.length / 1024)} KB) exceeds the 150 KB maximum limit for menu items.`,
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

  // Delete an R2 image object directly (e.g., when admin deletes the Promo Banner)
  app.delete('/api/r2-upload', async (req, res) => {
    res.set(R2_CORS_HEADERS);
    try {
      const storeData = await readStoreDataFromR2();
      const authCheck = await verifyAdminAuthorization(req.headers.authorization, storeData);
      if (!authCheck.ok) {
        return res.status(403).json({
          error: authCheck.error || 'Unauthorized delete attempt.',
        });
      }

      const cfg = getR2Config();
      if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey) {
        return res.status(400).json({ error: 'Cloudflare R2 credentials are not configured yet.' });
      }

      const imageUrl = String(req.body?.imageUrl || req.query?.imageUrl || '').trim();
      const r2Prefix = `${cfg.publicBaseUrl}/items/`;
      if (!imageUrl || !imageUrl.startsWith(r2Prefix)) {
        return res.status(400).json({ error: 'Invalid or non-R2 imageUrl provided.' });
      }

      const rawFileName = imageUrl.slice(r2Prefix.length).split('?')[0];
      const objectKey = `items/${sanitizeFileName(rawFileName)}`;

      const s3 = createR2Client(cfg);
      await s3.send(
        new DeleteObjectCommand({
          Bucket: cfg.bucketName,
          Key: objectKey,
        })
      );

      return res.status(200).json({ ok: true, deletedKey: objectKey });
    } catch (error: any) {
      console.error('R2 delete error:', error);
      return res.status(500).json({
        error: error?.message || 'Failed to delete image from Cloudflare R2',
      });
    }
  });

  // ============================================================================
  // CORANO AI WAITER & R2 CONVERSATION ANALYTICS ENDPOINT (/api/corano-ai)
  // ============================================================================
  app.options('/api/corano-ai', (_req, res) => {
    res.set(R2_CORS_HEADERS).status(204).end();
  });

  // Admin-only: Fetch all stored Corano AI conversations from R2
  app.get('/api/corano-ai', async (req, res) => {
    res.set({
      ...R2_CORS_HEADERS,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    try {
      const storeData = await readStoreDataFromR2();
      const authCheck = await verifyAdminAuthorization(req.headers.authorization, storeData);
      if (!authCheck.ok) {
        return res.status(403).json({ error: authCheck.error || 'Unauthorized admin request.' });
      }
      const conversations = await readAiConversationsFromR2();
      return res.status(200).json({ ok: true, conversations });
    } catch (err: any) {
      console.error('Error reading Corano AI conversations:', err);
      return res.status(500).json({ error: err?.message || 'Failed to read AI conversations' });
    }
  });

  // Admin-only: Delete a single conversation or clear all conversations in R2
  app.delete('/api/corano-ai', async (req, res) => {
    res.set({
      ...R2_CORS_HEADERS,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    try {
      const storeData = await readStoreDataFromR2();
      const authCheck = await verifyAdminAuthorization(req.headers.authorization, storeData);
      if (!authCheck.ok) {
        return res.status(403).json({ error: authCheck.error || 'Unauthorized admin request.' });
      }
      const idToDelete = String(req.body?.id || req.query?.id || '').trim();
      const clearAll = Boolean(req.body?.clearAll || req.query?.clearAll === 'true');

      let conversations = await readAiConversationsFromR2();
      if (clearAll) {
        conversations = [];
      } else if (idToDelete) {
        conversations = conversations.filter((c: any) => c.id !== idToDelete);
      } else {
        return res.status(400).json({ error: 'Provide conversation id or clearAll: true.' });
      }

      await writeAiConversationsToR2(conversations);
      return res.status(200).json({ ok: true, conversations });
    } catch (err: any) {
      console.error('Error deleting Corano AI conversation:', err);
      return res.status(500).json({ error: err?.message || 'Failed to delete AI conversation' });
    }
  });

  // Public Guest Chat: Ask Corano AI Waiter & log session to R2 (data/ai-conversations.json)
  app.post('/api/corano-ai', async (req, res) => {
    res.set({
      ...R2_CORS_HEADERS,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    try {
      const rawMessage = stripHtmlTags(req.body?.message).slice(0, 400);
      if (!rawMessage) {
        return res.status(400).json({ error: 'Please enter a question about our menu.' });
      }

      const sessionId =
        String(req.body?.sessionId || '').trim() ||
        `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const cleanGuestName = stripHtmlTags(req.body?.guestName).slice(0, 40) || 'Guest';
      const rawHistory = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];

      // Strictly read-only read of live menu data from R2
      const storeData = await readStoreDataFromR2();
      const aiResult = await generateCoranoAiResponse(rawMessage, rawHistory, storeData);

      const availableItemsMap = new Map<string, any>();
      for (const item of storeData.items || []) {
        if (item.available !== false) {
          availableItemsMap.set(String(item.id), item);
        }
      }

      const validItemIds = (aiResult.recommendedItemIds || [])
        .map((id: string) => String(id).trim())
        .filter((id: string, idx: number, arr: string[]) => availableItemsMap.has(id) && arr.indexOf(id) === idx)
        .slice(0, 4);

      const recommendedItems = validItemIds.map((id: string) => availableItemsMap.get(id));

      // Return response to the guest immediately; log conversation to R2 asynchronously in background
      res.status(200).json({
        ok: true,
        sessionId,
        reply: aiResult.reply,
        recommendedItemIds: validItemIds,
        recommendedItems,
        summary: aiResult.summary,
        topicTag: aiResult.topicTag,
        language: aiResult.language,
      });

      void (async () => {
        const nowIso = new Date().toISOString();
        try {
          const conversations = await readAiConversationsFromR2();
          const existingIdx = conversations.findIndex((c: any) => c.id === sessionId);
          const userMsgObj = {
            role: 'user' as const,
            text: rawMessage,
            timestamp: nowIso,
          };
          const assistantMsgObj = {
            role: 'assistant' as const,
            text: aiResult.reply,
            recommendedItemIds: validItemIds,
            timestamp: nowIso,
          };

          if (existingIdx >= 0) {
            const existing = conversations[existingIdx];
            existing.updatedAt = nowIso;
            existing.guestName =
              cleanGuestName !== 'Guest' ? cleanGuestName : existing.guestName || 'Guest';
            existing.language = aiResult.language || existing.language || 'English';
            existing.topicTag = aiResult.topicTag || existing.topicTag || 'General Inquiry';
            existing.summary = aiResult.summary || existing.summary;
            existing.messages = [...(existing.messages || []), userMsgObj, assistantMsgObj].slice(-20);
            conversations.splice(existingIdx, 1);
            conversations.unshift(existing);
          } else {
            conversations.unshift({
              id: sessionId,
              guestName: cleanGuestName,
              createdAt: nowIso,
              updatedAt: nowIso,
              language: aiResult.language || 'English',
              topicTag: aiResult.topicTag || 'General Inquiry',
              summary: aiResult.summary || `Guest asked: "${rawMessage.slice(0, 80)}"`,
              messages: [userMsgObj, assistantMsgObj],
            });
          }

          await writeAiConversationsToR2(conversations.slice(0, MAX_AI_CONVERSATIONS));
        } catch (logErr) {
          console.warn('Non-fatal warning saving AI conversation log:', logErr);
        }
      })();
      return;
    } catch (err: any) {
      console.error('Error in POST /api/corano-ai:', err);
      return res.status(500).json({ error: err?.message || 'Failed to process Corano AI request' });
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
  process.env.DISABLE_HMR = 'true';
  return createViteServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'spa',
    plugins: [
      {
        name: 'disable-vite-client-ws',
        transform(code: string, id: string) {
          if (id.includes('vite/dist/client/client.mjs')) {
            return code.replace(
              'transport.connect(createHMRHandler(handleMessage));',
              '/* WebSocket HMR disabled in preview */'
            );
          }
        },
      },
    ],
  });
}

startServer();
