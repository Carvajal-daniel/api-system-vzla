import jwt, { type SignOptions } from "jsonwebtoken";
import { getJwtExpiresIn, getJwtSecret } from "../../../../shared/config/env.js";
import type {
  AccessTokenPayload,
  SignedAccessToken,
  TokenService,
} from "../../application/ports/token-service.js";

export class JwtTokenService implements TokenService {
  signAccessToken(payload: AccessTokenPayload): SignedAccessToken {
    const expiresIn = getJwtExpiresIn();
    const options: SignOptions = {
      expiresIn: expiresIn as NonNullable<SignOptions["expiresIn"]>,
    };

    const accessToken = jwt.sign(
      {
        sub: payload.sub,
        companyId: payload.companyId,
        role: payload.role,
      },
      getJwtSecret(),
      options,
    );

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn,
    };
  }
}
