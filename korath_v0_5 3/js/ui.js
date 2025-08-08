// ui.js — renders header/aside/tree + wires events
import { State, WORLD_FLAGS, GROUP_TECH, PERSONAL_TECH, activePlayer, saveState, groupByTier, countUnlockedByTier, tierGateOk, tierClass, flagsOk, canUnlockGroup, canUnlockPersonal } from './state.js';
import { upsertPlayerRemote, upsertGroupRemote, gmResetPlayerCode } from './supa.js';

const elHeader = document.getElementById('app-header');
const elAside  = document.getElementById('app-aside');
const elMain   = document.getElementById('app-main');
const elTree   = document.getElementById('tree');
const elLinks  = document.getElementById('link-layer');
const modalRoot= document.getElementById('modal-root');

function h(html){ const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstElementChild; }

export function buildChrome(){
  elHeader.innerHTML = `
    <div>
      <h1>Resonants: Korath Tech Tree</h1>
      <div class="sub">Realtime sync • Player login • GM PIN • Tier evolution</div>
    </div>
    <div class="row">
      <div class="tabs">
        <div class="tab ${State.mode==='group'?'active':''}" id="tab_group">Group Tree</div>
        <div class="tab ${State.mode!=='group'?'active':''}" id="tab_player">Player Tree</div>
      </div>
      <div class="knum" id="contextName">—</div>
      <div class="knum" id="points">0 pts</div>
      <button class="btn" id="addPoint">+1 pt</button>
      <button class="btn" id="subPoint">-1 pt</button>
      <button class="btn warn" id="resetContext">Reset</button>
    </div>`;

  elAside.innerHTML = `
    <div class="panel">
      <div class="row space">
        <div>
          <div class="muted small">GM Controls</div>
          <label class="row small"><input type="checkbox" id="gmMode"/> GM Mode (PIN)</label>
        </div>
        <button class="btn" id="resetAll">Reset All</button>
      </div>
      <div class="small muted" style="margin-top:6px">GM Mode requires the PIN.</div>
    </div>

    <div class="panel" id="campaignPanel">
      <div class="muted small">Campaign</div>
      <div class="row" style="margin-top:6px">
        <div id="campaignIdDisplay" class="small code" style="word-break:break-all"></div>
        <button class="btn" id="copyCampaignId">Copy ID</button>
      </div>
      <div class="small muted" id="campaignHint"></div>
    </div>

    <div class="panel" id="accessPanel">
      <div class="muted small">My Access</div>
      <div class="row" style="margin-top:6px">
        <div id="playerCodeDisplay" class="small code" style="word-break:break-all"></div>
        <button class="btn" id="copyPlayerLink">Copy Player Link</button>
      </div>
      <div class="small muted">Bookmark this link for 1-click login.</div>
    </div>

    <div class="panel" id="playersPanel">
      <div class="row space">
        <div><div class="muted small">Players</div></div>
      </div>
      <div id="players" class="plist"></div>
    </div>

    <div class="panel">
      <div class="muted small">World Flags (requirements)</div>
      <div id="flags"></div>
    </div>
  `;

  wireHeader();
  wireAside();
}

function wireHeader(){
  const elPoints = document.getElementById('points');
  const elActiveName = document.getElementById('contextName');

  document.getElementById('tab_group').onclick = ()=>{ State.mode='group'; render(); };
  document.getElementById('tab_player').onclick= ()=>{ State.mode='player'; render(); };

  document.getElementById('addPoint').onclick = ()=>{
    if(State.mode==='group'){ State.group.points++; upsertGroupRemote(); }
    else { const p=activePlayer(); if(!p) return; p.points++; upsertPlayerRemote(p); }
    render();
  };
  document.getElementById('subPoint').onclick = ()=>{
    if(State.mode==='group'){ State.group.points=Math.max(0, State.group.points-1); upsertGroupRemote(); }
    else { const p=activePlayer(); if(!p) return; p.points=Math.max(0,p.points-1); upsertPlayerRemote(p); }
    render();
  };
  document.getElementById('resetContext').onclick = ()=>{
    if(State.mode==='group'){ State.group.points=0; State.group.unlocked=[]; State.group.counts={}; upsertGroupRemote(); }
    else { const p=activePlayer(); if(!p) return; p.points=0; p.unlocked=[]; upsertPlayerRemote(p); }
    render();
  };

  function updateHeader(){
    const isGroup = State.mode==='group';
    elActiveName.textContent = State.campaignId? (isGroup? 'Group' : (activePlayer()?.name||'—')) : '—';
    elPoints.textContent = (isGroup? State.group.points : (activePlayer()?.points||0)) + ' pts';
    document.getElementById('tab_group').classList.toggle('active', isGroup);
    document.getElementById('tab_player').classList.toggle('active', !isGroup);
  }
  updateHeader();
}

