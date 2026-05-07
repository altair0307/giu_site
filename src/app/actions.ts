"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseGameWorkbook } from "@/lib/game-spreadsheet";
import { assertRateLimit } from "@/lib/rate-limit";
import { getClientKey } from "@/lib/request";

const loginIdSchema = z
  .string()
  .trim()
  .min(3, "아이디는 3자 이상이어야 합니다.")
  .max(30, "아이디는 30자 이하여야 합니다.")
  .regex(/^[a-zA-Z0-9_-]+$/, "아이디는 영문, 숫자, _, -만 사용할 수 있습니다.");

const passwordSchema = z.string().min(8, "비밀번호는 8자 이상이어야 합니다.");

export type ActionState = {
  ok?: boolean;
  message?: string;
};

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function actionError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

export async function registerAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    assertRateLimit(await getClientKey("register"), 5, 60_000);

    const parsed = z
      .object({
        name: z.string().trim().min(2, "이름을 입력해주세요.").max(20),
        loginId: loginIdSchema,
        studentId: z.string().trim().max(30).optional(),
        password: passwordSchema,
        passwordConfirm: z.string().min(1, "비밀번호 확인을 입력해주세요.")
      })
      .refine((data) => data.password === data.passwordConfirm, {
        message: "비밀번호와 비밀번호 확인이 다릅니다."
      })
      .parse({
        name: value(formData, "name"),
        loginId: value(formData, "loginId"),
        studentId: value(formData, "studentId") || undefined,
        password: String(formData.get("password") ?? ""),
        passwordConfirm: String(formData.get("passwordConfirm") ?? "")
      });

    const existing = await prisma.user.findUnique({
      where: { loginId: parsed.loginId }
    });

    if (existing) {
      return { message: "이미 사용 중인 아이디입니다." };
    }

    const userCount = await prisma.user.count();
    const passwordHash = await bcrypt.hash(parsed.password, 12);

    const user = await prisma.user.create({
      data: {
        name: parsed.name,
        loginId: parsed.loginId,
        studentId: parsed.studentId,
        passwordHash,
        role: userCount === 0 ? "ADMIN" : "MEMBER"
      }
    });

    await createSession(user.id);
  } catch (error) {
    return { message: actionError(error, "회원가입에 실패했습니다.") };
  }

  redirect("/");
}

export async function loginAction(_: ActionState, formData: FormData): Promise<ActionState> {
  let mustChangePassword = false;

  try {
    assertRateLimit(await getClientKey("login"), 8, 60_000);

    const parsed = z
      .object({
        loginId: loginIdSchema,
        password: z.string().min(1, "비밀번호를 입력해주세요.")
      })
      .parse({
        loginId: value(formData, "loginId"),
        password: String(formData.get("password") ?? "")
      });

    const user = await prisma.user.findUnique({
      where: { loginId: parsed.loginId }
    });

    if (!user || !(await bcrypt.compare(parsed.password, user.passwordHash))) {
      return { message: "아이디 또는 비밀번호가 올바르지 않습니다." };
    }

    await createSession(user.id);
    mustChangePassword = user.mustChangePassword;
  } catch (error) {
    return { message: actionError(error, "로그인에 실패했습니다.") };
  }

  if (mustChangePassword) {
    redirect("/account/password");
  }

  redirect("/");
}

