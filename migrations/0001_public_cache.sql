CREATE TABLE source (
  kind TEXT NOT NULL CHECK (kind IN ('channel','playlist')),
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  alias TEXT,
  uploads TEXT NOT NULL,
  expires INTEGER NOT NULL,
  seen INTEGER NOT NULL,
  PRIMARY KEY(kind,id)
) WITHOUT ROWID;
CREATE INDEX source_alias ON source(alias) WHERE alias IS NOT NULL;
CREATE INDEX source_expiry ON source(expires);

CREATE TABLE video (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  published TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  data TEXT NOT NULL,
  expires INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX video_channel ON video(channel,published,id);
CREATE INDEX video_expiry ON video(expires);

CREATE TABLE job (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  due INTEGER NOT NULL,
  token TEXT,
  generation INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 0,
  full INTEGER NOT NULL DEFAULT 0,
  checked INTEGER NOT NULL DEFAULT 0,
  last_manual INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  PRIMARY KEY(kind,id),
  FOREIGN KEY(kind,id) REFERENCES source(kind,id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX job_due ON job(due,lease_until);

CREATE TABLE member (
  playlist TEXT NOT NULL,
  generation INTEGER NOT NULL,
  position INTEGER NOT NULL,
  item TEXT NOT NULL,
  video TEXT,
  PRIMARY KEY(playlist,generation,position)
) WITHOUT ROWID;
CREATE INDEX member_video ON member(playlist,generation,video,position);

CREATE TABLE response_cache (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX response_expiry ON response_cache(expires);

CREATE TABLE budget (
  day TEXT PRIMARY KEY,
  api INTEGER NOT NULL DEFAULT 0,
  sync INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
