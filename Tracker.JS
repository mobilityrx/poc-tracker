(function() {
'use strict';

const CLINIC = 362;
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbwtDAa20TN9pkC6XZ9LCwKxNP_wDmcAtbLS05hiD7q8iT4mND51o4CR_6kZNXYvUk_EQQ/exec';

const MEDICARE_PATTERNS = [/medicare/i, /ca medicare/i, /cms/i, /railroad medicare/i];
const MEDICARE_ADV_PATTERNS = [/aarp/i, /humana/i, /wellcare/i, /scan/i, /alignment/i, /iehp/i, /\buhc\b/i, /united.*medicare/i, /medicare.*advantage/i, /mapd/i];
const MEDI_CAL_PATTERNS = [/medi.?cal/i, /medicaid/i, /denti.?cal/i];
const WORKERS_COMP_PATTERNS = [/workers.?comp/i, /work comp/i, /wc\b/i, /\blien\b/i, /\bmva\b/i, /state fund/i];

function classifyInsurance(payerName) {
  if (!payerName) return 'unknown';
  if (MEDICARE_PATTERNS.some(p => p.test(payerName))) return 'medicare';
  if (MEDICARE_ADV_PATTERNS.some(p => p.test(payerName))) return 'medicare_adv';
  if (MEDI_CAL_PATTERNS.some(p => p.test(payerName))) return 'medi_cal';
  if (WORKERS_COMP_PATTERNS.some(p => p.test(payerName))) return 'workers_comp';
  if (/cash|self.?pay|private pay/i.test(payerName)) return 'cash';
  return 'commercial';
}

function getMedicareCertWindow(insType) {
  if (insType === 'medicare') return 60;
  if (insType === 'medicare_adv') return 60;
  if (insType === 'medi_cal') return 60;
  return 90;
}

const FREQ = {ONCE_A_WEEK:'1x/wk',TWICE_A_WEEK:'2x/wk',THREE_TIMES_A_WEEK:'3x/wk',FOUR_TIMES_A_WEEK:'4x/wk',FIVE_TIMES_A_WEEK:'5x/wk',ONCE_EVERY_OTHER_WEEK:'1x/2wk',DAILY:'Daily'};
const OUTCOMES = {left_vm:'Left voicemail',no_answer:'No answer',spoke_signing:'Spoke — signing soon',fax_sent:'Fax re-sent',fax_received:'Fax received ✓',certified:'Signed — received ✓',rx_on_file:'RX on file ✓',rx_not_on_file:'RX not on file',scheduled:'Appointment scheduled',wrong_number:'Wrong number',other:'Other'};
const OCC = {certified:{bg:'#EDF6F1',c:'#1A6B3A'},fax_received:{bg:'#EDF6F1',c:'#1A6B3A'},spoke_signing:{bg:'#EDF6F1',c:'#1A6B3A'},rx_on_file:{bg:'#EDF6F1',c:'#1A6B3A'},scheduled:{bg:'#EDF6F1',c:'#1A6B3A'},left_vm:{bg:'#EFEDE8',c:'#6B6760'},no_answer:{bg:'#EFEDE8',c:'#6B6760'},fax_sent:{bg:'#F0EFFE',c:'#4B3FBF'},rx_not_on_file:{bg:'#FDF0F0',c:'#C13535'},wrong_number:{bg:'#FDF0F0',c:'#C13535'},other:{bg:'#EFEDE8',c:'#6B6760'}};
const RK = {non_compliant:-1,expired:0,recert_due:0.5,created:1,none:2,certified:3};
const RBC = {non_compliant:'rb_red',expired:'rb_red',recert_due:'rb_orange',created:'rb_orange',none:'rb_yellow',certified:'rb_green'};
const BDC = {non_compliant:'b_noncompliant',expired:'b_red',recert_due:'b_orange',created:'b_orange',none:'b_yellow',certified:'b_green'};
const INS_LABELS = {medicare:'Medicare',medicare_adv:'Medicare Adv',medi_cal:'Medi-Cal',workers_comp:'Workers Comp',cash:'Cash/Self-pay',commercial:'Commercial',unknown:'Unknown'};
const INS_COLORS = {medicare:{bg:'#EFF6FF',c:'#1D4ED8',bd:'#BFDBFE'},medicare_adv:{bg:'#F0F9FF',c:'#0369A1',bd:'#BAE6FD'},medi_cal:{bg:'#F0EFFE',c:'#4B3FBF',bd:'#C8C3F5'},workers_comp:{bg:'#FFF7ED',c:'#C2410C',bd:'#FED7AA'},cash:{bg:'#EFEDE8',c:'#6B6760',bd:'#D0CCC4'},commercial:{bg:'#F4F3EF',c:'#1C1A17',bd:'#D0CCC4'},unknown:{bg:'#F4F3EF',c:'#9E9A94',bd:'#E0DDD6'}};

// ── SHEET INTEGRATION ─────────────────────────────────────────────────────────
async function sheetSaveLog(entry) {
  try {
    await fetch(SHEET_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'log', ...entry }),
    });
  } catch(e) { console.warn('Sheet save failed:', e.message); }
}

async function sheetGetLogs(patient_id) {
  try {
    const r = await fetch(SHEET_URL + '?patient_id=' + patient_id);
    return await r.json();
  } catch(e) { return []; }
}

async function sheetSaveFlag(entry) {
  try {
    await fetch(SHEET_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'flag', ...entry }),
    });
  } catch(e) { console.warn('Sheet flag failed:', e.message); }
}

// ── REMOVE EXISTING INSTANCE ──────────────────────────────────────────────────
document.getElementById('_mrx_btn')?.remove();
document.getElementById('_mrx_overlay')?.remove();
document.getElementById('_mrx_style')?.remove();

