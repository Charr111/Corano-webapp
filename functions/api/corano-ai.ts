import initialSeedData from '../../src/data/initialStoreData.json';
import firebaseConfig from '../../firebase-applet-config.json';

const STORE_DATA_KEY = 'data/store-data.json';
const AI_CONVERSATIONS_KEY = 'data/ai-conversations.json';
const MAX_AI_CONVERSATIONS = 200;
const ROOT_ADMIN_EMAILS = ['apolokor@gmail.com'];

const R2_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

function stripHtmlTags(input: unknown): string {
  return String(input ?? '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function getBoundR2Bucket(env: any): any {
  if (!env || typeof env !== 'object') return null;
  if (env.BUCKET && typeof env.BUCKET.put === 'function') return env.BUCKET;
  if (env['corano-images'] && typeof env['corano-images'].put === 'function') {
    return env['corano-images'];
  }
  if (env.CORANO_IMAGES && typeof env.CORANO_IMAGES.put === 'function') return env.CORANO_IMAGES;
  if (env.R2_BUCKET && typeof env.R2_BUCKET.put === 'function') return env.R2_BUCKET;

  for (const key of Object.keys(env)) {
    const candidate = env[key];
    if (
      candidate &&
      typeof candidate === 'object' &&
      typeof candidate.put === 'function' &&
      typeof candidate.get === 'function'
    ) {
      return candidate;
    }
  }
  return null;
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
    body,
    contentType,
    cacheControl,
  } = params;

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucketName}/${objectKey}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';

  const payloadHash = body ? await sha256Hex(body) : await sha256Hex('');

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;
  if (cacheControl) headers['cache-control'] = cacheControl;

  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = signedHeaderKeys.join(';');

  const canonicalUri = `/${bucketName}/${objectKey
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')}`;
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

  const kDate = await hmacSha256(
    new TextEncoder().encode(`AWS4${secretAccessKey}`),
    dateStamp
  );
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signatureBuffer = await hmacSha256(kSigning, stringToSign);
  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  headers['Authorization'] =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, {
    method,
    headers,
    body: body ? (body as unknown as BodyInit) : undefined,
  });
}

async function readStoreDataFromEnv(env: any): Promise<any> {
  const r2Bucket = getBoundR2Bucket(env);
  if (r2Bucket && typeof r2Bucket.get === 'function') {
    const obj = await r2Bucket.get(STORE_DATA_KEY);
    if (obj) {
      const text = await obj.text();
      if (text) return JSON.parse(text);
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
      return JSON.parse(text);
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
      return await pubRes.json();
    }
  } catch {
    // ignore
  }

  return initialSeedData;
}

async function readAiConversationsFromEnv(env: any): Promise<any[]> {
  const r2Bucket = getBoundR2Bucket(env);
  if (r2Bucket && typeof r2Bucket.get === 'function') {
    const obj = await r2Bucket.get(AI_CONVERSATIONS_KEY);
    if (obj) {
      const text = await obj.text();
      if (text) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
        if (Array.isArray(parsed?.conversations)) return parsed.conversations;
      }
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
      objectKey: AI_CONVERSATIONS_KEY,
    });
    if (getRes.ok) {
      const text = await getRes.text();
      if (text) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
        if (Array.isArray(parsed?.conversations)) return parsed.conversations;
      }
    }
  }

  return [];
}

