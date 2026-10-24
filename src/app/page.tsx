import { redirect } from "next/navigation";
import { currentAuth } from "@/server/http/api";

export default async function Home() {
  const auth = await currentAuth();
  redirect(auth?.active ? "/command" : "/login");
}
