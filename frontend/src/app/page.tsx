import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionInfo } from "@/api/authSsr";
import { Config } from "@/config";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSessionInfo();

  if (session) {
    const now = Date.now();
    const regTs = Date.parse(session.userCreatedAt);
    const isNewbie = Number.isFinite(regTs) && now - regTs <= 48 * 60 * 60 * 1000;
    if (isNewbie) {
      redirect(Config.WELCOME_PAGE_PATH);
    } else {
      redirect("/posts");
    }
  }

  return (
    <main className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md border rounded-xl shadow-sm bg-white p-6 text-center">
        <div className="mb-4">
          <div className="text-3xl font-extrabold text-blue-600 select-none">STGY</div>
          <div className="text-sm text-gray-500 mt-1">Self-Tuning Generative Yarns</div>
        </div>
        <p className="text-gray-700 mb-6">Welcome! Please log in or sign up to continue.</p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/login"
            className="px-4 py-2 rounded border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="px-4 py-2 rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 cursor-pointer"
          >
            Sign up
          </Link>
        </div>
      </div>
    </main>
  );
}
