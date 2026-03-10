const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

const CONFIG = {
    beginner: { rows: 9, cols: 9, mines: 10 },
    intermediate: { rows: 16, cols: 16, mines: 40 },
    expert: { rows: 16, cols: 30, mines: 99 }
};

function generateMines(diff, exR, exC) {
    const { rows, cols, mines } = CONFIG[diff] || CONFIG.beginner;
    let locations = new Set();
    let result = [];
    while (result.length < mines) {
        let r = Math.floor(Math.random() * rows);
        let c = Math.floor(Math.random() * cols);
        if ((r === exR && c === exC) || locations.has(`${r},${c}`)) continue;
        locations.add(`${r},${c}`);
        result.push([r, c]);
    }
    return result;
}

export default {
    async fetch(request, env) {
        if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
        const url = new URL(request.url);
        const path = url.pathname;

        try {
            if (path === "/api/auth" && request.method === "POST") {
                const { username, password } = await request.json();
                const banned = await env.DB_CONTAS.prepare("SELECT * FROM bans WHERE username = ?").bind(username).first();
                if (banned) return Response.json({ error: "Banido" }, { status: 403, headers: corsHeaders });
                const user = await env.DB_CONTAS.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
                if (user) {
                    if (user.password !== password) return Response.json({ error: "Senha incorreta" }, { status: 401, headers: corsHeaders });
                } else {
                    await env.DB_CONTAS.prepare("INSERT INTO users (username, password) VALUES (?, ?)").bind(username, password).run();
                }
                return Response.json({ success: true }, { headers: corsHeaders });
            }

            if (path === "/api/data" && request.method === "GET") {
                const { results: admins } = await env.DB_CONTAS.prepare("SELECT * FROM admins").all();
                const { results: bans } = await env.DB_CONTAS.prepare("SELECT * FROM bans").all();
                const { results: records } = await env.DB_RECORDES.prepare("SELECT * FROM records ORDER BY time_ms ASC").all();
                return Response.json({ admins, bans, records }, { headers: corsHeaders });
            }

            if (path === "/api/admin" && request.method === "POST") {
                const { action, target, actor } = await request.json();
                const isAdmin = await env.DB_CONTAS.prepare("SELECT * FROM admins WHERE username = ?").bind(actor).first();
                if (!isAdmin) return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
                const date = new Date().toLocaleDateString('pt-BR');

                if (action === "ban") {
                    await env.DB_CONTAS.prepare("INSERT OR IGNORE INTO bans (username, banned_by, date_banned) VALUES (?, ?, ?)").bind(target, actor, date).run();
                    await env.DB_CONTAS.prepare("DELETE FROM admins WHERE username = ? AND username != 'Admin'").bind(target).run();
                    await env.DB_RECORDES.prepare("DELETE FROM records WHERE username = ?").bind(target).run();
                } else if (action === "unban") {
                    await env.DB_CONTAS.prepare("DELETE FROM bans WHERE username = ?").bind(target).run();
                } else if (action === "add_admin") {
                    await env.DB_CONTAS.prepare("INSERT OR IGNORE INTO admins (username, added_by, date_added) VALUES (?, ?, ?)").bind(target, actor, date).run();
                } else if (action === "remove_admin") {
                    if (target !== 'Admin') await env.DB_CONTAS.prepare("DELETE FROM admins WHERE username = ?").bind(target).run();
                }
                return Response.json({ success: true }, { headers: corsHeaders });
            }

            if (path === "/api/game/start" && request.method === "POST") {
                const { diff, exR, exC, player } = await request.json();
                const mines = generateMines(diff, exR, exC);
                const gameId = crypto.randomUUID();
                if (player) {
                    await env.DB_RECORDES.prepare("INSERT INTO active_games (id, username, difficulty, start_time) VALUES (?, ?, ?, ?)").bind(gameId, player, diff, Date.now()).run();
                }
                return Response.json({ gameId, mines }, { headers: corsHeaders });
            }

            if (path === "/api/game/end" && request.method === "POST") {
                const { gameId, time } = await request.json();
                const game = await env.DB_RECORDES.prepare("SELECT * FROM active_games WHERE id = ?").bind(gameId).first();
                if (game) {
                    await env.DB_RECORDES.prepare("DELETE FROM active_games WHERE id = ?").bind(gameId).run();
                    const realTime = Math.floor((Date.now() - game.start_time) / 1000);
                    if (time >= realTime - 2) {
                        const date = new Date().toISOString().split('T')[0];
                        await env.DB_RECORDES.prepare("INSERT INTO records (username, difficulty, time_ms, date_played) VALUES (?, ?, ?, ?)").bind(game.username, game.difficulty, time, date).run();
                    }
                }
                return Response.json({ success: true }, { headers: corsHeaders });
            }

            return new Response("Not found", { status: 404, headers: corsHeaders });
        } catch (e) {
            return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
        }
    }
};