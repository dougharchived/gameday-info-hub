// scripts/build.js
const fs = require('fs');

function buildMockSlate() {
  const now = Date.now();
  const mk = (league, id, home, away, start, market, selection, line, dec, p) => ({
    id, league, home, away, start, market, selection, line, decimal_odds: dec, p
  });

  const nfl = [
    mk("NFL","NFL1","Eagles","Cowboys", now + 2*3600e3,"ML","HOME",0,1.77,0.62),
    mk("NFL","NFL2","Chiefs","Ravens",  now + 3*3600e3,"TOTAL","OVER",49.5,1.91,0.55),
    mk("NFL","NFL3","Bills","Jets",    now + 4*3600e3,"SPREAD","AWAY",+3.5,1.87,0.58),
  ];
  const nba = [
    mk("NBA","NBA1","Celtics","Bucks", now + 2*3600e3,"ML","HOME",0,1.65,0.66),
    mk("NBA","NBA2","Lakers","Warriors",now + 3*3600e3,"TOTAL","UNDER",231.5,1.91,0.54),
    mk("NBA","NBA3","Knicks","Heat",   now + 4*3600e3,"SPREAD","HOME",-2.5,1.87,0.57),
  ];
  const nhl = [
    mk("NHL","NHL1","Rangers","Penguins", now + 2*3600e3,"ML","HOME",0,1.80,0.60),
    mk("NHL","NHL2","Oilers","Canucks",   now + 3*3600e3,"TOTAL","OVER",6.5,1.86,0.53),
    mk("NHL","NHL3","Leafs","Sens",       now + 4*3600e3,"SPREAD","AWAY",+1.5,1.58,0.64),
  ];

  const ev = (p, dec) => p * (dec - 1) - (1 - p);
  const label = (p, dec) => (p >= 0.6 ? "Safe" : (ev(p,dec)>0 ? (p<=0.4?"Risky":"Value") : "Info"));

  const enrich = (arr) => arr.map(x => ({ ...x, label: label(x.p, x.decimal_odds) }));
  const pickTop = (arr) => ({
    safest: arr.slice().sort((a,b)=>b.p-a.p)[0] || null,
    bestValue: arr.slice().sort((a,b)=> ev(b.p,b.decimal_odds) - ev(a.p,a.decimal_odds))[0] || null,
    risky: arr.filter(x=> ev(x.p,x.decimal_odds)>0 && x.p<=0.40)
             .sort((a,b)=> ev(b.p,b.decimal_odds) - ev(a.p,a.decimal_odds))[0] || null
  });

  const all = { NFL: enrich(nfl), NBA: enrich(nba), NHL: enrich(nhl) };
  const picks = { NFL: pickTop(nfl), NBA: pickTop(nba), NHL: pickTop(nhl) };
  const headers = {
    NFL: { season:{W:0,L:0,P:0,win:0}, last7:{W:0,L:0,P:0,win:0} },
    NBA: { season:{W:0,L:0,P:0,win:0}, last7:{W:0,L:0,P:0,win:0} },
    NHL: { season:{W:0,L:0,P:0,win:0}, last7:{W:0,L:0,P:0,win:0} },
  };

  return { headers, picks, all };
}

const slate = buildMockSlate();
fs.writeFileSync('slate.json', JSON.stringify(slate, null, 2));
console.log("Wrote slate.json with mock data at", new Date().toISOString());
