-- fixdb-01: Migration timestamp fix for v0.0.7–v0.0.22
-- See upgrade/fixdb-01.md for details.
-- Usage: sqlite3 data/db/bkd.db < upgrade/fixdb-01.sql

DELETE FROM __drizzle_migrations WHERE hash IN (
  '7282f98bc546a6542624aa4c1c4c8f3e3e2dafa26020d31672c8a83e0c95ce4d',
  'fd26b97b4524c44f27a3aeff25149b7070918cc0f9a81abcc97b2cfec1debd6f',
  'fd0c1684a45544a5273e8ea9c5fe245e53c70c4c74664b70bfb8599a25a8f378'
);

INSERT INTO __drizzle_migrations (hash, created_at)
  SELECT '0a5c6fb3156ee85af896d01a20de577c16f25274ad651ebcb0ab1e4bdc913c5b', 1773273600000
  WHERE NOT EXISTS (SELECT 1 FROM __drizzle_migrations
    WHERE hash = '0a5c6fb3156ee85af896d01a20de577c16f25274ad651ebcb0ab1e4bdc913c5b');
