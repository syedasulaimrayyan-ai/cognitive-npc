/**
 * Minimal OpenAI-compatible /chat/completions mock for LOCAL TESTING ONLY.
 * Not shipped to players, not imported by the game — run manually:
 *   node scripts/mock-llm.mjs
 * then in the browser console:
 *   localStorage.setItem('cnpc.llm', JSON.stringify({
 *     endpoint: 'http://localhost:8787/v1/chat/completions', model: 'mock' }))
 * Echoes the last user message back with context proof (which facts arrived).
 */
import http from 'node:http';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (!req.url?.includes('/chat/completions')) { res.writeHead(404).end(); return; }

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let sys = '', lastUser = '';
    try {
      const parsed = JSON.parse(body);
      sys = parsed.messages?.find((m) => m.role === 'system')?.content ?? '';
      lastUser = [...(parsed.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '';
    } catch { /* ignore */ }
    // Proof the model received mission context: quote a fact marker + intent-ish echo.
    const knowsCrate = sys.includes('what you personally know');
    const knowsDont = sys.includes('do NOT know');
    const reply = `[mock-model] Heard: "${lastUser.slice(0, 60)}". Context arrived: facts=${knowsCrate}/${knowsDont}, len=${sys.length}. — In character: aye, I hear you.`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'mock', object: 'chat.completion', model: 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
    }));
  });
});

server.listen(8787, '127.0.0.1', () => console.log('mock-llm on http://127.0.0.1:8787/v1/chat/completions'));
