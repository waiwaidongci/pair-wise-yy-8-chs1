# 古法纸浆发酵记录

运行：

```bash
npm start
```

访问`http://localhost:3039`。数据保存在`data/paper-pulp-fermentation.json`。

## 业务模块

- `src/splitting.js` — 拆分计算：纯函数。拆分合计校验（不得超过原批余量）、拆分份生成（保留来源批次）、合并前检查（发酵天数/异常次数/缸位，异常观察即拒绝）。
- `src/ledger.js` — 批次账：抄纸投料按实际称重扣减并记录来源批次与操作人；来源批次更正/退回时关联投料单转待复核，不计入当日产量；投料单复核。
- `src/page.js` — 页面动作：单页界面与前端交互。
- `server.js` — HTTP 路由与 JSON 持久化。

## 接口

- `POST /api/items/:code/split` `{parts:[kg,...]}` 拆分，合计超余量返回 409
- `POST /api/merge/preview` `{codes:[...]}` 合并前检查，返回各份天数/异常次数/缸位
- `POST /api/merge` `{codes:[...]}` 合并，任一份异常观察返回 409 并指出批次
- `POST /api/feedings` `{batchCode,weight,operator}` 投料扣减
- `POST /api/items/:code/correct` `{note}` 更正/退回，关联投料单转待复核
- `POST /api/feedings/:id/review` `{action:"有效"|"作废"}` 复核待复核投料单
