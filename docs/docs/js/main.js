
// main.js — bootstraps app
import { State, saveState, loadState, setTechData, initDiscovered } from './state.js';
import { render, buildChrome } from './ui.js';
import { ensureClient, joinCampaign, hostCampaign } from './supa.js';

// Load data json
async function loadData(){
  const [g,p] = await Promise.all([fetch('data/group.json').then(r=>r.json()), fetch('data/personal.json').then(r=>r.json())]);
  setTechData(g,p);
  initDiscovered();
}

async function tryDeepLinkOrAuto(){
  const qs = new URLSearchParams(location.search);
  const cid = qs.get('campaign'); const code = qs.get('code');
  if(cid && code){
    try{ await joinCampaign(cid, '', code); return true; }catch(e){ console.warn('Deep link failed', e); }
  }
  try{
    const raw = localStorage.getItem('korrath_auth');
    if(raw){ const a=JSON.parse(raw); if(a?.campaignId && a?.playerCode){ await joinCampaign(a.campaignId, '', a.playerCode); return true; } }
  }catch(_){}
  return false;
}

function showLanding(){
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal"><div class="card">
    <h2>Join or Host Campaign</h2>
    <div class="row">
      <div class="row">
        <button class="btn" id="hostBtn">Host (GM)</button>
        <button class="btn" id="joinBtn">Join (Player)</button>
      </div>
    </div>
    <div id="hostForm" style="display:none">
      <div class="row"><input class="input" id="campaignName" placeholder="Campaign Name (e.g., Korath)"/></div>
      <div class="row"><input class="input" id="gmPin" placeholder="Set GM PIN"/></div>
      <button class="btn primary" id="createCampaign">Create Campaign</button>
    </div>
    <div id="joinForm" style="display:none">
      <div class="row"><input class="input" id="campaignId" placeholder="Campaign ID (UUID)"/></div>
      <div class="row"><input class="input" id="playerName" placeholder="Player Name (optional if you have a code)"/></div>
      <div class="row"><input class="input" id="playerCode" placeholder="Player Code"/></div>
      <button class="btn primary" id="joinCampaign">Join</button>
    </div>
    <div class="small muted" id="landingMsg"></div>
  </div></div>`;
  const msg = (t)=> document.getElementById('landingMsg').textContent=t;

  document.getElementById('hostBtn').onclick = ()=>{ document.getElementById('hostForm').style.display='block'; document.getElementById('joinForm').style.display='none'; };
  document.getElementById('joinBtn').onclick = ()=>{ document.getElementById('joinForm').style.display='block'; document.getElementById('hostForm').style.display='none'; };

  document.getElementById('createCampaign').onclick = async ()=>{
    try{
      const name = document.getElementById('campaignName')?.value.trim()||'Korath';
      const pin  = document.getElementById('gmPin')?.value.trim()||'';
      const id = await hostCampaign(name, pin);
      msg('Campaign created: '+id);
      document.getElementById('modal-root').innerHTML='';
      render();
    }catch(err){ msg('Error: '+(err?.message||err)); }
  };

  document.getElementById('joinCampaign').onclick = async ()=>{
    try{
      const cid = document.getElementById('campaignId')?.value.trim();
      const nm  = document.getElementById('playerName')?.value.trim();
      const code= document.getElementById('playerCode')?.value.trim();
      if(!cid || (!nm && !code)){ msg('Need Campaign ID and either Player Code (to login) or Name (to create).'); return; }
      const info = await joinCampaign(cid, nm, code);
      alert('Your player code: '+info.code+'\n\nBookmark your Player Link in the sidebar (My Access).');
      document.getElementById('modal-root').innerHTML='';
      render();
    }catch(err){ msg('Error: '+(err?.message||err)); }
  };
}

(async function boot(){
  // Supabase client is created lazily by modules when needed
  loadState();
  await loadData();
  buildChrome();
  const logged = await tryDeepLinkOrAuto();
  if(!logged){ showLanding(); }
  render();
})();
