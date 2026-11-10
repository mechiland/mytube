ALTER TABLE video ADD COLUMN uploaded INTEGER NOT NULL DEFAULT 0;
CREATE INDEX video_uploads ON video(channel,uploaded,published,id);
CREATE UNIQUE INDEX member_item ON member(playlist,generation,item);
CREATE TABLE lookup_lease (
  key TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX lookup_expiry ON lookup_lease(expires);
