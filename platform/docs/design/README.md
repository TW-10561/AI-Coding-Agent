# 30_設計（Design Documents）

**Project:** Thirdwave AI Coding Platform  
**Version:** 1.0  
**Date:** 2026-03-26

---

## ドキュメント一覧（Document Index）

| No. | Document | Description |
|-----|----------|-------------|
| 30_01 | [システム構成図 (System Configuration Diagram)](./30_01_システム構成図.md) | Full system architecture, component topology, port map, technology stack, deployment options |
| 30_02 | [画面一覧 (Screen List)](./30_02_画面一覧.md) | All screens in TUI (85 screens), VS Code Extension (45 screens), and Web Dashboard — with screen IDs, names, triggers, and layout wireframes |
| 30_03 | [遷移図 (Screen Transition Diagram)](./30_03_遷移図.md) | State machines and navigation flows for TUI, VS Code Extension, request pipeline, HITL decision flow, and error transitions |
| 30_04 | [個別コンポーネント設計 (Individual Component Design)](./30_04_個別コンポーネント設計.md) | Detailed component diagrams: RAG/Skill system, Database schema (ERD + DDL), HITL architecture, Agentic tool loop, Parallel execution, Provider registry, Middleware stack, TUI input handling |
| 30_05 | [調査記録 (Investigation Record)](./30_05_調査記録.md) | Design decisions, technical investigations, rationale, performance analysis, known limitations, future enhancements, and design change log |

---

## システム概要（System Summary）

```
Thirdwave AI Coding Platform
────────────────────────────
Type:       Self-hosted local AI coding assistant
Runtime:    Bun 1.3+ / TypeScript 5.x
Framework:  Hono 4.x (backend)
AI Engine:  OpenCode 1.2.17 (wrapper)
AI Model:   Qwen3-Coder-30B-A3B (vLLM) + 9 cloud providers
Database:   SQLite WAL mode
Clients:    TUI (terminal) + VS Code Extension + REST API
Security:   HITL guards + RBAC + rate limiting + audit logging
Skills:     31 domain knowledge packages (RAG injection)
```

---

## アーキテクチャ概要図（Quick Architecture Diagram）

```
  [TUI / VS Code Extension]
           │
           ▼ HTTP/REST + SSE
  [nginx :80] → [Platform API :3100]
                      │
           ┌──────────┴──────────┐
           ▼                     ▼
  [OpenCode :4096]     [SQLite databases]
           │           audit / budget /
           ▼           tasks / workspaces
  [vLLM :8000] or
  [AI Gateway :9080]
```
