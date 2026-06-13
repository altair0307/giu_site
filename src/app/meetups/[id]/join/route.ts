import { NextResponse } from "next/server";
import { joinMeetupAndGetTarget } from "@/app/actions";
import { getCurrentUser } from "@/lib/auth";

type JoinMeetupRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: JoinMeetupRouteContext) {
  const { id } = await context.params;
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const targetHref = await joinMeetupAndGetTarget(id);

    return NextResponse.redirect(new URL(targetHref, request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "약속에 참여할 수 없습니다.";
    const target = new URL("/", request.url);
    target.searchParams.set("meetupError", message);
    return NextResponse.redirect(target);
  }
}
