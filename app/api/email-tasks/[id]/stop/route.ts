import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const task = await prisma.emailTask.findUnique({ where: { id } });
  if (!task) {
    return NextResponse.json({ error: "Email task not found" }, { status: 404 });
  }

  const updated = await prisma.emailTask.update({
    where: { id },
    data: { status: "stopped" },
  });

  return NextResponse.json(updated);
}
