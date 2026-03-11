# fixdb-01

Migration 0009 timestamp bug fix. Affected: v0.0.7–v0.0.22.

迁移 0009 时间戳 bug 修复。影响版本：v0.0.7–v0.0.22。

## Usage / 使用

Only if you manually added `sort_order` or `dedup_key` columns before.

仅当你之前手动添加过 `sort_order` 或 `dedup_key` 列时需要执行。

```bash
sqlite3 data/db/bkd.db < upgrade/fixdb-01.sql
```
