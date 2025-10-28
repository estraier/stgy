import Link from "next/link";
import SessionProbe from "@/components/SessionProbe";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function HomePage() {
  return (
    <>
      <SessionProbe redirectIfLoggedIn />
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
    </>
  );
}
