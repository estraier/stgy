import PubGoogleAnalyticsPageView from "@/components/PubGoogleAnalyticsPageView";

type Props = {
  measurementId: string;
  contentGroup: string;
  contentId: string;
  contentType: string;
  pageViewKey?: string;
};

export default function PubGoogleAnalytics({
  measurementId,
  contentGroup,
  contentId,
  contentType,
  pageViewKey,
}: Props) {
  const tagId = measurementId.trim();
  if (!tagId) return null;

  return (
    <>
      <script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tagId)}`}
      />
      <PubGoogleAnalyticsPageView
        measurementId={tagId}
        contentGroup={contentGroup}
        contentId={contentId}
        contentType={contentType}
        pageViewKey={pageViewKey}
      />
    </>
  );
}
