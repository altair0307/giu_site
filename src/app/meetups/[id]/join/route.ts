import { NextResponse } from "next/server";
import { joinMeetupAndGetTarget } from "@/app/actions";

type JoinMeetupRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: JoinMeetupRouteContext) {
  const { id } = await context.params;

  try {
    const targetHref = await joinMeetupAndGetTarget(id);

    return NextResponse.redirect(new URL(targetHref, request.url));
  } catch {
    return NextResponse.redirect(new URL("/", request.url));
  }
}
