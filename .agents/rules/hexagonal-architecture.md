---
trigger: model_decision
description: "Use for design review. Apply Hexagonal-specific guidance only when Hexagonal Architecture is explicitly selected or identified, or when the affected hybrid area meets the compatibility evidence in development-partner.md. The remaining design principles are optional and architecture-independent."
---

# Architecture and Design Principles

The Hexagonal-specific guidance in section 1 applies only when Hexagonal Architecture is explicitly selected or identified, or when the affected hybrid area meets the evidence criteria in `development-partner.md`. Do not infer it from a language, framework, folder name, or design label alone. For other architectures, follow their observed structure and use only the optional architecture-independent guidance below when it fits.

## 1. Hexagonal Architecture (Ports and Adapters)

Hexagonal Architecture separates application and business capabilities from external technologies so that the system can interact with external actors through explicit boundaries.

- Keep business policy independent of delivery mechanisms, persistence, frameworks, and external services.
- Keep application operations responsible for coordinating a system capability and invoking business behavior.
- Keep adapters responsible for translating between the system's capabilities or needs and external protocols, technologies, and actors.
- Define ports for meaningful boundaries: an inbound port may expose an application capability, while an outbound port may describe an external capability the application needs.
- Let adapters implement or invoke the relevant ports. Keep technology-specific details out of inner policies and contracts.
- Dependencies in source code point toward application needs and business policy. Runtime calls may cross an adapter boundary to reach an external system.
- Keep dependency composition explicit. Constructor injection is one option; use the composition approach suitable to the language and project.
- Introduce a port only when it clarifies a real boundary, isolates an external dependency, or supports a meaningful change or testability need.

Names and physical structures vary. Use the names and boundaries established by the project; do not add Hexagonal components to another architecture solely because they appear here.

## Architecture-Independent Design Principles

The following principles are optional guidance for any architecture. They do not define or imply Hexagonal Architecture, and should be used only when they help with the task.

## 2. Domain Modeling: DDD as an Option

Domain-Driven Design is an approach for handling complex business domains. It is optional in any architecture and should be used only when it helps express or manage the problem.

When DDD is useful:

- Use the language of domain experts and the product consistently in the model and code.
- Use strategic concepts, such as bounded contexts and explicit context relationships, when they help clarify ownership, vocabulary, or integration boundaries.
- Use tactical concepts, such as entities, value objects, aggregates, domain services, and domain events, only when they represent meaningful domain concepts or rules.
- Place invariants with the model responsible for protecting them.
- Define an aggregate around a consistency boundary and the invariants it must enforce; do not create one for every entity, table, or module.
- Keep application workflow and coordination distinct from domain decisions.
- Use domain events when a meaningful business fact must be communicated; do not introduce events solely to decouple code mechanically.

Do not force DDD terminology or artifacts onto a domain that is adequately represented with a simpler model.

## 3. SOLID as Practical Guidance

Apply SOLID principles when they improve cohesion, changeability, substitutability, or dependency direction. They do not require classes, interfaces, or abstractions in languages or situations where those constructs add no value.

- **Single Responsibility:** keep a unit focused on one coherent responsibility. Separate it when unrelated reasons for change make it harder to understand or safely modify.
- **Open/Closed:** use composition, extension points, or polymorphism when new variations are expected and avoiding repeated risky edits is useful. Do not prohibit ordinary modification of straightforward code.
- **Liskov Substitution:** implementations of a contract must preserve its behavioral expectations. Avoid inheritance or substitution when the relationship is not genuine.
- **Interface Segregation:** keep contracts focused on their actual consumers. Do not create an interface for every class or function.
- **Dependency Inversion:** keep high-level policy independent of low-level details at meaningful boundaries. Use a language-appropriate mechanism; do not add an abstraction solely to invert a dependency that is stable and local.

## 4. Clean Code and Maintainability

Prefer code that communicates intent and remains straightforward to change.

- Use names that convey purpose and domain meaning. Avoid vague names, misleading names, and abbreviations that obscure intent.
- Make control flow and side effects visible. Prefer direct, understandable code over cleverness or compressed expressions that hide behavior.
- Keep a unit cohesive around one purpose. Split it when doing so clarifies responsibility, reuse, or change; do not split merely to satisfy a size target.
- Remove duplication when it represents the same knowledge or rule. Similar-looking code with meaningfully different behavior need not be forced into a shared abstraction.
- Keep error handling explicit and consistent with the responsibility handling the error. Preserve useful context, avoid silently swallowing failures, and do not expose internal details across external boundaries.
- Keep comments focused on intent, constraints, and non-obvious decisions; do not use comments to restate clear code.
- Prefer simple solutions that meet current requirements. Avoid speculative generalization and unnecessary configuration.

Do not impose arbitrary limits for file length, method length, complexity, or test coverage. Use difficulty of understanding, change, and verification as signals.

## 5. Design Patterns and Abstractions

Use a design pattern when it addresses an identified problem or recurring pressure, such as variation, lifecycle management, coordination, or integration with an external system.

- Explain the problem the pattern solves in the current context.
- Prefer a direct solution when it is clearer and adequately changeable.
- Do not add a pattern, layer, interface, class, factory, repository, or indirection just to match a catalog or architecture diagram.
- Avoid speculative flexibility for hypothetical future requirements.
- Reuse an established project pattern when it fits the problem; do not copy it mechanically when the responsibilities differ.

## 6. Separation of Concerns and Testability

- Separate responsibilities when they change for different reasons or belong to different boundaries.
- Keep business decisions independent of external effects where practical.
- Test behavior through meaningful public contracts and observable outcomes. Avoid coupling tests to incidental implementation details.
- Use isolated unit tests where they provide useful feedback; use integration tests when correctness depends on real adapters, persistence, protocols, or configuration.
- Do not introduce test-only abstractions that make production design more complex without a concrete benefit.
- Prefer designs that allow important policy and behavior to be tested without requiring unrelated infrastructure.
