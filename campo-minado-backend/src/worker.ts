export interface Env {
    DB: D1Database;
    CHAT_ROOM: DurableObjectNamespace;
    GAME_SESSION: DurableObjectNamespace;
}

export class ChatRoom {
    state: DurableObjectState;
    env: Env;
    sessions: Map<WebSocket, string>;

    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;
        this.sessions = new Map();
    }

    async fetch(request: Request) {
        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("Expected Upgrade: websocket", { status: 426 });
        }

        const { 0: client, 1: server } = new WebSocketPair();
        
        server.accept();
        this.sessions.set(server, "Anon");

        server.addEventListener("message", (event) => {
            const data = JSON.parse(event.data as string);
            if (data.type === 'join') {
                this.sessions.set(server, data.name);
                this.broadcast(JSON.stringify({ type: 'system', users: Array.from(this.sessions.values()) }));
            } else {
                this.broadcast(JSON.stringify(data));
            }
        });

        server.addEventListener("close", () => {
            this.sessions.delete(server);
            this.broadcast(JSON.stringify({ type: 'system', users: Array.from(this.sessions.values()) }));
        });

        return new Response(null, { status: 101, webSocket: client });
    }

    broadcast(message: string) {
        this.sessions.forEach((_, session) => {
            try { session.send(message); } catch (err) {}
        });
    }
}

export class GameSession {
    state: DurableObjectState;
    env: Env;

    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request: Request) {
        const url = new URL(request.url);
        const path = url.pathname.split('/');

        if (request.method === "POST" && path[3] === "start") {
            const data = await request.json() as any;
            await this.startGame(data.rows, data.cols, data.mines, data.firstR, data.firstC);
            return new Response(JSON.stringify({ success: true }));
        }

        if (request.method === "POST" && path[3] === "click") {
            const data = await request.json() as any;
            const result = await this.handleClick(data.r, data.c);
            return new Response(JSON.stringify(result));
        }

        return new Response("Not found", { status: 404 });
    }

    async startGame(rows: number, cols: number, mines: number, exR: number, exC: number) {
        const board = [];
        const minesLocations = new Set<string>();
        let count = 0;

        for (let r = 0; r < rows; r++) {
            board[r] = [];
            for (let c = 0; c < cols; c++) {
                board[r][c] = { r, c, mine: false, revealed: false, flagged: false, neighborMines: 0 };
            }
        }

        while (count < mines) {
            let r = Math.floor(Math.random() * rows);
            let c = Math.floor(Math.random() * cols);
            if ((r === exR && c === exC) || minesLocations.has(`${r},${c}`)) continue;
            
            minesLocations.add(`${r},${c}`);
            board[r][c].mine = true;
            count++;
        }

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!board[r][c].mine) {
                    let n = 0;
                    for (let dr = -1; dr <= 1; dr++) {
                        for (let dc = -1; dc <= 1; dc++) {
                            let nr = r + dr, nc = c + dc;
                            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc].mine) n++;
                        }
                    }
                    board[r][c].neighborMines = n;
                }
            }
        }

        await this.state.storage.put("gameState", {
            board,
            rows,
            cols,
            mines,
            revealedCount: 0,
            startTime: Date.now(),
            status: 'playing'
        });
    }

    async handleClick(r: number, c: number) {
        const state: any = await this.state.storage.get("gameState");
        if (!state || state.status !== 'playing') return { error: "Game not active" };

        if (state.board[r][c].mine) {
            state.status = 'lost';
            await this.state.storage.put("gameState", state);
            return { status: 'lost', hitR: r, hitC: c, board: state.board };
        }

        const revealedCells = [];
        const stack = [[r, c]];

        while (stack.length > 0) {
            const [cr, cc] = stack.pop()!;
            if (cr < 0 || cr >= state.rows || cc < 0 || cc >= state.cols) continue;
            
            const cell = state.board[cr][cc];
            if (cell.revealed || cell.flagged) continue;

            cell.revealed = true;
            state.revealedCount++;
            revealedCells.push(cell);

            if (cell.neighborMines === 0) {
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) continue;
                        stack.push([cr + dr, cc + dc]);
                    }
                }
            }
        }

        if (state.revealedCount === (state.rows * state.cols) - state.mines) {
            state.status = 'won';
            const timeMs = Date.now() - state.startTime;
            await this.state.storage.put("gameState", state);
            return { status: 'won', timeMs, revealedCells };
        }

        await this.state.storage.put("gameState", state);
        return { status: 'playing', revealedCells };
    }
}

export default {
    async fetch(request: Request, env: Env) {
        const url = new URL(request.url);

        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Expose-Headers": "X-Game-Session"
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        if (url.pathname.startsWith("/api/chat/")) {
            const roomName = url.pathname.split("/")[3];
            const id = env.CHAT_ROOM.idFromName(roomName);
            const obj = env.CHAT_ROOM.get(id);
            return obj.fetch(request);
        }

        if (url.pathname.startsWith("/api/game/")) {
            const sessionId = request.headers.get("X-Game-Session") || env.GAME_SESSION.newUniqueId().toString();
            const id = typeof sessionId === "string" ? env.GAME_SESSION.idFromString(sessionId) : sessionId;
            const obj = env.GAME_SESSION.get(id);
            
            const response = await obj.fetch(request);
            const newResponse = new Response(response.body, response);
            newResponse.headers.set("X-Game-Session", id.toString());
            Object.entries(corsHeaders).forEach(([k, v]) => newResponse.headers.set(k, v));
            return newResponse;
        }

        if (url.pathname === "/api/ranking" && request.method === "POST") {
            const data = await request.json() as any;
            await env.DB.prepare(
                "INSERT INTO rankings (player_name, room_name, difficulty, time_ms) VALUES (?, ?, ?, ?)"
            ).bind(data.playerName, data.roomName, data.difficulty, data.timeMs).run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }

        if (url.pathname === "/api/ranking" && request.method === "GET") {
            const difficulty = url.searchParams.get("diff") || "beginner";
            const { results } = await env.DB.prepare(
                "SELECT player_name, time_ms FROM rankings WHERE difficulty = ? ORDER BY time_ms ASC LIMIT 10"
            ).bind(difficulty).all();
            return new Response(JSON.stringify(results), { headers: corsHeaders });
        }

        return new Response("Not found", { status: 404, headers: corsHeaders });
    }
};