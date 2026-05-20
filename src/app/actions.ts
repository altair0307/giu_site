"use server";

import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { createLoanActivityLog, createMeetupActivityLog } from "@/lib/activity-log";
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
const MAX_LOAN_PHOTO_SIZE = 8 * 1024 * 1024;
const ALLOWED_LOAN_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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

async function readLoanPhoto(formData: FormData) {
  const file = formData.get("photo");

  if (!(file instanceof File) || file.size === 0) {
    throw new Error("사진을 업로드해주세요.");
  }

  if (!ALLOWED_LOAN_PHOTO_TYPES.has(file.type)) {
    throw new Error("사진은 JPG, PNG, WebP 형식만 업로드할 수 있습니다.");
  }

  if (file.size > MAX_LOAN_PHOTO_SIZE) {
    throw new Error("사진은 8MB 이하로 업로드해주세요.");
  }

  return {
    contentType: file.type,
    size: file.size,
    data: Buffer.from(await file.arrayBuffer())
  };
}

async function assertGameHasNoUpcomingMeetup(gameId: string, startsAt = new Date()) {
  const upcomingMeetup = await prisma.meetup.findFirst({
    where: {
      gameId,
      startsAt: { gte: startsAt }
    },
    select: { id: true }
  });

  if (upcomingMeetup) {
    throw new Error("이미 예정된 약속이 있는 게임은 대여하거나 다른 약속에 선택할 수 없습니다.");
  }
}

