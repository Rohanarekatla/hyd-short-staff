// Local static server. The whole app runs in the browser (planner, simulation, on-device AI), so this only
// serves files, exactly like GitHub Pages does. npm start -> http://localhost:8520
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT) || 8520;
const ROOT = new URL('.', import.meta.url).pathname;
const PUBLIC = ['index.html', 'app/', 'lib/', 'data/']; // never serve node_modules, scripts or tests
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT) || !PUBLIC.some((p) => path === p || path.startsWith(p))) { res.writeHead(404); return res.end('not found'); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, () => console.log(`SurgeForce on http://localhost:${PORT}`));