export async function changePasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    assertRateLimit(`change-password:${user.id}`, 8, 60_000);

    const parsed = z
      .object({
        password: passwordSchema,
        passwordConfirm: z.string().min(1, "비밀번호 확인을 입력해주세요.")
      })
      .refine((data) => data.password === data.passwordConfirm, {
        message: "비밀번호와 비밀번호 확인이 다릅니다."
      })
      .parse({
        password: String(formData.get("password") ?? ""),
        passwordConfirm: String(formData.get("passwordConfirm") ?? "")
      });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(parsed.password, 12),
        mustChangePassword: false
      }
    });

    revalidatePath("/");
    revalidatePath("/account/password");
  } catch (error) {
    return { message: actionError(error, "비밀번호 변경에 실패했습니다.") };
  }

  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function addGameAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    assertRateLimit(`add-game:${user.id}`, 10, 60_000);

    if (user.role !== "ADMIN") {
      return { message: "관리자만 게임을 추가할 수 있습니다." };
    }

    const parsed = z
      .object({
        title: z.string().trim().min(1).max(60),
        players: z.string().trim().max(40).optional(),
        bestPlayers: z.string().trim().max(40).optional(),
        playTime: z.string().trim().max(40).optional(),
        quantity: z.coerce.number().int().min(0).max(999).optional().nullable(),
        note: z.string().trim().max(300).optional(),
        genre: z.string().trim().max(80).optional(),
        isPresent: z.enum(["", "true", "false"]).optional(),
        weight: z.string().trim().max(40).optional(),
        infoUrl: z.string().trim().max(500).optional()
      })
      .parse({
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

    await prisma.game.create({
      data: {
        ...parsed,
        isPresent: parsed.isPresent === "" || parsed.isPresent === undefined ? null : parsed.isPresent === "true"
      }
    });
    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/games");
    return { ok: true, message: "게임을 추가했습니다." };
  } catch (error) {
    return { message: actionError(error, "게임 추가에 실패했습니다.") };
  }
}

export async function borrowGameAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`borrow:${user.id}`, 12, 60_000);

  const gameId = value(formData, "gameId");

  await prisma.$transaction(async (tx) => {
    const game = await tx.game.findUnique({ where: { id: gameId } });

    if (!game || game.status !== "AVAILABLE") {
      throw new Error("대여 요청 가능한 게임이 아닙니다.");
    }

    const pendingRequest = await tx.loanRequest.findFirst({
      where: {
        gameId,
        type: "BORROW",
        status: "PENDING"
      }
    });

    if (pendingRequest) {
      throw new Error("이미 대여 승인 대기 중인 게임입니다.");
    }

    await tx.loanRequest.create({
      data: {
        type: "BORROW",
        gameId,
        requesterId: user.id
      }
    });
  });

  revalidatePath("/");
  revalidatePath("/admin");
}

export async function returnGameAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`return:${user.id}`, 12, 60_000);

  const loanId = value(formData, "loanId");
  const activeLoan = await prisma.loan.findUnique({
    where: { id: loanId },
    include: { game: true }
  });

  if (!activeLoan || activeLoan.status !== "ACTIVE") {
    throw new Error("반납 가능한 대여 기록이 아닙니다.");
  }

  if (activeLoan.borrowerId !== user.id && user.role !== "ADMIN") {
    throw new Error("본인 또는 관리자만 반납 요청을 할 수 있습니다.");
  }

  const pendingRequest = await prisma.loanRequest.findFirst({
    where: {
      loanId,
      type: "RETURN",
      status: "PENDING"
    }
  });

  if (pendingRequest) {
    throw new Error("이미 반납 승인 대기 중인 대여 기록입니다.");
  }

  await prisma.loanRequest.create({
    data: {
      type: "RETURN",
      gameId: activeLoan.gameId,
      loanId,
      requesterId: user.id
    }
  });

  revalidatePath("/");
  revalidatePath("/admin");
}

