// worker.js
// Bindings required in wrangler.toml:
// KV: PICKS_KV (for published picks + tallies)
// Cron: schedules = ["0 */1 * * *"]  // hourly; adjust as you like

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/slate') {
      const json = await buildSlate(env);
      return new Response(JSON.stringify(json), { headers: { 'content-type': 'application/json', 'cache-control':'no-store' } });
    }
    return new Response('OK', { status: 200 });
  },

  async scheduled(event, env, ctx) {
    // 1) Refresh odds & publish picks (read-only app consumes /slate)
    ctx.waitUntil(refreshOddsAndPicks(env));
    // 2) Grade yesterday’s picks to update W/L/P counters
    ctx.waitUntil(gradeYesterday(env));
  }
}

// === Config (set your free API endpoints/keys as secrets in wrangler) ===
const BOOKS = ['book_a','book_b']; // keep small on free tiers
const MARKETS = ['ML','SPREAD','TOTAL'];

async function refreshOddsAndPicks(env){
  // Fetch odds & basic stats from your free-tier APIs (use env.ODDS_API_KEY, env.STATS_API_KEY)
  // For v1 template, we’ll mock minimal data so everything runs out-of-the-box.
  const today = new Date(); today.setHours(0,0,0,0);
  const data = mockOddsForDay(today); // replace with real fetch + mapping later

  // Compute simple model probabilities (placeholder)
  // In production, replace with Elo/Poisson; here we use implied prob with a tiny edge nudge from form.
  const withProbs = data.map(g=>{
    const dec = g.decimal_odds; // consensus best price for the selection
    const implied = 1/dec; // baseline
    const p = Math.min(0.85, Math.max(0.15, implied + (g.formEdge||0))); // clamp + nudge
    return { ...g, p };
  });

  // Label picks and select Top 3 per league
  const byLeague = groupBy(withProbs, x=>x.league);
  const picks = {};
  const all = {};
  for (const [league, arr] of Object.entries(byLeague)){
    const sorted = arr.slice().sort((a,b)=> b.start - a.start); // keep deterministic
    // All picks list
    all[league] = arr.map(enrichLabel);
    // Top picks
    const safest = arr.slice().sort((a,b)=> b.p - a.p)[0];
    const bestValue = arr.slice().sort((a,b)=> ev(b)-ev(a))[0];
    const risky = arr.filter(x=> ev(x) > 0 && x.p <= 0.40).sort((a,b)=> ev(b)-ev(a))[0] || null;
    picks[league] = {
      safest: safest? enrichLabel(safest, 'Safest') : null,
      bestValue: bestValue? enrichLabel(bestValue, 'Best Value') : null,
      risky: risky? enrichLabel(risky, 'Risky') : null,
    };
  }

  // Persist today’s published picks (for grading later)
  const key = keyForDate(today);
  await env.PICKS_KV.put(`published:${key}`, JSON.stringify(withProbs), { expirationTtl: 60*60*24*7 });

  // Build headers (tallies)
  const headers = await buildHeaders(env);

  // Cache assembled slate
  const slate = { headers, picks, all };
  await env.PICKS_KV.put('slate:today', JSON.stringify(slate), { expirationTtl: 60*60*6 });
}

async function buildSlate(env){
  const cached = await env.PICKS_KV.get('slate:today');
  if (cached) return JSON.parse(cached);
  // Fallback: compute now (in case you open the site before the cron runs)
  await refreshOddsAndPicks(env);
  const again = await env.PICKS_KV.get('slate:today');
  return again? JSON.parse(again) : { headers: {}, picks: {}, all: {} };
}

function enrichLabel(p, forced){
  const label = forced || (p.p >= 0.6 ? 'Safe' : (ev(p)>0 ? (p.p<=0.4? 'Risky':'Value') : 'Info'));
  return { ...p, label };
}

function ev(p){ return p.p * (p.decimal_odds - 1) - (1 - p.p); }

async function gradeYesterday(env){
  const d = new Date(); d.setDate(d.getDate()-1); d.setHours(0,0,0,0);
  const key = keyForDate(d);
  const published = await env.PICKS_KV.get(`published:${key}`);
  if(!published) return;
  const picks = JSON.parse(published);

  // Fetch final results for d (replace with real results API). Here we mock finals.
  const finals = mockFinalsForDay(d);
  const finalsById = Object.fromEntries(finals.map(f=>[f.id, f]));

  // Tally per league
  const tallies = { NFL: {W:0,L:0,P:0}, NBA:{W:0,L:0,P:0}, NHL:{W:0,L:0,P:0} };
  for(const p of picks){
    const f = finalsById[p.id];
    if(!f){ continue; }
    const res = gradePick(p, f);
    const t = tallies[p.league];
    if(res==='W') t.W++; else if(res==='L') t.L++; else t.P++;
  }

  // Persist rolling logs
  await env.PICKS_KV.put(`graded:${key}`, JSON.stringify(tallies), { expirationTtl: 60*60*24*90 });
}

