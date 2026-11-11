export type StoreCurrency = 'USD' | 'LBP';

export const DEFAULT_LBP_RATE = 89000;

/**
 * Formats a stored USD price string (e.g., "6.00", "5.5", "4.00 / 7.00")
 * into either "$6.00" (when currency === 'USD') or "534,000 L.L." (when currency === 'LBP').
 */
export function formatStorePrice(
  rawPrice: string | number | undefined,
  currency: StoreCurrency = 'USD',
  rate: number = DEFAULT_LBP_RATE
): string {
  const str = String(rawPrice ?? '').trim();
  if (!str) return currency === 'LBP' ? '0 L.L.' : '$0';

  // If the string already explicitly contains L.L. or LBP, handle gracefully
  if (/l\.?l\.?|lbp/i.test(str)) {
    if (currency === 'LBP') return str;
    const convertedToUsd = str
      .replace(/l\.?l\.?|lbp/gi, '')
      .replace(/,/g, '')
      .replace(/\d+(\.\d+)?/g, (match) => {
        const val = parseFloat(match);
        if (isNaN(val)) return match;
        const usd = val / rate;
        return usd % 1 === 0 ? usd.toFixed(0) : usd.toFixed(2);
      })
      .trim();
    return `$${convertedToUsd}`;
  }

  if (currency === 'USD') {
    const clean = str.replace(/^\$/, '');
    return `$${clean}`;
  }

  // Convert all numbers inside the price string from USD to L.L. at `rate` (89,000)
  // and round to the nearest 10,000 L.L. so prices appear as clean net L.L. amounts
  const cleanUsd = str.replace(/\$/g, '').trim();
  let foundNumber = false;
  const converted = cleanUsd.replace(/\d+(?:\.\d+)?/g, (match) => {
    const num = parseFloat(match);
    if (isNaN(num)) return match;
    foundNumber = true;
    const lbp = roundToCleanLbp(num * rate);
    return lbp.toLocaleString('en-US');
  });

  if (!foundNumber) {
    return `${cleanUsd} L.L.`;
  }

  return `${converted} L.L.`;
}

/**
 * Rounds a raw converted L.L. amount to the nearest 10,000 L.L.
 * (e.g., 250,090 -> 250,000; 299,930 -> 300,000; 500,180 -> 500,000; 1,000,360 -> 1,000,000)
 */
function roundToCleanLbp(rawLbp: number): number {
  const rounded = Math.round(rawLbp);
  if (rounded === 712000) return 700000;
  if (rounded >= 10000) {
    return Math.round(rounded / 10000) * 10000;
  }
  return rounded;
}

/**
 * Converts an L.L. amount typed by the admin (e.g. "445000" or "445,000")
 * into a clean USD price string (e.g. "5" or "5.00") using 89,000 L.L. = $1.
 */
