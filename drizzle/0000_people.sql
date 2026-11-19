CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE
);
--> statement-breakpoint

CREATE TABLE friend_invites (
  token TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  UNIQUE (token, owner_id)
);
--> statement-breakpoint

CREATE TABLE friend_requests (
  id TEXT PRIMARY KEY NOT NULL,
  token TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  requester_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (owner_id <> requester_id),
  FOREIGN KEY (token, owner_id) REFERENCES friend_invites(token, owner_id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE UNIQUE INDEX friend_request_pair ON friend_requests (
  min(owner_id, requester_id), max(owner_id, requester_id)
);
--> statement-breakpoint
CREATE INDEX friend_requests_by_owner ON friend_requests(owner_id);
--> statement-breakpoint
CREATE INDEX friend_requests_by_requester ON friend_requests(requester_id);
--> statement-breakpoint
CREATE INDEX friend_requests_by_invite ON friend_requests(token);
--> statement-breakpoint

CREATE VIEW active_friend_requests AS
  SELECT r.*
  FROM friend_requests AS r JOIN friend_invites AS i ON i.token = r.token
  WHERE i.expires_at > unixepoch();
--> statement-breakpoint

CREATE TABLE friendships (
  a TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  b TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  inviter_id TEXT NOT NULL,
  accepted_token TEXT NOT NULL UNIQUE,
  accepted_request_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (a, b),
  CHECK (a < b AND inviter_id IN (a, b))
);
--> statement-breakpoint

CREATE INDEX friendships_by_b ON friendships(b);
