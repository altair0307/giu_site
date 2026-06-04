"use server";

import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { createGeneralActivityLog, createLoanActivityLog, createMeetupActivityLog } from "@/lib/activity-log";
import { prisma } from "@/lib/db";
import { NEGATIVE_RATING_REASON_VALUES, POSITIVE_RATING_REASON_VALUES, RATING_REASON_VALUES } from "@/lib/game-rating";
import { parseGameWorkbook } from "@/lib/game-spreadsheet";
import { notifyReturnRequested } from "@/lib/notifications";
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

function calculateRatingTrustWeight({
  verified,
  selfReported,
  reasonTagCount,
  hasComment,
  recentRatingCount
}: {
  verified: boolean;
  selfReported: boolean;
  reasonTagCount: number;
  hasComment: boolean;
  recentRatingCount: number;
}) {
  let weight = verified ? 1 : selfReported ? 0.7 : 0.5;

  if (reasonTagCount > 0) {
    weight += 0.1;
  }

  if (hasComment) {
    weight += 0.1;
  }

  if (recentRatingCount >= 10) {
    weight -= 0.4;
  } else if (recentRatingCount >= 5) {
    weight -= 0.2;
  }

  return Math.min(1, Math.max(0.1, Number(weight.toFixed(2))));
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
    await createGeneralActivityLog(prisma, {
      category: "USER",
      action: "REGISTER",
      actor: user,
      target: { type: "USER", id: user.id, name: user.name },
      message: `${user.name} 회원이 가입했습니다.`,
      metadata: {
        loginId: user.loginId,
        studentId: user.studentId,
        role: user.role
      }
    });
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
    await createGeneralActivityLog(prisma, {
      category: "ACCOUNT",
      action: "CHANGE_PASSWORD",
      actor: user,
      target: { type: "USER", id: user.id, name: user.name },
      message: `${user.name} 회원이 비밀번호를 변경했습니다.`
    });

    revalidatePath("/");
    revalidatePath("/admin/logs");
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

export async function saveGameRatingAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`rate-game:${user.id}`, 20, 60_000);

  const parsed = z
    .object({
      gameId: z.string().min(1),
      score: z.coerce
        .number()
        .min(1, "평점은 1.0점 이상이어야 합니다.")
        .max(5, "평점은 5.0점 이하여야 합니다.")
        .refine((score) => Math.abs(score * 10 - Math.round(score * 10)) < 0.000001, "평점은 0.1 단위로 입력해주세요.")
        .transform((score) => Math.round(score * 10) / 10),
      played: z.boolean(),
      reasonTags: z.array(z.string()).min(1, "평점 이유 태그를 하나 이상 선택해주세요.").max(6),
      comment: z.string().trim().max(300).optional()
    })
    .parse({
      gameId: value(formData, "gameId"),
      score: formData.get("score"),
      played: formData.get("played") === "on",
      reasonTags: formData.getAll("reasonTags").map((tag) => String(tag)),
      comment: value(formData, "comment") || undefined
    });

  const reasonTags = Array.from(new Set(parsed.reasonTags)).filter((tag) => RATING_REASON_VALUES.has(tag));

  if (reasonTags.length === 0) {
    throw new Error("평점 이유 태그를 하나 이상 선택해주세요.");
  }

  const expectedReasonValues =
    parsed.score >= 4
      ? POSITIVE_RATING_REASON_VALUES
      : parsed.score >= 3
        ? new Set([...POSITIVE_RATING_REASON_VALUES, ...NEGATIVE_RATING_REASON_VALUES])
        : NEGATIVE_RATING_REASON_VALUES;
  const expectedReasonLabel = parsed.score >= 4 ? "좋았던 이유" : parsed.score >= 3 ? "좋았던 이유 또는 아쉬웠던 이유" : "아쉬웠던 이유";

  if (reasonTags.some((tag) => !expectedReasonValues.has(tag))) {
    throw new Error(`${parsed.score.toFixed(1)}점에는 ${expectedReasonLabel} 태그만 선택할 수 있습니다.`);
  }

  const game = await prisma.game.findUnique({
    where: { id: parsed.gameId },
    select: { id: true, title: true }
  });

  if (!game) {
    throw new Error("평가할 게임을 찾을 수 없습니다.");
  }

  const [verifiedLoanCount, recentRatingCount, existingRating] = await Promise.all([
    prisma.loanActivityLog.count({
      where: {
        type: "BORROW",
        gameId: parsed.gameId,
        borrowerId: user.id
      }
    }),
    prisma.gameRating.count({
      where: {
        userId: user.id,
        updatedAt: { gte: new Date(Date.now() - 60_000) }
      }
    }),
    prisma.gameRating.findUnique({
      where: {
        gameId_userId: {
          gameId: parsed.gameId,
          userId: user.id
        }
      },
      select: {
        score: true,
        playedStatus: true,
        trustWeight: true,
        reasonTags: true,
        comment: true,
        isHidden: true
      }
    })
  ]);

  const verified = verifiedLoanCount > 0;
  const playedStatus = verified ? "VERIFIED" : parsed.played ? "SELF_REPORTED" : "UNVERIFIED";
  const trustWeight = calculateRatingTrustWeight({
    verified,
    selfReported: parsed.played,
    reasonTagCount: reasonTags.length,
    hasComment: Boolean(parsed.comment),
    recentRatingCount
  });

  await prisma.gameRating.upsert({
    where: {
      gameId_userId: {
        gameId: parsed.gameId,
        userId: user.id
      }
    },
    create: {
      gameId: parsed.gameId,
      userId: user.id,
      score: parsed.score,
      playedStatus,
      trustWeight,
      reasonTags,
      comment: parsed.comment
    },
    update: {
      score: parsed.score,
      playedStatus,
      trustWeight,
      reasonTags,
      comment: parsed.comment,
      isHidden: false
    }
  });

  await createGeneralActivityLog(prisma, {
    category: "RATING",
    action: existingRating ? "UPDATE_RATING" : "CREATE_RATING",
    actor: user,
    target: { type: "GAME", id: game.id, name: game.title },
    message: existingRating
      ? `${user.name} 회원이 ${game.title} 보드게임 평점을 수정했습니다.`
      : `${user.name} 회원이 ${game.title} 보드게임에 평점을 남겼습니다.`,
    metadata: {
      score: parsed.score,
      playedStatus,
      trustWeight,
      reasonTags,
      hasComment: Boolean(parsed.comment),
      previous: existingRating
        ? {
          score: existingRating.score,
          playedStatus: existingRating.playedStatus,
          trustWeight: existingRating.trustWeight,
          reasonTags: existingRating.reasonTags,
          hasComment: Boolean(existingRating.comment),
          wasHidden: existingRating.isHidden
        }
        : null
    }
  });

  revalidatePath("/");
  revalidatePath("/account");
  revalidatePath("/admin/logs");
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

    const game = await prisma.game.create({
      data: {
        ...parsed,
        isPresent: parsed.isPresent === "" || parsed.isPresent === undefined ? null : parsed.isPresent === "true"
      }
    });
    await createGeneralActivityLog(prisma, {
      category: "GAME",
      action: "CREATE",
      actor: user,
      target: { type: "GAME", id: game.id, name: game.title },
      message: `${user.name} 관리자가 ${game.title} 보드게임을 등록했습니다.`,
      metadata: {
        players: game.players,
        bestPlayers: game.bestPlayers,
        playTime: game.playTime,
        quantity: game.quantity,
        genre: game.genre,
        isPresent: game.isPresent,
        weight: game.weight
      }
    });
    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/games");
    revalidatePath("/admin/logs");
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
  revalidatePath("/account");
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

  const returnRequest = await prisma.$transaction(async (tx) => {
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

    return request;
  });

  await notifyReturnRequested({
    loanId,
    loanRequestId: returnRequest.id,
    gameTitle: activeLoan.game.title,
    borrowerName: user.name,
    borrowerLoginId: user.loginId,
    borrowerStudentId: user.studentId,
    dueAt: activeLoan.dueAt,
    requestedAt: returnRequest.requestedAt,
    userId: user.id
  });

  revalidatePath("/");
  revalidatePath("/account");
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

      await tx.game.update({
        where: { id: request.gameId },
        data: { status: "AVAILABLE" }
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

      await tx.loan.delete({
        where: { id: request.loanId }
      });
    }

    if (request.type === "BORROW") {
      await tx.loanRequest.update({
        where: { id: request.id },
        data: {
          status: "APPROVED",
          reviewerId: user.id,
          reviewedAt: now
        }
      });
    }
  });

  revalidatePath("/");
  revalidatePath("/account");
  revalidatePath("/admin");
  revalidatePath("/admin/loans");
  revalidatePath("/admin/logs");
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
  revalidatePath("/account");
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
  revalidatePath("/account");
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
    prisma.meetupActivityLog.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
    prisma.generalActivityLog.deleteMany({ where: { occurredAt: { lt: cutoff } } })
  ]);

  revalidatePath("/admin");
  revalidatePath("/admin/logs");
  redirect(`/admin/logs?notice=logs-pruned&days=${days}`);
}

