import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const events = await prisma.taskEvent.findMany({
    where: { metric: { taskId: id } },
    include: { metric: { select: { panelTitle: true } } },
    orderBy: { checkedAt: "desc" },
    take: 100,
  });
  return NextResponse.json(events);
}