// ── STYLES ────────────────────────────────────────────────────────────────────
const sEl = document.createElement('style');
sEl.id = '_mrx_style';
sEl.textContent = `
#_mrx_btn{position:fixed;bottom:24px;right:24px;z-index:99998;background:#1C1A17;color:#fff;font-family:'DM Sans',system-ui,sans-serif;font-size:13px;font-weight:600;padding:10px 18px;border-radius:99px;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.3);display:flex;align-items:center;gap:7px;transition:transform .15s,box-shadow .15s}
#_mrx_btn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(0,0,0,.35)}
#_mrx_btn .ld{width:7px;height:7px;border-radius:50%;background:#22c55e;animation:_mrx_p 2s infinite}
@keyframes _mrx_p{0%,100%{opacity:1}50%{opacity:.3}}@keyframes _mrx_pulse{0%,100%{box-shadow:0 0 0 2px #F97316}50%{box-shadow:0 0 0 4px #F97316,0 0 12px rgba(249,115,22,.5)}}
#_mrx_overlay{position:fixed;top:0;right:-510px;width:490px;height:100vh;background:#FDFCFA;border-left:1px solid #E0DDD6;z-index:99999;display:flex;flex-direction:column;font-family:'DM Sans',system-ui,sans-serif;font-size:13px;color:#1C1A17;box-shadow:-4px 0 24px rgba(0,0,0,.12);transition:right .28s cubic-bezier(.4,0,.2,1);overflow:hidden}
#_mrx_overlay.open{right:0}
._mh{background:#FDFCFA;border-bottom:1px solid #E0DDD6;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
._mhl{display:flex;align-items:center;gap:8px}
._mt{font-size:14px;font-weight:600;letter-spacing:-.2px}
._mb{font-size:10px;font-weight:600;padding:2px 7px;border-radius:99px;background:#EDF6F1;color:#1A6B3A;border:1px solid #B0D9C0;display:flex;align-items:center;gap:4px}
._mc{background:none;border:none;cursor:pointer;font-size:18px;color:#9E9A94;padding:2px 5px;border-radius:4px;line-height:1}
._mc:hover{background:#EFEDE8;color:#1C1A17}
._mr{font-family:'DM Sans',system-ui,sans-serif;font-size:11px;font-weight:500;padding:4px 10px;border-radius:8px;border:1px solid #D0CCC4;background:#FDFCFA;color:#1C1A17;cursor:pointer}
._mr:hover{background:#EFEDE8}
._mr:disabled{opacity:.5;pointer-events:none}
._mmet{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;padding:9px 12px;flex-shrink:0;background:#F4F3EF;border-bottom:1px solid #E0DDD6}
._mm{background:#FDFCFA;border:1px solid #E0DDD6;border-radius:8px;padding:7px 8px;cursor:pointer;text-align:center;transition:border-color .15s}
._mm:hover{border-color:#D0CCC4}
._mm.active{box-shadow:0 0 0 2px #1C1A17 inset}
._mmv{font-size:18px;font-weight:600;letter-spacing:-1px}
._mml{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#9E9A94;margin-top:1px}
.mr{color:#C13535}.mo{color:#B85A00}.my{color:#7A5200}.mg{color:#1A6B3A}.mb2{color:#1D4ED8}
._mctl{padding:8px 12px;border-bottom:1px solid #E0DDD6;display:flex;flex-direction:column;gap:5px;flex-shrink:0}
._mctlr{display:flex;gap:5px;align-items:center}
._ms{flex:1;font-family:'DM Sans',system-ui,sans-serif;font-size:12px;padding:5px 9px;border:1px solid #D0CCC4;border-radius:6px;background:#F4F3EF;color:#1C1A17;outline:none}
._ms:focus{border-color:#2563EB}
._mins{font-family:'DM Sans',system-ui,sans-serif;font-size:11px;padding:5px 8px;border:1px solid #D0CCC4;border-radius:6px;background:#F4F3EF;color:#1C1A17;outline:none}
._mins:focus{border-color:#2563EB}
._mft{font-family:'DM Sans',system-ui,sans-serif;font-size:10px;font-weight:500;padding:4px 8px;border-radius:99px;border:1px solid transparent;background:transparent;color:#9E9A94;cursor:pointer;white-space:nowrap}
._mft:hover{background:#EFEDE8;color:#1C1A17}
._mft.on{border-color:#D0CCC4;background:#FDFCFA;color:#1C1A17}
._mlist{flex:1;overflow-y:auto}
._mrow{padding:9px 12px;border-bottom:1px solid #EFEDE8;cursor:pointer;display:flex;align-items:flex-start;gap:8px;transition:background .1s}
._mrow:hover{background:#F4F3EF}
._mrow.sel{background:#EDF2FF}
.rb{width:3px;border-radius:2px;flex-shrink:0;margin-top:3px;align-self:stretch;min-height:36px}
.rb_red{background:#C13535}.rb_orange{background:#B85A00}.rb_yellow{background:#C99A00}.rb_green{background:#1A6B3A}
._mrb{flex:1;min-width:0}
._mrn{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
._mrs{font-size:10px;color:#6B6760;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
._mbg{font-size:9px;font-weight:500;padding:1px 6px;border-radius:99px;white-space:nowrap;display:inline-block}
.b_noncompliant{background:#FDF0F0;color:#7F1D1D;border:1px solid #FECACA;font-weight:700}
.b_red{background:#FDF0F0;color:#C13535;border:1px solid #F0C5C5}
.b_orange{background:#FEF5EC;color:#B85A00;border:1px solid #F5D8B0}
.b_yellow{background:#FEF9EC;color:#7A5200;border:1px solid #F0DFA0}
.b_green{background:#EDF6F1;color:#1A6B3A;border:1px solid #B0D9C0}
.b_purple{background:#F0EFFE;color:#4B3FBF;border:1px solid #C8C3F5}
.b_blue{background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE}
.b_gray{background:#EFEDE8;color:#9E9A94;border:1px solid #E0DDD6}
._mdet{border-top:1px solid #E0DDD6;background:#FDFCFA;max-height:62vh;overflow-y:auto;flex-shrink:0;display:none}
._mdet.open{display:block}
._mdh{padding:10px 12px;border-bottom:1px solid #EFEDE8;display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
._mdn{font-size:13px;font-weight:600}
._mdc2{display:grid;grid-template-columns:1fr 1fr}
._mdcol{padding:10px 12px;border-right:1px solid #EFEDE8}
._mdcol:last-child{border-right:none}
._mdct{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9E9A94;margin-bottom:7px}
._mdr{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #EFEDE8;font-size:11px;gap:6px}
._mdr:last-child{border-bottom:none}
._mdk{color:#6B6760;flex-shrink:0}
._mdv{font-weight:500;text-align:right;word-break:break-word}
._mdv.red{color:#C13535}._mdv.orange{color:#B85A00}._mdv.green{color:#1A6B3A}._mdv.blue{color:#1D4ED8}
._mcs{padding:8px 12px;border-top:1px solid #EFEDE8;background:#F4F3EF;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
._mcsl{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9E9A94}
._mci{display:flex;align-items:center;gap:4px;font-size:10px;color:#6B6760}
._mcid{width:6px;height:6px;border-radius:50%;flex-shrink:0}
._mrule{padding:8px 12px;border-top:1px solid #EFEDE8;background:#EFF6FF;font-size:11px;color:#1D4ED8;display:flex;align-items:center;gap:6px}
._mcl{border-top:1px solid #EFEDE8;padding:10px 12px}
._mclt{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9E9A94;margin-bottom:8px}
._mcle{font-size:11px;padding:5px 0;border-bottom:1px solid #EFEDE8;display:flex;gap:6px}
._mcle:last-child{border-bottom:none}
._mcled{width:5px;height:5px;border-radius:50%;background:#9E9A94;flex-shrink:0;margin-top:4px}
._mclt2{color:#9E9A94;font-size:10px;margin-top:1px}
._mct{font-size:10px;font-weight:500;padding:1px 6px;border-radius:99px;display:inline-block;margin-bottom:2px}
._mform{display:grid;gap:6px}
._mfrow{display:grid;grid-template-columns:1fr 1fr;gap:6px}
._mform select,._mform textarea,._mform input{font-family:'DM Sans',system-ui,sans-serif;font-size:11px;padding:5px 8px;border:1px solid #D0CCC4;border-radius:6px;background:#F4F3EF;color:#1C1A17;outline:none;width:100%}
._mform select:focus,._mform textarea:focus{border-color:#2563EB}
._mform textarea{resize:vertical;min-height:44px}
._msave{font-family:'DM Sans',system-ui,sans-serif;font-size:11px;font-weight:500;padding:5px 12px;border-radius:6px;border:none;background:#1C1A17;color:#fff;cursor:pointer;width:fit-content}
._msave:hover{opacity:.85}
._mflag{font-family:'DM Sans',system-ui,sans-serif;font-size:11px;font-weight:500;padding:5px 12px;border-radius:6px;border:1px solid #F5D8B0;background:#FEF5EC;color:#B85A00;cursor:pointer;width:fit-content}
._mflag:hover{opacity:.85}
._mempty{padding:32px;text-align:center;color:#9E9A94;font-size:12px}
._mload{padding:32px;text-align:center;color:#6B6760;font-size:12px}
._mnolog{color:#9E9A94;font-size:11px;font-style:italic;padding:4px 0 8px}
._mnc-banner{background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:6px 10px;font-size:11px;color:#7F1D1D;font-weight:500;margin-bottom:6px;display:flex;align-items:center;gap:5px}
._msync{font-size:10px;color:#9E9A94;font-style:italic;padding:2px 0}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#D0CCC4;border-radius:2px}
`;
document.head.appendChild(sEl);

