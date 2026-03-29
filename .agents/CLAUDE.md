<!-- DO NOT MODIFY - this file is auto-synced from skill directory -->

# Agent Centric Framework

This project uses the Agent Centric framework for AI-assisted development.

## Directory Structure

```
.agents/
├── decisions/              # AGD (Decision) files
├── scripts/
│   ├── utils.py            # Shared utilities
│   ├── validate-agds.py    # Validation script
│   └── generate-index.py   # Index generation script
├── config.json             # Configuration (tags, settings)
├── INDEX-TAGS.md           # Auto-generated tag index
├── INDEX-AGD-RELATIONS.md  # Auto-generated AGD relationships
└── CLAUDE.md               # This file
```

## AGD (Decision) Framework

AGD (Agent-centric Governance Decision) is a decision record mechanism, similar to ADR or RFC. Each AGD has a unique number (e.g., AGD-001) that records important decisions, rationale, and impact.

AGD covers **any important decision**, not just architecture - including design patterns, conventions, tool choices, process decisions, etc.

Decisions can be **updated** (extended) or **obsoleted** (replaced) by later decisions, but original files are preserved, forming a complete decision history for future reference.

### When to Create an AGD

Create an AGD file when:

- Making an important decision
- Choosing between multiple valid approaches
- Establishing a pattern or convention
- Making a decision that affects multiple components
- Overriding or updating a previous decision

### Creating AGD Files

**ALWAYS use the Write tool** to create AGD files. This ensures:
1. PreToolUse hook validates tags before creation
2. Invalid AGD creation is blocked automatically

Before creating an AGD:
1. Read `.agents/config.json` to check available tags
2. If you need a new tag, add it to config.json first
3. Then create the AGD file using Write tool

### AGD File Format

**Filename**: `AGD-{number}_{kebab-case-name}.md`

**Content**:

```yaml
---
title: "Decision Title"
description: "Brief description"
tags: tag1, tag2
updates: AGD-XXX, AGD-XXXX         # decisions this one updates (optional)
obsoletes: AGD-XXX, AGD-XXXX       # decisions this one obsoletes (optional)
---

## Context
Why this decision is needed.

## Decision
What was decided.

## Consequences
Impact of this decision.
```

**Note:** The `obsoleted_by` and `updated_by` fields are automatically managed by `generate-index.py`. When you specify `updates: AGD-001` or `obsoletes: AGD-001` in your new AGD, the system will automatically add the reverse reference to AGD-001's frontmatter.

### Relationship Semantics

- **updates**: Extends or modifies the original decision. Original is still partially valid.
- **obsoletes**: Completely replaces the original. Original decision is no longer valid.

### Searching Decisions

**IMPORTANT**: Use `grep` and `find` to search. Do NOT read files to search.

```bash
# Search by keyword
grep -r "keyword" .agents/decisions/

# Search by AGD number
find .agents/decisions/ -name "AGD-001*"

# Search by tag
grep "#tagname" .agents/INDEX-TAGS.md

# Find AGD relationships
grep "AGD-001" .agents/INDEX-AGD-RELATIONS.md
```

### Referencing Decisions in Code

When implementing a decision, reference the AGD number:

```python
# Implementation follows AGD-001
```

```typescript
// See AGD-002 for architecture rationale
```

## Tags

Tags represent system scopes (modules, components). Define them in `config.json`:

```json
{
  "tags": ["core", "auth", "api", "database"]
}
```

## Index Files

Index files are auto-generated. Search them with `grep`, do not read entirely.

- `INDEX-TAGS.md`: `decisions/AGD-001_name.md: #tag1, #tag2`
- `INDEX-AGD-RELATIONS.md`:
  - `decisions/AGD-005_new.md -(o)-> decisions/AGD-001_old.md` (obsoletes)
  - `decisions/AGD-003_update.md -(u)-> decisions/AGD-001_original.md` (updates)

<!-- USER CONTENT BELOW - Your customizations will be preserved during sync -->
