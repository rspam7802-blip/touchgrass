import { and, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Tx } from '../infra/database/database.module.js';
import {
  conversationMembers,
  conversations,
  icebreakerCards,
  type LocalizedJson,
  messages,
  pollOptions,
  polls,
  pollVotes,
} from '../infra/database/schema/index.js';
import { directKey, uuidV7At, uuidV7Time } from '../modules/chat/chat.policy.js';

type Category = 'light' | 'deep' | 'playful' | 'local';

/** The starter icebreaker deck (admins curate it in the dashboard). */
export const ICEBREAKERS: { category: Category; prompt: LocalizedJson }[] = [
  {
    category: 'light',
    prompt: {
      en: 'What is the best thing you ate this week?',
      te: 'ఈ వారం నువ్వు తిన్న బెస్ట్ ఫుడ్ ఏంటి?',
      hi: 'इस हफ्ते तुमने सबसे बढ़िया क्या खाया?',
    },
  },
  {
    category: 'light',
    prompt: {
      en: 'Chai or coffee — and where in Hyderabad?',
      te: 'చాయ్ లేదా కాఫీ — హైదరాబాద్‌లో ఎక్కడ?',
      hi: 'चाय या कॉफ़ी — और हैदराबाद में कहाँ?',
    },
  },
  {
    category: 'light',
    prompt: {
      en: 'What got you out of the house today?',
      te: 'ఈ రోజు నిన్ను ఇంట్లోంచి బయటికి తెచ్చింది ఏంటి?',
      hi: 'आज तुम्हें घर से बाहर क्या लाया?',
    },
  },
  {
    category: 'light',
    prompt: {
      en: 'Which song is stuck in your head right now?',
      te: 'ఇప్పుడు నీ తలలో తిరుగుతున్న పాట ఏది?',
      hi: 'अभी कौन सा गाना दिमाग में अटका है?',
    },
  },
  {
    category: 'light',
    prompt: {
      en: 'What is a small thing that made you happy recently?',
      te: 'ఈ మధ్య నిన్ను ఆనందపరిచిన చిన్న విషయం ఏంటి?',
      hi: 'हाल में किस छोटी सी बात ने तुम्हें खुश किया?',
    },
  },
  {
    category: 'playful',
    prompt: {
      en: 'You have a free day and ₹2,000. What is the plan?',
      te: 'ఒక ఖాళీ రోజు, ₹2,000 ఉన్నాయి. ప్లాన్ ఏంటి?',
      hi: 'एक खाली दिन और ₹2,000 हैं. प्लान क्या है?',
    },
  },
  {
    category: 'playful',
    prompt: {
      en: 'Which fictional character would you want on your squad?',
      te: 'నీ స్క్వాడ్‌లో ఏ కల్పిత పాత్ర కావాలి?',
      hi: 'अपनी स्क्वाड में कौन सा काल्पनिक किरदार चाहोगे?',
    },
  },
  {
    category: 'playful',
    prompt: {
      en: 'Two truths and a lie — go!',
      te: 'రెండు నిజాలు, ఒక అబద్ధం — మొదలుపెట్టు!',
      hi: 'दो सच और एक झूठ — शुरू करो!',
    },
  },
  {
    category: 'playful',
    prompt: {
      en: 'What is your most useless talent?',
      te: 'నీ అత్యంత పనికిరాని టాలెంట్ ఏంటి?',
      hi: 'तुम्हारा सबसे बेकार टैलेंट क्या है?',
    },
  },
  {
    category: 'playful',
    prompt: {
      en: 'If today had a soundtrack, what would play first?',
      te: 'ఈ రోజుకి సౌండ్‌ట్రాక్ ఉంటే, మొదట ఏ పాట?',
      hi: 'अगर आज का साउंडट्रैक होता, तो पहला गाना कौन सा?',
    },
  },
  {
    category: 'local',
    prompt: {
      en: 'Best biryani in the city — defend your pick.',
      te: 'సిటీలో బెస్ట్ బిర్యానీ — నీ ఎంపికను సమర్థించు.',
      hi: 'शहर की सबसे बढ़िया बिरयानी — अपनी पसंद का बचाव करो.',
    },
  },
  {
    category: 'local',
    prompt: {
      en: 'Your favourite sunset spot in Hyderabad?',
      te: 'హైదరాబాద్‌లో నీకు ఇష్టమైన సన్‌సెట్ స్పాట్?',
      hi: 'हैदराबाद में तुम्हारा पसंदीदा सनसेट स्पॉट?',
    },
  },
  {
    category: 'local',
    prompt: {
      en: 'Which neighbourhood would you show a visitor first?',
      te: 'వచ్చిన వాళ్లకి ముందు ఏ ఏరియా చూపిస్తావు?',
      hi: 'किसी मेहमान को पहले कौन सा इलाका दिखाओगे?',
    },
  },
  {
    category: 'local',
    prompt: {
      en: 'Irani chai: Osmania biscuit or bun maska?',
      te: 'ఇరానీ చాయ్‌తో: ఉస్మానియా బిస్కెట్ లేదా బన్ మస్కా?',
      hi: 'ईरानी चाय के साथ: उस्मानिया बिस्कुट या बन मस्का?',
    },
  },
  {
    category: 'local',
    prompt: {
      en: 'What is one Hyderabad thing everyone should try once?',
      te: 'ప్రతి ఒక్కరూ ఒక్కసారైనా ట్రై చేయాల్సిన హైదరాబాద్ విషయం ఏంటి?',
      hi: 'हैदराबाद की कौन सी चीज़ हर किसी को एक बार ज़रूर आज़मानी चाहिए?',
    },
  },
  {
    category: 'deep',
    prompt: {
      en: 'What is something you want to get better at this year?',
      te: 'ఈ సంవత్సరం నువ్వు మెరుగవ్వాలనుకునేది ఏంటి?',
      hi: 'इस साल तुम किस चीज़ में बेहतर होना चाहते हो?',
    },
  },
  {
    category: 'deep',
    prompt: {
      en: 'Who in your life always makes plans happen?',
      te: 'నీ జీవితంలో ఎప్పుడూ ప్లాన్స్ జరిగేలా చేసేది ఎవరు?',
      hi: 'तुम्हारी ज़िंदगी में कौन हमेशा प्लान बनवा देता है?',
    },
  },
  {
    category: 'deep',
    prompt: {
      en: 'What is a place that feels like home to you?',
      te: 'నీకు ఇంటిలా అనిపించే ప్లేస్ ఏది?',
      hi: 'कौन सी जगह तुम्हें घर जैसी लगती है?',
    },
  },
  {
    category: 'deep',
    prompt: {
      en: 'What would you do if you knew you could not fail?',
      te: 'ఓడిపోవని తెలిస్తే నువ్వు ఏం చేస్తావు?',
      hi: 'अगर पता हो कि नाकाम नहीं होगे, तो क्या करोगे?',
    },
  },
  {
    category: 'deep',
    prompt: {
      en: 'What is a hobby you dropped and want back?',
      te: 'వదిలేసి మళ్లీ మొదలుపెట్టాలనుకునే హాబీ ఏది?',
      hi: 'कौन सा शौक छूट गया जिसे वापस चाहते हो?',
    },
  },
];

