// state.js — local state + helpers
export const LS_KEY = 'korrath_v05';
export const AUTH_KEY = 'korrath_auth';

export const WORLD_FLAGS = [
  {id:'tools_workshop', name:'Tools & Tech NPC present'},
  {id:'cleared_patrol', name:'Cleared patrol route'},
  {id:'trade_route_1', name:'Brokered trade route'},
  {id:'med_scanners', name:'Medical scanners & medic'},
  {id:'mast_installed', name:'Comm mast installed'},
  {id:'power_core', name:'Power core & stabilizers'}
];

export let GROUP_TECH = [];
export let PERSONAL_TECH = [];

export const State = {
  gm:false,
  gmHash:null,
  mode:'group',
  world:{ flags:{} },
  group:{ points:0, unlocked:[], discovered:[], counts:{} },
  personalDiscovered:[],
  players:{ byId:{}, order:[] },
  activePlayerId:null,
  campaignId:null,
  sbReady:false
};

export function makePlayer(name){ return { id: crypto.randomUUID(), name, code:'', points:0, unlocked:[] }; }

export function saveState(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(State)); }catch(_){} }
export function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw){ const s = JSON.parse(raw); Object.assign(State, s); }
  }catch(_){}
  if(!State.players.order.length){
    const p = makePlayer('Party'); State.players.byId[p.id]=p; State.players.order=[p.id]; State.activePlayerId=p.id;
  }
  for(const f of WORLD_FLAGS){ if(!(f.id in State.world.flags)) State.world.flags[f.id]=false; }
  saveState();
}

export const activePlayer = ()=> State.players.byId[State.activePlayerId] || null;

export function groupByTier(arr){ const m=new Map(); for(const t of arr){ if(!m.has(t.tier)) m.set(t.tier,[]); m.get(t.tier).push(t);} return [...m.entries()].sort((a,b)=>a[0]-b[0]); }
export function countUnlockedByTier(unlockedIds, dataset){ const by={}; for(const id of unlockedIds){ const n=dataset.find(x=>x.id===id); if(!n) continue; by[n.tier]=(by[n.tier]||0)+1; } return by; }
export function tierGateOk(node, unlockedByTier){ if(node.tier===1) return true; return (unlockedByTier[node.tier-1]||0) >= 5; }
export function flagsOk(node){ if(!node.flags||!node.flags.length) return true; return node.flags.every(fid=> !!State.world.flags[fid]); }
export function tierClass(t){ return ['','t1','t2','t3','t4','t5'][t] || 't1'; }

export function canUnlockGroup(node){
  if(State.mode!=='group') return false;
  if(!new Set(State.group.discovered).has(node.id)) return false;
  if(State.group.unlocked.includes(node.id)) return false;
  if(!flagsOk(node)) return false;
  const byTier=countUnlockedByTier(State.group.unlocked,GROUP_TECH);
  if(!tierGateOk(node,byTier)) return false;
  if(node.prereqs && !node.prereqs.every(id=> State.group.unlocked.includes(id))) return false;
  if(node.cost > State.group.points) return false;
  if(node.cap){ const c=State.group.counts[node.id]||0; if(c>=node.cap) return false; }
  return true;
}
export function canUnlockPersonal(player,node){
  if(State.mode!=='player'||!player) return false;
  if(!new Set(State.personalDiscovered).has(node.id)) return false;
  if(player.unlocked.includes(node.id)) return false;
  const byTier=countUnlockedByTier(player.unlocked,PERSONAL_TECH);
  if(!tierGateOk(node,byTier)) return false;
  if(node.prereqs && !node.prereqs.every(id=> player.unlocked.includes(id))) return false;
  if(node.cost > player.points) return false;
  return true;
}

export function setTechData(group, personal){
  GROUP_TECH = group; PERSONAL_TECH = personal;
}
export const defaultDiscoveredGroup = new Set();
export const defaultDiscoveredPersonal = new Set();
export function initDiscovered(){
  defaultDiscoveredGroup.clear();
  GROUP_TECH.filter(t=>t.discovered).forEach(t=> defaultDiscoveredGroup.add(t.id));
  defaultDiscoveredPersonal.clear();
  PERSONAL_TECH.filter(t=>t.discovered).forEach(t=> defaultDiscoveredPersonal.add(t.id));
  if(!State.group.discovered.length) State.group.discovered = [...defaultDiscoveredGroup];
  if(!State.personalDiscovered.length) State.personalDiscovered = [...defaultDiscoveredPersonal];
  saveState();
}
