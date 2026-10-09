-- Only releases that won the atomic pointer update are eligible for details/rollback.
CREATE TABLE discovery_release_activations (
  release_id TEXT PRIMARY KEY REFERENCES discovery_releases(id),
  activated_at INTEGER NOT NULL
);
INSERT INTO discovery_release_activations(release_id,activated_at)
SELECT r.id,r.created_at FROM discovery_active_release a JOIN discovery_releases r ON r.id=a.release_id;
