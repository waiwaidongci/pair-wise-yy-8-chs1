import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSplit, buildPortions, mergePreview, mergeWeight, R3 } from "./src/splitting.js";
import { findBatch, recordFeeding, markBatchCorrected, reviewFeeding, computeStats } from "./src/ledger.js";
import { page } from "./src/page.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "paper-pulp-fermentation.json");
const port = Number(process.env.PORT || 3039);
const seed = {
  "items": [
    {
      "code": "PF-001",
      "source": "构树皮",
      "vat": "三号缸",
      "days": 5,
      "dryWeight": 120,
      "remaining": 120,
      "owner": "林素",
      "status": "发酵中",
      "logs": [
        {
          "at": "2026-06-15",
          "step": "观察",
          "note": "温度24.6，气味微酸，纤维开始松散",
          "abnormal": false
        }
      ]
    }
  ],
  "feedings": []
};

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  db.feedings ||= [];
  return db;
}
async function saveDb(db) { await writeFile(dbPath, JSON.stringify(db, null, 2)); }
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}
function newId() { return "PF-" + Date.now(); }
function summarize(item) {
  const logCount = (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
  return { ...item, logCount };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") return html(res, page());
    if (req.method === "GET" && url.pathname === "/api/items") return send(res, 200, db.items.map(summarize));
    if (req.method === "POST" && url.pathname === "/api/items") {
      const input = await body(req);
      const item = { id: newId(), ...input, logs: [{ at: new Date().toISOString(), step: "建档", note: "创建纸浆批次" }] };
      if (item.dryWeight !== undefined && item.dryWeight !== "" && Number.isFinite(Number(item.dryWeight))) {
        item.dryWeight = R3(item.dryWeight);
        item.remaining = item.dryWeight;
      }
      db.items.unshift(item);
      await saveDb(db);
      return send(res, 201, item);
    }
    const patch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (patch && req.method === "PATCH") {
      const item = db.items.find(x => x.id === patch[1] || x.code === patch[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      Object.assign(item, await body(req));
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: "状态", note: "更新为" + item.status });
      await saveDb(db);
      return send(res, 200, item);
    }
    const log = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (log && req.method === "POST") {
      const item = db.items.find(x => x.id === log[1] || x.code === log[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: input.step || "记录", note: input.note || "" });
      await saveDb(db);
      return send(res, 201, item);
    }
    const action = url.pathname.match(/^\/api\/items\/([^/]+)\/action$/);
    if (action && req.method === "POST") {
      const item = db.items.find(x => x.id === action[1] || x.code === action[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      item.logs ||= [];
      const abnormal = String(input.abnormal || "").includes("是") || String(input.abnormal || "").includes("有");
      item.observations ||= [];
      item.observations.push({ at: new Date().toISOString(), ...input, abnormal });
      item.days = Number(item.days || 0) + 1;
      item.status = abnormal ? "异常观察" : Number(item.days) >= 7 ? "可抄纸" : "发酵中";
      item.logs.push({ at: new Date().toISOString(), step: "观察", note: "温度" + (input.temperature || "") + "，" + (input.smell || "") + "，" + (input.fiber || ""), abnormal });
      await saveDb(db);
      return send(res, 201, item);
    }
    // 批次拆分：合计不得超过原批余量，每份保留来源
    const split = url.pathname.match(/^\/api\/items\/([^/]+)\/split$/);
    if (split && req.method === "POST") {
      const item = findBatch(db, split[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const parts = (await body(req)).parts;
      const check = validateSplit(item, parts);
      if (!check.ok) return send(res, 409, { error: check.error });
      const portions = buildPortions(item, parts);
      item.splitCount = (item.splitCount || 0) + portions.length;
      item.remaining = R3(check.remaining - check.total);
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: "拆分", note: "拆出 " + portions.map(p => `${p.code} ${p.dryWeight}kg`).join("，") + `，余量 ${item.remaining}kg` });
      for (const p of portions) {
        p.id = newId() + "-" + p.code;
        p.logs = [{ at: new Date().toISOString(), step: "建档", note: `自 ${item.code} 拆分而来，来源批次 ${p.sourceBatches.join("、")}` }];
        db.items.unshift(p);
      }
      await saveDb(db);
      return send(res, 201, { parent: item, portions });
    }
    // 合并前检查：列出各份发酵天数、异常次数、缸位，异常观察即拒绝
    if (req.method === "POST" && url.pathname === "/api/merge/preview") {
      const { codes } = await body(req);
      const items = (codes || []).map(c => findBatch(db, c)).filter(Boolean);
      if (items.length < 2) return send(res, 400, { error: "至少选择两个批次" });
      return send(res, 200, mergePreview(items));
    }
    if (req.method === "POST" && url.pathname === "/api/merge") {
      const { codes } = await body(req);
      const items = (codes || []).map(c => findBatch(db, c)).filter(Boolean);
      if (items.length < 2) return send(res, 400, { error: "至少选择两个批次" });
      const preview = mergePreview(items);
      if (!preview.ok) return send(res, 409, { error: `批次 ${preview.blocked.join("、")} 处于异常观察，拒绝合并`, blocked: preview.blocked, rows: preview.rows });
      const total = mergeWeight(items);
      const merged = {
        id: newId(),
        code: "MG-" + Date.now(),
        kind: "合并批",
        source: items.map(i => i.source).filter(Boolean).join(" + "),
        vat: items[0].vat,
        days: Math.max(...items.map(i => Number(i.days || 0))),
        owner: items[0].owner,
        status: "发酵中",
        dryWeight: total,
        remaining: total,
        sourceBatches: items.map(i => i.code),
        logs: [{ at: new Date().toISOString(), step: "合并", note: `由 ${items.map(i => i.code).join("、")} 合并，合计 ${total}kg` }]
      };
      for (const i of items) {
        i.remaining = 0;
        i.mergedInto = merged.code;
        i.logs ||= [];
        i.logs.push({ at: new Date().toISOString(), step: "合并", note: `并入 ${merged.code}` });
      }
      db.items.unshift(merged);
      await saveDb(db);
      return send(res, 201, { merged, rows: preview.rows });
    }
    // 抄纸投料：按实际称重扣减，记录来源批次与操作人
    if (req.method === "GET" && url.pathname === "/api/feedings") return send(res, 200, db.feedings);
    if (req.method === "POST" && url.pathname === "/api/feedings") {
      const result = recordFeeding(db, await body(req));
      if (!result.ok) return send(res, result.status, { error: result.error });
      await saveDb(db);
      return send(res, 201, result.feeding);
    }
    const review = url.pathname.match(/^\/api\/feedings\/([^/]+)\/review$/);
    if (review && req.method === "POST") {
      const result = reviewFeeding(db, review[1], (await body(req)).action);
      if (!result.ok) return send(res, result.status, { error: result.error });
      await saveDb(db);
      return send(res, 200, result.feeding);
    }
    // 来源批次更正/退回：关联投料单转待复核，不计入当日产量
    const correct = url.pathname.match(/^\/api\/items\/([^/]+)\/correct$/);
    if (correct && req.method === "POST") {
      const result = markBatchCorrected(db, correct[1], (await body(req)).note);
      if (!result.ok) return send(res, result.status, { error: result.error });
      await saveDb(db);
      return send(res, 200, result);
    }
    if (req.method === "GET" && url.pathname === "/api/stats") return send(res, 200, computeStats(db));
    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});
server.listen(port, () => console.log("古法纸浆发酵记录 listening on http://localhost:" + port));
