'use strict';
// Tarjan SCC over graph.json produced by split-graph.js
function scc(nodes) {
    let index = 0; const stack = []; const onStack = new Set(); const idx = {}; const low = {}; const out = [];
    const keys = Object.keys(nodes);
    function strong(v) {
        // iterative Tarjan
        const work = [[v, 0]];
        idx[v] = low[v] = index++; stack.push(v); onStack.add(v);
        while (work.length) {
            const [n, i] = work[work.length - 1];
            const deps = (nodes[n].deps || []).filter(d => nodes[d]);
            if (i < deps.length) {
                work[work.length - 1][1]++;
                const w = deps[i];
                if (idx[w] === undefined) { idx[w] = low[w] = index++; stack.push(w); onStack.add(w); work.push([w, 0]); }
                else if (onStack.has(w)) { low[n] = Math.min(low[n], idx[w]); }
            } else {
                work.pop();
                if (work.length) { const p = work[work.length - 1][0]; low[p] = Math.min(low[p], low[n]); }
                if (low[n] === idx[n]) { const comp = []; let w; do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== n); out.push(comp); }
            }
        }
    }
    for (const k of keys) { if (idx[k] === undefined) { strong(k); } }
    return out;
}
module.exports = { scc };
if (require.main === module) {
    const g = require(require('path').resolve(process.argv[2]));
    const comps = scc(g).filter(c => c.length > 1).sort((a, b) => b.length - a.length);
    for (const c of comps) { console.log(c.length, c.reduce((s, f) => s + g[f].loc, 0) + ' LOC', c.length < 12 ? c.map(f => f.split('/').pop()).join(' ') : ''); }
}
