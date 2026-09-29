import { eq } from "drizzle-orm";
import * as schema from "../db/schema/auth";
import type { Auth } from "./auth";
import type { Database } from "./database";

type SessionResult = Awaited<ReturnType<Auth["api"]["getSession"]>>;
type User = NonNullable<SessionResult>["user"];

const ADMIN_NEAR_ACCOUNTS = new Set(
  (process.env.ADMIN_NEAR_ACCOUNTS ?? "ballzz.near")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

export interface RequestContext {
  session: SessionResult;
  user: User | null;
  nearAccountId: string | null;
  reqHeaders: Headers;
  getRawBody?: () => Promise<string>;
}

export async function createRequestContext(
  req: Request,
  auth: Auth,
  db: Database
): Promise<RequestContext> {
  const session = await auth.api.getSession({ headers: req.headers });

  let nearAccountId: string | null = null;
  if (session?.user?.id) {
    const nearAccount = await db.query.nearAccount.findFirst({
      where: eq(schema.nearAccount.userId, session.user.id),
    });
    nearAccountId = nearAccount?.accountId ?? null;
  }

  const elevatedSession = await elevateConfiguredAdmin(session, nearAccountId, db);

  return {
    session: elevatedSession,
    user: elevatedSession?.user ?? null,
    nearAccountId,
    reqHeaders: req.headers,
  };
}

async function elevateConfiguredAdmin(
  session: SessionResult,
  nearAccountId: string | null,
  db: Database,
): Promise<SessionResult> {
  if (!session?.user?.id || !nearAccountId || !ADMIN_NEAR_ACCOUNTS.has(nearAccountId)) {
    return session;
  }

  if (session.user.role !== "admin") {
    await db
      .update(schema.user)
      .set({ role: "admin" })
      .where(eq(schema.user.id, session.user.id));
  }

  return {
    ...session,
    user: {
      ...session.user,
      role: "admin",
    },
  };
}
