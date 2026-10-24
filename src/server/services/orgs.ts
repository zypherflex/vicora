import { and, eq, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { PROVIDER_ORG_TYPES } from "@/lib/domain";
import { ROLES_FOR_ORG_TYPE, type Role } from "@/lib/permissions";
import { hashPassword, randomToken, sha256Hex, verifyPassword } from "@/server/auth/crypto";
import { createSession, loadMemberships } from "@/server/auth/session";
import { requirePerm, type Ctx } from "@/server/authz/context";
import { systemDb } from "@/server/db/client";
import { auditLog, invitations, memberships, organizations, outboundMessages, providerProfiles, users } from "@/server/db/schema";
import { env } from "@/server/env";
import { AppError, conflict, notFound } from "@/server/http/errors";
import type { acceptInviteSchema, inviteSchema, orgSettingsSchema, registerSchema, updateMemberSchema } from "@/server/validators";
import { audit } from "./common";

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";
}

/** Self-service registration creates a user, an organization and an OWNER membership atomically. */
export async function registerOrganization(input: z.infer<typeof registerSchema>, meta: { ip?: string; userAgent?: string }) {
  const db = systemDb();
  const passwordHash = await hashPassword(input.password);
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing) throw conflict("An account with this email already exists. Sign in and create the organization from your account.");
    const [user] = await tx.insert(users).values({ email: input.email, name: input.name, passwordHash }).returning();
    const o = input.organization;
    const [org] = await tx
      .insert(organizations)
      .values({
        name: o.name,
        slug: `${slugify(o.name)}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`,
        type: o.type,
        city: o.city,
        state: o.state ?? null,
        usdotNumber: o.usdotNumber ?? null,
        mcNumber: o.mcNumber ?? null,
      })
      .returning();
    await tx.insert(memberships).values({ orgId: org.id, userId: user.id, roles: ["OWNER"] });
    if (PROVIDER_ORG_TYPES.includes(o.type)) {
      await tx.insert(providerProfiles).values({
        orgId: org.id,
        serviceTypes: o.type === "AUTO_TRANSPORT" ? ["AUTO_TRANSPORT"] : ["FTL", "LTL"],
        serviceStates: o.state ? [o.state] : [],
      });
    }
    await tx.insert(auditLog).values({ orgId: org.id, actorUserId: user.id, action: "org.registered", entityType: "organization", entityId: org.id, ip: meta.ip });
    return { user, org };
  });
  const session = await createSession(result.user.id, result.org.id, meta);
  return { ...result, session };
}

/** Constant-work login: always runs a password hash comparison to avoid user enumeration by timing. */
export async function login(email: string, password: string, meta: { ip?: string; userAgent?: string }) {
  const db = systemDb();
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  const ok = await verifyPassword(password, user?.passwordHash ?? "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  if (!user || !ok || user.disabledAt) {
    await db.insert(auditLog).values({ action: "auth.login_failed", entityType: "user", entityId: user?.id ?? null, ip: meta.ip, after: { email } });
    throw new AppError("UNAUTHENTICATED", "Email or password is incorrect");
  }
  const ms = await loadMemberships(user.id);
  const session = await createSession(user.id, ms[0]?.orgId ?? null, meta);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await db.insert(auditLog).values({ orgId: ms[0]?.orgId ?? null, actorUserId: user.id, action: "auth.login", entityType: "user", entityId: user.id, ip: meta.ip });
  return { user, session };
}

/* ---------------------------------------------------------------- Team */

