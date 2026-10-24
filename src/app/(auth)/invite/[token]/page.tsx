import type { Metadata } from "next";
import { ORG_TYPE_LABEL } from "@/lib/domain";
import { currentAuth } from "@/server/http/api";
import { lookupInvitation } from "@/server/services/orgs";
import { AcceptInvite } from "./accept";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await lookupInvitation(token);
  if (!inv) {
    return (
      <>
        <h1 className="text-lg font-semibold">Invitation unavailable</h1>
        <p className="mt-2 text-sm text-slate-600">This link is invalid, expired, or has already been used. Ask your administrator for a new invitation.</p>
      </>
    );
  }
  const auth = await currentAuth();
  return (
    <>
      <h1 className="text-lg font-semibold">Join {inv.orgName}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {ORG_TYPE_LABEL[inv.orgType]} · roles: {inv.roles.join(", ")} · for <strong>{inv.email}</strong>
      </p>
      <AcceptInvite token={token} hasAccount={inv.hasAccount} signedInAs={auth?.user.email ?? null} invitedEmail={inv.email} />
    </>
  );
}