// ── BUILD UI ──────────────────────────────────────────────────────────────────
const btn = document.createElement('button');
btn.id = '_mrx_btn';
btn.innerHTML = '<span class="ld"></span> POC Tracker';
btn.onclick = () => {
  overlay.classList.toggle('open');
  if (overlay.classList.contains('open') && !window._mrxData?.length) _mrxLoad();
};
document.body.appendChild(btn);

const overlay = document.createElement('div');
overlay.id = '_mrx_overlay';
overlay.innerHTML = `
  <div class="_mh">
    <div class="_mhl">
      <span class="_mt">POC Tracker</span>
      <span class="_mb"><span class="ld" style="width:6px;height:6px;border-radius:50%;background:#22c55e;animation:_mrx_p 2s infinite;display:inline-block"></span>Live · Spry</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <span id="_mrxts" style="font-size:10px;color:#9E9A94"></span>
      <button class="_mr" id="_mrxref" onclick="_mrxLoad()">↻ Refresh</button>
      <button class="_mc" onclick="document.getElementById('_mrx_overlay').classList.remove('open')">✕</button>
    </div>
  </div>
  <div class="_mmet" style="grid-template-columns:repeat(4,1fr)">
    <div class="_mm" id="_mrxme" onclick="_mrxFilter('non_compliant')"><div class="_mmv" style="color:#7F1D1D;font-size:14px" id="_mrxvnc">—</div><div class="_mml">Non-Comp</div></div>
    <div class="_mm" id="_mrxmexp" onclick="_mrxFilter('expired')"><div class="_mmv mr" id="_mrxve">—</div><div class="_mml">Expired</div></div>
    <div class="_mm" id="_mrxmc" onclick="_mrxFilter('recert_due')"><div class="_mmv mo" id="_mrxvc">—</div><div class="_mml">Recert Due</div></div>
    <div class="_mm" id="_mrxmk" onclick="_mrxFilter('certified')"><div class="_mmv mg" id="_mrxvk">—</div><div class="_mml">Certified</div></div>
    <div class="_mm" id="_mrxmns" onclick="_mrxFilter('needs_scheduling')" style="border:2px solid #F97316;background:#FFF7ED"><div class="_mmv" style="color:#C2410C;font-size:14px;font-weight:800" id="_mrxvns">—</div><div class="_mml" style="color:#C2410C;font-weight:600">Sched Alert</div></div>
    <div class="_mm" id="_mrxmar" onclick="_mrxFilter('at_risk')" style="border:1px solid #FECACA"><div class="_mmv" style="color:#7F1D1D;font-size:14px;font-weight:800" id="_mrxvar">—</div><div class="_mml" style="color:#C13535">At Risk</div></div>
    <div class="_mm" id="_mrxmna" onclick="_mrxFilter('no_future_appt')"><div class="_mmv" style="color:#6B21A8;font-size:14px" id="_mrxvna">—</div><div class="_mml">No Appt</div></div>
    <div class="_mm" id="_mrxmun" onclick="_mrxFilter('unscheduled')"><div class="_mmv" style="color:#0369A1;font-size:14px" id="_mrxvun">—</div><div class="_mml">Unscheduled</div></div>
  </div>
  <div class="_mctl">
    <div class="_mctlr">
      <input class="_ms" id="_mrxs" placeholder="Search patient or provider…" oninput="_mrxRender()">
    </div>
    <div class="_mctlr">
      <select class="_mins" id="_mrxins" onchange="_mrxRender()">
        <option value="">All insurance</option>
        <option value="medicare">Medicare</option>
        <option value="medicare_adv">Medicare Advantage</option>
        <option value="medi_cal">Medi-Cal</option>
        <option value="workers_comp">Workers Comp</option>
        <option value="commercial">Commercial</option>
        <option value="cash">Cash / Self-pay</option>
      </select>
      <button class="_mft on" onclick="_mrxTab('all',this)">All</button>
      <button class="_mft" onclick="_mrxTab('non_compliant',this)">Non-comp</button>
      <button class="_mft" onclick="_mrxTab('expired',this)">Expired</button>
      <button class="_mft" onclick="_mrxTab('recert_due',this)">Recert due</button>
      <button class="_mft" onclick="_mrxTab('no_future_appt',this)">No appt</button>
      <button class="_mft" onclick="_mrxTab('needs_scheduling',this)" style="color:#C2410C;font-weight:600">Schedule Alert</button>
      <button class="_mft" onclick="_mrxTab('at_risk',this)" style="color:#7F1D1D">At Risk</button>
      <button class="_mft" onclick="_mrxTab('unscheduled',this)">Unscheduled</button>
    </div>
  </div>
  <div class="_mlist" id="_mrxlist"><div class="_mload">Click ↻ Refresh to load patients</div></div>
  <div class="_mdet" id="_mrxdet"></div>
`;
document.body.appendChild(overlay);

// ── STATE ─────────────────────────────────────────────────────────────────────
window._mrxData = window._mrxData || [];
window._mrxFlt = 'all';
window._mrxDid = null;

function _mrxFmt(d) { if (!d) return '—'; const dt = new Date(d); return (dt.getMonth()+1)+'/'+(dt.getDate())+'/'+dt.getFullYear().toString().slice(2); }

