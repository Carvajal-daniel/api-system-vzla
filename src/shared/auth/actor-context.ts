export type ActorRole = "OWNER" | "COLLABORATOR";

export interface OwnerActorContext {
  readonly role: "OWNER";
  readonly userId: string;
  readonly companyId: string;
}

export interface CollaboratorActorContext {
  readonly role: "COLLABORATOR";
  readonly collaboratorId: string;
  readonly companyId: string;
}

export type ActorContext = OwnerActorContext | CollaboratorActorContext;
