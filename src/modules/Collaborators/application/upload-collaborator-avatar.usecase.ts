import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CollaboratorsRepository } from "../domain/repository/collaborators.repository.interface.js";
import { CollaboratorNotFoundError } from "./errors/collaborator-errors.js";

export class InvalidAvatarFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAvatarFileError";
  }
}

export interface UploadCollaboratorAvatarInput {
  collaboratorId: string;
  companyId: string;
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export class UploadCollaboratorAvatarUseCase {
  constructor(private readonly collaboratorsRepository: CollaboratorsRepository) {}

  async execute(input: UploadCollaboratorAvatarInput): Promise<{ avatarUrl: string }> {
    if (!ALLOWED_MIME_TYPES.has(input.mimetype)) {
      throw new InvalidAvatarFileError(
        "Formato de imagem inválido. São permitidos apenas arquivos JPEG, PNG ou WEBP.",
      );
    }

    if (input.buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new InvalidAvatarFileError("A imagem do avatar não pode exceder o limite de 5MB.");
    }

    const collaborator = await this.collaboratorsRepository.findById(
      input.collaboratorId,
      input.companyId,
    );

    if (!collaborator) {
      throw new CollaboratorNotFoundError();
    }

    // Diretório de armazenamento de uploads
    const uploadsDir = join(process.cwd(), "uploads", "avatars");
    await mkdir(uploadsDir, { recursive: true });

    const extension = extname(input.filename) || (input.mimetype === "image/png" ? ".png" : input.mimetype === "image/webp" ? ".webp" : ".jpg");
    const uniqueFileName = `${collaborator.id}-${randomUUID()}${extension}`;
    const filePath = join(uploadsDir, uniqueFileName);

    await writeFile(filePath, input.buffer);

    const publicAvatarUrl = `/uploads/avatars/${uniqueFileName}`;
    collaborator.updateProfile({ avatarUrl: publicAvatarUrl });
    await this.collaboratorsRepository.update(collaborator);

    return { avatarUrl: publicAvatarUrl };
  }
}
