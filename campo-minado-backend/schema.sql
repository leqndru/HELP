CREATE TABLE rankings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_name TEXT NOT NULL,
    room_name TEXT,
    difficulty TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rankings_diff_time ON rankings(difficulty, time_ms);
CREATE INDEX idx_rankings_room ON rankings(room_name);