export async function saveAnnouncementAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    assertRateLimit(`save-announcement:${user.id}`, 12, 60_000);

    if (user.role !== "ADMIN") {
      return { message: "관리자만 공지를 수정할 수 있습니다." };
    }

    const publishedAtValue = value(formData, "publishedAt");
    const parsed = z
      .object({
        id: z.string().optional(),
        title: z.string().trim().min(1, "공지 제목을 입력해주세요.").max(80, "공지 제목은 80자 이하여야 합니다."),
        body: z.string().trim().min(1, "공지 내용을 입력해주세요.").max(2000, "공지 내용은 2000자 이하여야 합니다."),
        isActive: z.boolean(),
        publishedAt: z.date()
      })
      .parse({
        id: value(formData, "id") || undefined,
        title: value(formData, "title"),
        body: value(formData, "body"),
        isActive: formData.get("isActive") === "on",
        publishedAt: publishedAtValue ? new Date(publishedAtValue) : new Date()
      });

    if (Number.isNaN(parsed.publishedAt.getTime())) {
      return { message: "게시일 형식이 올바르지 않습니다." };
    }

    const announcement = parsed.id
      ? await prisma.announcement.update({
        where: { id: parsed.id },
        data: {
          title: parsed.title,
          body: parsed.body,
          isActive: parsed.isActive,
          publishedAt: parsed.publishedAt
        }
      })
      : await prisma.announcement.create({
        data: {
          title: parsed.title,
          body: parsed.body,
          isActive: parsed.isActive,
          publishedAt: parsed.publishedAt
        }
      });

    await createGeneralActivityLog(prisma, {
      category: "ANNOUNCEMENT",
      action: parsed.id ? "UPDATE" : "CREATE",
      actor: user,
      target: { type: "ANNOUNCEMENT", id: announcement.id, name: announcement.title },
      message: `${user.name} 관리자가 공지사항을 ${parsed.id ? "수정" : "등록"}했습니다.`,
      metadata: {
        isActive: announcement.isActive,
        publishedAt: announcement.publishedAt.toISOString()
      }
    });

    revalidatePath("/");
    revalidatePath("/account");
    revalidatePath("/admin/logs");
    revalidatePath("/admin/announcements");
    return { ok: true, message: parsed.id ? "공지사항을 수정했습니다." : "공지사항을 등록했습니다." };
  } catch (error) {
    return { message: actionError(error, "공지사항 저장에 실패했습니다.") };
  }
}

