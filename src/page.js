// 页面动作：单页界面与前端交互，业务规则调用 /api 由拆分计算与批次账模块裁决。
const fields = [["code","批次编号","text"],["source","原料来源","text"],["vat","浸泡缸","text"],["days","发酵天数","number"],["dryWeight","干浆重量kg","number"],["owner","负责人","text"]];
const stages = ["入缸","发酵中","可抄纸","异常观察"];
const extraFields = [["temperature","温度"],["smell","气味状态"],["fiber","纤维松散度"],["changedWater","是否换水"],["abnormal","异味或霉点"]];

export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法纸浆发酵记录</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:90px; overflow:auto; } .warn { color:var(--warn); font-weight:700; }
    .flash { margin-bottom:14px; padding:10px 14px; border-radius:8px; display:none; } .flash.ok { display:block; background:#e6efe0; color:#3c5a2e; } .flash.err { display:block; background:#f3e2dc; color:var(--warn); }
    table { width:100%; border-collapse:collapse; font-size:13px; margin:10px 0; } th,td { border-bottom:1px solid var(--line); padding:7px 8px; text-align:left; } th { color:var(--muted); }
    .split-row { display:grid; grid-template-columns:1fr 110px 34px; gap:8px; align-items:center; margin-bottom:8px; }
    .feedings { max-height:260px; overflow:auto; } .feedings td .pill { font-size:11px; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古法纸浆发酵记录</h1><div class="meta">纸浆批次、浸泡缸、换水和异常观察 · 批次拆分合并 · 抄纸投料</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <form id="createForm"><h2>新增纸浆批次</h2><div id="fields"></div><label>初始状态</label><select name="status">${stages.map(s => '<option>'+s+'</option>').join('')}</select><button>保存纸浆批次</button></form>
      <form id="actionForm" style="margin-top:14px"><h2>每日观察记录</h2><label>选择纸浆批次</label><select name="id" id="itemSelect"></select><div id="extraFields"></div><button>提交记录</button></form>
      <form id="splitForm" style="margin-top:14px"><h2>批次拆分</h2><label>原批次</label><select id="splitSelect"></select><div class="meta" id="splitRemain"></div><label>拆分份（每份保留来源批次）</label><div id="splitRows"></div><button type="button" class="secondary" id="addSplitRow" style="margin-bottom:10px">加一份</button><button>执行拆分</button></form>
      <form id="mergeForm" style="margin-top:14px"><h2>批次合并</h2><label>待合并批次（按住 Ctrl 多选）</label><select id="mergeSelect" multiple size="5"></select><button type="button" class="secondary" id="previewMerge" style="margin-bottom:10px">合并前检查</button><div id="mergePreview"></div><button id="mergeSubmit" disabled>确认合并</button></form>
      <form id="feedForm" style="margin-top:14px"><h2>抄纸投料</h2><label>来源批次</label><select name="batchCode" id="feedSelect"></select><div class="meta" id="feedRemain"></div><label>实际称重 kg</label><input name="weight" type="number" step="0.001" min="0.001" required><label>操作人</label><input name="operator" required><button>登记投料</button></form>
    </section>
    <section>
      <div class="flash" id="flash"></div>
      <div class="stats" id="stats"></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option>${stages.map(s => '<option>'+s+'</option>').join('')}</select><input id="search" placeholder="搜索编号或关键词"></div>
      <div class="panel"><h2>每天记录温度、气味、纤维状态和换水情况，系统统计发酵进度与异常次数。</h2><div class="grid" id="cards"></div></div>
      <div class="panel" style="margin-top:14px"><h2>投料单</h2><div class="feedings"><table><thead><tr><th>日期</th><th>来源批次</th><th>称重kg</th><th>操作人</th><th>状态</th><th></th></tr></thead><tbody id="feedingRows"></tbody></table></div></div>
    </section>
  </main>
  <script>
    const fields = ${JSON.stringify(fields)};
    const stages = ${JSON.stringify(stages)};
    const extraFields = ${JSON.stringify(extraFields)};
    const $ = s => document.querySelector(s);
    let items = [], feedings = [], stats = {}, mergeChecked = false;
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
    function flash(msg, ok) { const el = $('#flash'); el.textContent = msg; el.className = 'flash ' + (ok === false ? 'err' : 'ok'); }
    async function run(fn) { try { await fn(); } catch (e) { flash(e.message, false); } }
    function batchLabel(i) { return i.code + ' · ' + (i.source || '') + (i.remaining != null ? ' · 余' + i.remaining + 'kg' : ''); }
    function renderForms() {
      $('#fields').innerHTML = fields.map(([key,label,type]) => '<label>'+label+'</label><input name="'+key+'" type="'+type+'" '+(key==='code'?'required':'')+(type==='number'?' step="any" min="0"':'')+'>').join('');
      $('#extraFields').innerHTML = extraFields.map(([key,label]) => '<label>'+label+'</label><input name="'+key+'">').join('');
    }
    function addSplitRow() {
      const row = document.createElement('div');
      row.className = 'split-row';
      row.innerHTML = '<input name="part" type="number" step="0.001" min="0.001" placeholder="本份干浆kg" required><span class="meta">kg</span><button type="button" class="secondary">删</button>';
      row.querySelector('button').onclick = () => { row.remove(); };
      $('#splitRows').appendChild(row);
    }
    function render() {
      $('#itemSelect').innerHTML = items.map(i => '<option value="'+(i.id || i.code)+'">'+batchLabel(i)+'</option>').join('');
      const withWeight = items.filter(i => i.remaining != null);
      $('#splitSelect').innerHTML = withWeight.map(i => '<option value="'+i.code+'">'+batchLabel(i)+'</option>').join('');
      $('#feedSelect').innerHTML = withWeight.map(i => '<option value="'+i.code+'">'+batchLabel(i)+'</option>').join('');
      $('#mergeSelect').innerHTML = items.map(i => '<option value="'+i.code+'">'+batchLabel(i)+'</option>').join('');
      const sr = withWeight.find(i => i.code === $('#splitSelect').value);
      $('#splitRemain').textContent = sr ? '原批余量 ' + sr.remaining + 'kg，拆分合计不得超过' : '暂无可拆分批次';
      const fr = withWeight.find(i => i.code === $('#feedSelect').value);
      $('#feedRemain').textContent = fr ? '该批余量 ' + fr.remaining + 'kg' : '';
      stats = Object.fromEntries(stages.map(s => [s, items.filter(i => i.status === s).length]));
      $('#stats').innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const status = $('#statusFilter').value, q = $('#search').value.trim();
      const visible = items.filter(i => (!status || i.status === status) && (!q || JSON.stringify(i).includes(q)));
      $('#cards').innerHTML = visible.map(cardHtml).join('');
      document.querySelectorAll('[data-status]').forEach(sel => sel.onchange = () => run(async () => { await api('/api/items/'+sel.dataset.status, { method:'PATCH', body: JSON.stringify({ status: sel.value }) }); await load(); }));
      document.querySelectorAll('[data-note]').forEach(btn => btn.onclick = () => run(async () => { const note = prompt('记录备注'); if (note) { await api('/api/items/'+btn.dataset.note+'/logs', { method:'POST', body: JSON.stringify({ step:'备注', note }) }); await load(); } }));
      document.querySelectorAll('[data-correct]').forEach(btn => btn.onclick = () => run(async () => {
        const note = prompt('更正/退回原因', '原料退回'); if (note == null) return;
        const r = await api('/api/items/'+btn.dataset.correct+'/correct', { method:'POST', body: JSON.stringify({ note }) });
        flash('已登记更正，' + r.affected + ' 张关联投料单转待复核'); await load();
      }));
      $('#feedingRows').innerHTML = feedings.map(f => '<tr><td>'+f.date+'</td><td>'+f.batchCode+'</td><td>'+f.weight+'</td><td>'+f.operator+'</td><td><span class="pill">'+f.status+'</span></td><td>'+(f.status==='待复核' ? '<button class="secondary" data-keep="'+f.id+'">有效</button> <button class="secondary" data-void="'+f.id+'">作废</button>' : '')+'</td></tr>').join('') || '<tr><td colspan="6" class="meta">暂无投料单</td></tr>';
      document.querySelectorAll('[data-keep]').forEach(b => b.onclick = () => run(async () => { await api('/api/feedings/'+b.dataset.keep+'/review', { method:'POST', body: JSON.stringify({ action:'有效' }) }); await load(); }));
      document.querySelectorAll('[data-void]').forEach(b => b.onclick = () => run(async () => { await api('/api/feedings/'+b.dataset.void+'/review', { method:'POST', body: JSON.stringify({ action:'作废' }) }); await load(); }));
    }
    function cardHtml(item) {
      const main = fields.slice(0,5).map(([key,label]) => '<div><b>'+label+'</b> '+((key==='dryWeight' ? (item.remaining != null ? '余'+item.remaining+' / 原'+(item.dryWeight ?? '—') : item[key]) : item[key]) ?? '')+'</div>').join('');
      const from = (item.sourceBatches || []).length ? '<div><b>来源批次</b> '+item.sourceBatches.join('、')+'</div>' : '';
      const logs = (item.logs || []).slice(-4).map(l => '<div>'+l.step+'：'+l.note+'</div>').join('');
      return '<article class="card"><h3>'+(item.code || item.id)+'</h3><span class="pill">'+item.status+'</span>'+main+from+'<label>状态</label><select data-status="'+(item.id || item.code)+'">'+stages.map(s => '<option '+(s===item.status?'selected':'')+'>'+s+'</option>').join('')+'</select><div style="display:flex;gap:8px"><button class="secondary" data-note="'+(item.id || item.code)+'">追加备注</button><button class="secondary" data-correct="'+(item.id || item.code)+'">更正/退回</button></div><div class="logs meta">'+(logs || '暂无记录')+'</div></article>';
    }
    async function load() {
      [items, feedings, stats] = await Promise.all([api('/api/items'), api('/api/feedings'), api('/api/stats')]);
      render();
      $('#stats').innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
    }
    $('#createForm').onsubmit = e => { e.preventDefault(); run(async () => { await api('/api/items', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target).entries())) }); e.target.reset(); flash('批次已保存'); await load(); }); };
    $('#actionForm').onsubmit = e => { e.preventDefault(); run(async () => { await api('/api/items/'+$('#itemSelect').value+'/action', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target).entries())) }); e.target.reset(); flash('观察已记录'); await load(); }); };
    $('#splitForm').onsubmit = e => { e.preventDefault(); run(async () => {
      const parts = [...document.querySelectorAll('#splitRows input[name=part]')].map(i => Number(i.value));
      const r = await api('/api/items/'+$('#splitSelect').value+'/split', { method:'POST', body: JSON.stringify({ parts }) });
      $('#splitRows').innerHTML = ''; addSplitRow(); addSplitRow();
      flash('拆分完成：' + r.portions.map(p => p.code + ' ' + p.dryWeight + 'kg').join('，')); await load();
    }); };
    $('#previewMerge').onclick = () => run(async () => {
      const codes = [...$('#mergeSelect').selectedOptions].map(o => o.value);
      const r = await api('/api/merge/preview', { method:'POST', body: JSON.stringify({ codes }) });
      $('#mergePreview').innerHTML = '<table><thead><tr><th>批次</th><th>发酵天数</th><th>异常次数</th><th>缸位</th></tr></thead><tbody>' + r.rows.map(x => '<tr><td>'+x.code+'</td><td>'+x.days+'</td><td>'+x.abnormalCount+'</td><td>'+x.vat+'</td></tr>').join('') + '</tbody></table>';
      $('#mergeSubmit').disabled = false; mergeChecked = true;
    });
    $('#mergeForm').onsubmit = e => { e.preventDefault(); run(async () => {
      if (!mergeChecked) { flash('请先执行合并前检查', false); return; }
      const codes = [...$('#mergeSelect').selectedOptions].map(o => o.value);
      const r = await api('/api/merge', { method:'POST', body: JSON.stringify({ codes }) });
      $('#mergePreview').innerHTML = ''; $('#mergeSubmit').disabled = true; mergeChecked = false;
      flash('合并完成：' + r.merged.code + '，合计 ' + r.merged.dryWeight + 'kg'); await load();
    }); };
    $('#feedForm').onsubmit = e => { e.preventDefault(); run(async () => {
      await api('/api/feedings', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target).entries())) });
      e.target.reset(); flash('投料已登记'); await load();
    }); };
    $('#statusFilter').onchange = render; $('#search').oninput = render; $('#reload').onclick = load;
    $('#addSplitRow').onclick = addSplitRow;
    renderForms(); addSplitRow(); addSplitRow(); load();
  </script>
</body>
</html>`;
}
