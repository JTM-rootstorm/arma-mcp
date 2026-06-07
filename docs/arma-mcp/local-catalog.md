# ArmaMCP Local Catalog Cache

ArmaMCP stores loaded Arma catalog data in a local SQLite cache so MCP tools can search classes, enrich Eden objects, and queue later measurement or screenshot work without rescanning every request.

The default cache path is:

```text
.mcp-cache/arma/catalog.sqlite
```

Generated cache files are local artifacts and must not be committed:

```text
.mcp-cache/
*.sqlite
*.sqlite-wal
*.sqlite-shm
```

Future screenshot capture output should use:

```text
.mcp-cache/arma/screenshots/
```

The cache may contain class names, loaded addon metadata, generated tags, measurements, and screenshot file paths. It must not contain MCP bearer tokens, private keys, Steam credentials, mission secrets, or any other durable secret material.

Useful inspection commands:

```bash
sqlite3 .mcp-cache/arma/catalog.sqlite ".tables"
sqlite3 .mcp-cache/arma/catalog.sqlite "SELECT COUNT(*) FROM classes;"
sqlite3 .mcp-cache/arma/catalog.sqlite "SELECT class_name, display_name FROM classes_fts WHERE classes_fts MATCH 'terminal' LIMIT 10;"
```