async function writeAiConversationsToEnv(env: any, conversations: any[]): Promise<void> {
  const safeList = Array.isArray(conversations)
    ? conversations.slice(0, MAX_AI_CONVERSATIONS)
    : [];
  const jsonBytes = new TextEncoder().encode(JSON.stringify(safeList));

  const r2Bucket = getBoundR2Bucket(env);
  if (r2Bucket && typeof r2Bucket.put === 'function') {
    await r2Bucket.put(AI_CONVERSATIONS_KEY, jsonBytes, {
      httpMetadata: {
        contentType: 'application/json',
        cacheControl: 'no-cache, no-store, must-revalidate',
      },
    });
    return;
  }

  const accountId = String(env?.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = String(env?.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env?.R2_SECRET_ACCESS_KEY || '').trim();
  const bucketName = String(env?.R2_BUCKET_NAME || 'corano-images').trim();

  if (accountId && accessKeyId && secretAccessKey) {
    await signedR2Request({
      method: 'PUT',
      accountId,
      accessKeyId,
      secretAccessKey,
      bucketName,
      objectKey: AI_CONVERSATIONS_KEY,
      body: jsonBytes,
      contentType: 'application/json',
      cacheControl: 'no-cache, no-store, must-revalidate',
    });
  }
}

async function verifyAdminAuthorization(
  authHeader: string | null | undefined,
  storeData: any
): Promise<{ ok: boolean; email?: string; error?: string }> {
  const token = String(authHeader || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!token) {
    return { ok: false, error: 'Missing Authorization Bearer token.' };
  }

  let verifiedEmail = '';

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
    // fallback
  }

  if (!verifiedEmail) {
    try {
      const tokenRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`
      );
      if (tokenRes.ok) {
        const tokenInfo: any = await tokenRes.json();
        if (tokenInfo.email && tokenInfo.email_verified !== 'false') {
          verifiedEmail = String(tokenInfo.email).trim().toLowerCase();
        }
      }
    } catch {
      // ignore
    }
  }

  if (!verifiedEmail) {
    return { ok: false, error: 'Invalid or expired Google/Firebase authentication token.' };
  }

  const isRoot = ROOT_ADMIN_EMAILS.includes(verifiedEmail);
  const removed = Array.isArray(storeData.removedAdmins)
    ? storeData.removedAdmins.map((e: any) => String(e || '').trim().toLowerCase())
    : [];
  const isDynamic =
    (storeData.admins || []).some(
      (a: any) => String(a.email || '').trim().toLowerCase() === verifiedEmail
    ) ||
    (verifiedEmail === 'rony.daou83@gmail.com' && !removed.includes('rony.daou83@gmail.com'));

  if (!isRoot && !isDynamic) {
    return { ok: false, error: `Email ${verifiedEmail} is not authorized as an Admin.` };
  }

  return { ok: true, email: verifiedEmail };
}

function roundToCleanLbpEdge(rawLbp: number): number {
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
    return roundToCleanLbpEdge(num * rate).toLocaleString('en-US');
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
      v === 'سندويش' ||
      v === 'ساندويش'
    ) {
      variants.add('sandwich');
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
      v === 'siyam' ||
      v === 'syam' ||
      v === 'siyame' ||
      v === 'syame' ||
      v === '9iyam' ||
      v === '9yam' ||
      v === 'vegan' ||
      v === 'صيامي' ||
      v === 'صيام'
    ) {
      variants.add('siyam');
      variants.add('vegetarian');
    } else if (
      v === 'nebate' ||
      v === 'nabati' ||
      v === 'nabate' ||
      v === 'vegetarian' ||
      v === 'meatless' ||
      v === 'veggie' ||
      v === 'نباتي'
    ) {
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
    /\b(shu|chou|baddi|bade|badde|atyab|3andkon|andkon|3endkon|endkon|3endak|3enddak|aandak|andak|bala|bla|bela|bdoun|bidoun|toum|thoum|basal|5as|khas|akel|kabis|feter|banadoura|kifak|ahla|shi|fi|akid|tayeb|wajbe|7ar|har|shawarma|tawouk|kbeir|zghir|as3ar|asaar|se3er|seaer|7a2|ha2|la7me|lahme|djej|jebne|batata|7doud|hdoud|b7doud|bhdoud|ta7et|tahet|a2al|aqal|2arib|arib|ma3|ma33|maa|sa7en|sahen)\b/i.test(
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
    /allerg|gluten|celiac|coeliac|dairy|lactose|nut|without|no |bala |bla |bela |bdoun |bidoun |حساسية|بدون|بلا/.test(
      q
    )
  ) {
    return 'Ingredients & Allergies';
  }
  if (/healthy|light|diet|calorie|fit|protein|gym|salad|quinoa|صحي|دايت|لايت|سلطة/.test(q)) {
    return 'Healthy & Light';
  }
  if (/spicy|hot|chili|har|7ar|harra|soujouk|حار|حد|حر/.test(q)) {
    return 'Spicy Dishes';
  }
  if (/burger|sub|fajita|philadelphia|crispy|crunchy|pane|برغر|ساب|كريسبي/.test(q)) {
    return 'Burgers & Subs';
  }
  if (/pizza|pasta|penne|margherita|pepperoni|بيتزا|باستا/.test(q)) {
    return 'Pizza & Pasta';
  }
  if (/sandwich|sandwish|sando|tawouk|kafta|mashewe|mashawi|falafel|wrap|sajj|saj|ساندويش|طاووق|كفتة|مشاوي|فلافل|صاج/.test(q)) {
    return 'Sandwiches & Wraps';
  }
  if (/price|cost|cheap|how much|ll|lbp|dollar|usd|se3er|seaer|as3ar|asaar|7doud|hdoud|ta7et|tahet|a2al|aqal|budget|combo|سعر|أسعار|بكم|قديش|تحت|حدود/.test(q)) {
    return 'Prices & Budget';
  }
  if (/popular|best|top|special|signature|atyab|ashhar|أطيب|أشهر/.test(q)) {
    return 'Popular & Best Sellers';
  }
  return 'General Inquiry';
}

const NEGATION_TRIGGER_REGEX =
  /\b(without|no|free|not|avoid|allerg\w*|intoleran\w*|bala|bla|bela|bdoun|bidoun|bedoun|badoon|ma\s+bheb|ma\s+b7eb|mish|mesh)\b|بدون|بلا|من دون|حساسية|ما بحب/i;

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
    queryTriggers: /\b(onion|onions|basal|bassal)\b|بصل/i,
    itemMatchTerms: ['onion', 'onions'],
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
    labelLb: 'jebne (cheese)',
    labelAr: 'جبنة',
    queryTriggers: /\b(cheese|dairy|lactose|jebne|jebneh|jibne|cheddar|mozzarella|7alloum|halloum|halloumi)\b|جبن|جبنة|ألبان|حلوم/i,
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
    labelEn: 'spicy ingredients',
    labelLb: '7ar (spicy)',
    labelAr: 'حر / حار',
    queryTriggers: /\b(spicy|hot|chili|jalapeno|har|7ar|harra|7arra)\b|حار|حد|حر/i,
    itemMatchTerms: ['spicy', 'jalapeno', 'chili', 'dynamite', 'mexican', 'harra'],
  },
  {
    labelEn: 'mushrooms',
    labelLb: 'feter (mushrooms)',
    labelAr: 'فطر',
    queryTriggers: /\b(mushroom|mushrooms|feter|fotor)\b|فطر/i,
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
    labelEn: 'bacon',
    labelLb: 'bacon',
    labelAr: 'بيكون',
    queryTriggers: /\b(bacon|pork)\b|بيكون/i,
    itemMatchTerms: ['bacon', 'pork'],
  },
  {
    labelEn: 'avocado',
    labelLb: 'avocado',
    labelAr: 'أفوكادو',
    queryTriggers: /\b(avocado)\b|أفوكادو|افوكادو/i,
    itemMatchTerms: ['avocado'],
  },
  {
    labelEn: 'meat or chicken',
    labelLb: 'la7me aw djej (meat/chicken)',
    labelAr: 'لحم أو دجاج',
    queryTriggers:
      /\b(meat|meatless|la7me|lahme|la7em|lahem|beef|chicken|djej|djeij|lamb|8anam|ghanam)\b|لحمة|لحم|دجاج|فروج/i,
    itemMatchTerms: [
      'beef',
      'chicken',
      'djeij',
      'djej',
      'tawouk',
      'tawook',
      'taouk',
      'kafta',
      'kabab',
      'kebab',
      'lahme',
      'makanek',
      'soujouk',
      'sawda',
      'liver',
      'ham',
      'salameh',
      'bacon',
      'pepperoni',
      'crab',
      'tuna',
      'farrouj',
      'farouj',
      'steak',
      'fajita',
      'francisco',
      'rosted',
      'philadelphia',
      'twister',
      'crispy',
      'crunchy',
      'shish',
      'chich',
      'skewers',
    ],
  },
];

function extractExclusionsFromMessage(message: string): {
  excludedTerms: string[];
  labelsEn: string[];
  labelsLb: string[];
  labelsAr: string[];
} {
  const combined = `${message} ${normalizeLebaneseFrancoText(message)}`;
  if (!NEGATION_TRIGGER_REGEX.test(combined)) {
    return { excludedTerms: [], labelsEn: [], labelsLb: [], labelsAr: [] };
  }
  const excludedTerms: string[] = [];
  const labelsEn: string[] = [];
  const labelsLb: string[] = [];
  const labelsAr: string[] = [];

  for (const group of INGREDIENT_EXCLUSION_GROUPS) {
    if (group.queryTriggers.test(combined)) {
      excludedTerms.push(...group.itemMatchTerms);
      labelsEn.push(group.labelEn);
      labelsLb.push(group.labelLb);
      labelsAr.push(group.labelAr);
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
  const desc = String(item?.desc || '').trim();
  // When filtering out an allergen/ingredient, skip items that have no listed ingredients to verify
  if (!desc) return true;
  const haystack = `${String(item?.title || '')} ${desc}`.toLowerCase();
  return excludedTerms.some((term) => haystack.includes(term.toLowerCase()));
}

interface BudgetAndComboSpec {
  maxBudgetUsd: number | null;
  wantsCombo: boolean;
}

function getItemComboAddonUsd(item: any): number | null {
  const addons = Array.isArray(item?.addons) ? item.addons : [];
  for (const addon of addons) {
    const str = String(addon || '');
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
    'akel',
    'baddi',
    'bade',
    'badde',
    'shi',
    'have',
    'what',
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
    'shu',
    'chou',
    'atyab',
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
    if (w === 'crispy' || w === 'crunchy' || w === 'كريسبي' || w === 'مقرمش') {
      if (titleLower.includes('crispy') && titleLower.includes('tenders')) {
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
      if (titleLower.includes('farrouj') || titleLower.includes('farouj')) score += 28;
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
      w === 'لحمة' ||
      w === 'غنم'
    ) {
      if (titleLower.includes('lahme') || titleLower.includes('sheep') || titleLower.includes('ghanam')) {
        score += catLower.includes('mashewe') ? 28 : 24;
      } else if (descLower.includes('lahme') || descLower.includes('skewers')) {
        score += 16;
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
        titleLower.includes('mexican')
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
    if (w === 'healthy' || w === 'light' || w === 'diet' || w === 'صحي' || w === 'لايت' || w === 'دايت') {
      if (catLower.includes('light') || catLower.includes('healthy') || catLower.includes('salad')) {
        score += 20;
      } else if (titleLower.includes('light') || titleLower.includes('salad') || titleLower.includes('quinoa')) {
        score += 16;
      }
      continue;
    }
    if (w === 'siyam' || w === 'vegetarian') {
      const hasMeatOrFish =
        /\b(beef|chicken|djeij|djej|tawouk|tawook|taouk|kafta|kabab|kebab|lahme|makanek|soujouk|sawda|liver|ham|salameh|bacon|pepperoni|crab|tuna|farrouj|farouj|steak|fajita|francisco|rosted|philadelphia|twister|crispy|crunchy|shish|chich|skewers|mashewe)\b/i.test(
          combined
        );
      if (hasMeatOrFish) continue;
      const hasDairyOrCheese =
        /\b(cheese|cheddar|mozzarella|halloumi|halloum|parmesan|feta|kashkaval|cream|mayo|mayonnaise|laban)\b/i.test(
          combined
        );
      if (w === 'siyam') {
        if (hasDairyOrCheese) continue;
        if (
          catLower.includes('falafel') ||
          titleLower.includes('hummus') ||
          titleLower.includes('motabal') ||
          titleLower.includes('wara2') ||
          titleLower.includes('batata harra') ||
          titleLower.includes('fatouche') ||
          titleLower.includes('tabbouleh') ||
          titleLower.includes('french fries') ||
          titleLower.includes('wedges')
        ) {
          score += 48;
        }
      } else {
        if (
          catLower.includes('falafel') ||
          titleLower.includes('hummus') ||
          titleLower.includes('motabal') ||
          titleLower.includes('wara2') ||
          titleLower.includes('batata harra') ||
          titleLower.includes('cheese') ||
          titleLower.includes('halloumi') ||
          titleLower.includes('margherita') ||
          titleLower.includes('vegetarian') ||
          titleLower.includes('quinoa') ||
          titleLower.includes('fatouche') ||
          titleLower.includes('tabbouleh')
        ) {
          score += 36;
        }
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
    if (titleLower.includes(w)) score += 20;
    else if (catLower.includes(w)) score += 16;
    else if (descLower.includes(w)) score += 12;
    else if (combined.includes(w)) score += 8;
  }
  return score;
}

const DISH_CARRIER_REGEX =
  /\b(sandwich|sandwiches|sandwish|sandwiche|sando|sandos|sub|subs|burger|burgers|wrap|wraps|saj|sajj|platter|platters|sa7en|sahen|wajbe|wajbet|meal|meals|salad|salads|pizza|pasta|سندويش|ساندويش|ساب|برغر|صاج|صحن|وجبة|سلطة|بيتزا|باستا)\b/i;

const INSIDE_DISH_PHRASE_REGEX =
  /\b(b\s*alba|b\s*2alba|balba|b2alba|fiha|fiya|fia|with\s+[\w\s]{1,25}\s+in\b|فيها|بقلبها)\b/i;

const STANDALONE_SAUCE_OR_MEZZA_REGEX =
  /\b(sauce|sauces|dip|dips|hommos|7ommos|homos|7omos|hummus|7ummus|humus|toum|thoum|garlic|aioli|bbq|barbecue|caesar|cheddar\s+sauce|cocktail|mayo|mayonnaise|mustard|debes|debs|remen|remmen|balsamic|kabis|reb\s+7ar|reb\s+har|steak\s+sauce|thiery|burger\s+sauce|صوص|حمص|ثوم|توم|مايونيز|خردل|كبيس|دبس)\b/i;

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
  budgetSpec: BudgetAndComboSpec
): any[] {
  const qCombined = `${message} ${normalizeLebaneseFrancoText(message)}`.toLowerCase();
  const wantsDishWithIngredient =
    DISH_CARRIER_REGEX.test(qCombined) || INSIDE_DISH_PHRASE_REGEX.test(qCombined);
  const mentionsSauceOrMezza = STANDALONE_SAUCE_OR_MEZZA_REGEX.test(qCombined);

  const isAskingForDrinkOrSauce =
    !budgetSpec.wantsCombo &&
    !wantsDishWithIngredient &&
    (/\b(drink|drinks|pepsi|7up|mirinda|water|juice|مشروب|عصير|مياه)\b/i.test(qCombined) ||
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

  const budgetFilteredPool = basePool.filter((i: any) => itemFitsBudgetAndCombo(i, budgetSpec));
  const pool = budgetFilteredPool.length > 0 ? budgetFilteredPool : basePool;

  const rawWords = extractPositiveQueryWords(message, excludedTerms, budgetSpec);
  // When asking for a dish with a specific sauce (e.g. "sando with bbq sauce"), drop generic word "sauce" so other sauces don't match
  const words =
    wantsDishWithIngredient && rawWords.length > 1
      ? rawWords.filter((w) => w !== 'sauce' && w !== 'sauces' && w !== 'صوص')
      : rawWords;

  if (!words.length) {
    if ((budgetSpec.maxBudgetUsd !== null || budgetSpec.wantsCombo) && budgetFilteredPool.length > 0) {
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
  limit = 3
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
} {
  const rate = storeData.settings?.exchangeRate || 89000;
  const activeBudgetSpec = budgetSpec || extractBudgetAndComboSpec(message, rate);
  const { previouslyRecommendedIds, previousAssistantTurns } = extractHistoryRotationState(history);
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
      3
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

  const scored = pool.map((item) => {
    let score = 0;
    const catLower = String(item.category || '').toLowerCase();
    const descLower = String(item.desc || '').toLowerCase();
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
    3
  );

  return { turnItems, strictMatches: [], previousAssistantTurns, budgetSpec: activeBudgetSpec };
}

const RESTAURANT_INFO_REGEX =
  /\b(delivery|deliver|tawsil|tawseel|phone|number|telefon|telephone|whatsapp|contact|opening\s+hours|open\s+now|when\s+do\s+you\s+open|when\s+do\s+you\s+close|aya\s+se3a|se3a\s+btefta7o|btefta7o|btsakro|location|address|where\s+are\s+you|google\s+map|maw2a3|mawka3|3enwen|aenwen|توصيل|دليفري|ديليفري|رقم|تلفون|هاتف|واتساب|ساعات\s+العمل|بتفتحوا|بتسكروا|موقعكم|عنوانكم|وين\s+موقعكم)\b/i;

function shouldUseInstantDeterministicFastPath(
  message: string,
  exclusions: { excludedTerms: string[] },
  budgetSpec: BudgetAndComboSpec,
  strictMatches: any[]
): boolean {
  if (exclusions.excludedTerms.length > 0) return true;
  if (budgetSpec.maxBudgetUsd !== null || budgetSpec.wantsCombo) return true;
  if (strictMatches.length > 0) return true;
  const q = `${message} ${normalizeLebaneseFrancoText(message)}`.toLowerCase();
  if (RESTAURANT_INFO_REGEX.test(q)) return true;
  if (
    /\b(popular|best|top|recommend|favorite|special|atyab|ashhar|healthy|light|diet|siyam|syam|vegetarian|vegan|nebate|nabati|sharing|family|group|3ayle|aayle|jem3a|jam3a|crispy|cheesy|mashewe|mashawi|burger|sub|sandwich|sandwish|salad|pizza|pasta|أطيب|أشهر|صحي|دايت|لايت|صيامي|نباتي|عيلة|عائلة|جمعة|مشاوي)\b/i.test(
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

  const { turnItems: topPicks, previousAssistantTurns } = getTurnTargetItems(
    message,
    storeData,
    exclusions.excludedTerms,
    history,
    budgetSpec
  );

  const pickNames = topPicks
    .map(
      (p) =>
        `${p.title} (${formatItemPriceWithComboBreakdown(p, currency, rate, budgetSpec)}${
          p.desc ? ` — ${p.desc}` : ''
        })`
    )
    .join(', ');

  const q = `${message} ${normalizeLebaneseFrancoText(message)}`.toLowerCase();
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
      reply = `أهلاً وسهلاً بك في مطعم كورانو! نفتح يومياً طوال أيام الأسبوع من الساعة 11:00 صباحاً حتى 12:00 منتصف الليل. للطلب أو الاستفسار عن التوصيل (Delivery)، يسعدنا اتصالك بنا مباشرة على الرقم 03 220 810 (+961 3 220 810)، كما يمكنك عرض موقعنا على خرائط Google في صفحة Visit Us. ونرشح لك أيضاً تجربة: ${pickNames}!`;
    } else if (lang === 'Lebanese') {
      reply = `Ahla w sahla fik bi Corano! Nehna maftou7in kel youm (Monday – Sunday) men el 11:00 AM lal 12:00 AM (nos lel). Lal talab aw el delivery, fik te7kina moubashara 3ala 03 220 810 (+961 3 220 810), w maw2a3na mawjoud bi saf7et Visit Us 3al Google Maps. W hayde kamen men atyab el asnaf 3anna: ${pickNames}!`;
    } else {
      reply = `Welcome to Corano Restaurant! We are open daily (Monday – Sunday) from 11:00 AM until 12:00 AM (Midnight). To place an order or inquire about delivery, please call us directly at +961 3 220 810 (03 220 810), and you can view our exact Google Maps location anytime in the Visit Us tab. Here are also some of our top dishes to try: ${pickNames}!`;
    }
  } else if (exclusions.excludedTerms.length > 0) {
    if (lang === 'Arabic') {
      const arTemplates = [
        `أهلاً وسهلاً بك في كورانو! بالتأكيد، هذه الأطباق الشهية لدينا محضرة بدون ${exclusions.labelsAr.join(' أو ')}: ${pickNames}. كما يمكنك دائماً إبلاغ النادل عند الطلب لتحضير وجبتك كما تفضل!`,
        `بكل سرور! إليك تشكيلة أخرى من أطباقنا الطازجة الخالية من ${exclusions.labelsAr.join(' أو ')}: ${pickNames}. اضغط على أي طبق بالأسفل لتصفح مكوناته الكاملة!`,
        `أهلاً بك مجدداً! نرشح لك أيضاً هذه الخيارات المميزة المحضرة بدون ${exclusions.labelsAr.join(' أو ')}: ${pickNames}.`,
      ];
      reply = arTemplates[variantIdx];
    } else if (lang === 'Lebanese') {
      const lbTemplates = [
        `Ahla w sahla fik bi Corano! Akid, hayde atyab el asnaf 3anna yalli ma fiha ${exclusions.labelsLb.join(' aw ')} abadan: ${pickNames}. W akid fik t2oul lal waiter wa2t el talab eza baddak t3addel ayya moukawen!`,
        `Tekram 3aynak! Hayde kamen kheyarat tenye taybe ktir 3anna bala ${exclusions.labelsLb.join(' aw ')}: ${pickNames}. Ekbus 3ala ayya wajbe ta7et la tshouf kel el moukawinet!`,
        `Miyet ahla! Jareb kamen hal asnaf el fresh men matbakhna yalli bala ${exclusions.labelsLb.join(' aw ')}: ${pickNames}!`,
      ];
      reply = lbTemplates[variantIdx];
    } else {
      const enTemplates = [
        `Welcome to Corano! Absolutely — here are great freshly prepared options from our menu that do not contain ${exclusions.labelsEn.join(' or ')}: ${pickNames}. Tap any dish below to check its full ingredients!`,
        `Here are more delicious options from our kitchen prepared without ${exclusions.labelsEn.join(' or ')}: ${pickNames}. Feel free to tap any card below for full details!`,
        `Happy to share more choices! You can also enjoy these fresh dishes made without ${exclusions.labelsEn.join(' or ')}: ${pickNames}!`,
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
        ? `أهلاً وسهلاً بك في كورانو! بالتأكيد، إليك أشهى الخيارات مع كومبو (بطاطا ومشروب بيبسي) ضمن ميزانية ${budgetLabel}: ${pickNames}. اضغط على أي وجبة بالأسفل لعرض التفاصيل!`
        : `أهلاً وسهلاً بك في كورانو! إليك أشهى الخيارات مع كومبو (بطاطا ومشروب بيبسي): ${pickNames}. اضغط على أي وجبة بالأسفل لعرض التفاصيل!`;
    } else if (lang === 'Lebanese') {
      reply = budgetLabel
        ? `Ahla w sahla fik bi Corano! Akid tekram, hayde atyab el asnaf ma3 Combo (Batata w Pepsi) b 7doud / ta7et el ${budgetLabel}: ${pickNames}. Ekbus 3ala ayya wajbe ta7et la tshouf kel el tafasil!`
        : `Ahla w sahla fik bi Corano! Akid tekram, hayde atyab el asnaf ma3 Combo (Batata w Pepsi): ${pickNames}. Ekbus 3ala ayya wajbe ta7et la tshouf kel el tafasil!`;
    } else {
      reply = budgetLabel
        ? `Welcome to Corano! Here are our top freshly prepared picks with the full Combo (Fries & Drink) all within ${budgetLabel}: ${pickNames}. Tap any dish card below for full details!`
        : `Welcome to Corano! Here are our top freshly prepared picks with the full Combo (Fries & Drink): ${pickNames}. Tap any dish card below for full details!`;
    }
  } else if (isMasheweQuery) {
    if (lang === 'Arabic') {
      const arMashewe = [
        `أهلاً بك في كورانو! نقدم تشكيلة واسعة من المشاوي على الفحم تشمل صحن لحمة شقف، طاووق على الفحم، فروج مشوي أو نصف فروج، كفتة، كباب، مشاوي مشكل، بالإضافة إلى المشاوي بالكيلو أو نصف كيلو. ننصحك بتجربة: ${pickNames}!`,
        `إليك المزيد من خيارات المشاوي الشهية على الفحم لدينا: ${pickNames}! كما يتوفر لدينا المشاوي المشكلة وبالوزن (نصف كيلو وكيلو).`,
        `من ركن المشاوي على الفحم في كورانو، نرشح لك أيضاً تجربة: ${pickNames}. اضغط على أي طبق بالأسفل لعرض التفاصيل!`,
      ];
      reply = arMashewe[variantIdx];
    } else if (lang === 'Lebanese') {
      const lbMashewe = [
        `Ahla w sahla fik bi Corano! 3anna تشكيلة mashewe 3al fahem bteshmal Lahme Platter, Charcoal Tawouk, Farrouj aw 1/2 Farrouj Meshwe, Kafta, Kabab, w Mixed Grill, bil idafe lal mashewe bil kilo aw nos kilo. Bansa7ak tjareb: ${pickNames}!`,
        `Tekram! Hayde kamen تشكيلة tenye men el mashewe 3al fahem 3anna: ${pickNames}. Ekbus 3ala ayya sahan ta7et la tshouf el moukawinet!`,
        `Men atyab el mashewe 3al fahem bi Corano kamen fik tjareb: ${pickNames}!`,
      ];
      reply = lbMashewe[variantIdx];
    } else {
      const enMashewe = [
        `Welcome to Corano! Our charcoal Mashewe selection includes our signature Lahme Platter (Lamb Meat), Charcoal Tawouk Platter, Whole or 1/2 Farrouj Meshwe, Kafta, Kabab, Mixed Grill, and 1/2 kg or 1 kg platters by weight. Here are top picks to start with: ${pickNames}!`,
        `Here are more delicious charcoal-grilled Mashewe platters from our grill: ${pickNames}! Tap any dish card below to see all included sides and ingredients.`,
        `Looking for more from our charcoal grill? We also highly recommend trying: ${pickNames}!`,
      ];
      reply = enMashewe[variantIdx];
    }
  } else if (lang === 'Arabic') {
    const arGeneral = [
      `أهلاً وسهلاً بك في مطعم كورانو! بناءً على طلبك، أنصحك بتجربة هذه الأطباق المميزة والمحضرة طازجة لدينا: ${pickNames}. يمكنك الضغط على أي طبق بالأسفل لعرض كافة المكونات والتفاصيل!`,
      `بكل سرور! إليك مجموعة أخرى من الأطباق الشهية التي تناسب طلبك: ${pickNames}. اضغط على أي طبق بالأسفل لتصفح المكونات!`,
      `نرشح لك أيضاً هذه الخيارات الرائعة والمحضرة طازجة في كورانو: ${pickNames}!`,
    ];
    reply = arGeneral[variantIdx];
  } else if (lang === 'Lebanese') {
    const lbGeneral = [
      `Ahla w sahla fik bi Corano! Kirmel talabak, bansa7ak tjareb hal asnaf el taybe w el fresh 3anna: ${pickNames}. Fik tekbus 3ala ayya wajbe ta7et la tshouf kel el moukawinet!`,
      `Tekram 3aynak! Hayde kamen تشكيلة tenye men atyab el asnaf yalli bteneseb talabak: ${pickNames}. Ekbus 3ala ayya wajbe ta7et la tshouf el tafasil!`,
      `Miyet ahla! Jareb kamen hal kheyarat el taybe ktir men matbakh Corano: ${pickNames}!`,
    ];
    reply = lbGeneral[variantIdx];
  } else {
    const enGeneral = [
      `Welcome to Corano! Based on what you're looking for, I highly recommend trying these fresh favorites from our kitchen: ${pickNames}. Tap any dish card below to view its full ingredients and details!`,
      `Here is another delicious mix of options from our menu that match what you're looking for: ${pickNames}. Tap any dish card below to explore its ingredients!`,
      `Happy to recommend more! You'll also love these freshly prepared picks from our kitchen: ${pickNames}!`,
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

  return `You are "Corano AI", the warm, knowledgeable AI Waiter at Corano Restaurant in Lebanon (Open daily 11:00 AM - 12:00 AM).
Your job is to help guests choose dishes, answer ingredient or allergy questions accurately, and recommend 1 to 3 dishes from our LIVE AVAILABLE MENU below.

STRICT RULES:
1. LANGUAGE MIRRORING:
   - If the guest writes in English -> reply in warm, appetizing English (set language="English").
   - If the guest writes in Lebanese Franco / Arabizi (e.g. "shu atyab burger", "baddi akel bala toum", "bade sandwish aw sub ma3 pepsi w batata fries b 7doud l 10$") -> reply naturally in warm Lebanese Franco / Arabizi (e.g. "Ahla w sahla! Akid...") (set language="Lebanese").
   - If the guest writes in Arabic script (العربية) -> reply in natural Lebanese/Arabic script (set language="Arabic").
2. RELY ON ITEM NAME, CATEGORY, AND INGREDIENTS:
   - Always check the item's Name, Category, AND Ingredients for every question.
3. STRICT INGREDIENT EXCLUSION ("WITHOUT" / "BALA" / "BLA" / "NO" / "بدون" / "بلا"):
   - When a guest asks for food WITHOUT an ingredient (e.g. "without garlic", "bala toum", "no mayo", "bla basal", "بدون ثوم"), NEVER recommend any dish whose Name or Ingredients contains that ingredient.
4. USE THE SELECTED DISHES FOR THIS TURN:
   - Use the exact IDs listed in "SELECTED DISHES FOR THIS TURN" for your recommendedItemIds array and naturally talk about those specific dishes in your reply.
   - For Mashewe inquiries, also briefly mention our full charcoal Mashewe variety (Lahme platter, Charcoal Tawouk platter, Whole & 1/2 Farrouj Meshwe, Kafta, Kabab, Mixed Grill, plus 1/2 kg & 1 kg Mashewe by weight).
5. ONLY RECOMMEND IN-STOCK ITEMS:
   - Never recommend out-of-stock items (${outOfStockTitles.length > 0 ? outOfStockTitles.join(', ') : 'none currently out of stock'}).
6. EXACT PRICES & INGREDIENTS:
   - Quote the exact prices shown in the menu below (${currency === 'LBP' ? 'in L.L.' : 'in $ USD'}).
7. Keep your reply concise (2 to 4 sentences max) because visual dish cards for your recommendedItemIds will automatically appear right below your text!
8. Set topicTag to one of: "Popular & Best Sellers", "Burgers & Subs", "Healthy & Light", "Ingredients & Allergies", "Spicy Dishes", "Prices & Budget", "Sandwiches & Wraps", "Pizza & Pasta", "General Inquiry".
9. Set summary to a 1-sentence English summary for the restaurant owner.
${budgetAndComboRuleBlock}${priorityHighlightBlock}${repeatVarietyBlock}
TOP RELEVANT CORANO MENU DISHES (${availableLines.length} dishes):
${availableLines.join('\n')}`;
}

async function generateCoranoAiEdgeResponse(
  message: string,
  history: Array<{ role: string; text: string; recommendedItemIds?: string[] }>,
  storeData: any,
  env: any
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

  const apiKey = String(env?.GEMINI_API_KEY || '').trim();

  // Single fast Gemini call (gemini-2.5-flash with thinkingBudget: 0 and strict 3200ms timeout)
  if (apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3200);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
          apiKey
        )}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'aistudio-build',
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: conversationContext }],
              },
            ],
            generationConfig: {
              temperature: previousAssistantTurns > 0 ? 0.55 : 0.35,
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingBudget: 0 },
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  reply: { type: 'STRING' },
                  recommendedItemIds: {
                    type: 'ARRAY',
                    items: { type: 'STRING' },
                  },
                  summary: { type: 'STRING' },
                  topicTag: { type: 'STRING' },
                  language: { type: 'STRING' },
                },
                required: ['reply', 'recommendedItemIds', 'summary', 'topicTag', 'language'],
              },
            },
          }),
        }
      );
      clearTimeout(timer);

      if (res.ok) {
        const data: any = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (rawText) {
          const parsed = JSON.parse(rawText);
          if (parsed && typeof parsed.reply === 'string' && parsed.reply.trim()) {
            const lang: 'English' | 'Lebanese' | 'Arabic' =
              parsed.language === 'Arabic' || parsed.language === 'Lebanese'
                ? parsed.language
                : detectUserLanguage(message);

            let finalIds = turnTargetIds.slice(0, 3);
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
                .slice(0, 3);
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
      }
    } catch {
      // Proceed immediately to Layer 3
    } finally {
      clearTimeout(timer);
    }
  }

  // Layer 3: Fast Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct-awq via corano-ai-gateway with strict 2800ms timeout, no double-retry loop)
  if (env?.AI && typeof env.AI.run === 'function') {
    const gatewayId = String(env?.CF_AI_GATEWAY_ID || 'corano-ai-gateway').trim();
    try {
      const cfPayload = {
        messages: [
          {
            role: 'system',
            content:
              systemInstruction +
              '\nRespond ONLY with a valid JSON object matching: {"reply": "...", "recommendedItemIds": ["..."], "summary": "...", "topicTag": "...", "language": "English"}',
          },
          {
            role: 'user',
            content: conversationContext,
          },
        ],
      };

      const cfAiRes: any = await Promise.race([
        env.AI.run('@cf/meta/llama-3.1-8b-instruct-awq', cfPayload, {
          gateway: { id: gatewayId },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('CF_AI_TIMEOUT')), 2800)),
      ]);

      const rawOut = cfAiRes?.response;
      let parsed: any = null;
      if (rawOut && typeof rawOut === 'object') {
        parsed = rawOut;
      } else {
        const textOut = String(rawOut || '').trim();
        const jsonMatch = textOut.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      }

      if (parsed && typeof parsed.reply === 'string' && parsed.reply.trim()) {
        let finalIds = turnTargetIds.slice(0, 3);
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
            .slice(0, 3);
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
          language:
            parsed.language === 'Arabic' || parsed.language === 'Lebanese'
              ? parsed.language
              : detectUserLanguage(message),
        };
      }
    } catch {
      // Proceed immediately to Layer 4 deterministic matcher
    }
  }

  // Layer 4: Deterministic Zero-Bug Safety Net
  return runDeterministicMenuMatcher(message, storeData, history);
}

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: R2_CORS_HEADERS,
  });
};

