import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { page } from "./src/page.js";
import {
  LedgerError,
  normalizeDb,
  summarize,
  createBatch,
  updateBatch,
  addLog,
  recordObservation,
  applySplit,
  previewMerge,
  applyMerge,
  applyInput,
  applyHold,
  reviewInput,
  dailyOutput,
} from "./src/ledger.js";

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
      "owner": "林素",
      "status": "发酵中",
      "dryWeight": 120,
      "remaining": 120,
      "rootCode": "PF-001",
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
  "inputs": []
};
const statLabels = ["入缸", "发酵中", "可抄纸", "异常观察"];

let idSeq = 0;
function makeId(prefix = "PF") {
  idSeq = (idSeq + 1) % 46656;
  return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36).padStart(3, "0")}`;
}

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return normalizeDb(JSON.parse(await readFile(dbPath, "utf8")));
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
function computeStats(items) {
  const stats = Object.fromEntries(statLabels.map(label => [label, 0]));
  for (const item of items) {
    if (stats[item.status] !== undefined) stats[item.status] += 1;
  }
  return stats;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    const ctx = () => ({ makeId, now: new Date().toISOString() });

    if (req.method === "GET" && url.pathname === "/") return html(res, page());
    if (req.method === "GET" && url.pathname === "/api/items") return send(res, 200, db.items.map(summarize));
    if (req.method === "POST" && url.pathname === "/api/items") {
      const item = createBatch(db, await body(req), ctx());
      await saveDb(db);
      return send(res, 201, item);
    }
    const split = url.pathname.match(/^\/api\/items\/([^/]+)\/split$/);
    if (split && req.method === "POST") {
      const result = applySplit(db, split[1], (await body(req)).parts, ctx());
      await saveDb(db);
      return send(res, 201, result);
    }
    const hold = url.pathname.match(/^\/api\/items\/([^/]+)\/(correct|return)$/);
    if (hold && req.method === "POST") {
      const result = applyHold(db, hold[1], hold[2] === "correct" ? "更正" : "退回", (await body(req)).note, ctx());
      await saveDb(db);
      return send(res, 200, result);
    }
    const patch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (patch && req.method === "PATCH") {
      const item = updateBatch(db, patch[1], await body(req), ctx());
      await saveDb(db);
      return send(res, 200, item);
    }
    const log = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (log && req.method === "POST") {
      const item = addLog(db, log[1], await body(req), ctx());
      await saveDb(db);
      return send(res, 201, item);
    }
    const action = url.pathname.match(/^\/api\/items\/([^/]+)\/action$/);
    if (action && req.method === "POST") {
      const item = recordObservation(db, action[1], await body(req), ctx());
      await saveDb(db);
      return send(res, 201, item);
    }
    if (req.method === "POST" && url.pathname === "/api/merge/preview") {
      return send(res, 200, previewMerge(db, (await body(req)).codes));
    }
    if (req.method === "POST" && url.pathname === "/api/merge") {
      const input = await body(req);
      const merged = applyMerge(db, input.codes, input, ctx());
      await saveDb(db);
      return send(res, 201, merged);
    }
    if (req.method === "GET" && url.pathname === "/api/inputs") return send(res, 200, db.inputs);
    if (req.method === "POST" && url.pathname === "/api/inputs") {
      const order = applyInput(db, await body(req), ctx());
      await saveDb(db);
      return send(res, 201, order);
    }
    const review = url.pathname.match(/^\/api\/inputs\/([^/]+)\/review$/);
    if (review && req.method === "POST") {
      const input = await body(req);
      const order = reviewInput(db, review[1], input.decision, input.note, ctx());
      await saveDb(db);
      return send(res, 200, order);
    }
    if (req.method === "GET" && url.pathname === "/api/output/daily") {
      return send(res, 200, dailyOutput(db, url.searchParams.get("date")));
    }
    if (req.method === "GET" && url.pathname === "/api/stats") return send(res, 200, computeStats(db.items));
    send(res, 404, { error: "not_found" });
  } catch (error) {
    const status = error instanceof LedgerError ? error.status : 500;
    send(res, status, { error: error.message });
  }
});
server.listen(port, () => console.log("古法纸浆发酵记录 listening on http://localhost:" + port));
