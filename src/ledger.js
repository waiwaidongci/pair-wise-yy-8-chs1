// 批次账：投料扣减、来源更正/退回联动、当日产量，不接触 HTTP。
import { R3, remainingOf } from "./splitting.js";

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function findBatch(db, code) {
  return db.items.find(x => x.code === code || x.id === code);
}

export function recordFeeding(db, { batchCode, weight, operator }) {
  const batch = findBatch(db, batchCode);
  if (!batch) return { ok: false, status: 404, error: "batch_not_found" };
  const remaining = remainingOf(batch);
  if (remaining == null) return { ok: false, status: 400, error: `批次 ${batch.code} 未登记干浆重量，无法投料` };
  const w = Number(weight);
  if (!Number.isFinite(w) || w <= 0) return { ok: false, status: 400, error: "投料重量无效" };
  if (w > remaining + 1e-9) return { ok: false, status: 409, error: `投料 ${R3(w)}kg 超过批次余量 ${remaining}kg` };
  if (!operator || !String(operator).trim()) return { ok: false, status: 400, error: "请填写操作人" };

  batch.remaining = R3(remaining - w);
  db.feedings ||= [];
  const feeding = {
    id: "FD-" + Date.now(),
    date: today(),
    batchCode: batch.code,
    weight: R3(w),
    operator: String(operator).trim(),
    status: "有效"
  };
  db.feedings.unshift(feeding);
  batch.logs ||= [];
  batch.logs.push({ at: new Date().toISOString(), step: "投料", note: `抄纸投料 ${feeding.weight}kg，操作人 ${feeding.operator}，余量 ${batch.remaining}kg` });
  return { ok: true, feeding, batch };
}

// 来源批次更正/退回：关联投料单转待复核，当日产量不计。
export function markBatchCorrected(db, code, note) {
  const batch = findBatch(db, code);
  if (!batch) return { ok: false, status: 404, error: "batch_not_found" };
  const affected = (db.feedings || []).filter(f => f.batchCode === batch.code && f.status !== "作废");
  for (const f of affected) f.status = "待复核";
  batch.logs ||= [];
  batch.logs.push({ at: new Date().toISOString(), step: "更正", note: note || "来源批次更正/退回，关联投料单转待复核" });
  return { ok: true, batch, affected: affected.length };
}

export function reviewFeeding(db, id, action) {
  const feeding = (db.feedings || []).find(f => f.id === id);
  if (!feeding) return { ok: false, status: 404, error: "feeding_not_found" };
  if (feeding.status !== "待复核") return { ok: false, status: 409, error: "该投料单不在待复核状态" };
  feeding.status = action === "作废" ? "作废" : "有效";
  return { ok: true, feeding };
}

export function dailyOutput(db, date = today()) {
  return R3((db.feedings || [])
    .filter(f => f.date === date && f.status === "有效")
    .reduce((s, f) => s + f.weight, 0));
}

export function computeStats(db) {
  const stats = { 入缸: 0, 发酵中: 0, 可抄纸: 0, 异常观察: 0 };
  for (const item of db.items) {
    if (stats[item.status] !== undefined) stats[item.status] += 1;
  }
  stats.当日产量 = dailyOutput(db);
  stats.待复核 = (db.feedings || []).filter(f => f.status === "待复核").length;
  return stats;
}