export async function listMembers(ctx: Ctx) {
  requirePerm(ctx, "team.read");
  const rows = await ctx.db
    .select({
      id: memberships.id,
      userId: memberships.userId,
      roles: memberships.roles,
      grants: memberships.grants,
      revocations: memberships.revocations,
      status: memberships.status,
      name: users.name,
      email: users.email,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, ctx.org.id))
    .orderBy(users.name);
  const invites = ctx.perms.has("team.manage")
    ? await ctx.db
        .select({ id: invitations.id, email: invitations.email, roles: invitations.roles, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
        .from(invitations)
        .where(and(eq(invitations.orgId, ctx.org.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    : [];
  return { members: rows, invites };
}

function assertRolesAllowed(ctx: Ctx, roles: Role[]) {
  const allowed = ROLES_FOR_ORG_TYPE[ctx.org.type];
  const bad = roles.filter((r) => !allowed.includes(r));
  if (bad.length) throw new AppError("VALIDATION_FAILED", `Roles not available for this organization type: ${bad.join(", ")}`);
  if (roles.includes("OWNER") && !ctx.roles.includes("OWNER")) throw new AppError("FORBIDDEN", "Only owners can grant the owner role");
}

export async function inviteMember(ctx: Ctx, input: z.infer<typeof inviteSchema>) {
  requirePerm(ctx, "team.manage");
  assertRolesAllowed(ctx, input.roles);
  const token = randomToken(24);
  const [inv] = await ctx.db
    .insert(invitations)
    .values({ orgId: ctx.org.id, email: input.email, roles: input.roles, tokenHash: sha256Hex(token), invitedBy: ctx.user.id, expiresAt: new Date(Date.now() + 7 * 86400_000) })
    .returning({ id: invitations.id, expiresAt: invitations.expiresAt });
  const url = `${env().APP_URL}/invite/${token}`;
  // Email delivery is not connected; the message is written to the outbox for review.
  await systemDb().insert(outboundMessages).values({
    channel: "EMAIL",
    to: input.email,
    subject: `${ctx.user.name} invited you to ${ctx.org.name} on Vicora`,
    body: `Accept your invitation: ${url}\nThis link expires in 7 days.`,
    provider: env().EMAIL_PROVIDER,
    status: env().EMAIL_PROVIDER === "outbox" ? "DELIVERED_TO_OUTBOX" : "NOT_CONNECTED",
  });
  await audit(ctx, "team.invited", "invitation", inv.id, { after: { email: input.email, roles: input.roles } });
  return { ...inv, acceptUrl: url };
}

export async function revokeInvitation(ctx: Ctx, invitationId: string) {
  requirePerm(ctx, "team.manage");
  const res = await ctx.db.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.id, invitationId), eq(invitations.orgId, ctx.org.id))).returning({ id: invitations.id });
  if (!res.length) throw notFound("Invitation");
  await audit(ctx, "team.invitation_revoked", "invitation", invitationId);
}

export async function lookupInvitation(token: string) {
  const [inv] = await systemDb()
    .select({ id: invitations.id, email: invitations.email, roles: invitations.roles, expiresAt: invitations.expiresAt, acceptedAt: invitations.acceptedAt, revokedAt: invitations.revokedAt, orgName: organizations.name, orgType: organizations.type })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.orgId))
    .where(eq(invitations.tokenHash, sha256Hex(token)));
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return null;
  const [existing] = await systemDb().select({ id: users.id }).from(users).where(eq(users.email, inv.email));
  return { ...inv, hasAccount: !!existing };
}

/**
 * Accept an invitation. A signed-in user whose email matches joins directly (multi-org membership);
 * a new person sets a name and password.
 */
export async function acceptInvitation(input: z.infer<typeof acceptInviteSchema>, signedInUserId: string | null, meta: { ip?: string; userAgent?: string }) {
  const db = systemDb();
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invitations).where(eq(invitations.tokenHash, sha256Hex(input.token))).for("update");
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) throw new AppError("NOT_FOUND", "This invitation is invalid or has expired");
    let [user] = await tx.select().from(users).where(eq(users.email, inv.email));
    if (user) {
      if (user.id !== signedInUserId) throw new AppError("UNAUTHENTICATED", "Sign in as the invited user to accept this invitation");
    } else {
      if (!input.name || !input.password) throw new AppError("VALIDATION_FAILED", "Name and password are required to create your account");
      [user] = await tx.insert(users).values({ email: inv.email, name: input.name, passwordHash: await hashPassword(input.password) }).returning();
    }
    await tx
      .insert(memberships)
      .values({ orgId: inv.orgId, userId: user.id, roles: inv.roles })
      .onConflictDoUpdate({ target: [memberships.orgId, memberships.userId], set: { roles: inv.roles, status: "ACTIVE" } });
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    await tx.insert(auditLog).values({ orgId: inv.orgId, actorUserId: user.id, action: "team.invitation_accepted", entityType: "invitation", entityId: inv.id, ip: meta.ip });
    return { userId: user.id, orgId: inv.orgId };
  });
}

