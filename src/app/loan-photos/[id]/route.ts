import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type LoanPhotoRouteProps = {
  params: Promise<{ id: string }>;
};

export async function GET(_: NextRequest, { params }: LoanPhotoRouteProps) {
  const user = await getCurrentUser();

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const photo = await prisma.loanPhoto.findUnique({
    where: { id },
    select: {
      contentType: true,
      data: true,
      loan: {
        select: {
          borrowerId: true
        }
      },
      loanRequest: {
        select: {
          requesterId: true
        }
      }
    }
  });

  if (!photo) {
    return new NextResponse("Not found", { status: 404 });
  }

  const canView =
    user.role === "ADMIN" || photo.loan.borrowerId === user.id || photo.loanRequest?.requesterId === user.id;

  if (!canView) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return new NextResponse(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.data.byteLength),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