// ── RISK ASSESSMENT ───────────────────────────────────────────────────────────
function _mrxAssess(p) {
  const s = p.poc_status, e = p.poc_expiration_date, lastAppt = p.last_appt;
  const insType = p.ins_type || 'commercial';
  const warningDays = insType === 'medicare' || insType === 'medicare_adv' ? 10 : 14;
  const dfl = d => d ? Math.round((new Date(d) - new Date()) / 864e5) : null;
  const dag = d => d ? Math.round((new Date() - new Date(d)) / 864e5) : null;
  const isNonCompliant = () => {
    if (s !== 'EXPIRED' && !(s === 'CERTIFIED' && dfl(e) !== null && dfl(e) <= 0)) return false;
    if (!lastAppt) return false;
    return (dag(lastAppt) || 0) <= 30;
  };
  if (!s) return { risk: 'none', label: 'No POC on file', dl: null };
  if (s === 'EXPIRED') {
    const da = dag(e);
    if (isNonCompliant()) return { risk: 'non_compliant', label: '⚠ Non-compliant', dl: da ? -da : null };
    return { risk: 'expired', label: 'Expired' + (da !== null ? ' ' + da + 'd ago' : ''), dl: da ? -da : null };
  }
  if (s === 'CERTIFIED' || s === 'CREATED') {
    if (e) {
      const dl = dfl(e);
      if (dl !== null && dl <= 0) {
        if (isNonCompliant()) return { risk: 'non_compliant', label: '⚠ Non-compliant', dl };
        return { risk: 'expired', label: 'Cert expired ' + Math.abs(dl) + 'd ago', dl };
      }
      if (dl !== null && dl <= warningDays) return { risk: s === 'CREATED' ? 'created' : 'recert_due', label: (s === 'CREATED' ? 'Urgent — ' : 'Recert due ') + dl + 'd', dl };
      if (dl !== null && dl <= 30 && (insType === 'medicare' || insType === 'medicare_adv')) return { risk: 'recert_due', label: 'Medicare recert ' + dl + 'd', dl };
      return s === 'CREATED' ? { risk: 'created', label: 'Awaiting cert', dl } : { risk: 'certified', label: 'Certified', dl };
    }
    return s === 'CREATED' ? { risk: 'created', label: 'Awaiting cert', dl: null } : { risk: 'certified', label: 'Certified', dl: null };
  }
  return { risk: 'none', label: s, dl: null };
}

// ── FILTER / SORT ─────────────────────────────────────────────────────────────
window._mrxFilter = f => { window._mrxFlt = window._mrxFlt === f ? 'all' : f; _mrxSyncTabs(); _mrxRender(); };
window._mrxTab = (f, el) => { window._mrxFlt = f; _mrxSyncTabs(); _mrxRender(); };

