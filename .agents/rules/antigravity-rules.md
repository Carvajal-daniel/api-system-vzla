---
trigger: model_decision
description: "Use when creating, scoping, reviewing, or maintaining this project?s Antigravity rules."
---

# Antigravity Rules Organization

## 1. Location and Naming

All Antigravity project rule files must be placed directly inside:

`.agents/rules/`

Use descriptive kebab-case names and the `.md` extension. Antigravity scans immediate `.md` files in this directory; do not nest rule files in subdirectories.

Current rules:

```text
.agents/
  rules/
    antigravity-rules.md
    development-partner.md
    hexagonal-architecture.md
    project-conventions.md
    continuous-improvement.md
    project-initialization.md
    module-implementation.md
```

Avoid duplicated or overlapping rules. Keep universal principles, project-specific conventions, and task workflows distinct.

## 2. Rule Scope and Metadata

Every `.md` file in `.agents/rules/` must start with YAML frontmatter containing a supported `trigger`:

- Use `always_on` only for essential project instructions that must be present in every task.
- Use `glob` with `globs` only when instructions should activate automatically for matching files.
- Use `model_decision` for guidance that the Agent should load when relevant. Give such rules a clear, specific `description`.
- Use `manual` only for rules that should activate through an explicit `@` mention; the Antigravity CLI does not support rule mentions.

Do not use a broad glob or global application merely to make a rule more likely to be selected. For rules in this project, prefer `always_on` for the essential universal and project-specific instructions, and `model_decision` for conditional guidance.

Example of a file-scoped rule:

```yaml
---
trigger: glob
globs: "src/**/*.ts"
description: Instructions for TypeScript files in a specific project area.
---
```

Example of guidance selected by relevance:

```yaml
---
trigger: model_decision
description: Use when reviewing or changing the project's architecture.
---
```

## 3. Before Creating or Changing a Rule

Before creating or changing a rule:

1. Read the existing rules and identify overlap or conflict.
2. Decide whether an existing rule should be updated instead of adding another.
3. Keep the rule specific, actionable, and appropriately scoped.
4. Use examples only when they clarify expected behavior.
5. Keep technology-specific examples in project-specific rules. Universal rules must not depend on a particular stack.

## 4. Project Decisions and Approval

Rules must reflect approved project decisions and must not silently introduce a new architecture, technology, or convention. Follow the approval process in `continuous-improvement.md`: present the proposed rule changes and wait for explicit approval. A direct request to change rules defines the intended outcome, but is not approval of the proposal. Do not ask again when the same concrete rule-change proposal and scope have already been approved.

Do not create rules that conflict with approved decisions.
