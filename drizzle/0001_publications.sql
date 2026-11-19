CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES profiles(id),
  day_json TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('all','selected','private')),
  content_version INTEGER NOT NULL DEFAULT 1,
  access_version INTEGER NOT NULL DEFAULT 1,
  content_marker TEXT NOT NULL,
  access_marker TEXT NOT NULL,
  published_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX publications_owner ON publications(owner_id, published_at DESC);
--> statement-breakpoint
CREATE INDEX publications_recent ON publications(published_at DESC);
--> statement-breakpoint

CREATE TABLE recipients (
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  PRIMARY KEY(publication_id,user_id)
);
--> statement-breakpoint
CREATE INDEX recipients_user ON recipients(user_id,publication_id);
--> statement-breakpoint

-- Never reuse a deleted network ID, including after a delayed first PUT.
CREATE TABLE deleted_publications (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL);
--> statement-breakpoint

CREATE TABLE publication_media (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES profiles(id),
  object_key TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('photo','audio')),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  publication_id TEXT REFERENCES publications(id),
  state TEXT NOT NULL CHECK (state IN ('staged','active','garbage')),
  created_at INTEGER NOT NULL,
  CHECK ((state='active')=(publication_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX media_publication ON publication_media(publication_id);
--> statement-breakpoint
CREATE INDEX media_cleanup ON publication_media(state,created_at);
--> statement-breakpoint
-- Covers a crash between the R2 write and D1 attachment, and competing uploads.
CREATE TABLE pending_media_objects (object_key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX pending_media_expiry ON pending_media_objects(expires_at);
--> statement-breakpoint

CREATE TABLE publication_operations (
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  PRIMARY KEY(publication_id,actor_id,scope,operation_id)
);
--> statement-breakpoint

CREATE TABLE publication_comments (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  text TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX comments_thread ON publication_comments(publication_id,created_at);
--> statement-breakpoint
CREATE INDEX comments_user ON publication_comments(user_id,created_at);
--> statement-breakpoint

CREATE TABLE publication_reactions (
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  kind TEXT NOT NULL CHECK (kind IN ('close','warm','surprise')),
  PRIMARY KEY(publication_id,user_id)
);
--> statement-breakpoint
CREATE INDEX reactions_user ON publication_reactions(user_id);
