import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";

// Pilot-only "auth" — a username plus a Slack member ID, no password. Good
// enough to simulate multiple teammates creating tasks; flagged in
// context.md for replacement before a real rollout.
const bodySchema = z.object({
  username: z.string().trim().min(1).max(50),
  slackUserId: z.string().trim().min(1).max(50),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { username, slackUserId } = parsed.data;
  const user = await prisma.user.upsert({
    where: { username },
    update: { slackUserId },
    create: { username, slackUserId },
  });

  await setSessionCookie(user.id);

  return NextResponse.json({ id: user.id, username: user.username });
}