const SAMPLE_LINES = [
  'Hey! Who else is coming solo?',
  'Me! First time at one of these 😅',
  'Same, see you there',
  'I can bring a frisbee if anyone wants',
  'Running 10 mins late, save me a spot',
  'This was so much fun, same time next week?',
  'Absolutely, count me in',
  'Thanks for hosting 🙌',
];

/** The starter icebreaker deck (reference data, also loaded in production by the bootstrap). Keyed by English prompt. */
export async function seedIcebreakerDeck(tx: Tx): Promise<void> {
  for (const [i, card] of ICEBREAKERS.entries()) {
    const [exists] = await tx
      .select({ id: icebreakerCards.id })
      .from(icebreakerCards)
      .where(sql`${icebreakerCards.prompt}->>'en' = ${card.prompt.en}`)
      .limit(1);
    if (!exists)
      await tx
        .insert(icebreakerCards)
        .values({ id: uuidv7(), prompt: card.prompt, category: card.category, sortOrder: i + 1 });
  }
}

export interface ChatSeedContext {
  memberIds: string[];
  adminId: string;
}
export interface ChatSeedSummary {
  icebreakers: number;
  conversations: number;
  messages: number;
}

/** Seeded rows carry this client-id prefix so counts and re-runs only look at seed data. */
const SEED_PREFIX = 'seed-';
const MINUTE = 60_000;

/**
 * Icebreaker deck, a few squad DMs, one pending message request, and group-chat history (with a poll) for
 * recently completed seeded plans. Idempotent: everything is keyed by deck prompt, direct key or event id.
 */
