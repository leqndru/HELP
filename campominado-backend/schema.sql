-- contas_db
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
    username TEXT PRIMARY KEY,
    added_by TEXT NOT NULL,
    date_added TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bans (
    username TEXT PRIMARY KEY,
    banned_by TEXT NOT NULL,
    date_banned TEXT NOT NULL
);

INSERT OR IGNORE INTO admins (username, added_by, date_added) VALUES ('Admin', 'System', '');

-- recordes_db
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    date_played TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS active_games (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    start_time INTEGER NOT NULL
);