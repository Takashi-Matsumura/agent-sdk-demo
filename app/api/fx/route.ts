export const runtime = "nodejs";

type CacheEntry = {
  rate: number;
  asOf: string;
  fetchedAt: number;
};

const TTL_MS = 60 * 60 * 1000;
let cache: CacheEntry | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) {
    return json(cache);
  }

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      rates?: { JPY?: number };
      time_last_update_utc?: string;
    };
    const rate = data.rates?.JPY;
    if (typeof rate !== "number") throw new Error("JPY rate missing");

    cache = {
      rate,
      asOf: data.time_last_update_utc ?? new Date().toUTCString(),
      fetchedAt: now,
    };
    return json(cache);
  } catch (err) {
    if (cache) return json(cache);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
}

function json(entry: CacheEntry) {
  return Response.json({
    base: "USD",
    quote: "JPY",
    rate: entry.rate,
    asOf: entry.asOf,
  });
}
