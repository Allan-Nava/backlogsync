# Backlog — demo

A synthetic backlog for the tests. Nothing here describes a real project.

## How to write an item

```
## v9.9.0 — Not a milestone, it is fenced <!-- ms: phase=now -->

- [ ] **DM-99 — Fenced, so never read**: body. <!-- dm: prio=high size=S labels=core -->
```

## v0.1.0 — First light <!-- ms: phase=now -->

- [x] **DM-1 — Shipped with an issue still open**: the issue must be closed.
  <!-- dm: prio=high size=S labels=core ver=0.1.0 -->
- [x] **DM-2 — Shipped, never had an issue**: nothing to do.
  <!-- dm: prio=low size=S labels=docs ver=main -->
- [ ] **DM-3 — Open with no issue**: the sync creates it, with a body that spans
  two lines and an `inline` code span. <!-- dm: prio=med size=M labels=core,docs -->
- [ ] **DM-4 — Open whose issue was closed**: reopened.
  <!-- dm: prio=high size=L labels=core -->

## v0.2.0 — Second light <!-- ms: phase=next -->

Prose between items is not part of any item.

- [ ] **DM-5 — Renamed in the backlog**: the issue title follows.
  <!-- dm: prio=low size=XL labels=docs -->
- [ ] **DM-6 — Moved between milestones**: the issue follows the heading.
  <!-- dm: prio=med size=S labels=core -->
- [ ] **DM-7 — Already right**: nothing to do. <!-- dm: prio=med size=S labels=core -->
