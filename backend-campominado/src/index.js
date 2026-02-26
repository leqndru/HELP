export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (url.pathname.startsWith('/api/ranking')) {
      if (request.method === 'GET') {
        const diff = url.searchParams.get('diff') || 'beginner';
        const { results } = await env.DB.prepare(
          "SELECT name, time FROM rankings WHERE difficulty = ? ORDER BY time ASC LIMIT 10"
        ).bind(diff).all();
        return new Response(JSON.stringify(results.map((r, i) => ({ pos: i + 1, ...r }))), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      if (request.method === 'POST') {
        const body = await request.json();
        await env.DB.prepare("INSERT INTO rankings (name, time, difficulty) VALUES (?, ?, ?)")
          .bind(body.name, body.time, body.difficulty).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
    }

    if (url.pathname.startsWith('/chat/')) {
      const roomName = url.pathname.split('/')[2] || 'principal';
      const id = env.CHAT_ROOM.idFromName(roomName);
      return env.CHAT_ROOM.get(id).fetch(request);
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};

export class ChatRoom {
  constructor(state) { this.state = state; this.sessions = []; }
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WS', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    const name = new URL(request.url).searchParams.get('name') || 'Anónimo';
    server.accept();
    const session = { server, name };
    this.sessions.push(session);
    this.broadcast({ type: 'system', msg: `${name} entrou na sala.` });
    server.addEventListener('message', m => {
      const data = JSON.parse(m.data);
      if (data.type === 'chat') this.broadcast({ type: 'chat', user: name, msg: data.msg });
    });
    server.addEventListener('close', () => {
      this.sessions = this.sessions.filter(s => s !== session);
      this.broadcast({ type: 'system', msg: `${name} saiu da sala.` });
    });
    return new Response(null, { status: 101, webSocket: client });
  }
  broadcast(obj) { this.sessions.forEach(s => s.server.send(JSON.stringify(obj))); }
}