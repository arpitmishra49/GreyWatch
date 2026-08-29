import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { COOLDOWN_PRESETS_MIN, DURATION_PRESETS_MIN, POLL_INTERVAL_PRESETS_MIN } from "@/lib/types";

const metricSchema = z.object({
  panelId: z.number().int(),
  panelTitle: z.string().min(1),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq"]),
  threshold: z.number(),
});

const createTaskSchema = z.object({
  siteId: z.string().min(1),
  dashboardUid: z.string().min(1),
  metrics: z.array(metricSchema).min(1, "Pick at least one panel to watch"),
  pollIntervalMin: z.number().int().refine((v) => POLL_INTERVAL_PRESETS_MIN.includes(v)),
  cooldownMin: z.number().int().refine((v) => COOLDOWN_PRESETS_MIN.includes(v)),
  durationMin: z.number().int().refine((v) => DURATION_PRESETS_MIN.includes(v)),
  recipientSlackIds: z.array(z.string().trim().min(1)).default([]),
});

export async function GET() {
  const tasks = await prisma.monitorTask.findMany({
    include: {
      site: true,
      createdBy: { select: { username: true } },
      metrics: { orderBy: { panelTitle: "asc" } },
      recipients: true,
    },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  return NextResponse.json(tasks);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const parsed = createTaskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const site = await prisma.site.findUnique({ where: { id: parsed.data.siteId } });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const { metrics, recipientSlackIds, ...taskFields } = parsed.data;
  const now = new Date();
  const task = await prisma.monitorTask.create({
    data: {
      ...taskFields,
      createdById: user.id,
      startedAt: now,
      expiresAt: new Date(now.getTime() + taskFields.durationMin * 60_000),
      nextCheckAt: now,
      metrics: { create: metrics },
      recipients: { create: recipientSlackIds.map((slackUserId) => ({ slackUserId })) },
    },
    include: { metrics: true, recipients: true },
  });

  return NextResponse.json(task, { status: 201 });
}
