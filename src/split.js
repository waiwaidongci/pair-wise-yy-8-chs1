// 拆分计算模块：纯函数，只负责拆分/合并的计算与校验，不读写数据。

export const EPS = 1e-6;

export function round3(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 1000) / 1000;
}

// 批次异常次数：台账字段优先，旧数据回退到观察记录。
export function abnormalCount(item) {
  if (item && item.abnormalCount != null) return Number(item.abnormalCount) || 0;
  return ((item && item.observations) || []).filter(o => o && o.abnormal).length;
}

// 批次余量（kg）。
export function remainingOf(item) {
  const n = item.remaining != null ? Number(item.remaining) : Number(item.dryWeight || 0);
  return round3(Number.isFinite(n) ? n : 0) || 0;
}

// 校验拆分方案：每份重量为正，且干浆重量合计不超过原批余量。
export function validateSplit(batch, parts) {
  const errors = [];
  const list = Array.isArray(parts) ? parts : [];
  if (list.length === 0) errors.push("至少需要拆分出一份");
  let total = 0;
  list.forEach((part, index) => {
    const w = round3(part && part.weight);
    if (!Number.isFinite(w) || w <= 0) errors.push(`第${index + 1}份的干浆重量必须为正数`);
    else total = round3(total + w);
  });
  const remaining = remainingOf(batch || {});
  if (list.length > 0 && total - remaining > EPS) {
    errors.push(`拆分合计 ${total}kg 超过原批余量 ${remaining}kg`);
  }
  return { ok: errors.length === 0, errors, total, remaining };
}

// 由拆分方案生成子批次：每份保留来源（母批与根源批次）。
export function buildSplitParts(batch, parts, { makeId, now }) {
  return parts.map(part => {
    const weight = round3(part.weight);
    return {
      id: makeId("PF"),
      code: part.code,
      source: batch.source || "",
      vat: part.vat || batch.vat || "",
      days: Number(batch.days || 0),
      owner: part.owner || batch.owner || "",
      status: batch.status || "发酵中",
      dryWeight: weight,
      remaining: weight,
      parentCode: batch.code,
      rootCode: batch.rootCode || batch.code,
      abnormalCount: abnormalCount(batch),
      mergedFrom: [],
      hold: null,
      logs: [{ at: now, step: "拆分", note: `自 ${batch.code} 拆出 ${weight}kg，来源批次 ${batch.rootCode || batch.code}` }],
      observations: [],
    };
  });
}

// 合并前检视：列出每份的发酵天数、异常次数、缸位；处于异常观察的批次阻断合并。
export function mergePreview(batches) {
  const parts = batches.map(b => ({
    code: b.code,
    days: Number(b.days || 0),
    abnormalCount: abnormalCount(b),
    vat: b.vat || "",
    status: b.status || "",
    remaining: remainingOf(b),
  }));
  const blocked = parts.filter(p => p.status === "异常观察").map(p => p.code);
  return { parts, blocked, ok: blocked.length === 0 };
}

// 生成合并批次：重量为各份余量合计，各份来源明细写入 mergedFrom。
export function buildMergedBatch(batches, options, { makeId, now }) {
  const total = round3(batches.reduce((sum, b) => sum + remainingOf(b), 0));
  const sources = [...new Set(batches.map(b => b.source).filter(Boolean))];
  const roots = [...new Set(batches.map(b => b.rootCode || b.code))];
  return {
    id: makeId("PF"),
    code: options.code,
    source: sources.join("+"),
    vat: options.vat || batches[0].vat || "",
    days: Math.max(...batches.map(b => Number(b.days || 0))),
    owner: options.owner || batches[0].owner || "",
    status: batches.every(b => b.status === "可抄纸") ? "可抄纸" : "发酵中",
    dryWeight: total,
    remaining: total,
    parentCode: null,
    rootCode: roots.length === 1 ? roots[0] : options.code,
    abnormalCount: batches.reduce((sum, b) => sum + abnormalCount(b), 0),
    mergedFrom: batches.map(b => ({
      code: b.code,
      days: Number(b.days || 0),
      abnormalCount: abnormalCount(b),
      vat: b.vat || "",
      weight: remainingOf(b),
    })),
    hold: null,
    logs: [{ at: now, step: "合并", note: `由 ${batches.map(b => b.code).join("、")} 合并，合计 ${total}kg` }],
    observations: [],
  };
}
