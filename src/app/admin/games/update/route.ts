import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { safeAdminPath } from "@/lib/navigation";
import { assertRateLimit } from "@/lib/rate-limit";

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function actionError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function redirectTo(location: string) {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location }
  });
}

function redirectWithStatus(returnTo: string, params: Record<string, string>) {
  const [pathAndQuery, hash = ""] = safeAdminPath(returnTo).split("#");
  const [pathname, query = ""] = pathAndQuery.split("?");
  const searchParams = new URLSearchParams(query);

  for (const [key, paramValue] of Object.entries(params)) {
    searchParams.set(key, paramValue);
  }

  const queryString = searchParams.toString();
  const location = `${pathname}${queryString ? `?${queryString}` : ""}${hash ? `#${hash}` : ""}`;

  return redirectTo(location);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const returnTo = value(formData, "returnTo") || "/admin/games#game-edit";

  try {
    const user = await getCurrentUser();

    if (!user) {
      return redirectTo("/login");
    }

    assertRateLimit(`update-game:${user.id}`, 30, 60_000);

    if (user.role !== "ADMIN") {
      return redirectWithStatus(returnTo, {
        gameError: "관리자만 게임을 수정할 수 있습니다."
      });
    }

    const parsed = z
      .object({
        id: z.string().min(1),
        title: z.string().trim().min(1, "게임명을 입력해주세요.").max(120, "게임명은 120자 이하여야 합니다."),
        players: z.string().trim().max(80, "인원은 80자 이하여야 합니다.").optional(),
        bestPlayers: z.string().trim().max(80, "베스트 인원은 80자 이하여야 합니다.").optional(),
        playTime: z.string().trim().max(80, "시간은 80자 이하여야 합니다.").optional(),
        quantity: z.coerce.number().int().min(0).max(999).optional().nullable(),
        note: z.string().trim().max(1000, "비고는 1000자 이하여야 합니다.").optional(),
        genre: z.string().trim().max(120, "장르는 120자 이하여야 합니다.").optional(),
        isPresent: z.enum(["", "true", "false"]).optional(),
        weight: z.string().trim().max(80, "웨이트는 80자 이하여야 합니다.").optional(),
        infoUrl: z.string().trim().max(500, "정보 사이트 주소는 500자 이하여야 합니다.").optional()
      })
      .parse({
        id: value(formData, "id"),
        title: value(formData, "title"),
        players: value(formData, "players") || undefined,
        bestPlayers: value(formData, "bestPlayers") || undefined,
        playTime: value(formData, "playTime") || undefined,
        quantity: value(formData, "quantity") === "" ? null : formData.get("quantity"),
        note: value(formData, "note") || undefined,
        genre: value(formData, "genre") || undefined,
        isPresent: value(formData, "isPresent") as "" | "true" | "false",
        weight: value(formData, "weight") || undefined,
        infoUrl: value(formData, "infoUrl") || undefined
      });

    await prisma.game.update({
      where: { id: parsed.id },
      data: {
        title: parsed.title,
        players: parsed.players ?? null,
        bestPlayers: parsed.bestPlayers ?? null,
        playTime: parsed.playTime ?? null,
        quantity: parsed.quantity ?? null,
        note: parsed.note ?? null,
        genre: parsed.genre ?? null,
        isPresent: parsed.isPresent === "" || parsed.isPresent === undefined ? null : parsed.isPresent === "true",
        weight: parsed.weight ?? null,
        infoUrl: parsed.infoUrl ?? null
      }
    });

    return redirectWithStatus(returnTo, {
      gameNotice: "게임 정보를 수정했습니다."
    });
  } catch (error) {
    return redirectWithStatus(returnTo, {
      gameError: actionError(error, "게임 수정에 실패했습니다.")
    });
  }
}
