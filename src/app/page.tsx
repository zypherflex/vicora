import { redirect } from "next/navigation";
import { currentAuth } from "@/server/http/api";

export default async function Home() {
  const auth = await currentAuth();
  redirect(!auth ? "/login" : auth.active ? (auth.active.roles.every((r) => r === "DRIVER") ? "/driver" : "/command") : auth.user.isPlatformAdmin ? "/admin" : "/login?reason=no-org");
}