export async function updateMember(ctx: Ctx, membershipId: string, input: z.infer<typeof updateMemberSchema>) {
  requirePerm(ctx, "team.manage");
  const [m] = await ctx.db.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.orgId, ctx.org.id)));
  if (!m) throw notFound("Member");
  if (input.roles) assertRolesAllowed(ctx, input.roles);
  if (m.roles.includes("OWNER") && !ctx.roles.includes("OWNER")) throw new AppError("FORBIDDEN", "Only owners can change another owner");
  const losingOwner = m.roles.includes("OWNER") && ((input.roles && !input.roles.includes("OWNER")) || input.status === "SUSPENDED");
  if (losingOwner) {
    const [{ n }] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.orgId, ctx.org.id), eq(memberships.status, "ACTIVE"), sql`'OWNER' = any(${memberships.roles})`));
    if (n <= 1) throw conflict("An organization must keep at least one active owner");
  }
  const [updated] = await ctx.db
    .update(memberships)
    .set({ roles: input.roles ?? m.roles, grants: input.grants ?? m.grants, revocations: input.revocations ?? m.revocations, status: input.status ?? m.status })
    .where(eq(memberships.id, m.id))
    .returning();
  await audit(ctx, "team.member_updated", "membership", m.id, {
    before: { roles: m.roles, grants: m.grants, revocations: m.revocations, status: m.status },
    after: { roles: updated.roles, grants: updated.grants, revocations: updated.revocations, status: updated.status },
  });
  return updated;
}

export async function updateOrgSettings(ctx: Ctx, input: z.infer<typeof orgSettingsSchema>) {
  requirePerm(ctx, "org.manage");
  const [before] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.org.id));
  await ctx.db
    .update(organizations)
    .set({ name: input.name ?? before.name, timezone: input.timezone ?? before.timezone, documentRetentionDays: input.documentRetentionDays ?? before.documentRetentionDays })
    .where(eq(organizations.id, ctx.org.id));
  if (PROVIDER_ORG_TYPES.includes(ctx.org.type) && (input.serviceStates || input.equipmentTypes || input.serviceTypes || input.acceptingLoads !== undefined)) {
    await ctx.db
      .insert(providerProfiles)
      .values({ orgId: ctx.org.id, serviceStates: input.serviceStates ?? [], equipmentTypes: input.equipmentTypes ?? [], serviceTypes: input.serviceTypes ?? [], acceptingLoads: input.acceptingLoads ?? true })
      .onConflictDoUpdate({
        target: providerProfiles.orgId,
        set: {
          ...(input.serviceStates ? { serviceStates: input.serviceStates } : {}),
          ...(input.equipmentTypes ? { equipmentTypes: input.equipmentTypes } : {}),
          ...(input.serviceTypes ? { serviceTypes: input.serviceTypes } : {}),
          ...(input.acceptingLoads !== undefined ? { acceptingLoads: input.acceptingLoads } : {}),
        },
      });
  }
  await audit(ctx, "org.settings_updated", "organization", ctx.org.id, { before: { name: before.name, retention: before.documentRetentionDays }, after: input });
}

export async function getOrgProfile(ctx: Ctx) {
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.org.id));
  const [profile] = await ctx.db.select().from(providerProfiles).where(eq(providerProfiles.orgId, ctx.org.id));
  return { org, profile: profile ?? null };
}