function wireAside(){
  const elGM = document.getElementById('gmMode');
  const elPlayers = document.getElementById('players');
  const elFlags = document.getElementById('flags');

  elGM.onchange = async (e)=>{
    if(e.target.checked){
      const pin = prompt('Enter GM PIN');
      if(!pin){ e.target.checked=false; return; }
      const { sha256 } = await import('./supa.js');
      const hash = await sha256(pin);
      State.gm = true; State.gmHash = hash; saveState();
    }else{
      State.gm = false; saveState();
    }
    render();
  };

  document.getElementById('resetAll').onclick = ()=>{
    State.group.points=0; State.group.unlocked=[]; State.group.counts={}; saveState();
    import('./supa.js').then(m=>m.upsertGroupRemote());
    render();
  };

  document.getElementById('copyCampaignId').onclick = ()=>{
    if(State.campaignId){ navigator.clipboard.writeText(State.campaignId); alert('Campaign ID copied'); }
  };
  document.getElementById('copyPlayerLink').onclick = ()=>{
    const p=activePlayer(); if(!p?.code || !State.campaignId){ alert('Join a campaign first.'); return; }
    const link = location.origin + location.pathname + '?campaign=' + encodeURIComponent(State.campaignId) + '&code=' + encodeURIComponent(p.code);
    navigator.clipboard.writeText(link); alert('Player link copied');
  };

  function drawPlayers(){
    elPlayers.innerHTML='';
    const list = State.gm ? State.players.order : (activePlayer()? [activePlayer().id] : []);
    list.forEach(pid=>{
      const pl = State.players.byId[pid]; if(!pl) return;
      const row = h(`<div class="pitem row space"><div><div class="pname">${pl.name}</div><div class="small muted">${pl.points} pts • ${pl.unlocked.length} unlocked</div></div></div>`);
      const controls = h(`<div class="row"></div>`);
      const useBtn = h(`<button class="btn">Use</button>`);
      useBtn.onclick = ()=>{ State.activePlayerId=pid; saveState(); render(); };
      controls.appendChild(useBtn);
      if(State.gm){
        const linkBtn = h(`<button class="btn primary" title="Generate a new code and copy player link">New Link</button>`);
        linkBtn.onclick = ()=> import('./supa.js').then(m=>m.gmResetPlayerCode(pid));
        controls.appendChild(linkBtn);
      }
      row.appendChild(controls);
      elPlayers.appendChild(row);
    });
  }

  function drawFlags(){
    elFlags.innerHTML='';
    WORLD_FLAGS.forEach(f=>{
      const row=h(`<div class="row small muted"><input type="checkbox"><span>${f.name}</span></div>`);
      const ck=row.querySelector('input'); ck.checked=!!State.world.flags[f.id]; ck.disabled=!State.gm;
      ck.onchange=()=>{ State.world.flags[f.id]=ck.checked; saveState(); import('./supa.js').then(m=>m.upsertGroupRemote()); };
      elFlags.appendChild(row);
    });
  }

  drawPlayers(); drawFlags();
}

export function render(){
  buildChrome();
  const isGroup = State.mode==='group';
  const data = isGroup? GROUP_TECH : PERSONAL_TECH;
  const discovered = new Set(isGroup? State.group.discovered : State.personalDiscovered);

  // Players panel refresh
  // (wireAside handles initial draw; here we could add refresh if needed)

  elTree.innerHTML='';
  const tiers = groupByTier(data);
  const byTierCounts = isGroup ? countUnlockedByTier(State.group.unlocked, GROUP_TECH)
                               : countUnlockedByTier(activePlayer()?.unlocked||[], PERSONAL_TECH);
  const nodeEls = new Map();

  tiers.forEach(([tier, nodes])=>{
    const col = h(`<section class="tier"><h3>Tier ${tier} (${byTierCounts[tier]||0} unlocked)</h3><div class="nodes"></div></section>`);
    const wrap = col.querySelector('.nodes');
    nodes.forEach(n=>{
      const el = renderNode(n, discovered);
      nodeEls.set(n.id, el);
      wrap.appendChild(el);
    });
    elTree.appendChild(col);
  });
  requestAnimationFrame(()=> drawLinks(data, nodeEls, discovered));
}

