import { createHash, randomBytes } from 'node:crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const challengeSchema = z.object({
  stellarAddress: z.string().trim().min(1),
});

const verifySchema = z.object({
  stellarAddress: z.string().trim().min(1),
  message: z.string().min(1),
  signature: z.string().min(1),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/v1/auth/challenge', async (request, reply) => {
    const parsed = challengeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        details: parsed.error.flatten(),
      });
    }

    const address = parsed.data.stellarAddress;
    if (!StrKey.isValidEd25519PublicKey(address)) {
      return reply.code(400).send({ error: 'invalid_stellar_address' });
    }

    const issuedAt = new Date().toISOString();
    const expiresAt = Date.now() + app.config.AUTH_CHALLENGE_TTL_SECONDS * 1_000;
    const message = [
      'LockA Medical Passport authentication',
      `Address: ${address}`,
      `Nonce: ${randomBytes(16).toString('hex')}`,
      `Issued At: ${issuedAt}`,
      `Network: ${app.config.STELLAR_NETWORK_PASSPHRASE}`,
    ].join('\n');

    app.services.challenges.issue({
      stellarAddress: address,
      message,
      expiresAt,
    });

    return {
      address,
      message,
      network: app.config.STELLAR_NETWORK,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  });

  app.post('/v1/auth/verify', async (request, reply) => {
    const parsed = verifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        details: parsed.error.flatten(),
      });
    }

    const { stellarAddress, message, signature } = parsed.data;
    if (!StrKey.isValidEd25519PublicKey(stellarAddress)) {
      return reply.code(400).send({ error: 'invalid_stellar_address' });
    }

    const challenge = app.services.challenges.get(stellarAddress);
    if (!challenge || challenge.message !== message) {
      return reply.code(401).send({ error: 'challenge_expired' });
    }

    const signatureBytes = Buffer.from(signature, 'base64');
    if (signatureBytes.length !== 64) {
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    const payload = Buffer.from(
      `Stellar Signed Message:\n${challenge.message}`,
      'utf8',
    );
    const digest = createHash('sha256').update(payload).digest();
    const valid = Keypair.fromPublicKey(stellarAddress).verify(
      digest,
      signatureBytes,
    );

    if (!valid) {
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    app.services.challenges.remove(stellarAddress);
    await app.services.audit.record({
      actorAddress: stellarAddress,
      action: 'auth.login',
      resourceType: 'account',
      resourceId: stellarAddress,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    const token = app.jwt.sign(
      { sub: stellarAddress, role: 'patient' },
      { expiresIn: app.config.ACCESS_TOKEN_TTL_SECONDS },
    );

    return {
      token,
      tokenType: 'Bearer',
      expiresIn: app.config.ACCESS_TOKEN_TTL_SECONDS,
      address: stellarAddress,
    };
  });

  app.get(
    '/v1/auth/me',
    { preHandler: [app.authenticate] },
    async (request) => ({ user: request.user }),
  );
};
