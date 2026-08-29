import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { DURATION_PRESETS_MIN, EMAIL_INTERVAL_PRESETS_MIN } from "@/lib/types";

const emailMetricSchema = z.object({
  panelId: z.number().int(),
  panelTitle: z.string().min(1),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq"]).nullable(),
  threshold: z.number().nullable(),
});

const createEmailTaskSchema = z.object({
  siteId: z.string().min(1),
  dashboardUid: z.string().min(1),
  metrics: z.array(emailMetricSchema).min(1, "Pick at least one panel to include"),
  intervalMin: z.number().int().refine((v) => EMAIL_INTERVAL_PRESETS_MIN.includes(v)),
  durationMin: z.number().int().refine((v) => DURATION_PRESETS_MIN.includes(v)),
  toEmails: z.array(z.string().trim().email()).min(1, "At least one recipient is required"),
  ccEmails: z.array(z.string().trim().email()).default([]),
});

export async function GET() {
  const tasks = await prisma.emailTask.findMany({
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

  const parsed = createEmailTaskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const site = await prisma.site.findUnique({ where: { id: parsed.data.siteId } });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const { metrics, toEmails, ccEmails, ...taskFields } = parsed.data;
  const now = new Date();
  const task = await prisma.emailTask.create({
    data: {
      ...taskFields,
      createdById: user.id,
      startedAt: now,
      expiresAt: new Date(now.getTime() + taskFields.durationMin * 60_000),
      nextSendAt: now,
      metrics: { create: metrics },
      recipients: {
        create: [
          ...toEmails.map((email) => ({ email, kind: "to" })),
          ...ccEmails.map((email) => ({ email, kind: "cc" })),
        ],
      },
    },
    include: { metrics: true, recipients: true },
  });

  return NextResponse.json(task, { status: 201 });
}
