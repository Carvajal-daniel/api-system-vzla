---
trigger: model_decision
description: "Use when reviewing recurring code patterns or proposing material architectural or project-rule improvements."
---

# Continuous Improvement of Project Rules

## 1. Objective

Identify opportunities to improve consistency, maintainability, security, and architecture based on real implementation patterns. Preserve architectural and business decisions established by the developer.

Do not turn every repeated pattern into a rule or every local imperfection into a refactoring task.

## 2. Triggers

Consider proposing an improvement when analysis reveals:

- Recurring implementation mistakes or meaningful duplicated logic.
- Inconsistent error handling or validation.
- Repeated persistence or integration problems.
- Security weaknesses or architectural boundary violations.
- Patterns that make important behavior difficult to test or maintain.
- An approved technology or project decision that needs consistent implementation guidance.

Consider frequency, impact, and risk. A serious security or architectural issue may merit attention even if it appears once.

## 3. Analysis and Proposal

Before proposing a systematic change:

1. Inspect the affected code and relevant project rules.
2. Determine whether the issue is isolated or repeated and identify its impact.
3. Explain the problem and why the existing approach is insufficient.
4. Propose a specific, incremental change consistent with approved decisions.
5. Identify affected files, modules, risks, and relevant alternatives.

If the improvement is outside the current task, report it as a recommendation. Do not refactor unrelated code automatically.

## 4. Approval

Do not modify, remove, or replace project rules before presenting the proposed changes and receiving explicit approval of that proposal. A direct request to change a rule identifies the intended outcome, but is not approval of a plan. Follow `development-partner.md`; do not ask again when the same concrete rule-change plan and scope have already been approved.

For material architectural changes, explain the impact and alternatives and obtain approval unless that exact change is already approved. Routine implementation choices within approved architecture do not require a new proposal unless they change its boundaries or commitments.

## 5. Rule Quality and Deprecation

Rules must be specific, actionable, consistent with approved architecture, based on actual requirements, and free from avoidable repetition.

When a rule becomes outdated, explain why and propose its replacement or removal. Never silently remove an architectural instruction.

## 6. Resolving Conflicts

Respect the latest applicable user decision and approved business requirements or domain invariants. If these conflict with a project convention or a material technical choice, explain the impact and ask instead of choosing arbitrarily. Use general design guidance only where it does not conflict with approved project decisions.
