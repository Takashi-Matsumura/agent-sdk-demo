import { clearAll, getRecent, getTotals } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const totals = getTotals();
  const recent = getRecent(20);
  return Response.json({
    count: totals.count,
    totalUsd: totals.total_usd,
    recent,
  });
}

export async function DELETE() {
  clearAll();
  return Response.json({ ok: true });
}
