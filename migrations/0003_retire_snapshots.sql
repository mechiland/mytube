CREATE TABLE retired_member (
  playlist TEXT NOT NULL,
  generation INTEGER NOT NULL,
  PRIMARY KEY(playlist,generation)
) WITHOUT ROWID;

CREATE TRIGGER member_retire_update AFTER UPDATE OF active,generation ON job
WHEN OLD.kind='playlist' BEGIN
  INSERT OR IGNORE INTO retired_member
    SELECT OLD.id,OLD.active WHERE OLD.active>0 AND OLD.active<>NEW.active;
  INSERT OR IGNORE INTO retired_member
    SELECT OLD.id,OLD.generation WHERE OLD.generation<>NEW.generation AND OLD.generation<>NEW.active;
END;
CREATE TRIGGER member_retire_delete AFTER DELETE ON job
WHEN OLD.kind='playlist' BEGIN
  INSERT OR IGNORE INTO retired_member VALUES(OLD.id,OLD.generation);
  INSERT OR IGNORE INTO retired_member SELECT OLD.id,OLD.active WHERE OLD.active>0;
END;
CREATE INDEX playlist_age ON job(full) WHERE kind='playlist' AND active>0;