export async function deleteAnnouncementAction(formData: FormData) {
  const user = await requireUser();
  assertRateLimit(`delete-announcement:${user.id}`, 12, 60_000);

  if (user.role !== "ADMIN") {
    throw new Error("관리자만 공지를 삭제할 수 있습니다.");
  }

  const announcement = await prisma.announcement.delete({
    where: { id: value(formData, "id") }
  });
  await createGeneralActivityLog(prisma, {
    category: "ANNOUNCEMENT",
    action: "DELETE",
    actor: user,
    target: { type: "ANNOUNCEMENT", id: announcement.id, name: announcement.title },
    message: `${user.name} 관리자가 공지사항을 삭제했습니다.`,
    metadata: {
      isActive: announcement.isActive,
      publishedAt: announcement.publishedAt.toISOString()
    }
  });

  revalidatePath("/");
  revalidatePath("/account");
  revalidatePath("/admin/logs");
  revalidatePath("/admin/announcements");
  redirect("/admin/announcements?notice=announcement-deleted");
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

    const game = await prisma.game.update({
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
    await createGeneralActivityLog(prisma, {
      category: "GAME",
      action: "UPDATE",
      actor: user,
      target: { type: "GAME", id: game.id, name: game.title },
      message: `${user.name} 관리자가 ${game.title} 보드게임 정보를 수정했습니다.`,
      metadata: {
        quantity: game.quantity,
        genre: game.genre,
        isPresent: game.isPresent,
        weight: game.weight
      }
    });

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/logs");
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

    const targetUser = await prisma.user.update({
      where: { id: parsed.id },
      data: {
        name: parsed.name,
        studentId: parsed.studentId ?? null,
        role: parsed.role
      }
    });
    await createGeneralActivityLog(prisma, {
      category: "USER",
      action: "UPDATE",
      actor: user,
      target: { type: "USER", id: targetUser.id, name: targetUser.name },
      message: `${user.name} 관리자가 ${targetUser.name} 회원 정보를 수정했습니다.`,
      metadata: {
        loginId: targetUser.loginId,
        studentId: targetUser.studentId,
        role: targetUser.role
      }
    });

    revalidatePath("/admin");
    revalidatePath("/admin/logs");
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

  const targetUser = await prisma.user.update({
    where: { id: targetUserId },
    data: {
      passwordHash: await bcrypt.hash("1981", 12),
      mustChangePassword: true
    }
  });

  await prisma.session.deleteMany({ where: { userId: targetUserId } });
  await createGeneralActivityLog(prisma, {
    category: "ACCOUNT",
    action: "RESET_PASSWORD",
    actor: user,
    target: { type: "USER", id: targetUser.id, name: targetUser.name },
    message: `${user.name} 관리자가 ${targetUser.name} 회원의 비밀번호를 초기화했습니다.`,
    metadata: {
      loginId: targetUser.loginId,
      studentId: targetUser.studentId
    }
  });
  revalidatePath("/admin");
  revalidatePath("/admin/logs");
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

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, loginId: true, studentId: true, role: true }
  });

  if (!targetUser) {
    throw new Error("삭제할 회원을 찾을 수 없습니다.");
  }

  await prisma.user.delete({ where: { id: targetUserId } });
  await createGeneralActivityLog(prisma, {
    category: "USER",
    action: "DELETE",
    actor: user,
    target: { type: "USER", id: targetUser.id, name: targetUser.name },
    message: `${user.name} 관리자가 ${targetUser.name} 회원 계정을 삭제했습니다.`,
    metadata: {
      loginId: targetUser.loginId,
      studentId: targetUser.studentId,
      role: targetUser.role
    }
  });
  revalidatePath("/admin");
  revalidatePath("/admin/logs");
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

      await createGeneralActivityLog(tx, {
        category: "GAME",
        action: "IMPORT",
        actor: user,
        target: { type: "GAME", name: "보드게임 DB" },
        message: `${user.name} 관리자가 보드게임 DB를 엑셀로 반영했습니다.`,
        metadata: {
          rowCount: rows.length,
          createdCount,
          updatedCount,
          deletedCount,
          keptCount
        }
      });
    });

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/games");
    revalidatePath("/admin/logs");
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
