// 页面动作模块：只负责页面结构与浏览器端动作，业务规则都在服务端（ledger/split）。
export function page() {
  const stages = ["入缸", "发酵中", "可抄纸", "异常观察"];
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
    button:disabled { opacity:.5; cursor:not-allowed; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:90px; overflow:auto; } .warn { color:var(--warn); font-weight:700; }
    table { width:100%; border-collapse:collapse; margin:10px 0; font-size:13px; } th,td { border:1px solid var(--line); padding:6px 8px; text-align:left; }
    .row { display:grid; grid-template-columns:1fr 1fr 1fr auto; gap:6px; margin:6px 0; }
    .checks { display:grid; gap:4px; max-height:160px; overflow:auto; border:1px solid var(--line); border-radius:6px; padding:8px; margin:6px 0; }
    .check { margin:0; color:var(--ink); font-size:13px; } .check input { width:auto; margin-right:6px; }
    .btnrow { display:flex; gap:8px; flex-wrap:wrap; } #mergePreview { margin:10px 0; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古法纸浆发酵记录</h1><div class="meta">纸浆批次、拆分合并、抄纸投料与异常观察</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <form id="createForm"><h2>新增纸浆批次</h2><div id="fields"></div><label>初始状态</label><select name="status">${stages.map(s => "<option>" + s + "</option>").join("")}</select><button>保存纸浆批次</button></form>
      <form id="actionForm" style="margin-top:14px"><h2>每日观察记录</h2><label>选择纸浆批次</label><select name="id" id="itemSelect"></select><div id="extraFields"></div><button>提交记录</button></form>
      <form id="splitForm" style="margin-top:14px"><h2>批次拆分</h2><label>选择原批</label><select id="splitSelect"></select><div id="splitRows"></div><button type="button" class="secondary" id="addSplitRow">加一份</button><div style="height:8px"></div><button>拆分（合计不超过原批余量）</button></form>
      <form id="mergeForm" style="margin-top:14px"><h2>批次合并</h2><label>勾选要合并的批次（至少两个）</label><div id="mergeChecks" class="checks"></div><label>新批次编号（可空）</label><input name="code"><label>合并后缸位（可空）</label><input name="vat"><button type="button" class="secondary" id="previewMerge">合并前检视</button><div id="mergePreview"></div><button id="mergeSubmit" disabled>确认合并</button></form>
      <form id="inputForm" style="margin-top:14px"><h2>抄纸投料</h2><label>来源批次</label><select id="inputSelect" name="batchCode"></select><label>实称重量（kg）</label><input name="weight" type="number" step="any" min="0" required><label>操作人</label><input name="operator" required><button>登记投料（按实称扣减）</button></form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="panel" style="margin-bottom:14px"><h2>当日产量</h2><label>日期</label><input type="date" id="outputDate"><div id="outputInfo"></div></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option>${stages.map(s => "<option>" + s + "</option>").join("")}</select><input id="search" placeholder="搜索编号或关键词"></div>
      <div class="panel"><h2>批次台账：余量、来源、异常次数逐批可查。</h2><div class="grid" id="cards"></div></div>
      <div class="panel" style="margin-top:14px"><h2>投料单</h2><div class="grid" id="inputs"></div></div>
    </section>
  </main>
  <script>
    const fields = [["code","批次编号","text"],["source","原料来源","text"],["vat","浸泡缸","text"],["days","发酵天数","number"],["owner","负责人","text"],["dryWeight","干浆重量kg","number"]];
    const stages = ["入缸","发酵中","可抄纸","异常观察"];
    const extraFields = [["temperature","温度"],["smell","气味状态"],["fiber","纤维松散度"],["changedWater","是否换水"],["abnormal","异味或霉点"]];
    const createForm = document.querySelector('#createForm');
    const actionForm = document.querySelector('#actionForm');
    const splitForm = document.querySelector('#splitForm');
    const mergeForm = document.querySelector('#mergeForm');
    const inputForm = document.querySelector('#inputForm');
    const cards = document.querySelector('#cards');
    const statsEl = document.querySelector('#stats');
    const itemSelect = document.querySelector('#itemSelect');
    let items = [];
    let inputs = [];
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
    function renderForms() {
      document.querySelector('#fields').innerHTML = fields.map(([key,label,type]) => '<label>'+label+'</label><input name="'+key+'" type="'+type+'" '+(key==='code'?'required ':'')+(type==='number'?'step="any" min="0" ':'')+'>').join('');
      document.querySelector('#extraFields').innerHTML = extraFields.map(([key,label]) => '<label>'+label+'</label><input name="'+key+'">').join('');
    }
    function usable(item) { return Number(item.remaining || 0) > 0 && !item.hold; }
    function render() {
      itemSelect.innerHTML = items.map(item => '<option value="'+(item.id || item.code)+'">'+(item.code || item.id)+' · '+(item.source || '')+'</option>').join('');
      const opts = items.filter(usable).map(item => '<option value="'+(item.id || item.code)+'">'+item.code+' · 余量'+(item.remaining ?? 0)+'kg</option>').join('');
      document.querySelector('#splitSelect').innerHTML = opts || '<option value="">暂无可拆分批次</option>';
      document.querySelector('#inputSelect').innerHTML = opts || '<option value="">暂无可投料批次</option>';
      document.querySelector('#mergeChecks').innerHTML = items.filter(usable).map(item => '<label class="check"><input type="checkbox" value="'+item.code+'"> '+item.code+' · '+item.status+' · 余量'+(item.remaining ?? 0)+'kg</label>').join('') || '<div class="meta">暂无可合并批次</div>';
      document.querySelector('#mergeSubmit').disabled = true;
      document.querySelector('#mergePreview').innerHTML = '';
      const stats = Object.fromEntries(stages.map(s => [s, items.filter(i => i.status === s).length]));
      statsEl.innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const status = document.querySelector('#statusFilter').value;
      const q = document.querySelector('#search').value.trim();
      const visible = items.filter(item => (!status || item.status === status) && (!q || JSON.stringify(item).includes(q)));
      cards.innerHTML = visible.map(item => cardHtml(item)).join('');
      document.querySelectorAll('[data-status]').forEach(sel => sel.onchange = async () => { await api('/api/items/'+sel.dataset.status, { method:'PATCH', body: JSON.stringify({ status: sel.value }) }); await load(); });
      document.querySelectorAll('[data-note]').forEach(btn => btn.onclick = async () => { const id = btn.dataset.note; const note = prompt('记录备注'); if (note) { await api('/api/items/'+id+'/logs', { method:'POST', body: JSON.stringify({ step:'备注', note }) }); await load(); } });
      document.querySelectorAll('[data-hold]').forEach(btn => btn.onclick = async () => {
        const kind = btn.dataset.hold === 'correct' ? '更正' : '退回';
        const note = prompt(kind + '说明（关联投料单将转为待复核）');
        if (note === null) return;
        try { await api('/api/items/'+btn.dataset.id+'/'+btn.dataset.hold, { method:'POST', body: JSON.stringify({ note }) }); await load(); }
        catch (e) { alert(e.message); }
      });
    }
    function cardHtml(item) {
      const main = [['source','原料来源'],['vat','浸泡缸'],['days','发酵天数'],['owner','负责人']].map(([key,label]) => '<div><b>'+label+'</b> '+(item[key] ?? '')+'</div>').join('');
      const weight = '<div><b>干浆/余量</b> '+(item.dryWeight ?? 0)+'kg / '+(item.remaining ?? 0)+'kg</div>';
      const from = item.parentCode ? '<div><b>拆分自</b> '+item.parentCode+'</div>' : '';
      const merged = (item.mergedFrom || []).length ? '<div><b>合并自</b> '+item.mergedFrom.map(m => m.code+'('+m.weight+'kg)').join('、')+'</div>' : '';
      const root = item.rootCode && item.rootCode !== item.code ? '<div><b>来源批次</b> '+item.rootCode+'</div>' : '';
      const abn = '<div><b>异常次数</b> '+(item.abnormalCount ?? 0)+'</div>';
      const hold = item.hold ? '<div class="warn">'+item.hold.type+'：'+(item.hold.note || '无说明')+'</div>' : '';
      const logs = (item.logs || []).slice(-4).map(l => '<div>'+l.step+'：'+l.note+'</div>').join('');
      const holdBtns = item.hold ? '' : '<button class="secondary" data-hold="correct" data-id="'+(item.id || item.code)+'">更正</button><button class="secondary" data-hold="return" data-id="'+(item.id || item.code)+'">退回</button>';
      return '<article class="card"><h3>'+(item.code || item.id)+'</h3><span class="pill">'+item.status+'</span>'+main+weight+from+merged+root+abn+hold+'<label>状态</label><select data-status="'+(item.id || item.code)+'">'+stages.map(s => '<option '+(s===item.status?'selected':'')+'>'+s+'</option>').join('')+'</select><div class="btnrow"><button class="secondary" data-note="'+(item.id || item.code)+'">追加备注</button>'+holdBtns+'</div><div class="logs meta">'+(logs || '暂无记录')+'</div></article>';
    }
    function renderInputs() {
      const box = document.querySelector('#inputs');
      box.innerHTML = inputs.map(o => '<article class="card"><div><b>'+o.id+'</b> <span class="pill">'+o.status+'</span></div>'
        + '<div>来源批次 <b>'+o.batchCode+'</b> · 实称 '+o.weight+'kg · 操作人 '+o.operator+'</div>'
        + '<div class="meta">'+String(o.at).replace('T',' ').slice(0,19)+(o.holdReason ? ' · '+o.holdReason : '')+(o.review ? ' · 复核：'+o.review.decision : '')+'</div>'
        + (o.status === '待复核' ? '<div class="btnrow"><button data-review="有效" data-id="'+o.id+'">复核有效</button><button class="secondary" data-review="作废" data-id="'+o.id+'">作废</button></div>' : '')
        + '</article>').join('') || '<div class="meta">暂无投料单</div>';
      box.querySelectorAll('[data-review]').forEach(btn => btn.onclick = async () => {
        try { await api('/api/inputs/'+btn.dataset.id+'/review', { method:'POST', body: JSON.stringify({ decision: btn.dataset.review }) }); await load(); }
        catch (e) { alert(e.message); }
      });
    }
    async function loadOutput() {
      const date = document.querySelector('#outputDate').value;
      const data = await api('/api/output/daily' + (date ? '?date=' + date : ''));
      document.querySelector('#outputInfo').innerHTML = '<div class="stats"><div class="stat"><span>当日产量</span><strong>'+data.total+' kg</strong></div>'
        + '<div class="stat"><span>待复核（不计入）</span><strong>'+data.pendingWeight+' kg</strong></div></div>'
        + '<div class="meta">有效 '+data.validCount+' 单计入产量；待复核 '+data.pendingCount+' 单已剔除。</div>';
    }
    function addSplitRow() {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<input type="number" step="any" min="0" placeholder="干浆重量kg" required><input placeholder="编号(可空)" data-code><input placeholder="缸位(可空)" data-vat><button type="button" class="secondary">删</button>';
      row.querySelector('button').onclick = () => row.remove();
      document.querySelector('#splitRows').appendChild(row);
    }
    async function load() {
      items = await api('/api/items');
      inputs = await api('/api/inputs');
      render();
      renderInputs();
      await loadOutput();
    }
    createForm.onsubmit = async event => { event.preventDefault(); try { await api('/api/items', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(createForm).entries())) }); createForm.reset(); await load(); } catch (e) { alert(e.message); } };
    actionForm.onsubmit = async event => { event.preventDefault(); try { await api('/api/items/'+itemSelect.value+'/action', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(actionForm).entries())) }); actionForm.reset(); await load(); } catch (e) { alert(e.message); } };
    splitForm.onsubmit = async event => {
      event.preventDefault();
      const id = document.querySelector('#splitSelect').value;
      if (!id) return alert('暂无可拆分批次');
      const parts = [...document.querySelectorAll('#splitRows .row')].map(row => {
        const cells = row.querySelectorAll('input');
        return { weight: Number(cells[0].value), code: cells[1].value.trim(), vat: cells[2].value.trim() };
      });
      try {
        await api('/api/items/'+id+'/split', { method:'POST', body: JSON.stringify({ parts }) });
        document.querySelector('#splitRows').innerHTML = ''; addSplitRow(); addSplitRow();
        await load();
      } catch (e) { alert(e.message); }
    };
    document.querySelector('#previewMerge').onclick = async () => {
      const codes = [...document.querySelectorAll('#mergeChecks input:checked')].map(c => c.value);
      const box = document.querySelector('#mergePreview');
      const submit = document.querySelector('#mergeSubmit');
      try {
        const data = await api('/api/merge/preview', { method:'POST', body: JSON.stringify({ codes }) });
        box.innerHTML = '<table><tr><th>编号</th><th>发酵天数</th><th>异常次数</th><th>缸位</th><th>状态</th><th>余量kg</th></tr>'
          + data.parts.map(p => '<tr><td>'+p.code+'</td><td>'+p.days+'</td><td>'+p.abnormalCount+'</td><td>'+p.vat+'</td><td>'+p.status+'</td><td>'+p.remaining+'</td></tr>').join('') + '</table>'
          + (data.ok ? '<div class="meta">检视通过，可以合并。</div>' : '<div class="warn">'+(data.blocked.length ? data.blocked.join('、')+' 处于异常观察，拒绝合并。' : '')+(data.held && data.held.length ? data.held.join('、')+' 已更正或退回，不能合并。' : '')+'</div>');
        submit.disabled = !data.ok;
      } catch (e) { box.innerHTML = '<div class="warn">'+e.message+'</div>'; submit.disabled = true; }
    };
    mergeForm.onsubmit = async event => {
      event.preventDefault();
      const codes = [...document.querySelectorAll('#mergeChecks input:checked')].map(c => c.value);
      const fd = new FormData(mergeForm);
      try {
        await api('/api/merge', { method:'POST', body: JSON.stringify({ codes, code: String(fd.get('code')||'').trim(), vat: String(fd.get('vat')||'').trim() }) });
        mergeForm.reset();
        await load();
      } catch (e) { alert(e.message); }
    };
    inputForm.onsubmit = async event => {
      event.preventDefault();
      const fd = new FormData(inputForm);
      try {
        await api('/api/inputs', { method:'POST', body: JSON.stringify({ batchCode: fd.get('batchCode'), weight: Number(fd.get('weight')), operator: fd.get('operator') }) });
        inputForm.reset();
        await load();
      } catch (e) { alert(e.message); }
    };
    document.querySelector('#statusFilter').onchange = render; document.querySelector('#search').oninput = render; document.querySelector('#reload').onclick = load;
    document.querySelector('#addSplitRow').onclick = addSplitRow;
    document.querySelector('#outputDate').value = new Date().toISOString().slice(0,10);
    document.querySelector('#outputDate').onchange = loadOutput;
    renderForms(); addSplitRow(); addSplitRow(); load();
  </script>
</body>
</html>`;
}
