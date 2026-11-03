import { LIMITS, screenText, VERIFICATION_POSES } from '@touchgrass/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { uuidv7 } from 'uuidv7';
import type { ObjectStorage } from '../adapters/storage/storage.port.js';
import type { Tx } from '../infra/database/database.module.js';
import {
  conversations,
  mediaAssets,
  messages,
  moderationItems,
  profiles,
  trustedContacts,
  userSanctions,
  users,
  verifications,
} from '../infra/database/schema/index.js';
import { directKey, uuidV7At, uuidV7Time } from '../modules/chat/chat.policy.js';
import { renderVariant } from '../modules/media/media.processor.js';

export interface SafetySeedSummary {
  trustedContacts: number;
  pendingVerifications: number;
  heldItems: number;
  sanctions: number;
}

const HELD_BIO = 'Weekend trekker. Zero patience for haramis who cancel last minute.';
const HELD_MESSAGE = 'bro you are such a chutiya for missing it';

/** A plain generated portrait-ish image, stored with the same variants a real upload gets. */
async function generatedImage(
  tx: Tx,
  storage: ObjectStorage,
  ownerUserId: string,
  colour: string,
  now: Date,
): Promise<string> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="100%" height="100%" fill="${colour}"/><circle cx="450" cy="460" r="220" fill="#ffffff" fill-opacity="0.35"/><rect x="230" y="760" width="440" height="440" rx="200" fill="#ffffff" fill-opacity="0.25"/></svg>`,
  );
  const image = await sharp(svg).jpeg().toBuffer();
  const id = uuidv7();
  const [sm, md, lg] = await Promise.all(LIMITS.imageSizes.map((s) => renderVariant(image, s)));
  if (!sm || !md || !lg) throw new Error('Seed image rendering failed');
  const keys = { sm: `media/${id}/sm.webp`, md: `media/${id}/md.webp`, lg: `media/${id}/lg.webp` };
  await Promise.all([
    storage.put(keys.sm, sm.buffer, 'image/webp'),
    storage.put(keys.md, md.buffer, 'image/webp'),
    storage.put(keys.lg, lg.buffer, 'image/webp'),
  ]);
  await tx.insert(mediaAssets).values({
    id,
    ownerUserId,
    purpose: 'verification_selfie',
    originalKey: `generated/${id}`,
    contentType: 'image/webp',
    declaredBytes: lg.buffer.length,
    status: 'ready',
    width: lg.width,
    height: lg.height,
    variantKeys: keys,
    moderationLabels: [],
    processedAt: now,
  });
  return id;
}

/**
 * Phase 9 seed (idempotent; re-running refills what reviewers cleared): member #2 has two trusted contacts; members #4 and #5 have selfies waiting in the
 * verification queue; member #8's bio and a message from member #7 are held by the text filter; member #10 has
 * an old warning on record.
 */
export async function seedSafety(
  tx: Tx,
  ctx: { memberIds: string[]; adminId: string; storage?: ObjectStorage },
  now: Date = new Date(),
): Promise<SafetySeedSummary> {
  const m = (n: number): string => {
    const id = ctx.memberIds[n - 1];
    if (!id) throw new Error(`Seed member #${String(n)} missing`);
    return id;
  };

  // ---------- trusted contacts ----------
  await tx
    .insert(trustedContacts)
    .values([
      { id: uuidv7(), userId: m(2), name: 'Amma', phoneE164: '+919876500002' },
      { id: uuidv7(), userId: m(2), name: 'Kiran (flatmate)', phoneE164: '+919876500003' },
    ])
    .onConflictDoNothing();

  // ---------- verification queue ----------
  if (ctx.storage) {
    for (const [k, n] of [4, 5].entries()) {
      const userId = m(n);
      // Re-seeding refills the queue for anyone still unverified with nothing waiting (reviews in e2e runs).
      const [user] = await tx
        .select({ verifiedAt: users.verifiedAt })
        .from(users)
        .where(eq(users.id, userId));
      const [open] = await tx
        .select({ id: verifications.id })
        .from(verifications)
        .where(
          and(
            eq(verifications.userId, userId),
            inArray(verifications.status, ['challenged', 'pending']),
          ),
        )
        .limit(1);
      if (!user || user.verifiedAt || open) continue;
      const mediaId = await generatedImage(
        tx,
        ctx.storage,
        userId,
        k === 0 ? '#1A5FD0' : '#E8710A',
        now,
      );
      await tx.insert(verifications).values({
        id: uuidv7(),
        userId,
        pose: VERIFICATION_POSES[k] ?? 'thumbs_up',
        status: 'pending',
        expiresAt: new Date(now.getTime() + LIMITS.verification.challengeTtlMs),
        mediaAssetId: mediaId,
        faceSimilarity: k === 0 ? 91.5 : null,
        submittedAt: new Date(now.getTime() - (k + 1) * 3_600_000),
      });
    }
  }

  // ---------- content held by the text filter ----------
  const bio = screenText(HELD_BIO);
  const [bioItem] = await tx
    .select({ id: moderationItems.id })
    .from(moderationItems)
    .where(
      and(
        eq(moderationItems.targetType, 'user'),
        eq(moderationItems.targetId, m(8)),
        eq(moderationItems.source, 'auto_text'),
        eq(moderationItems.status, 'open'),
      ),
    )
    .limit(1);
  if (!bioItem) {
    await tx
      .update(profiles)
      .set({ bio: HELD_BIO, bioHeldAt: now })
      .where(eq(profiles.userId, m(8)));
    await tx.insert(moderationItems).values({
      id: uuidv7(),
      targetType: 'user',
      targetId: m(8),
      source: 'auto_text',
      severity: bio.severity ?? 'medium',
      details: { matches: bio.matches },
    });
  }

  const [dm] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.directKey, directKey(m(7), m(8))))
    .limit(1);
  if (dm) {
    const [already] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.conversationId, dm.id), eq(messages.body, HELD_MESSAGE)))
      .limit(1);
    if (!already) {
      const at = new Date(now.getTime() - 20 * 60_000);
      await tx.execute(sql`SELECT ensure_monthly_partition_for('messages', ${at})`);
      const id = uuidV7At(at);
      // Held: the conversation's last message stays as it was, so only the sender sees this one.
      await tx.insert(messages).values({
        id,
        conversationId: dm.id,
        senderId: m(7),
        kind: 'text',
        body: HELD_MESSAGE,
        clientId: `seed-held-${dm.id}`,
        heldAt: at,
        createdAt: uuidV7Time(id),
      });
      const msg = screenText(HELD_MESSAGE);
      await tx
        .insert(moderationItems)
        .values({
          id: uuidv7(),
          targetType: 'message',
          targetId: id,
          source: 'auto_text',
          severity: msg.severity ?? 'medium',
          details: { matches: msg.matches },
        })
        .onConflictDoNothing();
    }
  }

  // ---------- a past warning ----------
  const [warned] = await tx
    .select({ id: userSanctions.id })
    .from(userSanctions)
    .where(eq(userSanctions.userId, m(10)))
    .limit(1);
  if (!warned)
    await tx.insert(userSanctions).values({
      id: uuidv7(),
      userId: m(10),
      kind: 'warn',
      reason: 'Two late cancellations on small-group plans in one week',
      createdByUserId: ctx.adminId,
    });

  const count = async (q: ReturnType<typeof sql>): Promise<number> =>
    (await tx.execute<{ n: number }>(q)).rows[0]?.n ?? 0;
  return {
    trustedContacts: await count(sql`SELECT count(*)::int AS n FROM trusted_contacts`),
    pendingVerifications: await count(
      sql`SELECT count(*)::int AS n FROM verifications WHERE status = 'pending'`,
    ),
    heldItems: await count(
      sql`SELECT count(*)::int AS n FROM moderation_items WHERE source = 'auto_text' AND status = 'open'`,
    ),
    sanctions: await count(sql`SELECT count(*)::int AS n FROM user_sanctions`),
  };
}
