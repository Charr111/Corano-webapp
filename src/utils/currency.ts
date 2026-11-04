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
  const cleanUsd = str.replace(/\$/g, '').trim();
  let foundNumber = false;
  const converted = cleanUsd.replace(/\d+(?:\.\d+)?/g, (match) => {
    const num = parseFloat(match);
    if (isNaN(num)) return match;
    foundNumber = true;
    const lbp = Math.round(num * rate);
    return lbp.toLocaleString('en-US');
  });

  if (!foundNumber) {
    return `${cleanUsd} L.L.`;
  }

  return `${converted} L.L.`;
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
 * Converts a stored USD price string into a raw L.L. input string for editing in L.L. mode.
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
    return String(Math.round(usdVal * rate));
  });
}