async function buildHeaders(env){
  const keys = await listKeys(env.PICKS_KV, 'graded:');
  const logs = [];
  for (const k of keys){ const v = await env.PICKS_KV.get(k); if(v) logs.push(JSON.parse(v)); }
  const agg = (league, days)=>{
    let W=0,L=0,P=0; for(const d of logs.slice(-days)) { const t=d[league]; if(!t) continue; W+=t.W; L+=t.L; P+=t.P; }
    const total = W+L; const win = total? W/total : 0; return {W,L,P,win};
  };
  return {
    NFL: { season: agg('NFL', logs.length||1), last7: agg('NFL', Math.min(7, logs.length||1)) },
    NBA: { season: agg('NBA', logs.length||1), last7: agg('NBA', Math.min(7, logs.length||1)) },
    NHL: { season: agg('NHL', logs.length||1), last7: agg('NHL', Math.min(7, logs.length||1)) },
  };
}

function gradePick(p, f){
  // Minimal graders (moneyline/spread/total). Props can be added similarly.
  if (p.market === 'ML') {
    return f.winner === p.selection ? 'W' : 'L';
  }
  if (p.market === 'SPREAD') {
    const margin = f.homeScore - f.awayScore; // home minus away
    const sel = p.selection; // e.g., HOME -3.5 or AWAY +2.5
    const m = p.line; // negative for favorite
    const signed = sel==='HOME'? -m : m; // normalize toward our team
    const cover = sel==='HOME'? (margin + m) : ((-margin) + (-m));
    if (Math.abs(cover) < 1e-9) return 'P';
    return cover>0? 'W' : 'L';
  }
  if (p.market === 'TOTAL') {
    const total = f.homeScore + f.awayScore;
    if (Math.abs(total - p.line) < 1e-9) return 'P';
    return (p.selection==='OVER' && total>p.line) || (p.selection==='UNDER' && total<p.line) ? 'W':'L';
  }
  return 'P';
}

// ===== Utilities & Mock Data =====
function keyForDate(d){ return d.toISOString().slice(0,10); }
function groupBy(arr, fn){ const m={}; for(const x of arr){ const k=fn(x); (m[k]??=[]).push(x);} return m; }
async function listKeys(kv, prefix){
  // Cloudflare KV list iterator
  const out=[]; let cursor=undefined; do{
    const res = await kv.list({ prefix, cursor });
    out.push(...res.keys.map(k=>k.name)); cursor=res.cursor;
  } while(cursor);
  return out.sort();
}

function mockOddsForDay(day){
  // Returns a tiny sample slate per league so the UI renders before you wire real APIs.
  // Each item: {id, league, home, away, start, market, selection, line, decimal_odds, formEdge}
  const base = day.getTime()+18*3600*1000; // 6pm local for demo
  return [
    { id:'NFL1', league:'NFL', home:'Eagles', away:'Cowboys', start: base, market:'ML', selection:'HOME', line:0, decimal_odds:1.77, formEdge:+0.03 },
    { id:'NFL2', league:'NFL', home:'Chiefs', away:'Ravens', start: base+3600e3, market:'TOTAL', selection:'OVER', line:49.5, decimal_odds:1.91, formEdge:+0.01 },
    { id:'NFL3', league:'NFL', home:'Bills', away:'Jets', start: base+2*3600e3, market:'SPREAD', selection:'AWAY', line:+3.5, decimal_odds:1.87, formEdge:+0.02 },

    { id:'NBA1', league:'NBA', home:'Celtics', away:'Bucks', start: base, market:'ML', selection:'HOME', line:0, decimal_odds:1.65, formEdge:+0.04 },
    { id:'NBA2', league:'NBA', home:'Lakers', away:'Warriors', start: base+5400e3, market:'TOTAL', selection:'UNDER', line:231.5, decimal_odds:1.91, formEdge:+0.005 },
    { id:'NBA3', league:'NBA', home:'Knicks', away:'Heat', start: base+3600e3, market:'SPREAD', selection:'HOME', line:-2.5, decimal_odds:1.87, formEdge:+0.015 },

    { id:'NHL1', league:'NHL', home:'Rangers', away:'Penguins', start: base, market:'ML', selection:'HOME', line:0, decimal_odds:1.80, formEdge:+0.02 },
    { id:'NHL2', league:'NHL', home:'Oilers', away:'Canucks', start: base+3600e3, market:'TOTAL', selection:'OVER', line:6.5, decimal_odds:1.86, formEdge:+0.01 },
    { id:'NHL3', league:'NHL', home:'Leafs', away:'Sens', start: base+7200e3, market:'SPREAD', selection:'AWAY', line:+1.5, decimal_odds:1.58, formEdge:+0.008 }
  ];
}

function mockFinalsForDay(day){
  // Simple finals so grading can demonstrate W/L/P updates.
  return [
    { id:'NFL1', winner:'HOME', homeScore:27, awayScore:20 },
    { id:'NFL2', winner:null, homeScore:31, awayScore:24 }, // total 55. OVER 49.5 wins
    { id:'NFL3', winner:null, homeScore:20, awayScore:17 }, // AWAY +3.5 wins

    { id:'NBA1', winner:'HOME', homeScore:118, awayScore:110 },
    { id:'NBA2', winner:null, homeScore:110, awayScore:112 }, // total 222 -> UNDER wins
    { id:'NBA3', winner:null, homeScore:105, awayScore:99 },  // HOME -2.5 wins

    { id:'NHL1', winner:'HOME', homeScore:3, awayScore:2 },
    { id:'NHL2', winner:null, homeScore:5, awayScore:3 },    // OVER 6.5 wins (8 total)
    { id:'NHL3', winner:null, homeScore:2, awayScore:3 }     // AWAY +1.5 wins
  ];
}