export async function approveLoanRequestAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`approve-loan-request:${user.id}`, 30, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 대여/반납 요청을 승인할 수 있습니다.");
  }

  const requestId = value(formData, "requestId");
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const request = await tx.loanRequest.findUnique({
      where: { id: requestId },
      include: { game: true, loan: true }
    });

    if (!request || request.status !== "PENDING") {
      throw new Error("승인 가능한 요청이 아닙니다.");
    }

    if (request.type === "BORROW") {
      const game = await tx.game.findUnique({ where: { id: request.gameId } });

      if (!game || game.status !== "AVAILABLE") {
        throw new Error("현재 대여 가능한 게임이 아닙니다.");
      }

      await tx.loan.create({
        data: {
          gameId: request.gameId,
          borrowerId: request.requesterId,
          dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }
      });

      await tx.game.update({
        where: { id: request.gameId },
        data: { status: "BORROWED" }
      });

      await tx.loanRequest.updateMany({
        where: {
          id: { not: request.id },
          gameId: request.gameId,
          type: "BORROW",
          status: "PENDING"
        },
        data: {
          status: "REJECTED",
          reviewerId: user.id,
          reviewedAt: now
        }
      });
    } else {
      if (!request.loanId || !request.loan || request.loan.status !== "ACTIVE") {
        throw new Error("반납 승인 가능한 대여 기록이 아닙니다.");
      }

      await tx.loan.update({
        where: { id: request.loanId },
        data: { status: "RETURNED", returnedAt: now }
      });

      await tx.game.update({
        where: { id: request.gameId },
        data: { status: "AVAILABLE" }
      });

      await tx.loanRequest.updateMany({
        where: {
          id: { not: request.id },
          loanId: request.loanId,
          type: "RETURN",
          status: "PENDING"
        },
        data: {
          status: "REJECTED",
          reviewerId: user.id,
          reviewedAt: now
        }
      });
    }

    await tx.loanRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        reviewerId: user.id,
        reviewedAt: now
      }
    });
  });

  revalidatePath("/");
  revalidatePath("/admin");
}

export async function rejectLoanRequestAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`reject-loan-request:${user.id}`, 30, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 대여/반납 요청을 거절할 수 있습니다.");
  }

  const result = await prisma.loanRequest.updateMany({
    where: {
      id: value(formData, "requestId"),
      status: "PENDING"
    },
    data: {
      status: "REJECTED",
      reviewerId: user.id,
      reviewedAt: new Date()
    }
  });

  if (result.count === 0) {
    throw new Error("거절 가능한 요청이 아닙니다.");
  }

  revalidatePath("/");
  revalidatePath("/admin");
}

export async function updateGameAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    assertRateLimit(`update-game:${user.id}`, 30, 60_000);

    if (user.role !== "ADMIN") {
      return { message: "관리자만 게임을 수정할 수 있습니다." };
    }

    const parsed = z
      .object({
        id: z.string().min(1),
        title: z.string().trim().min(1).max(60),
        players: z.string().trim().max(40).optional(),
        bestPlayers: z.string().trim().max(40).optional(),
        playTime: z.string().trim().max(40).optional(),
        quantity: z.coerce.number().int().min(0).max(999).optional().nullable(),
        note: z.string().trim().max(300).optional(),
        genre: z.string().trim().max(80).optional(),
        isPresent: z.enum(["", "true", "false"]).optional(),
        weight: z.string().trim().max(40).optional(),
        infoUrl: z.string().trim().max(500).optional()
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

    revalidatePath("/");
    revalidatePath("/admin");
    return { ok: true, message: "게임 정보를 수정했습니다." };
  } catch (error) {
    return { message: actionError(error, "게임 수정에 실패했습니다.") };
  }
}

export async function updateGameFormAction(formData: FormData) {
  const result = await updateGameAction({}, formData);

  if (!result.ok) {
    throw new Error(result.message ?? "게임 수정에 실패했습니다.");
  }
}