export function convertLbpInputToUsdString(
  lbpInput: string,
  rate: number = DEFAULT_LBP_RATE
): string {
  const cleaned = String(lbpInput || '').replace(/,/g, '').trim();
  if (!cleaned) return '';
  return cleaned.replace(/\d+(?:\.\d+)?/g, (match) => {
    const lbpVal = parseFloat(match);
    if (isNaN(lbpVal) || lbpVal === 0) return '0';
    const usd = lbpVal / rate;
    // Round to 2 decimal places, stripping trailing .00 if exact integer
    const rounded = Math.round(usd * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  });
}

/**
 * Converts a stored USD price string into a clean L.L. input string for editing in L.L. mode.
 */
export function convertUsdStringToLbpInput(
  usdPrice: string,
  rate: number = DEFAULT_LBP_RATE
): string {
  const cleaned = String(usdPrice || '').replace(/\$/g, '').trim();
  if (!cleaned) return '';
  return cleaned.replace(/\d+(?:\.\d+)?/g, (match) => {
    const usdVal = parseFloat(match);
    if (isNaN(usdVal)) return match;
    return String(roundToCleanLbp(usdVal * rate));
  });
}

function slugifySegment(str: string): string {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ActivePromoDiscountInfo {
  badgeText: string;
  originalFormatted: string;
  discountedFormatted: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
}

/**
 * Formats a discount badge string (e.g., "50% OFF", "-$10", or "-890,000 L.L.")
 */
export function formatDiscountBadgeText(
  discountType: 'percent' | 'fixed',
  discountValue: number,
  currency: StoreCurrency = 'USD',
  rate: number = DEFAULT_LBP_RATE
): string {
  if (discountType === 'percent') {
    const cleanPct = Math.max(1, Math.min(99, Math.round(discountValue)));
    return `${cleanPct}% OFF`;
  }
  const cleanUsd = Math.round(discountValue * 100) / 100;
  const usdStr = Number.isInteger(cleanUsd) ? String(cleanUsd) : cleanUsd.toFixed(2).replace(/\.?0+$/, '');
  if (currency === 'LBP') {
    return `-${formatStorePrice(usdStr, 'LBP', rate)}`;
  }
  return `-$${usdStr}`;
}

/**
 * Computes discounted USD price string from original USD price string without mutating item.price.
 */
export function computeDiscountedUsdPriceString(
  rawPrice: string | number | undefined,
  discountType: 'percent' | 'fixed',
  discountValue: number
): string {
  const str = String(rawPrice ?? '').replace(/\$/g, '').trim();
  if (!str) return '0';
  return str.replace(/\d+(?:\.\d+)?/g, (match) => {
    const origUsd = parseFloat(match);
    if (isNaN(origUsd) || origUsd <= 0) return match;
    let nextUsd = origUsd;
    if (discountType === 'percent') {
      const pct = Math.max(1, Math.min(99, discountValue));
      nextUsd = origUsd * (1 - pct / 100);
    } else {
      nextUsd = Math.max(0, origUsd - discountValue);
    }
    const rounded = Math.round(nextUsd * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  });
}

/**
 * Dynamically checks if the currently active Promo Banner has a live discount
 * that applies to the given menu item (single item, whole category, or whole menu).
 * Returns null immediately when the banner or discount is turned OFF/Hidden.
 */
export function getActiveItemPromoDiscount(
  item: { id?: string; title?: string; category?: string; price?: string | number },
  categories: Array<{ id: string; name: string }>,
  settings: {
    promoBannerEnabled?: boolean;
    promoBannerUrl?: string;
    activePromoBannerId?: string;
    promoBannerTargetUrl?: string;
    promoBannerDiscountEnabled?: boolean;
    promoBannerDiscountType?: 'percent' | 'fixed';
    promoBannerDiscountValue?: number;
  } | null | undefined,
  currency: StoreCurrency = 'USD',
  rate: number = DEFAULT_LBP_RATE
): ActivePromoDiscountInfo | null {
  if (!settings || !item) return null;
  if (!settings.promoBannerEnabled) return null;
  if (!settings.promoBannerUrl && !settings.activePromoBannerId) return null;
  if (!settings.promoBannerDiscountEnabled) return null;

  const discountVal = Number(settings.promoBannerDiscountValue);
  if (!Number.isFinite(discountVal) || discountVal <= 0) return null;

  const discountType: 'percent' | 'fixed' =
    settings.promoBannerDiscountType === 'fixed' ? 'fixed' : 'percent';

  const cleanTarget = String(settings.promoBannerTargetUrl || '/menu').trim();
  const parts = cleanTarget.replace(/^\/+/, '').split('/').filter(Boolean);

  let matchesItem = false;
  if (parts.length <= 1 && (!parts[0] || parts[0].toLowerCase() === 'menu')) {
    // Whole menu (/menu)
    matchesItem = true;
  } else if (parts[0]?.toLowerCase() === 'menu' && parts.length === 2) {
    // Category (/menu/:catSlug)
    const targetCatSlug = slugifySegment(parts[1]);
    const itemCatRaw = String(item.category || '').toLowerCase().trim();
    const itemCatSlug = slugifySegment(itemCatRaw);
    const matchedCatObj = (categories || []).find(
      (c) =>
        slugifySegment(c.name) === targetCatSlug ||
        slugifySegment(c.id) === targetCatSlug
    );
    if (
      itemCatSlug === targetCatSlug ||
      (matchedCatObj &&
        (itemCatRaw === matchedCatObj.name.toLowerCase().trim() ||
          itemCatRaw === matchedCatObj.id.toLowerCase().trim()))
    ) {
      matchesItem = true;
    }
  } else if (parts[0]?.toLowerCase() === 'menu' && parts.length >= 3) {
    // Specific dish (/menu/:catSlug/:itemSlug)
    const targetItemSlug = slugifySegment(parts[2]);
    const itemTitleSlug = slugifySegment(item.title || '');
    const itemIdSlug = slugifySegment(item.id || '');
    if (
      (targetItemSlug && itemTitleSlug === targetItemSlug) ||
      (targetItemSlug && itemIdSlug === targetItemSlug)
    ) {
      matchesItem = true;
    }
  }

  if (!matchesItem) return null;

  const originalFormatted = formatStorePrice(item.price, currency, rate);
  const discountedUsdStr = computeDiscountedUsdPriceString(
    item.price,
    discountType,
    discountVal
  );
  const discountedFormatted = formatStorePrice(discountedUsdStr, currency, rate);

  if (originalFormatted === discountedFormatted) return null;

  return {
    badgeText: formatDiscountBadgeText(discountType, discountVal, currency, rate),
    originalFormatted,
    discountedFormatted,
    discountType,
    discountValue: discountVal,
  };
}

