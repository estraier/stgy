import HomePageClient from "./HomePageClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata = {
  title: "STGY - log in or sign up",
  description:
    "Create an account or log into STGY. Connect with friends, family and other people you know. Share photos and videos, send messages and get updates.",
};

export default function HomePage() {
  return <HomePageClient />;
}