export async function updateUserAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    assertRateLimit(`update-user:${user.id}`, 30, 60_000);

    if (user.role !== "ADMIN") {
      return { message: "관리자만 회원 정보를 수정할 수 있습니다." };
    }

    const parsed = z
      .object({
        id: z.string().min(1),
        name: z.string().trim().min(2).max(20),
        studentId: z.string().trim().max(30).optional(),
        role: z.enum(["MEMBER", "ADMIN"])
      })
      .parse({
        id: value(formData, "id"),
        name: value(formData, "name"),
        studentId: value(formData, "studentId") || undefined,
        role: value(formData, "role")
      });

    if (parsed.id === user.id && parsed.role !== "ADMIN") {
      return { message: "본인의 관리자 권한은 해제할 수 없습니다." };
    }

    await prisma.user.update({
      where: { id: parsed.id },
      data: {
        name: parsed.name,
        studentId: parsed.studentId ?? null,
        role: parsed.role
      }
    });

    revalidatePath("/admin");
    revalidatePath("/admin/users");
    return { ok: true, message: "회원 정보를 수정했습니다." };
  } catch (error) {
    return { message: actionError(error, "회원 정보 수정에 실패했습니다.") };
  }
}

export async function updateUserFormAction(formData: FormData) {
  const result = await updateUserAction({}, formData);

  if (!result.ok) {
    throw new Error(result.message ?? "회원 정보 수정에 실패했습니다.");
  }
}

export async function resetUserPasswordAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`reset-user-password:${user.id}`, 20, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 비밀번호를 초기화할 수 있습니다.");
  }

  const targetUserId = value(formData, "id");

  await prisma.user.update({
    where: { id: targetUserId },
    data: {
      passwordHash: await bcrypt.hash("1981", 12),
      mustChangePassword: true
    }
  });

  await prisma.session.deleteMany({ where: { userId: targetUserId } });
  revalidatePath("/admin");
  revalidatePath("/admin/users");
  redirect("/admin/users?notice=password-reset");
}

export async function deleteUserAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`delete-user:${user.id}`, 10, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 사용자를 삭제할 수 있습니다.");
  }

  const targetUserId = value(formData, "id");
  const confirm = value(formData, "confirm");

  if (targetUserId === user.id) {
    throw new Error("본인 계정은 삭제할 수 없습니다.");
  }

  if (confirm !== "DELETE") {
    throw new Error("삭제 확인 문구가 올바르지 않습니다.");
  }

  await prisma.user.delete({ where: { id: targetUserId } });
  revalidatePath("/admin");
  revalidatePath("/admin/users");
  redirect("/admin/users?notice=user-deleted");
}

export async function importGamesAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    assertRateLimit(`import-games:${user.id}`, 4, 60_000);

    if (user.role !== "ADMIN") {
      return { message: "관리자만 게임 DB를 업로드할 수 있습니다." };
    }

    const [activeLoans, pendingLoanRequests] = await Promise.all([
      prisma.loan.count({ where: { status: "ACTIVE" } }),
      prisma.loanRequest.count({ where: { status: "PENDING" } })
    ]);
    if (activeLoans > 0) {
      return { message: "대여 중인 게임이 있으면 전체 업로드를 할 수 없습니다. 먼저 반납 처리해주세요." };
    }
    if (pendingLoanRequests > 0) {
      return { message: "승인 대기 중인 대여/반납 요청이 있으면 전체 업로드를 할 수 없습니다. 먼저 처리해주세요." };
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { message: "업로드할 엑셀 파일을 선택해주세요." };
    }

    const rows = await parseGameWorkbook(Buffer.from(await file.arrayBuffer()));
    if (rows.length === 0) {
      return { message: "가져올 게임 데이터가 없습니다." };
    }

    await prisma.$transaction(async (tx) => {
      await tx.meetup.updateMany({ data: { gameId: null } });
      await tx.loan.deleteMany({});
      await tx.game.deleteMany({});
      await tx.game.createMany({
        data: rows.map((row) => ({
          title: row.title,
          players: row.players,
          bestPlayers: row.bestPlayers,
          playTime: row.playTime,
          quantity: row.quantity,
          note: row.note,
          genre: row.genre,
          isPresent: row.isPresent,
          weight: row.weight,
          infoUrl: row.infoUrl
        }))
      });
    });

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/games");
    return { ok: true, message: `${rows.length}개 게임을 반영했습니다.` };
  } catch (error) {
    return { message: actionError(error, "게임 DB 업로드에 실패했습니다.") };
  }
}