function _mrxSyncTabs() {
  document.querySelectorAll('._mft').forEach(b => b.classList.remove('on'));
  const tabs = ['all', 'non_compliant', 'expired', 'recert_due', 'needs_scheduling', 'at_risk', 'no_future_appt', 'unscheduled'];
  const idx = tabs.indexOf(window._mrxFlt);
  if (idx >= 0) document.querySelectorAll('._mft')[idx]?.classList.add('on');
  ['_mrxme','_mrxmexp','_mrxmc','_mrxmn','_mrxmk'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  const mm = { non_compliant: '_mrxme', expired: '_mrxmexp', recert_due: '_mrxmc', certified: '_mrxmk', needs_scheduling: '_mrxmns', no_future_appt: '_mrxmna', unscheduled: '_mrxmun', at_risk: '_mrxmar' };
  if (mm[window._mrxFlt]) document.getElementById(mm[window._mrxFlt])?.classList.add('active');
}

// ── RENDER ────────────────────────────────────────────────────────────────────
window._mrxRender = function() {
  const data = window._mrxData;
  if (!data.length) return;
  const q = document.getElementById('_mrxs')?.value?.toLowerCase() || '';
  const insFilter = document.getElementById('_mrxins')?.value || '';
  const flt = window._mrxFlt;
  const _set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  _set('_mrxvnc', data.filter(p => p.risk === 'non_compliant').length);
  _set('_mrxve', data.filter(p => p.risk === 'expired').length);
  _set('_mrxvc', data.filter(p => p.risk === 'recert_due' || p.risk === 'created').length);
  _set('_mrxvk', data.filter(p => p.risk === 'certified').length);
  const nsCount = data.filter(p => p.sched_priority === 1 || p.sched_priority === 2).length;
  _set('_mrxvns', nsCount);
  _set('_mrxvna', data.filter(p => p.no_future_appt === true).length);
  _set('_mrxvun', data.filter(p => p.activity_status === 'unscheduled').length);
  _set('_mrxvar', data.filter(p => p.at_risk).length);
  const nsTile = document.getElementById('_mrxmns');
  if (nsTile) nsTile.style.animation = nsCount > 0 ? '_mrx_pulse 2s infinite' : '';
  let rows = data.filter(p => {
    if (q && !p.name.toLowerCase().includes(q) && !(p.referring || '').toLowerCase().includes(q) && !(p.insurance || '').toLowerCase().includes(q)) return false;
    if (insFilter && p.ins_type !== insFilter) return false;
    if (flt === 'non_compliant') return p.risk === 'non_compliant';
    if (flt === 'expired') return p.risk === 'expired';
    if (flt === 'recert_due') return p.risk === 'recert_due' || p.risk === 'created';
    if (flt === 'certified') return p.risk === 'certified';
    if (flt === 'needs_scheduling') return p.sched_priority === 1 || p.sched_priority === 2;
    if (flt === 'at_risk') return p.at_risk === true;
    if (flt === 'no_future_appt') return p.no_future_appt === true;
    if (flt === 'unscheduled') return p.activity_status === 'unscheduled';
    return true;
  });
  // For scheduling-focused filters, sort by priority score first
  const schedFilters = ['no_future_appt','unscheduled','needs_scheduling','all'];
  rows.sort((a, b) => {
    // If viewing a scheduling-focused filter, sort by scheduling priority first
    if (schedFilters.includes(flt)) {
      const sp = (a.sched_priority||4) - (b.sched_priority||4);
      if (sp !== 0) return sp;
    }
    const ra = RK[a.risk] ?? 3, rb = RK[b.risk] ?? 3;
    if (ra !== rb) return ra - rb;
    const risk = a.risk;
    const da = a.poc_expiration_date ? new Date(a.poc_expiration_date) : null;
    const db = b.poc_expiration_date ? new Date(b.poc_expiration_date) : null;
    if (risk === 'recert_due' || risk === 'created') {
      if (da && db) return da - db;
      if (da) return -1; if (db) return 1;
    }
    if (risk === 'non_compliant' || risk === 'expired') {
      if (da && db) return da - db;
      if (da) return -1; if (db) return 1;
    }
    if (risk === 'certified') {
      if (da && db) return db - da;
      if (da) return -1; if (db) return 1;
    }
    return a.name.localeCompare(b.name);
  });
  const list = document.getElementById('_mrxlist');
  if (!rows.length) { list.innerHTML = '<div class="_mempty">No patients match</div>'; return; }
  const ec = p => { if (p.dl === null) return ''; if (p.dl <= 0) return 'color:#C13535'; if (p.dl <= 14) return 'color:#B85A00'; return ''; };
  const insCol = p => { const col = INS_COLORS[p.ins_type] || INS_COLORS.unknown; return `background:${col.bg};color:${col.c};border:1px solid ${col.bd}`; };
  list.innerHTML = rows.map(p => {
    const bdCls = p.risk === 'non_compliant' ? 'b_noncompliant' : (BDC[p.risk] || 'b_gray');
    const insLabel = INS_LABELS[p.ins_type] || p.insurance || '—';
    const isMedicare = p.ins_type === 'medicare' || p.ins_type === 'medicare_adv';
    const hasLog = (p.log_count || 0) > 0;
    return `<div class="_mrow${p.patient_id === window._mrxDid ? ' sel' : ''}" onclick="_mrxDet(${p.patient_id})">
      <div class="rb ${RBC[p.risk] || 'rb_yellow'}"></div>
      <div class="_mrb">
        <div class="_mrn">${p.name}</div>
        <div class="_mrs" style="${ec(p)}">${p.label} · ${_mrxFmt(p.poc_expiration_date)}</div>
        <div style="display:flex;gap:3px;margin-top:3px;flex-wrap:wrap;align-items:center">
          <span class="_mbg ${bdCls}">${p.label}</span>
          <span class="_mbg" style="${insCol(p)}">${insLabel}</span>
          ${isMedicare ? '<span class="_mbg b_blue">Medicare</span>' : ''}
          ${p.needs_scheduling ? '<span class="_mbg" style="background:#FFF7ED;color:#C2410C;border:2px solid #F97316;font-weight:700;animation:_mrx_pulse 2s infinite">📅 SCHEDULE NOW</span>' : ''}
          ${p.at_risk ? '<span class="_mbg" style="background:#FEF2F2;color:#7F1D1D;border:1px solid #FECACA;font-weight:700">⚠ At Risk</span>' : ''}
          ${!p.needs_scheduling && p.activity_status === 'unscheduled' ? '<span class="_mbg" style="background:#E0F2FE;color:#0369A1;border:1px solid #BAE6FD">Unscheduled</span>' : ''}
          ${!p.needs_scheduling && p.has_future_appt === false && p.activity_status === 'inactive' ? '<span class="_mbg" style="background:#F3E8FF;color:#6B21A8;border:1px solid #D8B4FE">No future appt</span>' : ''}
          ${p.fot_pending ? '<span class="_mbg" style="background:#FEF9EC;color:#7A5200;border:1px solid #F0DFA0">FOT pending</span>' : ''}
          ${p.rx_missing ? '<span class="_mbg" style="background:#FEF2F2;color:#C13535;border:1px solid #FECACA">No RX</span>' : ''}
          ${p.sched_priority === 1 && !p.needs_scheduling ? '<span class="_mbg" style="background:#FEF2F2;color:#C13535;border:1px solid #FECACA;font-weight:600">No appts</span>' : ''}
          ${p.sched_priority === 2 && !p.needs_scheduling ? '<span class="_mbg" style="background:#FFF7ED;color:#C2410C;border:1px solid #FED7AA">1 appt left</span>' : ''}
          ${p.fax_count > 0 ? `<span class="_mbg b_purple">${p.fax_count} fax</span>` : ''}
          ${hasLog ? `<span class="_mbg b_gray">${p.log_count} log</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  if (window._mrxDid) _mrxDet(window._mrxDid, true);
};

// ── DETAIL PANEL ──────────────────────────────────────────────────────────────
window._mrxDet = async function(id, silent) {
  window._mrxDid = id;
  const p = window._mrxData.find(x => x.patient_id === id);
  if (!p) return;
  const det = document.getElementById('_mrxdet');
  det.classList.add('open');

  const ec = p.dl !== null && p.dl <= 14 ? (p.dl <= 0 ? 'red' : 'orange') : '';
  const isMedicare = p.ins_type === 'medicare' || p.ins_type === 'medicare_adv';
  const certWindow = getMedicareCertWindow(p.ins_type);
  const insCol = INS_COLORS[p.ins_type] || INS_COLORS.unknown;

  const faxHtml = p.fax_records && p.fax_records.length
    ? p.fax_records.slice(0,3).map(f => `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid #EFEDE8;font-size:11px"><div style="width:7px;height:7px;border-radius:50%;background:${f.is_poc_certified?'#1A6B3A':'#B85A00'};flex-shrink:0;margin-top:3px"></div><div><div style="font-weight:600">${_mrxFmt(f.received_date)} · ${f.is_poc_certified?'<span style="color:#1A6B3A">Certified ✓</span>':'Unsigned'}</div>${f.referring_physician?`<div style="color:#6B6760">${f.referring_physician}</div>`:''}</div></div>`).join('')
    : '<div style="color:#9E9A94;font-size:11px;padding:4px 0">No fax records</div>';

  const medicareBanner = isMedicare ? `<div class="_mrule">📋 <strong>Medicare rules apply</strong> · ${certWindow}-day cert window · Rx required</div>` : '';
  const ncBanner = p.risk === 'non_compliant' ? `<div class="_mnc-banner">⚠ NON-COMPLIANT — Patient attending with expired POC. Immediate action required.</div>` : '';
  const nsBanner = p.needs_scheduling ? `<div style="background:#FFF7ED;border:2px solid #F97316;border-radius:6px;padding:8px 12px;font-size:12px;color:#C2410C;font-weight:600;margin:8px 12px;display:flex;align-items:center;gap:6px">📅 SCHEDULE BEFORE PATIENT LEAVES — No future appointment booked</div>` : '';
  const atRiskBanner = p.at_risk ? `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:6px 12px;font-size:11px;color:#7F1D1D;font-weight:600;margin:4px 12px;display:flex;align-items:center;gap:5px">⚠ COMPLIANCE RISK — Has upcoming appointment with expired/invalid POC</div>` : '';
  const fotBanner = p.fot_pending ? `<div style="background:#FEF9EC;border:1px solid #F0DFA0;border-radius:6px;padding:6px 12px;font-size:11px;color:#7A5200;font-weight:600;margin:4px 12px">📋 FOT PENDING — ${p.fot_name || 'Outcome measure'} not completed</div>` : '';
  const rxBanner = p.rx_missing ? `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:6px 12px;font-size:11px;color:#C13535;font-weight:600;margin:4px 12px">💊 NO RX ON FILE — Medicare patient missing physician script</div>` : '';

  // Show skeleton while loading logs
  det.innerHTML = `
    <div class="_mdh">
      <div style="flex:1;min-width:0">
        <div class="_mdn">${p.name}</div>
        <div style="display:flex;gap:3px;margin-top:4px;flex-wrap:wrap">
          <span class="_mbg ${p.risk==='non_compliant'?'b_noncompliant':(BDC[p.risk]||'b_gray')}">${p.label}</span>
          <span class="_mbg" style="background:${insCol.bg};color:${insCol.c};border:1px solid ${insCol.bd}">${INS_LABELS[p.ins_type]||p.insurance||'—'}</span>
          ${isMedicare?'<span class="_mbg b_blue">Medicare rules</span>':''}
          ${p.fax_count>0?`<span class="_mbg b_purple">${p.fax_count} fax${p.fax_count!==1?'es':''}</span>`:''}
        </div>
      </div>
      <button class="_mc" onclick="_mrxCloseDet()">✕</button>
    </div>
    ${nsBanner}${ncBanner}${atRiskBanner}${fotBanner}${rxBanner}${medicareBanner}
    <div class="_mdc2">
      <div class="_mdcol">
        <div class="_mdct">POC</div>
        <div class="_mdr"><span class="_mdk">Status</span><span class="_mdv ${p.risk==='certified'?'green':p.risk==='non_compliant'||p.risk==='expired'?'red':'orange'}">${p.poc_status||'None'}</span></div>
        <div class="_mdr"><span class="_mdk">Start</span><span class="_mdv">${_mrxFmt(p.poc_created_at)}</span></div>
        <div class="_mdr"><span class="_mdk">Expires</span><span class="_mdv ${ec}">${_mrxFmt(p.poc_expiration_date)}</span></div>
        <div class="_mdr"><span class="_mdk">Duration</span><span class="_mdv">${p.treatment_weeks?p.treatment_weeks+'w':'—'}</span></div>
        <div class="_mdr"><span class="_mdk">Freq</span><span class="_mdv">${FREQ[p.visit_frequency]||'—'}</span></div>
        <div class="_mdr"><span class="_mdk">Cert periods</span><span class="_mdv">${p.poc_count||'—'}</span></div>
        ${isMedicare?`<div class="_mdr"><span class="_mdk">Cert window</span><span class="_mdv blue">${certWindow}d (Medicare)</span></div>`:''}
      </div>
      <div class="_mdcol">
        <div class="_mdct">Patient</div>
        <div class="_mdr"><span class="_mdk">Mobile</span><span class="_mdv">${p.mobile||'—'}</span></div>
        <div class="_mdr"><span class="_mdk">Insurance</span><span class="_mdv" style="font-size:10px">${p.insurance||'—'}</span></div>
        <div class="_mdr"><span class="_mdk">Provider</span><span class="_mdv" style="font-size:10px">${p.referring||'—'}</span></div>
        <div class="_mdr"><span class="_mdk">Last appt</span><span class="_mdv">${_mrxFmt(p.last_appt)}${p.days_since_appt !== null ? ' (' + p.days_since_appt + 'd ago)' : ''}</span></div>
        <div class="_mdr"><span class="_mdk">Future appts</span><span class="_mdv" style="color:${p.sched_priority===1?'#C13535':p.sched_priority===2?'#C2410C':'#1A6B3A'}">${p.sched_priority===1?'None scheduled':p.sched_priority===2?'1 appt left':'Scheduled'}</span></div>
        <div class="_mdr"><span class="_mdk">Today</span><span class="_mdv" style="color:${p.has_today_appt ? '#1A6B3A' : '#9E9A94'}">${p.has_today_appt ? 'In clinic today' : 'No appt today'}</span></div>
        <div class="_mdr"><span class="_mdk">Cert fax</span><span class="_mdv ${p.latest_fax_certified?'green':'orange'}">${p.latest_fax_certified?'Yes ✓':'Not yet'}</span></div>
        <div class="_mdr"><span class="_mdk">RX on file</span><span class="_mdv" style="color:${p.rx_missing?'#C13535':p.rx_pending===false?'#1A6B3A':'#9E9A94'}">${p.rx_missing?'Missing ✗':p.ins_type==='medicare'||p.ins_type==='medicare_adv'?'On file ✓':'N/A'}</span></div>
        <div class="_mdr"><span class="_mdk">FOT</span><span class="_mdv" style="color:${p.fot_pending?'#7A5200':'#9E9A94'}">${p.fot_pending?'Pending — '+( p.fot_name||'outcome measure'):'Complete'}</span></div>
        <div style="margin-top:8px"><div class="_mdct" style="margin-bottom:4px">Fax history</div>${faxHtml}</div>
      </div>
    </div>
    <div class="_mcl">
      <div class="_mclt">Contact log <span id="_mrxlsync" class="_msync">Loading from Sheet…</span></div>
      <div id="_mrxlogs"><div class="_mnolog">Loading…</div></div>
      <div class="_mform" style="margin-top:8px">
        <div class="_mfrow">
          <select id="_mrxoc"><option value="">Select outcome…</option><optgroup label="Contact"><option value="left_vm">Left voicemail</option><option value="no_answer">No answer</option><option value="spoke_signing">Spoke — signing soon</option><option value="wrong_number">Wrong number</option></optgroup><optgroup label="POC / Fax"><option value="fax_sent">Fax re-sent</option><option value="fax_received">Fax received ✓</option><option value="certified">Signed — received ✓</option></optgroup><optgroup label="RX / Script"><option value="rx_on_file">RX on file ✓</option><option value="rx_not_on_file">RX not on file</option></optgroup><optgroup label="Scheduling"><option value="scheduled">Appointment scheduled</option></optgroup><optgroup label="Other"><option value="other">Other</option></optgroup></select>
          <input type="text" id="_mrxuser" placeholder="Initials (e.g. DE)">
        </div>
        <textarea id="_mrxnote" placeholder="Notes (optional)…"></textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="_msave" onclick="_mrxAddLog(${p.patient_id})">Save contact attempt</button>
          <button class="_mflag" onclick="_mrxOpenFlag(${p.patient_id})">⚑ Flag inaccuracy</button>
        </div>
      </div>
      <div id="_mrxflagform" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid #EFEDE8">
        <div class="_mdct" style="color:#B85A00;margin-bottom:6px">⚑ Report inaccuracy</div>
        <div class="_mform">
          <input type="text" id="_mrxflagwhat" placeholder="What does tracker show? (e.g. Certified)">
          <input type="text" id="_mrxflagreal" placeholder="What is it actually? (e.g. Expired)">
          <input type="text" id="_mrxflagby" placeholder="Your initials">
          <button class="_mflag" onclick="_mrxSubmitFlag(${p.patient_id}, '${p.name.replace(/'/g,"\\'")}')">Submit flag</button>
        </div>
      </div>
    </div>`;

  // Load logs from Sheet asynchronously
  const logs = await sheetGetLogs(id);
  p.log_count = logs.length;
  const syncEl = document.getElementById('_mrxlsync');
  const logsEl = document.getElementById('_mrxlogs');
  if (syncEl) syncEl.textContent = logs.length > 0 ? `(${logs.length}) · synced` : '· synced';
  if (logsEl) {
    logsEl.innerHTML = logs.length
      ? logs.map(l => {
          const col = OCC[l.outcome] || { bg: '#EFEDE8', c: '#6B6760' };
          return `<div class="_mcle"><div class="_mcled"></div><div style="flex:1">
            <div><span class="_mct" style="background:${col.bg};color:${col.c}">${OUTCOMES[l.outcome]||l.outcome}</span></div>
            ${l.note ? `<div style="font-size:11px;margin-top:2px">${l.note}</div>` : ''}
            <div class="_mclt2">${l.date}${l.initials?' · '+l.initials:''}</div>
          </div></div>`;
        }).join('')
      : '<div class="_mnolog">No contact attempts yet</div>';
  }

  if (!silent) _mrxRender();
};

window._mrxCloseDet = () => { window._mrxDid = null; document.getElementById('_mrxdet').classList.remove('open'); _mrxRender(); };

window._mrxOpenFlag = (pid) => {
  const el = document.getElementById('_mrxflagform');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

window._mrxSubmitFlag = async (pid, name) => {
  const what = document.getElementById('_mrxflagwhat')?.value?.trim();
  const real = document.getElementById('_mrxflagreal')?.value?.trim();
  const by = document.getElementById('_mrxflagby')?.value?.trim();
  if (!what || !real) { alert('Please fill in both fields'); return; }
  await sheetSaveFlag({
    patient_id: pid,
    patient_name: name,
    date: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
    tracker_shows: what,
    actual_value: real,
    flagged_by: by,
  });
  document.getElementById('_mrxflagform').style.display = 'none';
  alert('Flag submitted to Google Sheet. Thank you!');
};

window._mrxAddLog = async function(pid) {
  const outcome = document.getElementById('_mrxoc')?.value;
  const note = document.getElementById('_mrxnote')?.value?.trim();
  const user = document.getElementById('_mrxuser')?.value?.trim();
  if (!outcome) { alert('Please select an outcome'); return; }
  const p = window._mrxData.find(x => x.patient_id === pid);
  const entry = {
    patient_id: pid,
    patient_name: p?.name || '',
    date: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
    outcome, note: note || '', initials: user || '',
  };
  // Save to Sheet
  await sheetSaveLog(entry);
  if (outcome === 'certified' && p) { p.poc_status = 'CERTIFIED'; Object.assign(p, _mrxAssess(p)); }
  _mrxDet(pid, true);
  _mrxRender();
};

// ── DATA LOADING ──────────────────────────────────────────────────────────────
window._mrxLoad = async function() {
  const refBtn = document.getElementById('_mrxref');
  if (refBtn) refBtn.disabled = true;
  const setStatus = (msg) => { const el = document.getElementById('_mrxlist'); if (el) el.innerHTML = '<div class="_mload">'+msg+'</div>'; };
  setStatus('Pulling patients from Spry…');

  const td = JSON.parse(localStorage.getItem('Spry/token'));
  const h = { 'Authorization': `${td.token_type} ${td.access_token}`, 'X-Device-ID': td['X-Device-ID'] || '63dd6ace-7308-48eb-a23d-38d23ca303b1' };

  try {
    // ── STEP 1: Patients (1-indexed, param=page) ──────────────────────────────
    const patients = [];
    let totalPages = null;
    for (let pg = 1; pg <= 200; pg++) {
      const r = await fetch(`/apis/soap-enrichment/patient/v3/search?clinic_id=${CLINIC}&page=${pg}&pageSize=10&status=ACTIVE`, { headers: h });
      const j = await r.json();
      const batch = j?.data?.content || [];
      patients.push(...batch);
      if (totalPages === null) totalPages = j?.data?.pages ?? null;
      setStatus(`Loading patients: ${patients.length}${totalPages ? ' of ' + (totalPages * 10) : ''}…`);
      if (totalPages !== null && pg >= totalPages) break;
      if (batch.length === 0) break;
    }

    // ── STEP 2: POC data ──────────────────────────────────────────────────────
    setStatus(`Loading POC data 0/${patients.length}…`);
    const pocMap = {};
    for (let i = 0; i < patients.length; i += 10) {
      const batch = patients.slice(i, i + 10);
      const res = await Promise.all(batch.map(async p => {
        try {
          const r = await fetch(`/apis/soap-enrichment/planOfCare/list/${p.patient_id}`, { headers: h });
          const j = await r.json();
          const list2 = j?.data || [];
          // API returns POCs oldest-first — always use the most recent one
          const lat = list2[list2.length - 1] || null;
          const insurance = p.additional_details?.insurance_payer || '';
          const insType = classifyInsurance(insurance);
          return {
            patient_id: p.patient_id, name: p.name, first_name: p.first_name, last_name: p.last_name,
            mobile: p.mobile, referring: p.additional_details?.referring_physician_name || '',
            insurance, ins_type: insType, last_appt: p.additional_details?.last_appointment_date,
            poc_status: lat?.poc_status || null, poc_created_at: lat?.poc_created_at || null,
            poc_expiration_date: lat?.poc_expiration_date || null,
            treatment_weeks: lat?.treatment_duration_in_weeks || null,
            visit_frequency: lat?.visit_frequency || null, case_title: lat?.case_title || null,
            signed_doc: !!lat?.signed_poc_document_url, poc_count: list2.length, log_count: 0,
          };
        } catch { return { patient_id: p.patient_id, name: p.name, poc_status: null, poc_count: 0, ins_type: 'unknown', insurance: '', log_count: 0 }; }
      }));
      res.forEach(r => { if (!pocMap[r.patient_id]) pocMap[r.patient_id] = r; });
      setStatus(`POC data: ${Object.keys(pocMap).length}/${patients.length}`);
    }
    const pocData = Object.values(pocMap);

    // ── STEP 3: Appointments skipped — API returns empty body ────────────────
    // Future/today appointment sets are not used; scheduling derived from:
    // - one_appt_left: from ONE_SCHEDULED_APPOINTMENT_LEFT_REPORT (reliable)
    // - last_appt date: from patient API (reliable)
    const todayApptPids = new Set();  // unused but kept for compatibility
    const futureApptPids = new Set(); // unused but kept for compatibility

    // ── STEP 4: Faxes ─────────────────────────────────────────────────────────
    setStatus('Loading fax records…');
    const allFaxes = [];
    for (let pg = 0; pg < 5; pg++) {
      const r = await fetch(`/apis/faxes/v1/fax?clinic_id=${CLINIC}&direction=INBOUND&size=100&page=${pg}`, { headers: h });
      const j = await r.json();
      const batch = j?.faxes || [];
      allFaxes.push(...batch);
      if (batch.length < 100) break;
    }

    // ── STEP 5: Fax maps ──────────────────────────────────────────────────────
    const faxById = {}, faxByName = {};
    allFaxes.forEach(f => {
      (f.documents || []).forEach(d => {
        const cats = d.analysis?.categories || [];
        const isPoc = d.document_type === 'PLAN_OF_CARE' || cats.some(c => c.document_category === 'PLAN_OF_CARE');
        if (!isPoc) return;
        const ex = cats[0]?.extracted_data || {};
        const rec = { fax_id: f.id, received_date: f.received_time || f.created_date, is_poc_certified: ex.is_poc_certified || false, referring_physician: ex.referring_physician || null, patient_name_in_fax: ex.patient_name || d.analysis?.patients?.[0]?.patient_name || null };
        (d.analysis?.patients || []).forEach(pt => { if (pt.patient_id) { const k = String(pt.patient_id); if (!faxById[k]) faxById[k] = []; faxById[k].push(rec); } });
        if (rec.patient_name_in_fax) { const nk = rec.patient_name_in_fax.toLowerCase().replace(/\s+/g,' ').trim(); if (!faxByName[nk]) faxByName[nk]=[]; faxByName[nk].push(rec); }
      });
    });

    // ── STEP 5.6: Enhancement reports via direct API calls ──────────────────
    // Uses exact request format captured from Spry — no scraping, no iframes
    setStatus('Loading compliance reports…');
    const fotPids = new Set();
    const fotDetails = {};
    const scriptPids = new Set();
    const oneApptPids = new Set();
    try {
      // Build time window: today from 7am to tomorrow 7am (matches Spry's format)
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const tomorrowStr = new Date(now.getTime() + 864e5).toISOString().split('T')[0];
      const fromStr = todayStr + 'T07:00:00';
      const toStr = tomorrowStr + 'T06:59:59';
      const baseParams = { period: '0_days_day', from: fromStr, to: toStr, clinic_ids: [CLINIC], organisation_id: 229, size: 1000000 };

      const callReport = async (kpi, extraParams) => {
        const body = JSON.stringify({ kpi, params: { ...baseParams, ...extraParams, kpi } });
        const r = await fetch('/apis/analytics/emr/report', {
          method: 'POST',
          headers: { ...h, 'Content-Type': 'application/json' },
          body
        });
        if (!r.ok) return [];
        const j = await r.json();
        // Response: {data: {series: [[keyArr, valueArr], ...]}}
        return (j?.data?.series || []).map(s => s[1] || []);
      };

      const [fotSeries, scriptSeries, oneApptSeries] = await Promise.all([
        callReport('PND_FOT', { fot_from_day: 30 }),
        callReport('PND_SCRIPT', { poc_expires_in: 10 }),
        callReport('ONE_SCHEDULED_APPOINTMENT_LEFT_REPORT', {}),
      ]);

      // FOT: valueArr = [patientId, fullName, firstName, lastName, fotName, sentDate, status]
      fotSeries.forEach(v => {
        if (v[0]) { fotPids.add(String(v[0])); fotDetails[String(v[0])] = v[4] || 'Outcome measure'; }
      });
      // SCRIPT: valueArr = [patientId, fullName, firstName, lastName, caseTitle, pocStart, pocEnd, pocStatus]
      scriptSeries.forEach(v => { if (v[0]) scriptPids.add(String(v[0])); });
      // ONE_APPT: valueArr = [patientId, fullName, firstName, lastName, insurance, mobile, apptDate]
      oneApptSeries.forEach(v => { if (v[0]) oneApptPids.add(String(v[0])); });

      setStatus(`Reports loaded: FOT=${fotPids.size} Script=${scriptPids.size} 1-Appt=${oneApptPids.size}…`);
    } catch(e) { console.warn('[POC Tracker] Report API failed:', e.message); }

    // ── STEP 6: Merge + assess ────────────────────────────────────────────────
    window._mrxData = pocData.map(p => {
      const pid = String(p.patient_id);
      const nk = p.name.toLowerCase().replace(/\s+/g,' ').trim();
      const lf = ((p.last_name||'')+' '+(p.first_name||'')).toLowerCase().trim();
      let faxRecs = faxById[pid] || faxByName[nk] || faxByName[lf] || [];
      faxRecs = [...faxRecs].sort((a,b) => new Date(b.received_date)-new Date(a.received_date));
      const lat = faxRecs[0] || null;
      const pid2 = String(p.patient_id);
      const daysSinceAppt = p.last_appt ? Math.round((new Date() - new Date(p.last_appt)) / 864e5) : null;
      const assessed = _mrxAssess(p);
      const logs = window._mrxLogCache?.[pid2] || [];
      const fot_pending = fotPids.has(pid2);
      const fot_name = fotDetails[pid2] || null;
      const rx_pending = scriptPids.has(pid2);
      const isMedPat = p.ins_type === 'medicare' || p.ins_type === 'medicare_adv';
      const rx_missing = isMedPat && rx_pending;
      const one_appt_left = oneApptPids.has(pid2);

      // Derive activity from last_appt date (appointments API returns empty body)
      // unscheduled = seen in last 60 days but not in one_appt_left report (likely no future appt)
      // inactive = not seen in 60+ days
      // scheduled = in one_appt_left report OR seen recently (assume scheduled)
      const activity = one_appt_left ? 'one_left'
        : daysSinceAppt === null ? 'unknown'
        : daysSinceAppt <= 60 ? 'recent'
        : 'inactive';

      // has_future_appt: true if in one_appt_left (definitely has at least 1), unknown otherwise
      const has_future_appt = one_appt_left ? true : null;

      // at_risk = has appointment (seen recently) + expired/non-compliant POC
      const at_risk = daysSinceAppt !== null && daysSinceAppt <= 30 &&
        (assessed.risk === 'non_compliant' || assessed.risk === 'expired');

      // no_future_appt = not seen in 60+ days AND not in one_appt_left report
      const no_future_appt = !one_appt_left && daysSinceAppt !== null && daysSinceAppt > 60;

      // unscheduled = seen in last 60 days but not in one_appt_left (may have 0 or 2+ appts)
      const unscheduled = !one_appt_left && daysSinceAppt !== null && daysSinceAppt <= 60;

      // Priority 1 = inactive (60+ days, likely no appts), Priority 2 = 1 appt left, Priority 3 = recent
      const sched_priority = no_future_appt ? 1 : one_appt_left ? 2 : 3;

      return { ...p, ...Object.assign({}, assessed), fax_count: faxRecs.length, latest_fax_certified: lat?.is_poc_certified||false, fax_records: faxRecs.slice(0,5), has_future_appt, has_today_appt: null, needs_scheduling: one_appt_left, days_since_appt: daysSinceAppt, activity_status: unscheduled ? 'unscheduled' : no_future_appt ? 'inactive' : one_appt_left ? 'scheduled' : 'recent', at_risk, log_count: logs.length, fot_pending, fot_name, rx_pending, rx_missing, one_appt_left, sched_priority, no_future_appt };
    });

    const ts = document.getElementById('_mrxts');
    if (ts) ts.textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    _mrxRender();

  } catch (e) {
    setStatus(`<span style='color:#C13535'>Error: ${e.message}</span>`);
  }
  if (refBtn) refBtn.disabled = false;
};

console.log('[POC Tracker v13] Fixed: no appt API, derive activity from last_appt, fix encoding');
})();
