// 拆分计算：拆分/合并的纯计算，不接触存储与 HTTP。
export const R3 = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

export function abnormalCount(item) {
  const logs = (item.logs || []).filter(l => l.abnormal === true).length;
  const obs = (item.observations || []).filter(o => o.abnormal === true).length;
  return logs + obs;
}

export function remainingOf(item) {
  if (item.remaining != null && Number.isFinite(Number(item.remaining))) return R3(item.remaining);
  if (item.dryWeight != null && Number.isFinite(Number(item.dryWeight))) return R3(item.dryWeight);
  return null;
}

export function validateSplit(item, weights) {
  const remaining = remainingOf(item);
  if (remaining == null) return { ok: false, error: `批次 ${item.code} 未登记干浆重量，无法拆分` };
  if (!Array.isArray(weights) || weights.length < 2) return { ok: false, error: "拆分至少两份" };
  const bad = weights.findIndex(w => !Number.isFinite(Number(w)) || Number(w) <= 0);
  if (bad >= 0) return { ok: false, error: `第 ${bad + 1} 份重量无效` };
  const total = R3(weights.reduce((s, w) => s + Number(w), 0));
  if (total > remaining + 1e-9) {
    return { ok: false, error: `拆分合计 ${total}kg 超过原批余量 ${remaining}kg`, total, remaining };
  }
  return { ok: true, total, remaining };
}

export function buildPortions(parent, weights) {
  return weights.map((w, i) => ({
    code: `${parent.code}-${(parent.splitCount || 0) + i + 1}`,
    kind: "拆分份",
    source: parent.source,
    vat: parent.vat,
    days: parent.days,
    owner: parent.owner,
    status: parent.status,
    dryWeight: R3(w),
    remaining: R3(w),
    sourceBatches: [parent.code]
  }));
}

export function mergePreview(items) {
  const rows = items.map(item => ({
    code: item.code,
    days: Number(item.days || 0),
    abnormalCount: abnormalCount(item),
    vat: item.vat || "",
    status: item.status,
    remaining: remainingOf(item)
  }));
  const blocked = rows.filter(r => r.status === "异常观察").map(r => r.code);
  return { ok: blocked.length === 0, blocked, rows };
}

export function mergeWeight(items) {
  return R3(items.reduce((s, it) => s + (remainingOf(it) || 0), 0));
}
