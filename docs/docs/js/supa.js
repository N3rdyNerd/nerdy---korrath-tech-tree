
// supa.js — Supabase client + host/join + realtime
export const SUPABASE_URL = 'https://vwlswnrfywukwpaeoiyv.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3bHN3bnJmeXd1a3dwYWVvaXl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2NjY4ODEsImV4cCI6MjA3MDI0Mjg4MX0.xownCCj2Y7_L4Hpekh_AwnwhJSpdCIQjW-L0xnW4vL8';

import { State, defaultDiscoveredGroup, makePlayer, saveState } from './state.js';

let sb = null;
export function ensureClient(){
  if(!sb){
    // dynamic import of supabase-js from CDN
    // @ts-ignore
    sb = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_ANON_KEY);
    if(!sb){
      throw new Error('Supabase JS not found. Add <script src=\"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2\"></script> OR upgrade to v0.6 where we ESM-import.');
    }
    State.sbReady = true; saveState();
  }
  return sb;
}

export async function sha256(text){
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export async function hostCampaign(name, pin){
  const sbc = ensureClient();
  const gm_hash = await sha256(pin);
  const { data:camp, error } = await sbc.from('campaigns').insert({ name, gm_hash }).select().single();
  if(error) throw error;
  State.campaignId = camp.id; State.gm = true; State.gmHash = gm_hash; saveState();
  await sbc.from('group_state').upsert({
    campaign_id: camp.id, points:0, unlocked:[], counts:{}, discovered:[...defaultDiscoveredGroup], flags: State.world.flags
  });
  return camp.id;
}

export async function joinCampaign(campaignId, playerName, playerCode){
  const sbc = ensureClient();

  // Code-based login
  if(playerCode && playerCode.trim()){
    const code = playerCode.trim();
    const code_hash = await sha256(code);
    const { data:existing, error:codeErr } = await sbc.from('players')
      .select('*').eq('campaign_id', campaignId).eq('code_hash', code_hash).maybeSingle();
    if(codeErr) throw codeErr;
    if(!existing) throw new Error('Invalid code for this campaign.');

    const p = makePlayer(existing.name);
    p.id = existing.id; p.points=existing.points; p.unlocked=existing.unlocked||[]; p.code = code;
    State.players.byId[p.id]=p; if(!State.players.order.includes(p.id)) State.players.order.push(p.id);
    State.activePlayerId=p.id; State.campaignId=campaignId; saveState();
    try{ localStorage.setItem('korrath_auth', JSON.stringify({ campaignId, playerId:p.id, playerCode:code })); }catch(_){}
    await loadGroupState();
    subscribeRealtime(campaignId, p.id);
    return { playerId:p.id, code };
  }

  // No code: join by name or create + assign code
  if(!playerName || !playerName.trim()) throw new Error('Enter a name or a player code.');
  const name = playerName.trim();

  const { data:rows, error:nameErr } = await sbc.from('players')
    .select('*').eq('campaign_id', campaignId).eq('name', name).limit(1);
  if(nameErr) throw nameErr;
  let playerRow = rows && rows[0];

  const code = crypto.randomUUID().slice(0,8);
  const code_hash = await sha256(code);

  if(playerRow){
    const { data:updated, error:updErr } = await sbc.from('players')
      .update({ code_hash }).eq('id', playerRow.id).select().single();
    if(updErr) throw updErr;
    playerRow = updated;
  }else{
    const { data:ins, error:insErr } = await sbc.from('players')
      .insert({ campaign_id: campaignId, name, code_hash, points:0, unlocked:[] }).select().single();
    if(insErr) throw insErr;
    playerRow = ins;
  }

  const p = makePlayer(playerRow.name);
  p.id = playerRow.id; p.points=playerRow.points; p.unlocked=playerRow.unlocked||[]; p.code = code;
  State.players.byId[p.id]=p; if(!State.players.order.includes(p.id)) State.players.order.push(p.id);
  State.activePlayerId=p.id; State.campaignId=campaignId; saveState();
  try{ localStorage.setItem('korrath_auth', JSON.stringify({ campaignId, playerId:p.id, playerCode:code })); }catch(_){}
  await loadGroupState();
  subscribeRealtime(campaignId, p.id);
  return { playerId:p.id, code };
}

export async function upsertPlayerRemote(p){
  if(!State.sbReady||!State.campaignId) return;
  const sbc = ensureClient();
  await sbc.from('players').upsert({ id:p.id, campaign_id:State.campaignId, name:p.name, points:p.points, unlocked:p.unlocked });
}
export async function upsertGroupRemote(){
  if(!State.sbReady||!State.campaignId) return;
  const sbc = ensureClient();
  await sbc.from('group_state').upsert({ campaign_id:State.campaignId, points:State.group.points, unlocked:State.group.unlocked, counts:State.group.counts, discovered:State.group.discovered, flags:State.world.flags });
}

export async function loadGroupState(){
  const sbc = ensureClient();
  const { data:gs } = await sbc.from('group_state').select('*').eq('campaign_id', State.campaignId).single();
  if(gs){
    State.group.points=gs.points||0; State.group.unlocked=gs.unlocked||[]; State.group.counts=gs.counts||{};
    State.group.discovered=gs.discovered||[]; State.world.flags=gs.flags||{}; saveState();
  }
}

export function subscribeRealtime(campaignId, playerId){
  const sbc = ensureClient();
  const ch = sbc.channel('korrath_'+campaignId);
  ch.on('postgres_changes', { event:'UPDATE', schema:'public', table:'group_state', filter:`campaign_id=eq.${campaignId}` }, (payload)=>{
    const gs = payload.new; State.group.points=gs.points||0; State.group.unlocked=gs.unlocked||[]; State.group.counts=gs.counts||{}; State.group.discovered=gs.discovered||[]; State.world.flags=gs.flags||{}; saveState();
    import('./ui.js').then(m=>m.render());
  });
  ch.on('postgres_changes', { event:'INSERT', schema:'public', table:'players', filter:`campaign_id=eq.${campaignId}` }, ()=> fetchPlayers());
  ch.on('postgres_changes', { event:'UPDATE', schema:'public', table:'players', filter:`campaign_id=eq.${campaignId}` }, ()=> fetchPlayers());
  ch.subscribe();
}

export async function fetchPlayers(){
  if(!State.sbReady||!State.campaignId) return;
  const sbc = ensureClient();
  const { data } = await sbc.from('players').select('id,name,points,unlocked').eq('campaign_id', State.campaignId);
  if(data){
    for(const r of data){
      const p = State.players.byId[r.id] || makePlayer(r.name);
      p.id=r.id; p.name=r.name; p.points=r.points; p.unlocked=r.unlocked||[];
      State.players.byId[p.id]=p; if(!State.players.order.includes(p.id)) State.players.order.push(p.id);
    }
    saveState();
    import('./ui.js').then(m=>m.render());
  }
}

export async function gmResetPlayerCode(pid){
  if(!State.gm){ alert('GM only.'); return; }
  if(!State.campaignId){ alert('Host or join a campaign first.'); return; }
  const sbc = ensureClient();
  const code = crypto.randomUUID().slice(0,8);
  const code_hash = await sha256(code);
  const { error } = await sbc.from('players').update({ code_hash }).eq('id', pid).eq('campaign_id', State.campaignId);
  if(error){ alert('Failed to set code: '+(error.message||error)); return; }
  const link = location.origin + location.pathname + '?campaign=' + encodeURIComponent(State.campaignId) + '&code=' + encodeURIComponent(code);
  try{ await navigator.clipboard.writeText(link); }catch(_){}
  alert('New player link copied to clipboard.\n\nCode: '+code+'\nLink: '+link);
}