function renderNode(node, discoveredSet){
  const isGroup = State.mode==='group';
  const div = h(`<div class="node ${tierClass(node.tier)}" id="node_${node.id}">
    <div class="name">${node.name}</div>
    <div class="desc">${node.desc||''}</div>
    <div class="meta">
      <span class="pill">Tier ${node.tier}</span>
      <span class="pill">Cost: ${node.cost}</span>
      <span class="pill">Pre: ${node.prereqs?.length||0}</span>
      ${node.cap? `<span class="pill">Cap: ${node.cap}</span>`:''}
    </div>
    <div class="actions"></div>
  </div>`);

  const isDiscovered = discoveredSet.has(node.id);
  const isUnlocked = isGroup ? State.group.unlocked.includes(node.id) : (activePlayer()?.unlocked.includes(node.id)||false);
  const available = isGroup ? canUnlockGroup(node) : (activePlayer()? canUnlockPersonal(activePlayer(), node): false);
  if(!isDiscovered) div.classList.add('hidden');
  if(!available && !isUnlocked) div.classList.add('locked');

  const actions = div.querySelector('.actions');

  if(node.cap){
    const count = State.group.counts[node.id]||0;
    const canBuild = available || (isUnlocked && count < node.cap && State.group.points >= node.cost);
    const b = h(`<button class="btn ${canBuild?'primary':''}">${isUnlocked?'Build (+1)':'Unlock & Build (+1)'}</button>`);
    b.disabled = !canBuild;
    b.onclick = async ()=>{
      if(b.disabled) return;
      if(!State.group.unlocked.includes(node.id)) State.group.unlocked.push(node.id);
      State.group.points -= node.cost;
      State.group.counts[node.id]=(State.group.counts[node.id]||0)+1;
      saveState(); render(); await upsertGroupRemote();
    };
    const status = h(`<span class="small muted">Built ${count}/${node.cap}</span>`);
    actions.appendChild(b); actions.appendChild(status);
  } else {
    const b = h(`<button class="btn ${available?'primary':''}">${isUnlocked?'Unlocked':'Unlock'}</button>`);
    b.disabled = isUnlocked ? true : !available;
    b.onclick = async ()=>{
      if(b.disabled) return;
      if(isGroup){
        State.group.points -= node.cost; State.group.unlocked.push(node.id); saveState(); render(); await upsertGroupRemote();
      } else {
        const p=activePlayer(); p.points -= node.cost; p.unlocked.push(node.id); saveState(); render(); await upsertPlayerRemote(p);
      }
    };
    actions.appendChild(b);
  }

  if(State.gm){
    const gmRow = h(`<div class="row small"><label class="small"><input type="checkbox"> Discovered</label><span class="small muted"> id: ${node.id}</span></div>`);
    const ck = gmRow.querySelector('input'); ck.checked = isDiscovered;
    ck.onchange = async ()=>{
      if(isGroup){
        const set = new Set(State.group.discovered); ck.checked? set.add(node.id):set.delete(node.id);
        State.group.discovered = [...set]; saveState(); render(); await upsertGroupRemote();
      } else {
        const set = new Set(State.personalDiscovered); ck.checked? set.add(node.id):set.delete(node.id);
        State.personalDiscovered = [...set]; saveState(); render();
      }
    };
    actions.appendChild(gmRow);
  }

  return div;
}

function drawLinks(dataset, nodeEls, discovered){
  const svg = elLinks;
  const rect = document.getElementById('tree').getBoundingClientRect();
  while(svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
  svg.setAttribute('width',rect.width);
  svg.setAttribute('height',rect.height);
  const styleFor=(tier)=>({ stroke:[null,'#6e5a47','#5c6f86','#6aa6d9','#6fe1e9','#8ff7ff'][tier]||'#6aa6d9', width:[0,2,2,2.5,3,3.5][tier]||2, opacity:[0,.5,.55,.6,.75,.85][tier]||.6 });
  dataset.forEach(n=>{
    if(!n.prereqs||n.prereqs.length===0) return;
    if(!discovered.has(n.id)) return;
    const tgtEl = document.getElementById(`node_${n.id}`); if(!tgtEl) return;
    const tRect=tgtEl.getBoundingClientRect(); const tX=(tRect.left+tRect.width/2)-rect.left; const tY=(tRect.top)-rect.top;
    n.prereqs.forEach(pid=>{
      if(!discovered.has(pid)) return;
      const srcEl=document.getElementById(`node_${pid}`); if(!srcEl) return;
      const sRect=srcEl.getBoundingClientRect(); const sX=(sRect.left+sRect.width/2)-rect.left; const sY=(sRect.bottom)-rect.top;
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');
      const d=`M ${sX} ${sY} C ${sX} ${sY+20}, ${tX} ${tY-20}, ${tX} ${tY}`;
      const st=styleFor(n.tier);
      p.setAttribute('d',d); p.setAttribute('fill','none'); p.setAttribute('stroke',st.stroke); p.setAttribute('stroke-width',st.width); p.setAttribute('opacity',st.opacity); p.setAttribute('stroke-linecap','round');
      if(n.tier>=4){ p.setAttribute('filter','url(#glow)'); }
      svg.appendChild(p);
    });
  });
  let defs=svg.querySelector('defs'); if(!defs){ defs=document.createElementNS('http://www.w3.org/2000/svg','defs'); svg.appendChild(defs); }
  defs.innerHTML = `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
}
