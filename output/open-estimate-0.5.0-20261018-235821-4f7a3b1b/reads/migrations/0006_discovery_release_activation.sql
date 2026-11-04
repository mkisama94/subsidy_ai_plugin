1: -- Only releases that won the atomic pointer update are eligible for details/rollback.
2: CREATE TABLE discovery_release_activations (
3:   release_id TEXT PRIMARY KEY REFERENCES discovery_releases(id),
4:   activated_at INTEGER NOT NULL
5: );
6: INSERT INTO discovery_release_activations(release_id,activated_at)
7: SELECT r.id,r.created_at FROM discovery_active_release a JOIN discovery_releases r ON r.id=a.release_id;