export async function createMeetupAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    assertRateLimit(`meetup:${user.id}`, 8, 60_000);

    const parsed = z
      .object({
        title: z.string().trim().min(1).max(80),
        description: z.string().trim().max(300).optional(),
        startsAt: z.coerce.date(),
        maxPeople: z.coerce.number().int().min(2).max(30),
        gameId: z.string().optional(),
        tableId: z.string().min(1, "테이블을 선택해주세요.")
      })
      .parse({
        title: value(formData, "title"),
        description: value(formData, "description") || undefined,
        startsAt: formData.get("startsAt"),
        maxPeople: formData.get("maxPeople"),
        gameId: value(formData, "gameId") || undefined,
        tableId: value(formData, "tableId")
      });

    if (parsed.startsAt < new Date()) {
      return { message: "미래 시간으로 약속을 잡아주세요." };
    }

    const meetup = await prisma.meetup.create({
      data: {
        ...parsed,
        hostId: user.id
      }
    });

    await prisma.meetupParticipant.create({
      data: {
        meetupId: meetup.id,
        userId: user.id
      }
    });

    revalidatePath("/");
    revalidatePath("/admin");
    return { ok: true, message: "게임 약속을 만들었습니다." };
  } catch (error) {
    return { message: actionError(error, "약속 생성에 실패했습니다.") };
  }
}

async function requireMeetupManager(meetupId: string) {
  const user = await requireUser();
  const meetup = await prisma.meetup.findUnique({
    where: { id: meetupId },
    select: { id: true, hostId: true }
  });

  if (!meetup) {
    throw new Error("약속을 찾을 수 없습니다.");
  }

  if (meetup.hostId !== user.id && user.role !== "ADMIN") {
    throw new Error("개최자 또는 관리자만 약속을 관리할 수 있습니다.");
  }

  return { user, meetup };
}

export async function cancelMeetupAction(formData: FormData) {
  const meetupId = value(formData, "meetupId");
  const returnTo = value(formData, "returnTo") || "/";
  const { user } = await requireMeetupManager(meetupId);
  assertRateLimit(`cancel-meetup:${user.id}`, 20, 60_000);

  await prisma.meetup.delete({ where: { id: meetupId } });
  revalidatePath("/");
  revalidatePath("/admin");
  redirect(returnTo);
}

export async function completeMeetupAction(formData: FormData) {
  const meetupId = value(formData, "meetupId");
  const returnTo = value(formData, "returnTo") || "/";
  const { user } = await requireMeetupManager(meetupId);
  assertRateLimit(`complete-meetup:${user.id}`, 20, 60_000);

  await prisma.meetup.delete({ where: { id: meetupId } });
  revalidatePath("/");
  revalidatePath("/admin");
  redirect(returnTo);
}

export async function joinMeetupAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`join:${user.id}`, 20, 60_000);

  const meetupId = value(formData, "meetupId");
  const meetup = await prisma.meetup.findUnique({
    where: { id: meetupId },
    include: { participants: true }
  });

  if (!meetup) {
    throw new Error("약속을 찾을 수 없습니다.");
  }

  if (meetup.participants.length >= meetup.maxPeople) {
    throw new Error("정원이 찼습니다.");
  }

  await prisma.meetupParticipant.upsert({
    where: {
      meetupId_userId: {
        meetupId,
        userId: user.id
      }
    },
    update: {},
    create: {
      meetupId,
      userId: user.id
    }
  });

  revalidatePath("/");
  revalidatePath("/admin");
}

export async function leaveMeetupAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`leave:${user.id}`, 20, 60_000);

  await prisma.meetupParticipant.deleteMany({
    where: {
      meetupId: value(formData, "meetupId"),
      userId: user.id
    }
  });

  revalidatePath("/");
  revalidatePath("/admin");
}
