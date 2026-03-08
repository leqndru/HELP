export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);

    // SISTEMA DE CONTAS
    if (url.pathname === "/api/login" && request.method === "POST") {
      const { user, pass } = await request.json();
      const existing = await env.DB_USERS.prepare("SELECT password FROM users WHERE username = ?").bind(user).first();
      
      if (existing) {
        if (existing.password === pass) return new Response("OK", { headers: corsHeaders });
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      } else {
        await env.DB_USERS.prepare("INSERT INTO users (username, password) VALUES (?, ?)").bind(user, pass).run();
        return new Response("Created", { headers: corsHeaders });
      }
    }

    // INICIAR CRONÔMETRO NO BACKEND
    if (url.pathname === "/api/start" && request.method === "POST") {
      const sessionId = crypto.randomUUID();
      // Salva o momento exato em que a primeira célula foi aberta
      await env.DB_RECORDS.prepare("INSERT INTO sessions (id, start_time) VALUES (?, ?)").bind(sessionId, Date.now()).run();
      return new Response(JSON.stringify({ sessionId }), { headers: corsHeaders });
    }

    // REGISTRAR VITÓRIA E CALCULAR TEMPO REAL
    if (url.pathname === "/api/record" && request.method === "POST") {
      const { sessionId, difficulty, user } = await request.json();
      
      const session = await env.DB_RECORDS.prepare("SELECT start_time FROM sessions WHERE id = ?").bind(sessionId).first();
      if (!session) return new Response("Invalid Session", { status: 400, headers: corsHeaders });
      
      // O tempo do backend que decide o recorde, não o do navegador
      const timeSec = Math.floor((Date.now() - session.start_time) / 1000);
      const date = new Date().toISOString();
      
      await env.DB_RECORDS.prepare("INSERT INTO records (user, difficulty, time, date) VALUES (?, ?, ?, ?)").bind(user, difficulty, timeSec, date).run();
      // Opcional: Apagar a sessão para não ser reutilizada
      await env.DB_RECORDS.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
      
      return new Response("OK", { headers: corsHeaders });
    }

    // BUSCAR RECORDES E FILTRAR (Diário, Semanal, etc.)
    if (url.pathname === "/api/records" && request.method === "GET") {
      const { results } = await env.DB_RECORDS.prepare("SELECT * FROM records").all();
      const scores = { daily: {records:{}}, weekly: {records:{}}, monthly: {records:{}}, allTime: {records:{}} };
      const now = new Date();
      
      const currentDay = now.toISOString().split('T')[0];
      const currentMonth = currentDay.slice(0, 7);
      
      // Lógica ISO de Semana
      const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const currentWeek = d.getUTCFullYear() + '-W' + Math.ceil((((d - yearStart) / 86400000) + 1) / 7);

      const diffs = ['beginner', 'intermediate', 'expert'];
      diffs.forEach(df => { scores.daily.records[df] = []; scores.weekly.records[df] = []; scores.monthly.records[df] = []; scores.allTime.records[df] = []; });

      results.forEach(r => {
         const rec = { name: r.user, time: r.time };
         scores.allTime.records[r.difficulty].push(rec);

         const rDate = new Date(r.date);
         const rDay = rDate.toISOString().split('T')[0];
         if (rDay === currentDay) scores.daily.records[r.difficulty].push(rec);
         if (rDay.slice(0, 7) === currentMonth) scores.monthly.records[r.difficulty].push(rec);

         const rd = new Date(Date.UTC(rDate.getFullYear(), rDate.getMonth(), rDate.getDate()));
         rd.setUTCDate(rd.getUTCDate() + 4 - (rd.getUTCDay() || 7));
         const rWeek = rd.getUTCFullYear() + '-W' + Math.ceil((((rd - new Date(Date.UTC(rd.getUTCFullYear(), 0, 1))) / 86400000) + 1) / 7);
         if (rWeek === currentWeek) scores.weekly.records[r.difficulty].push(rec);
      });

      ['daily', 'weekly', 'monthly', 'allTime'].forEach(p => {
         diffs.forEach(df => {
            scores[p].records[df].sort((a,b) => a.time - b.time);
            scores[p].records[df] = scores[p].records[df].slice(0, 10);
         });
      });

      return new Response(JSON.stringify(scores), { headers: corsHeaders });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};