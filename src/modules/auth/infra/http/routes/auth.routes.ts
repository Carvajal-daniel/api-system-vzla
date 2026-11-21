import type { FastifyInstance } from "fastify";
import { authenticate } from "../../../../../shared/http/auth/authenticate.js";
import {
  makeAuthController,
  type AuthControllerDependencies,
} from "../factories/make-auth-controller.js";
import {
  getMeOpenApiSchema,
  loginOpenApiSchema,
  registerOwnerOpenApiSchema,
} from "../schemas/auth-http.schemas.js";

export async function authRoutes(
  app: FastifyInstance,
  options: AuthControllerDependencies = {},
): Promise<void> {
  const authController = makeAuthController(options);

  app.post(
    "/auth/register",
    {
      schema: registerOwnerOpenApiSchema,
    },
    authController.register.bind(authController),
  );

  app.post(
    "/auth/login",
    {
      schema: loginOpenApiSchema,
    },
    authController.login.bind(authController),
  );

  app.get(
    "/me",
    {
      preHandler: [authenticate],
      schema: getMeOpenApiSchema,
    },
    authController.me.bind(authController),
  );

  app.patch(
    "/me/profile",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Authentication"],
        summary: "Update authenticated user's profile (name, companyName for owner, and avatarUrl)",
        security: [{ bearerAuth: [] }],
      },
    },
    authController.updateProfile.bind(authController),
  );

  app.patch(
    "/me/password",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Authentication"],
        summary: "Change authenticated user's password after verifying current password",
        security: [{ bearerAuth: [] }],
      },
    },
    authController.updatePassword.bind(authController),
  );
}