async function findMeetupForLog(tx: Prisma.TransactionClient, meetupId: string) {
  return tx.meetup.findUnique({
    where: { id: meetupId },
    include: {
      game: { select: { title: true } },
      table: { select: { name: true } },
      host: { select: { name: true, loginId: true } },
      participants: {
        include: {
          user: { select: { id: true, name: true, loginId: true, studentId: true } }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });
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
  const photo = await readLoanPhoto(formData);
  const now = new Date();
  await assertGameHasNoUpcomingMeetup(gameId, now);

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

    const request = await tx.loanRequest.create({
      data: {
        type: "BORROW",
        status: "APPROVED",
        gameId,
        requesterId: user.id,
        reviewedAt: now
      }
    });

    const loan = await tx.loan.create({
      data: {
        gameId,
        borrowerId: user.id,
        borrowedAt: now,
        dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    await tx.loanPhoto.create({
      data: {
        type: "BORROW",
        loanId: loan.id,
        loanRequestId: request.id,
        ...photo
      }
    });

    await tx.loanRequest.update({
      where: { id: request.id },
      data: { loanId: loan.id }
    });

    await tx.game.update({
      where: { id: gameId },
      data: { status: "BORROWED" }
    });

    await createLoanActivityLog(tx, {
      type: "BORROW",
      loanId: loan.id,
      gameId,
      gameTitle: game.title,
      borrowerId: user.id,
      borrowerName: user.name,
      borrowerLoginId: user.loginId,
      borrowerStudentId: user.studentId,
      occurredAt: now,
      dueAt: loan.dueAt
    });
  });

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/loans");
  revalidatePath("/admin/logs");
}

export async function returnGameAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`return:${user.id}`, 12, 60_000);

  const loanId = value(formData, "loanId");
  const photo = await readLoanPhoto(formData);
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

  await prisma.$transaction(async (tx) => {
    const request = await tx.loanRequest.create({
      data: {
        type: "RETURN",
        gameId: activeLoan.gameId,
        loanId,
        requesterId: user.id
      }
    });

    await tx.loanPhoto.create({
      data: {
        type: "RETURN",
        loanId,
        loanRequestId: request.id,
        ...photo
      }
    });
  });

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/loans");
  revalidatePath("/admin/logs");
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
      include: {
        game: true,
        requester: { select: { id: true, name: true, loginId: true, studentId: true } },
        loan: {
          include: {
            borrower: { select: { id: true, name: true, loginId: true, studentId: true } }
          }
        }
      }
    });

    if (!request || request.status !== "PENDING") {
      throw new Error("승인 가능한 요청이 아닙니다.");
    }

    if (request.type === "BORROW") {
      const game = await tx.game.findUnique({ where: { id: request.gameId } });

      if (!game || game.status !== "AVAILABLE") {
        throw new Error("현재 대여 가능한 게임이 아닙니다.");
      }

      const loan = await tx.loan.create({
        data: {
          gameId: request.gameId,
          borrowerId: request.requesterId,
          borrowedAt: now,
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

      await createLoanActivityLog(tx, {
        type: "BORROW",
        loanId: loan.id,
        gameId: request.gameId,
        gameTitle: request.game.title,
        borrowerId: request.requester.id,
        borrowerName: request.requester.name,
        borrowerLoginId: request.requester.loginId,
        borrowerStudentId: request.requester.studentId,
        occurredAt: now,
        dueAt: loan.dueAt
      });

      await tx.loanRequest.update({
        where: { id: request.id },
        data: { loanId: loan.id }
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

      await createLoanActivityLog(tx, {
        type: "RETURN",
        loanId: request.loan.id,
        gameId: request.gameId,
        gameTitle: request.game.title,
        borrowerId: request.loan.borrower.id,
        borrowerName: request.loan.borrower.name,
        borrowerLoginId: request.loan.borrower.loginId,
        borrowerStudentId: request.loan.borrower.studentId,
        occurredAt: now,
        dueAt: request.loan.dueAt
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
  revalidatePath("/admin/loans");
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
  revalidatePath("/admin/loans");
}

export async function deleteLoanAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`delete-loan:${user.id}`, 20, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 대여 기록을 삭제할 수 있습니다.");
  }

  const loanId = value(formData, "loanId");
  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    select: { id: true, gameId: true, status: true }
  });

  if (!loan) {
    throw new Error("삭제할 대여 기록을 찾을 수 없습니다.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.loan.delete({ where: { id: loan.id } });

    if (loan.status === "ACTIVE") {
      await tx.game.update({
        where: { id: loan.gameId },
        data: { status: "AVAILABLE" }
      });
    }
  });

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/loans");
  redirect("/admin/loans?notice=loan-deleted");
}

export async function pruneActivityLogsAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`prune-activity-logs:${user.id}`, 4, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 로그를 정리할 수 있습니다.");
  }

  const days = z.coerce.number().int().min(30).max(3650).parse(formData.get("days") ?? 365);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.loanActivityLog.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
    prisma.meetupActivityLog.deleteMany({ where: { occurredAt: { lt: cutoff } } })
  ]);

  revalidatePath("/admin");
  revalidatePath("/admin/logs");
  redirect(`/admin/logs?notice=logs-pruned&days=${days}`);
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

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { message: "업로드할 엑셀 파일을 선택해주세요." };
    }

    const rows = await parseGameWorkbook(Buffer.from(await file.arrayBuffer()));
    if (rows.length === 0) {
      return { message: "가져올 게임 데이터가 없습니다." };
    }

    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let keptCount = 0;

    await prisma.$transaction(async (tx) => {
      const existingGames = await tx.game.findMany({
        include: {
          _count: {
            select: {
              loans: true,
              loanRequests: true,
              meetups: true
            }
          }
        },
        orderBy: { createdAt: "asc" }
      });
      const gamesByTitle = new Map<string, typeof existingGames>();

      for (const game of existingGames) {
        const key = game.title.trim().toLowerCase();
        gamesByTitle.set(key, [...(gamesByTitle.get(key) ?? []), game]);
      }

      const matchedGameIds = new Set<string>();

      for (const row of rows) {
        const key = row.title.trim().toLowerCase();
        const candidates = gamesByTitle.get(key) ?? [];
        const existingGame = candidates.find((game) => !matchedGameIds.has(game.id));
        const data = {
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
        };

        if (existingGame) {
          await tx.game.update({
            where: { id: existingGame.id },
            data
          });
          matchedGameIds.add(existingGame.id);
          updatedCount += 1;
          continue;
        }

        const createdGame = await tx.game.create({ data });
        matchedGameIds.add(createdGame.id);
        createdCount += 1;
      }

      const obsoleteGames = existingGames.filter((game) => !matchedGameIds.has(game.id));

      for (const game of obsoleteGames) {
        const hasRelatedData = game._count.loans > 0 || game._count.loanRequests > 0 || game._count.meetups > 0;

        if (hasRelatedData) {
          keptCount += 1;
          continue;
        }

        await tx.game.delete({
          where: { id: game.id }
        });
        deletedCount += 1;
      }

      await tx.meetup.updateMany({
        where: {
          gameId: {
            notIn: Array.from(matchedGameIds)
          }
        },
        data: { gameId: null }
      });
    });

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/games");
    return {
      ok: true,
      message: `${rows.length}개 행을 반영했습니다. 수정 ${updatedCount}개, 추가 ${createdCount}개, 삭제 ${deletedCount}개${
        keptCount > 0 ? `, 대여/기록 보존 ${keptCount}개` : ""
      }.`
    };
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

    if (parsed.gameId) {
      const [game, conflictingMeetup] = await Promise.all([
        prisma.game.findUnique({
          where: { id: parsed.gameId },
          select: { status: true }
        }),
        prisma.meetup.findFirst({
          where: {
            gameId: parsed.gameId,
            startsAt: { gte: new Date() }
          },
          select: { id: true }
        })
      ]);

      if (!game || game.status !== "AVAILABLE") {
        return { message: "대여 중인 게임은 약속에 선택할 수 없습니다." };
      }

      if (conflictingMeetup) {
        return { message: "이미 예정된 약속이 있는 게임은 선택할 수 없습니다." };
      }
    }

    await prisma.$transaction(async (tx) => {
      const meetup = await tx.meetup.create({
        data: {
          ...parsed,
          hostId: user.id
        }
      });

      await tx.meetupParticipant.create({
        data: {
          meetupId: meetup.id,
          userId: user.id
        }
      });

      const meetupForLog = await findMeetupForLog(tx, meetup.id);

      if (!meetupForLog) {
        throw new Error("약속 로그를 생성할 수 없습니다.");
      }

      await createMeetupActivityLog(tx, "SCHEDULED", meetupForLog, new Date());
    });

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/logs");
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

  await prisma.$transaction(async (tx) => {
    const meetupForLog = await findMeetupForLog(tx, meetupId);

    if (!meetupForLog) {
      throw new Error("약속을 찾을 수 없습니다.");
    }

    await createMeetupActivityLog(tx, "CANCELED", meetupForLog, new Date());
    await tx.meetup.delete({ where: { id: meetupId } });
  });
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/logs");
  redirect(returnTo);
}

export async function completeMeetupAction(formData: FormData) {
  const meetupId = value(formData, "meetupId");
  const returnTo = value(formData, "returnTo") || "/";
  const { user } = await requireMeetupManager(meetupId);
  assertRateLimit(`complete-meetup:${user.id}`, 20, 60_000);

  await prisma.$transaction(async (tx) => {
    const meetupForLog = await findMeetupForLog(tx, meetupId);

    if (!meetupForLog) {
      throw new Error("약속을 찾을 수 없습니다.");
    }

    await createMeetupActivityLog(tx, "COMPLETED", meetupForLog, new Date());
    await tx.meetup.delete({ where: { id: meetupId } });
  });
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/logs");
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
