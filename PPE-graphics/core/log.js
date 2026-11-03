// Application log: ring buffer + console + window.__ppLog for remote inspection.
// Read it without the browser open: curl http://localhost:5173/__log (dev) or
// window.__ppLog.dump() in the console. Levels: debug < info < warn < error.
const RING = 200;
const buf = [];
let level = 1; // 0=debug 1=info 2=warn 3=error
const LVL = { debug: 0, info: 1, warn: 2, error: 3 };

function push(lvl, args) {
  const entry = { t: (performance.now() / 1000).toFixed(1), lvl, msg: args.map(a => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
    return String(a);
  }).join(' ') };
  buf.push(entry);
  if (buf.length > RING) buf.shift();
  const c = lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log;
  c(`[pp ${entry.t}s ${lvl}]`, ...args);
}

export const log = {
  debug: (...a) => level <= 0 && push('debug', a),
  info: (...a) => level <= 1 && push('info', a),
  warn: (...a) => level <= 2 && push('warn', a),
  error: (...a) => level <= 3 && push('error', a),
  setLevel(l) { level = LVL[l] ?? 1; },
  dump() { return buf.map(e => `${e.t}s [${e.lvl}] ${e.msg}`).join('\n'); },
  last(n = 20) { return buf.slice(-n); },
};

// remote readout: window.__ppLog.dump() from console, or fetch('/__log') in dev.
// The ring buffer is POSTed to the dev server every 2 s (and on error immediately),
// so the agent can read the browser log with curl without opening the page.
if (typeof window !== 'undefined') {
  window.__ppLog = log;
  window.addEventListener('error', e => log.error('uncaught:', e.message, e.filename + ':' + e.lineno));
  window.addEventListener('unhandledrejection', e => log.error('unhandled rejection:', e.reason));
  const flush = () => {
    if (buf.length) {
      const lines = buf.splice(0).map(e => `${e.t}s [${e.lvl}] ${e.msg}`);
      fetch('/__log', {method: 'POST', body: JSON.stringify(lines), keepalive: true}).catch(() => {});
    }
  };
  setInterval(flush, 2000);
  window.addEventListener('beforeunload', flush);
}
