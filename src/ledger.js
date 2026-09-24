// 批次账模块：批次建档、拆分、合并、投料、更正/退回、复核与当日产量。
// 拆分/合并的计算规则在 split.js，本模块负责落账（改数据、记日志）。

import {
  EPS,
  abnormalCount,
  buildMergedBatch,
  buildSplitParts,
  mergePreview,
  remainingOf,
  round3,
  validateSplit,
} from "./split.js";

export class LedgerError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new LedgerError(status, message);
}

export function findBatch(db, key) {
  return db.items.find(x => x.id === key || x.code === key);
}

// 旧数据补齐批次账字段。
export function normalizeDb(db) {
  db.items ||= [];
  db.inputs ||= [];
  for (const item of db.items) {
    item.id ||= item.code || `PF-${Math.random().toString(36).slice(2, 10)}`;
    item.logs ||= [];
    item.observations ||= [];
    item.dryWeight = round3(item.dryWeight ?? item.remaining ?? 0) || 0;
    item.remaining = round3(item.remaining ?? item.dryWeight) || 0;
    item.rootCode ||= item.code;
    item.parentCode ??= null;
    item.mergedFrom ||= [];
    item.hold ??= null;
    item.abnormalCount = abnormalCount(item);
  }
  return db;
}

export function summarize(item) {
  const logCount = (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
  return { ...item, logCount };
}

export function createBatch(db, input, { makeId, now }) {
  const code = String(input.code || "").trim();
  if (!code) fail(400, "批次编号不能为空");
  if (findBatch(db, code)) fail(409, `批次编号 ${code} 已存在`);
  const dryWeight = round3(input.dryWeight ?? 0);
  if (!Number.isFinite(dryWeight) || dryWeight < 0) fail(400, "干浆重量必须是不小于 0 的数字");
  const item = {
    id: makeId("PF"),
    code,
    source: input.source || "",
    vat: input.vat || "",
    days: Number(input.days || 0),
    owner: input.owner || "",
    status: input.status || "入缸",
    dryWeight,
    remaining: dryWeight,
    parentCode: null,
    rootCode: code,
    abnormalCount: 0,
    mergedFrom: [],
    hold: null,
    logs: [{ at: now, step: "建档", note: `创建纸浆批次，干浆 ${dryWeight}kg` }],
    observations: [],
  };
  db.items.unshift(item);
  return item;
}

export function updateBatch(db, key, patch, { now }) {
  const item = findBatch(db, key);
  if (!item) fail(404, "批次不存在");
  // 余量、干浆重量、来源与异常次数只能经拆分/合并/投料/观察变动，不接受直接改写。
  const { id, code, logs, observations, remaining, dryWeight, hold, mergedFrom, parentCode, rootCode, abnormalCount, ...rest } = patch;
  const before = item.status;
  Object.assign(item, rest);
  item.logs ||= [];
  item.logs.push({ at: now, step: "状态", note: patch.status ? `状态由 ${before} 更新为 ${item.status}` : "修改批次信息" });
  return item;
}

export function addLog(db, key, input, { now }) {
  const item = findBatch(db, key);
  if (!item) fail(404, "批次不存在");
  item.logs ||= [];
  item.logs.push({ at: now, step: input.step || "记录", note: input.note || "" });
  return item;
}

export function recordObservation(db, key, input, { now }) {
  const item = findBatch(db, key);
  if (!item) fail(404, "批次不存在");
  const abnormal = String(input.abnormal || "").includes("是") || String(input.abnormal || "").includes("有");
  item.observations ||= [];
  item.observations.push({ at: now, ...input, abnormal });
  item.days = Number(item.days || 0) + 1;
  if (abnormal) item.abnormalCount = Number(item.abnormalCount || 0) + 1;
  item.status = abnormal ? "异常观察" : Number(item.days) >= 7 ? "可抄纸" : "发酵中";
  item.logs ||= [];
  item.logs.push({ at: now, step: "观察", note: "温度" + (input.temperature || "") + "，" + (input.smell || "") + "，" + (input.fiber || "") });
  return item;
}

// 拆分：合计不得超过原批余量，子批保留来源，原批扣减余量。
export function applySplit(db, key, rawParts, { makeId, now }) {
  const batch = findBatch(db, key);
  if (!batch) fail(404, "批次不存在");
  if (batch.hold) fail(409, `批次 ${batch.code} 已${batch.hold.type}，不能再拆分`);
  const check = validateSplit(batch, rawParts);
  if (!check.ok) fail(400, check.errors.join("；"));
  const used = new Set(db.items.map(i => i.code));
  const parts = rawParts.map((p, i) => {
    let code = String(p.code || "").trim();
    if (!code) {
      let n = 1;
      while (used.has(`${batch.code}-S${n}`)) n += 1;
      code = `${batch.code}-S${n}`;
    }
    if (used.has(code)) fail(409, `编号 ${code} 已存在`);
    used.add(code);
    return { ...p, code };
  });
  const children = buildSplitParts(batch, parts, { makeId, now });
  batch.remaining = round3(remainingOf(batch) - check.total);
  batch.logs ||= [];
  batch.logs.push({ at: now, step: "拆分", note: `拆出 ${children.map(c => c.code).join("、")}，合计 ${check.total}kg，余量 ${batch.remaining}kg` });
  db.items.unshift(...children);
  return { parent: batch, children };
}

// 合并前检视：列出各份发酵天数、异常次数、缸位；异常观察或已更正/退回的批次阻断合并。
export function previewMerge(db, codes) {
  const batches = pickMergeBatches(db, codes);
  const preview = mergePreview(batches);
  const held = batches.filter(b => b.hold).map(b => b.code);
  return { ...preview, held, ok: preview.ok && held.length === 0 };
}

function pickMergeBatches(db, codes) {
  const unique = [...new Set((Array.isArray(codes) ? codes : []).map(c => String(c || "").trim()).filter(Boolean))];
  if (unique.length < 2) fail(400, "合并至少需要两个不同批次");
  return unique.map(code => {
    const batch = findBatch(db, code);
    if (!batch) fail(404, `批次 ${code} 不存在`);
    return batch;
  });
}

// 合并：任一份处于异常观察即拒绝，并指出是哪份。
export function applyMerge(db, codes, options, { makeId, now }) {
  const batches = pickMergeBatches(db, codes);
  const abnormal = batches.filter(b => b.status === "异常观察").map(b => b.code);
  if (abnormal.length) fail(409, `批次 ${abnormal.join("、")} 处于异常观察，拒绝合并`);
  const held = batches.filter(b => b.hold).map(b => b.code);
  if (held.length) fail(409, `批次 ${held.join("、")} 已更正或退回，不能合并`);
  const empty = batches.filter(b => remainingOf(b) <= EPS).map(b => b.code);
  if (empty.length) fail(400, `批次 ${empty.join("、")} 余量为 0，无法合并`);
  let code = String(options.code || "").trim();
  if (!code) {
    let n = 1;
    while (findBatch(db, `MG-${String(n).padStart(3, "0")}`)) n += 1;
    code = `MG-${String(n).padStart(3, "0")}`;
  } else if (findBatch(db, code)) {
    fail(409, `编号 ${code} 已存在`);
  }
  const merged = buildMergedBatch(batches, { ...options, code }, { makeId, now });
  for (const b of batches) {
    b.logs ||= [];
    b.logs.push({ at: now, step: "合并", note: `并入 ${code}，转出 ${remainingOf(b)}kg` });
    b.remaining = 0;
  }
  db.items.unshift(merged);
  return merged;
}

// 抄纸投料：按实际称重扣减来源批次余量，记录来源批次与操作人。
export function applyInput(db, input, { makeId, now }) {
  const batch = findBatch(db, String(input.batchCode || "").trim());
  if (!batch) fail(404, `来源批次 ${input.batchCode || ""} 不存在`);
  if (batch.hold) fail(409, `批次 ${batch.code} 已${batch.hold.type}，不能投料`);
  const weight = round3(input.weight);
  if (!Number.isFinite(weight) || weight <= 0) fail(400, "投料重量必须为正数");
  const operator = String(input.operator || "").trim();
  if (!operator) fail(400, "必须填写操作人");
  const remaining = remainingOf(batch);
  if (weight - remaining > EPS) fail(400, `投料 ${weight}kg 超过批次 ${batch.code} 余量 ${remaining}kg`);
  batch.remaining = round3(remaining - weight);
  const order = {
    id: makeId("IN"),
    batchCode: batch.code,
    rootCode: batch.rootCode || batch.code,
    weight,
    operator,
    at: now,
    status: "有效",
  };
  db.inputs.unshift(order);
  batch.logs ||= [];
  batch.logs.push({ at: now, step: "投料", note: `抄纸投料 ${weight}kg，操作人 ${operator}，余量 ${batch.remaining}kg` });
  return order;
}

// 批次的所有下游批次（拆出的子批、并入的合并批），用于更正/退回时定位关联投料单。
export function descendantsOf(db, code) {
  const seen = new Set([code]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of db.items) {
      if (seen.has(item.code)) continue;
      const fromSplit = item.parentCode && seen.has(item.parentCode);
      const fromMerge = (item.mergedFrom || []).some(m => seen.has(m.code));
      if (fromSplit || fromMerge) {
        seen.add(item.code);
        grew = true;
      }
    }
  }
  return seen;
}

