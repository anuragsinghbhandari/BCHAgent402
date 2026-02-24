/**
 * BCH/USD Price Service
 * Tries CoinGecko (free, no key). Falls back to fixed $330 if unavailable.
 * Caches result for 5 minutes.
 */

const FALLBACK_BCH_USD = 330;  // fallback if fetch fails
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 min

let _cached = null;
let _fetchedAt = 0;
let _inFlight = null;

export const getBchUsdPrice = async () => {
    const now = Date.now();
    if (_cached && now - _fetchedAt < CACHE_TTL_MS) return _cached;
    if (_inFlight) return _inFlight;

    _inFlight = (async () => {
        try {
            const res = await fetch(
                'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd',
                { signal: AbortSignal.timeout(4000) }
            );
            if (!res.ok) throw new Error('CoinGecko non-OK');
            const data = await res.json();
            const price = data?.['bitcoin-cash']?.usd;
            if (!price || typeof price !== 'number') throw new Error('No price in response');
            _cached = price;
            _fetchedAt = Date.now();
            console.log(`[PriceService] BCH = $${price} USD`);
            return price;
        } catch (e) {
            console.warn(`[PriceService] Using fallback $${FALLBACK_BCH_USD} (${e.message})`);
            // Use fallback but set a shorter cache so we retry sooner
            _cached = FALLBACK_BCH_USD;
            _fetchedAt = Date.now() - (CACHE_TTL_MS - 30_000); // retry in 30s
            return FALLBACK_BCH_USD;
        } finally {
            _inFlight = null;
        }
    })();

    return _inFlight;
};

/** Convert tBCH amount to USD string, e.g. "0.001234 BCH → $0.41" */
export const bchToUsd = (bchAmount, rate) => {
    const usd = parseFloat(bchAmount) * rate;
    return usd < 0.01 ? `<$0.01` : `$${usd.toFixed(2)}`;
};

/** Convert USD amount to tBCH satoshis */
export const usdToSatoshis = (usdAmount, rate) => {
    const bch = usdAmount / rate;
    return Math.ceil(bch * 1e8);
};

/** Convert USD amount to BCH float */
export const usdToBch = (usdAmount, rate) => usdAmount / rate;
