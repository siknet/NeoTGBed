CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    file_type TEXT DEFAULT 'image',
    storage_type TEXT DEFAULT 'telegram',
    folder_path TEXT DEFAULT '',
    list_type TEXT DEFAULT 'None',
    label TEXT DEFAULT 'None',
    liked INTEGER DEFAULT 0,
    timestamp INTEGER NOT NULL,
    metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_files_timestamp ON files(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_files_storage ON files(storage_type);
CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_path);
CREATE INDEX IF NOT EXISTS idx_files_type ON files(file_type);
CREATE TABLE IF NOT EXISTS share_slugs (
    slug TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