// 更正/退回：标记批次，关联投料单（含下游批次的投料单）转为待复核。
export function applyHold(db, key, type, note, { now }) {
  const batch = findBatch(db, key);
  if (!batch) fail(404, "批次不存在");
  batch.hold = { type, at: now, note: String(note || "") };
  const affected = descendantsOf(db, batch.code);
  const flagged = [];
  for (const order of db.inputs) {
    if (order.status === "有效" && affected.has(order.batchCode)) {
      order.status = "待复核";
      order.holdReason = `来源批次 ${batch.code} ${type}`;
      flagged.push(order);
    }
  }
  batch.logs ||= [];
  batch.logs.push({ at: now, step: type, note: `${note || "无说明"}；${flagged.length} 张关联投料单转为待复核` });
  return { batch, flagged };
}

// 复核待复核的投料单：恢复有效或作废（作废不补回批次余量，浆已消耗）。
export function reviewInput(db, id, decision, note, { now }) {
  const order = db.inputs.find(o => o.id === id);
  if (!order) fail(404, "投料单不存在");
  if (order.status !== "待复核") fail(409, "仅待复核的投料单可以复核");
  if (!["有效", "作废"].includes(decision)) fail(400, "复核结论只能是 有效 或 作废");
  order.status = decision;
  order.review = { at: now, decision, note: String(note || "") };
  return order;
}

// 当日产量：只统计状态为"有效"的投料单，待复核与作废不计入。
export function dailyOutput(db, date) {
  const day = date || new Date().toISOString().slice(0, 10);
  const orders = db.inputs.filter(o => String(o.at).slice(0, 10) === day);
  const valid = orders.filter(o => o.status === "有效");
  const pending = orders.filter(o => o.status === "待复核");
  return {
    date: day,
    total: round3(valid.reduce((s, o) => s + o.weight, 0)),
    pendingWeight: round3(pending.reduce((s, o) => s + o.weight, 0)),
    validCount: valid.length,
    pendingCount: pending.length,
    orders,
  };
}