export async function seedChat(
  tx: Tx,
  ctx: ChatSeedContext,
  now: Date = new Date(),
): Promise<ChatSeedSummary> {
  await seedIcebreakerDeck(tx);

  let seq = 0;
  const say = async (
    conversationId: string,
    senderId: string | null,
    body: string,
    at: Date,
  ): Promise<string> => {
    seq += 1;
    await tx.execute(sql`SELECT ensure_monthly_partition_for('messages', ${at})`);
    const id = uuidV7At(at);
    await tx.insert(messages).values({
      id,
      conversationId,
      senderId,
      kind: 'text',
      body,
      clientId: `${SEED_PREFIX}${conversationId}-${String(seq)}`,
      createdAt: uuidV7Time(id),
    });
    await tx
      .update(conversations)
      .set({ lastMessageId: id, lastMessageAt: at })
      .where(eq(conversations.id, conversationId));
    return id;
  };

  // Squad DMs: members 1–20 each chat with the next person in the ring (they are squad).
  for (let k = 0; k < 20; k += 1) {
    const a = ctx.memberIds[k];
    const b = ctx.memberIds[k + 1];
    if (!a || !b) continue;
    const key = directKey(a, b);
    const [exists] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.directKey, key))
      .limit(1);
    if (exists) continue;
    const id = uuidv7();
    await tx.insert(conversations).values({ id, kind: 'direct', directKey: key, createdBy: a });
    await tx.insert(conversationMembers).values([
      { conversationId: id, userId: a, status: 'active' },
      { conversationId: id, userId: b, status: 'active' },
    ]);
    const base = new Date(now.getTime() - (k + 1) * 3 * 3_600_000);
    await say(id, a, 'Pulling up to anything this weekend?', base);
    const last = await say(
      id,
      b,
      'Thinking of the sunset frisbee, you in?',
      new Date(base.getTime() + 5 * MINUTE),
    );
    await tx
      .update(conversationMembers)
      .set({ lastReadMessageId: last, lastReadAt: new Date(base.getTime() + 5 * MINUTE) })
      .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, b)));
  }

  // A pending message request (not squad): member 1 → member 100.
  const sender = ctx.memberIds[0];
  const receiver = ctx.memberIds[99];
  if (sender && receiver) {
    const key = directKey(sender, receiver);
    const [exists] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.directKey, key))
      .limit(1);
    if (!exists) {
      const id = uuidv7();
      await tx
        .insert(conversations)
        .values({ id, kind: 'direct', directKey: key, createdBy: sender });
      await tx.insert(conversationMembers).values([
        { conversationId: id, userId: sender, status: 'active' },
        { conversationId: id, userId: receiver, status: 'request' },
      ]);
      await say(
        id,
        sender,
        'Hi! Saw you at the board games night, want to team up next time?',
        new Date(now.getTime() - 2 * 3_600_000),
      );
    }
  }

  // Group chats for the five most recent completed seeded plans, with history and a poll.
  const recent = await tx.execute<{ id: string; starts_at: Date; creator_user_id: string }>(sql`
    SELECT id, starts_at, creator_user_id FROM events WHERE slug LIKE 'seedev%' AND status = 'completed'
    ORDER BY starts_at DESC LIMIT 5`);
  for (const ev of recent.rows) {
    const [exists] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.eventId, ev.id))
      .limit(1);
    if (exists) continue;
    const id = uuidv7();
    await tx.insert(conversations).values({ id, kind: 'event', eventId: ev.id });
    const attendees = await tx.execute<{ user_id: string }>(sql`
      SELECT user_id FROM rsvps WHERE event_id = ${ev.id} AND status IN ('going','checked_in') ORDER BY created_at LIMIT 8`);
    const people = attendees.rows.map((r) => r.user_id);
    if (people.length > 0)
      await tx
        .insert(conversationMembers)
        .values(people.map((userId) => ({ conversationId: id, userId, status: 'active' as const })))
        .onConflictDoNothing();
    const start = new Date(ev.starts_at);
    for (const [j, line] of SAMPLE_LINES.entries()) {
      const who = people[j % Math.max(1, people.length)];
      if (who)
        await say(id, who, line, new Date(start.getTime() - 20 * 3_600_000 + j * 37 * MINUTE));
    }
    const pollId = uuidv7();
    await tx.insert(polls).values({
      id: pollId,
      conversationId: id,
      creatorId: ev.creator_user_id,
      question: 'Same time next week?',
      multi: false,
      anonymous: false,
      closesAt: start,
      closedAt: start,
    });
    const yes = uuidv7();
    const no = uuidv7();
    await tx.insert(pollOptions).values([
      { id: yes, pollId, text: 'Yes!', position: 0 },
      { id: no, pollId, text: 'Maybe the week after', position: 1 },
    ]);
    const voters = people.slice(0, 5);
    if (voters.length > 0)
      await tx
        .insert(pollVotes)
        .values(voters.map((userId, k) => ({ pollId, optionId: k % 4 === 3 ? no : yes, userId })));
    const pollAt = new Date(start.getTime() - 2 * 3_600_000);
    await tx.execute(sql`SELECT ensure_monthly_partition_for('messages', ${pollAt})`);
    const pollMsg = uuidV7At(pollAt);
    await tx.insert(messages).values({
      id: pollMsg,
      conversationId: id,
      senderId: ev.creator_user_id,
      kind: 'poll',
      pollId,
      body: 'Same time next week?',
      clientId: `${SEED_PREFIX}${id}-poll`,
      createdAt: uuidV7Time(pollMsg),
    });
  }

  const seeded = await tx.execute<{ conversations: number; messages: number }>(sql`
    SELECT count(DISTINCT conversation_id)::int AS conversations, count(*)::int AS messages
    FROM messages WHERE client_id LIKE ${`${SEED_PREFIX}%`}`);
  const deck = await tx.$count(
    icebreakerCards,
    inArray(
      sql`${icebreakerCards.prompt}->>'en'`,
      ICEBREAKERS.map((c) => c.prompt.en),
    ),
  );
  return {
    icebreakers: deck,
    conversations: seeded.rows[0]?.conversations ?? 0,
    messages: seeded.rows[0]?.messages ?? 0,
  };
}