export const onRequestGet = async (context: any) => {
  const jsonHeaders = {
    ...R2_CORS_HEADERS,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  };
  try {
    const env = context.env || {};
    const storeData = await readStoreDataFromEnv(env);
    const authHeader = context.request.headers.get('Authorization');
    const authCheck = await verifyAdminAuthorization(authHeader, storeData);
    if (!authCheck.ok) {
      return new Response(
        JSON.stringify({ error: authCheck.error || 'Unauthorized admin request.' }),
        { status: 403, headers: jsonHeaders }
      );
    }
    const conversations = await readAiConversationsFromEnv(env);
    return new Response(JSON.stringify({ ok: true, conversations }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Failed to read AI conversations' }),
      { status: 500, headers: jsonHeaders }
    );
  }
};

export const onRequestDelete = async (context: any) => {
  const jsonHeaders = {
    ...R2_CORS_HEADERS,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  };
  try {
    const env = context.env || {};
    const storeData = await readStoreDataFromEnv(env);
    const authHeader = context.request.headers.get('Authorization');
    const authCheck = await verifyAdminAuthorization(authHeader, storeData);
    if (!authCheck.ok) {
      return new Response(
        JSON.stringify({ error: authCheck.error || 'Unauthorized admin request.' }),
        { status: 403, headers: jsonHeaders }
      );
    }

    let body: any = {};
    try {
      body = await context.request.json();
    } catch {
      // allow query param fallback
    }
    const url = new URL(context.request.url);
    const idToDelete = String(body?.id || url.searchParams.get('id') || '').trim();
    const clearAll = Boolean(body?.clearAll || url.searchParams.get('clearAll') === 'true');

    let conversations = await readAiConversationsFromEnv(env);
    if (clearAll) {
      conversations = [];
    } else if (idToDelete) {
      conversations = conversations.filter((c: any) => c.id !== idToDelete);
    } else {
      return new Response(
        JSON.stringify({ error: 'Provide conversation id or clearAll: true.' }),
        { status: 400, headers: jsonHeaders }
      );
    }

    await writeAiConversationsToEnv(env, conversations);
    return new Response(JSON.stringify({ ok: true, conversations }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Failed to delete AI conversation' }),
      { status: 500, headers: jsonHeaders }
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
    const rawMessage = stripHtmlTags(body?.message).slice(0, 400);
    if (!rawMessage) {
      return new Response(
        JSON.stringify({ error: 'Please enter a question about our menu.' }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const sessionId =
      String(body?.sessionId || '').trim() ||
      `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const cleanGuestName = stripHtmlTags(body?.guestName).slice(0, 40) || 'Guest';
    const rawHistory = Array.isArray(body?.history) ? body.history.slice(-10) : [];

    const storeData = await readStoreDataFromEnv(env);
    const aiResult = await generateCoranoAiEdgeResponse(rawMessage, rawHistory, storeData, env);

    const availableItemsMap = new Map<string, any>();
    for (const item of storeData.items || []) {
      if (item.available !== false) {
        availableItemsMap.set(String(item.id), item);
      }
    }

    const validItemIds = (aiResult.recommendedItemIds || [])
      .map((id: string) => String(id).trim())
      .filter(
        (id: string, idx: number, arr: string[]) =>
          availableItemsMap.has(id) && arr.indexOf(id) === idx
      )
      .slice(0, 3);

    const recommendedItems = validItemIds.map((id: string) => availableItemsMap.get(id));

    const saveLogPromise = (async () => {
      const nowIso = new Date().toISOString();
      try {
        const conversations = await readAiConversationsFromEnv(env);
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

        await writeAiConversationsToEnv(env, conversations.slice(0, MAX_AI_CONVERSATIONS));
      } catch {
        // Non-fatal
      }
    })();

    if (typeof context.waitUntil === 'function') {
      context.waitUntil(saveLogPromise);
    } else {
      await saveLogPromise;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sessionId,
        reply: aiResult.reply,
        recommendedItemIds: validItemIds,
        recommendedItems,
        summary: aiResult.summary,
        topicTag: aiResult.topicTag,
        language: aiResult.language,
      }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Failed to process Corano AI request' }),
      { status: 500, headers: jsonHeaders }
    );
  }
};
